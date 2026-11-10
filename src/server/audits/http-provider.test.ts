// @vitest-environment node

import { EventEmitter } from "node:events";
import type http from "node:http";
import type https from "node:https";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuditPolicyError } from "@/modules/audits/types";
import { createConfiguredAuditProvider, SafeHttpAuditProvider, type AuditNetwork } from "./http-provider";

type Behavior =
  | { kind: "respond"; status?: number; headers?: Record<string, string>; body?: string | Buffer; delayMs?: number }
  | { kind: "hang" }
  | { kind: "trickle" }
  | { kind: "drop"; withError: boolean }
  | { kind: "error"; error: Error };
type Respond = Extract<Behavior, { kind: "respond" }>;
type Call = { protocol: string; options: https.RequestOptions; key: string };

const LIMITS = { pageIdleMs: 40, pageTotalMs: 150, robotsIdleMs: 40, robotsTotalMs: 100, inspectTotalMs: 400 };
const USER_AGENT = "PRIZMDEV/1.0 (+https://example.test/contact)";
const PAGE = '<!doctype html><html lang="en"><head><title>Fixture Company Home Page</title></head><body><h1>Fixture</h1></body></html>';

const html = (body = PAGE, extra: Record<string, string> = {}): Respond => ({ kind: "respond", headers: { "content-type": "text/html; charset=utf-8", ...extra }, body });
const text = (body: string, status = 200): Respond => ({ kind: "respond", status, headers: { "content-type": "text/plain" }, body });
const redirect = (to: string, status = 301): Respond => ({ kind: "respond", status, headers: { location: to }, body: "" });
const notFound: Respond = { kind: "respond", status: 404, headers: { "content-type": "text/plain" }, body: "not found" };

/** A scripted network: DNS answers and HTTP behaviour come from the test, and every request is recorded. */
function fakeNetwork(routes: Record<string, Behavior>, dns: Record<string, string[]> = {}) {
  const calls: Call[] = [];
  const network: AuditNetwork = {
    lookup: async (hostname) => {
      if (hostname === "dns-fails.example") throw new Error("ENOTFOUND");
      const addresses = dns[hostname] ?? ["93.184.216.34"];
      return addresses.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));
    },
    request: (protocol) => (options, callback) => {
      const headers = options.headers as Record<string, string>;
      const call: Call = { protocol, options, key: `${protocol.replace(":", "")}//${headers["Host"]}${options.path}` };
      calls.push(call);
      const behavior = routes[call.key] ?? notFound;
      const request = new EventEmitter() as EventEmitter & { setTimeout: (ms: number, cb: () => void) => unknown; destroy: (error?: Error) => unknown; end: () => void };
      let idleMs = 0;
      let onIdle: (() => void) | undefined;
      let idleTimer: NodeJS.Timeout | undefined;
      let closed = false;
      let response: (PassThrough & { statusCode?: number; headers?: Record<string, string>; complete?: boolean }) | undefined;
      const touch = () => {
        if (idleTimer) clearTimeout(idleTimer);
        if (!closed && idleMs > 0 && onIdle) idleTimer = setTimeout(onIdle, idleMs);
      };
      request.setTimeout = (ms, cb) => { idleMs = ms; onIdle = cb; touch(); return request; };
      request.destroy = (error) => {
        closed = true;
        if (idleTimer) clearTimeout(idleTimer);
        response?.destroy();
        if (error) setImmediate(() => request.emit("error", error));
        return request;
      };
      const start = () => {
        if (closed || behavior.kind === "hang") return;
        if (behavior.kind === "error") { request.emit("error", behavior.error); return; }
        const status = behavior.kind === "respond" ? behavior.status ?? 200 : 200;
        const raw = behavior.kind === "respond" ? behavior.headers ?? {} : { "content-type": "text/html" };
        const stream = Object.assign(new PassThrough(), { statusCode: status, headers: Object.fromEntries(Object.entries(raw).map(([name, value]) => [name.toLowerCase(), value])), complete: false });
        response = stream;
        stream.on("end", () => { stream.complete = true; });
        touch();
        callback(stream as unknown as http.IncomingMessage);
        if (behavior.kind === "respond") stream.end(behavior.body ?? "");
        else if (behavior.kind === "trickle") {
          const timer = setInterval(() => { if (closed || stream.destroyed) clearInterval(timer); else { stream.write("x"); touch(); } }, 10);
        } else if (behavior.kind === "drop") {
          stream.write("partial");
          setImmediate(() => (behavior.withError ? stream.destroy(new Error("aborted")) : stream.destroy()));
        }
      };
      request.end = () => {
        const delay = behavior.kind === "respond" ? behavior.delayMs ?? 0 : 0;
        setTimeout(() => setImmediate(start), delay);
      };
      return request as unknown as http.ClientRequest;
    },
  };
  return { network, calls };
}

const provider = (network: AuditNetwork, maxBytes = 1_000_000) => new SafeHttpAuditProvider(USER_AGENT, maxBytes, { ...network, limits: LIMITS });
async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(AuditPolicyError);
    return (error as AuditPolicyError).code;
  }
  return "no error";
}
const inspect = (routes: Record<string, Behavior>, dns: Record<string, string[]> = {}, url = "https://example.com/", maxBytes?: number) => {
  const { network, calls } = fakeNetwork(routes, dns);
  return { calls, run: () => provider(network, maxBytes).inspect(new URL(url)) };
};

describe("safe website audit provider", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("reads robots.txt first, then the page, through the validated address with an identifying user agent", async () => {
    const { calls, run } = inspect({ "https//example.com/": html() }, { "example.com": ["93.184.216.34"] });
    const snapshot = await run();

    expect(calls.map((call) => call.key)).toEqual(["https//example.com/robots.txt", "https//example.com/"]);
    for (const call of calls) {
      const headers = call.options.headers as Record<string, string>;
      expect(call.options.hostname).toBe("93.184.216.34");
      expect(call.options.servername).toBe("example.com");
      expect(call.options.method).toBe("GET");
      expect(headers["Host"]).toBe("example.com");
      expect(headers["User-Agent"]).toBe(USER_AGENT);
      expect(headers["Accept-Encoding"]).toBe("identity");
    }
    expect(snapshot).toMatchObject({ finalUrl: "https://example.com/", status: 200, robotsAllowed: true });
    expect(snapshot.body.toString()).toContain("Fixture Company Home Page");
    expect(snapshot.responseBytes).toBe(Buffer.byteLength(PAGE));
  });

  it("follows redirects, checking robots and the destination again at every hop, and caps the chain", async () => {
    const hop = inspect({ "https//example.com/": redirect("https://www.example.com/home"), "https//www.example.com/home": html() });
    expect((await hop.run()).finalUrl).toBe("https://www.example.com/home");
    expect(hop.calls.map((call) => call.key)).toEqual([
      "https//example.com/robots.txt", "https//example.com/", "https//www.example.com/robots.txt", "https//www.example.com/home",
    ]);

    const loop = inspect({ "https//example.com/": redirect("https://example.com/") });
    expect(await codeOf(loop.run())).toBe("redirect_limit");
    expect(loop.calls.filter((call) => call.key === "https//example.com/").length).toBe(4);
  });

  it("refuses redirects to private, credentialed, odd-port, malformed or non-HTTP destinations", async () => {
    const target = async (location: string, dns: Record<string, string[]> = {}) => codeOf(inspect({ "https//example.com/": redirect(location) }, dns).run());
    expect(await target("http://169.254.169.254/latest/meta-data")).toBe("private_destination");
    expect(await target("http://[::1]/")).toBe("private_destination");
    expect(await target("https://internal.example/", { "internal.example": ["10.0.0.8"] })).toBe("private_destination");
    expect(await target("https://user:secret@example.com/")).toBe("url_credentials");
    expect(await target("https://example.com:8443/")).toBe("non_standard_port");
    expect(await target("ftp://example.com/")).toBe("invalid_url");
    expect(await target("javascript:alert(1)")).toBe("invalid_url");
    expect(await target("http://")).toBe("invalid_url");
    expect(await codeOf(inspect({ "https//example.com/": { kind: "respond", status: 302, body: "" } }).run())).toBe("redirect_missing_location");
  });

  it("refuses private DNS answers, including mixed ones, and reports resolution failures", async () => {
    const attempt = (dns: Record<string, string[]>, url = "https://example.com/") => { const { run, calls } = inspect({ "https//example.com/": html() }, dns, url); return { run, calls }; };
    for (const addresses of [["10.0.0.5"], ["93.184.216.34", "127.0.0.1"], ["::1"], ["::ffff:192.168.1.1"], ["64:ff9b::7f00:1"], []]) {
      const { run, calls } = attempt({ "example.com": addresses });
      expect(await codeOf(run()), addresses.join(",")).toBe("private_destination");
      expect(calls).toHaveLength(0);
    }
    expect(await codeOf(attempt({}, "https://dns-fails.example/").run())).toBe("dns_failed");
    expect(await codeOf(inspect({}, {}, "http://localhost/").run())).toBe("private_destination");
  });

  it("honours robots.txt: disallow blocks before any page request, and the policy must be confirmable", async () => {
    const blocked = inspect({ "https//example.com/robots.txt": text("User-agent: *\nDisallow: /"), "https//example.com/": html() });
    expect(await codeOf(blocked.run())).toBe("robots_disallowed");
    expect(blocked.calls.map((call) => call.key)).toEqual(["https//example.com/robots.txt"]);

    const ourGroup = inspect({ "https//example.com/robots.txt": text("User-agent: *\nDisallow: /\n\nUser-agent: PRIZMDEV\nAllow: /"), "https//example.com/": html() });
    expect((await ourGroup.run()).status).toBe(200);
    expect((await inspect({ "https//example.com/robots.txt": notFound, "https//example.com/": html() }).run()).status).toBe(200);

    for (const status of [401, 403, 429, 500, 503]) {
      expect(await codeOf(inspect({ "https//example.com/robots.txt": text("", status), "https//example.com/": html() }).run()), `robots ${status}`).toBe("robots_unavailable");
    }
    const redirected = inspect({ "https//example.com/robots.txt": redirect("http://127.0.0.1/robots.txt"), "https//example.com/": html() });
    expect(await codeOf(redirected.run())).toBe("private_destination");
    expect(await codeOf(inspect({ "https//example.com/robots.txt": text("x".repeat(300_000)), "https//example.com/": html() }).run())).toBe("response_too_large");
  });

  it("rejects oversized, non-HTML and compressed pages, but returns error pages as observations", async () => {
    expect(await codeOf(inspect({ "https//example.com/": html("x".repeat(2_000)) }, {}, "https://example.com/", 500).run())).toBe("response_too_large");
    expect(await codeOf(inspect({ "https//example.com/": { kind: "respond", headers: { "content-type": "application/pdf" }, body: "%PDF" } }).run())).toBe("unsupported_content_type");
    expect(await codeOf(inspect({ "https//example.com/": html(PAGE, { "content-encoding": "gzip" }) }).run())).toBe("unsupported_content_type");
    expect((await inspect({ "https//example.com/": { kind: "respond", status: 404, headers: { "content-type": "text/html" }, body: "<html><title>Gone</title></html>" } }).run()).status).toBe(404);
    expect((await inspect({ "https//example.com/": { kind: "respond", status: 503, headers: { "content-type": "text/html" }, body: "<html></html>" } }).run()).status).toBe(503);
  });

  it("times out silent servers, trickling servers and over-long audits instead of waiting", async () => {
    const hung = inspect({ "https//example.com/": { kind: "hang" } });
    expect(await codeOf(hung.run())).toBe("request_timeout");

    const started = Date.now();
    expect(await codeOf(inspect({ "https//example.com/": { kind: "trickle" } }).run())).toBe("request_timeout");
    expect(Date.now() - started).toBeLessThan(LIMITS.pageTotalMs + 400);

    const slow = (delayMs: number): Respond => ({ ...redirect("https://example.com/next"), delayMs });
    const chain = inspect({
      "https//example.com/": slow(70), "https//example.com/next": { ...redirect("https://example.com/last"), delayMs: 70 },
      "https//example.com/last": { ...html(), delayMs: 70 },
    });
    const chainStarted = Date.now();
    expect(await codeOf(chain.run())).toBe("request_timeout");
    expect(Date.now() - chainStarted).toBeLessThan(LIMITS.inspectTotalMs + 400);
  });

  it("fails cleanly when the connection drops or errors, and never leaks internal error text", async () => {
    for (const withError of [true, false]) {
      expect(await codeOf(inspect({ "https//example.com/": { kind: "drop", withError } }).run()), `drop withError=${withError}`).toBe("request_failed");
    }
    const reset = inspect({ "https//example.com/": { kind: "error", error: Object.assign(new Error("connect ECONNRESET 93.184.216.34:443 secret-detail"), { code: "ECONNRESET" }) } });
    await expect(reset.run()).rejects.toMatchObject({ code: "request_failed", message: "The website request failed." });
    await expect(inspect({ "https//example.com/": { kind: "error", error: new Error("certificate has expired") } }).run()).rejects.not.toThrow("certificate");
  });

  it("uses plain HTTP without a server name and records an http final URL", async () => {
    const plain = inspect({ "http//example.com/": html() }, {}, "http://example.com/");
    const snapshot = await plain.run();
    expect(snapshot.finalUrl).toBe("http://example.com/");
    expect(plain.calls.every((call) => call.protocol === "http:" && call.options.servername === undefined)).toBe(true);
  });

  it("stays off unless explicitly enabled by server configuration", () => {
    vi.stubEnv("NEXTAUTH_URL", "http://localhost:3003");
    vi.stubEnv("DATABASE_URL", "postgresql://unused:unused@127.0.0.1:1/unused");
    vi.stubEnv("AUTH_SECRET", "placeholder-secret-for-schema-check-only-0000");
    vi.stubEnv("WEBSITE_AUDIT_ENABLED", "");
    expect(() => createConfiguredAuditProvider()).toThrow("not enabled");
    vi.stubEnv("WEBSITE_AUDIT_ENABLED", "true");
    vi.stubEnv("AUDIT_USER_AGENT", USER_AGENT);
    expect(createConfiguredAuditProvider().id).toBe("safe-http-v1");
  });
});
