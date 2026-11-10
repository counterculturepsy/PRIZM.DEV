import { lookup as dnsLookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { getServerEnv } from "@/config/env";
import { isRobotsAllowed } from "@/modules/audits/robots";
import { isPrivateAddress, normalizeAuditUrl } from "@/modules/audits/url-policy";
import { AuditPolicyError, type AuditSnapshot, type WebsiteAuditProvider } from "@/modules/audits/types";

type ResponseData = Readonly<{ status: number; headers: Record<string, string>; body: Buffer; bytes: number; durationMs: number }>;
const ROBOTS_MAX_BYTES = 256_000;
const MAX_REDIRECTS = 3;

/** Idle limits stop a silent server; total limits stop one that trickles data; the inspect budget bounds a whole audit. */
export type AuditLimits = Readonly<{ pageIdleMs: number; pageTotalMs: number; robotsIdleMs: number; robotsTotalMs: number; inspectTotalMs: number }>;
export const DEFAULT_AUDIT_LIMITS: AuditLimits = { pageIdleMs: 10_000, pageTotalMs: 20_000, robotsIdleMs: 5_000, robotsTotalMs: 8_000, inspectTotalMs: 60_000 };

type RequestFunction = (options: https.RequestOptions, callback: (response: http.IncomingMessage) => void) => http.ClientRequest;
type ResolvedAddress = Readonly<{ address: string; family: number }>;

/** Replaceable network layer, so the full HTTP behaviour can be tested without real sockets or third-party requests. */
export type AuditNetwork = Readonly<{
  lookup?: (hostname: string) => Promise<readonly ResolvedAddress[]>;
  request?: (protocol: "http:" | "https:") => RequestFunction;
  limits?: Partial<AuditLimits>;
}>;

const defaultLookup = (hostname: string) => dnsLookup(hostname, { all: true, verbatim: true });
const defaultRequest = (protocol: "http:" | "https:"): RequestFunction => (protocol === "https:" ? https.request : http.request) as RequestFunction;

function normalizedHeaders(headers: http.IncomingHttpHeaders): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).flatMap(([name, value]) => value === undefined ? [] : [[name.toLowerCase(), Array.isArray(value) ? value.join(", ") : value]]));
}

function redirectTarget(current: URL, response: ResponseData): URL | null {
  if (![301, 302, 303, 307, 308].includes(response.status)) return null;
  const location = response.headers["location"];
  if (!location) throw new AuditPolicyError("redirect_missing_location", "The website returned an invalid redirect.");
  let next: URL;
  try {
    next = new URL(location, current);
  } catch {
    throw new AuditPolicyError("invalid_url", "The website redirected to an invalid address.");
  }
  if (next.protocol !== "http:" && next.protocol !== "https:") throw new AuditPolicyError("invalid_url", "The website redirected to an unsupported address.");
  return normalizeAuditUrl(next.toString());
}

function timeBudget(deadline: number, configuredMs: number): number {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new AuditPolicyError("request_timeout", "The audit exceeded its total time limit.");
  return Math.min(configuredMs, remaining);
}

export class SafeHttpAuditProvider implements WebsiteAuditProvider {
  readonly id = "safe-http-v1";
  private readonly lookup: NonNullable<AuditNetwork["lookup"]>;
  private readonly requestFor: NonNullable<AuditNetwork["request"]>;
  private readonly limits: AuditLimits;

  constructor(private readonly userAgent: string, private readonly maxResponseBytes: number, network: AuditNetwork = {}) {
    this.lookup = network.lookup ?? defaultLookup;
    this.requestFor = network.request ?? defaultRequest;
    this.limits = { ...DEFAULT_AUDIT_LIMITS, ...network.limits };
  }

  private async resolvePublicAddress(url: URL): Promise<ResolvedAddress> {
    let addresses: readonly ResolvedAddress[];
    try {
      addresses = await this.lookup(url.hostname);
    } catch {
      throw new AuditPolicyError("dns_failed", "The website hostname could not be resolved.");
    }
    if (addresses.length === 0 || addresses.some((entry) => isPrivateAddress(entry.address))) {
      throw new AuditPolicyError("private_destination", "The destination resolved to a private or reserved address.");
    }
    const [selected] = addresses;
    if (!selected) throw new AuditPolicyError("dns_failed", "The website hostname could not be resolved.");
    return selected;
  }

  private async requestOnce(url: URL, maxBytes: number, idleMs: number, totalMs: number): Promise<ResponseData> {
    const target = normalizeAuditUrl(url.toString());
    const resolved = await this.resolvePublicAddress(target);
    const send = this.requestFor(target.protocol === "https:" ? "https:" : "http:");
    return new Promise((resolve, reject) => {
      const started = Date.now();
      let settled = false;
      const state: { timer?: NodeJS.Timeout; request?: http.ClientRequest } = {};
      const settle = (finish: () => void) => {
        if (settled) return;
        settled = true;
        if (state.timer) clearTimeout(state.timer);
        finish();
      };
      const fail = (error: unknown) => settle(() => {
        state.request?.destroy();
        reject(error instanceof AuditPolicyError ? error : new AuditPolicyError("request_failed", "The website request failed."));
      });
      state.timer = setTimeout(() => fail(new AuditPolicyError("request_timeout", "The website did not finish responding within the audit limit.")), totalMs);

      const outgoing = send({
        protocol: target.protocol,
        hostname: resolved.address,
        family: resolved.family,
        port: target.port || undefined,
        path: `${target.pathname}${target.search}`,
        method: "GET",
        servername: target.protocol === "https:" ? target.hostname : undefined,
        headers: { Accept: "text/html,application/xhtml+xml,text/plain;q=0.5", "Accept-Encoding": "identity", Host: target.host, "User-Agent": this.userAgent },
      }, (response) => {
        const chunks: Buffer[] = [];
        let bytes = 0;
        response.on("data", (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > maxBytes) {
            fail(new AuditPolicyError("response_too_large", "The response exceeded the configured byte limit."));
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () => settle(() => resolve({
          status: response.statusCode ?? 0,
          headers: normalizedHeaders(response.headers),
          body: Buffer.concat(chunks),
          bytes,
          durationMs: Date.now() - started,
        })));
        response.on("error", fail);
        response.on("close", () => {
          if (!response.complete) fail(new AuditPolicyError("request_failed", "The website closed the connection before finishing its response."));
        });
      });
      state.request = outgoing;
      outgoing.setTimeout(idleMs, () => fail(new AuditPolicyError("request_timeout", "The website did not respond within the audit limit.")));
      outgoing.on("error", fail);
      outgoing.end();
    });
  }

  private async requestRobots(start: URL, deadline: number): Promise<ResponseData> {
    let current = new URL("/robots.txt", start.origin);
    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
      const response = await this.requestOnce(current, ROBOTS_MAX_BYTES, this.limits.robotsIdleMs, timeBudget(deadline, this.limits.robotsTotalMs));
      const redirect = redirectTarget(current, response);
      if (!redirect) return response;
      if (redirects === MAX_REDIRECTS) throw new AuditPolicyError("redirect_limit", "Robots policy exceeded the redirect limit.");
      current = redirect;
    }
    throw new AuditPolicyError("redirect_limit", "Robots policy exceeded the redirect limit.");
  }

  private async assertRobotsAllowed(url: URL, deadline: number): Promise<void> {
    const response = await this.requestRobots(url, deadline);
    if (response.status === 404) return;
    if (response.status < 200 || response.status >= 300) throw new AuditPolicyError("robots_unavailable", "Robots policy could not be confirmed.");
    if (!isRobotsAllowed(response.body.toString("utf8"), url, "prizmdev")) throw new AuditPolicyError("robots_disallowed", "The website robots policy does not allow this audit.");
  }

  async inspect(requestedUrl: URL): Promise<AuditSnapshot> {
    const deadline = Date.now() + this.limits.inspectTotalMs;
    let current = normalizeAuditUrl(requestedUrl.toString());
    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
      await this.assertRobotsAllowed(current, deadline);
      const response = await this.requestOnce(current, this.maxResponseBytes, this.limits.pageIdleMs, timeBudget(deadline, this.limits.pageTotalMs));
      const redirect = redirectTarget(current, response);
      if (redirect) {
        if (redirects === MAX_REDIRECTS) throw new AuditPolicyError("redirect_limit", "The website exceeded the redirect limit.");
        current = redirect;
        continue;
      }
      const contentType = response.headers["content-type"] ?? "";
      if (!/^(text\/html|application\/xhtml\+xml)(;|$)/i.test(contentType)) throw new AuditPolicyError("unsupported_content_type", "Only HTML website responses can be audited.");
      const encoding = (response.headers["content-encoding"] ?? "identity").toLowerCase();
      if (encoding !== "identity") throw new AuditPolicyError("unsupported_content_type", "Compressed website responses cannot be audited.");
      return {
        requestedUrl: requestedUrl.toString(), finalUrl: current.toString(), status: response.status,
        contentType, headers: response.headers, body: response.body, responseBytes: response.bytes,
        durationMs: response.durationMs, observedAt: new Date(), robotsAllowed: true,
      };
    }
    throw new AuditPolicyError("redirect_limit", "The website exceeded the redirect limit.");
  }
}

export function createConfiguredAuditProvider(): WebsiteAuditProvider {
  const env = getServerEnv();
  if (!env.WEBSITE_AUDIT_ENABLED) throw new AuditPolicyError("worker_disabled", "Website audit processing is not enabled in this environment.");
  return new SafeHttpAuditProvider(env.AUDIT_USER_AGENT, env.AUDIT_MAX_RESPONSE_BYTES);
}
