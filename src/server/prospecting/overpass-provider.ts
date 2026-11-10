import { buildOverpassQuery, parseOverpassResponse, type IndustryFilters } from "@/modules/prospecting/overpass";
import {
  DiscoveryProviderError,
  type BusinessSearchPage,
  type BusinessSearchQuery,
  type DiscoveryProvider,
  type ProviderLicense,
} from "@/modules/prospecting/providers";

export const OVERPASS_DEFAULT_ENDPOINT = "https://overpass-api.de/api/interpreter";
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RESPONSE_BYTES = 2_000_000;

export type OverpassProviderOptions = Readonly<{
  endpoint: string;
  userAgent: string;
  industryFilters: IndustryFilters;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxResponseBytes?: number;
  now?: () => Date;
}>;

async function readBounded(response: Response, maxBytes: number): Promise<string> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw new DiscoveryProviderError("provider_bad_response", "The data provider response was too large.");
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new DiscoveryProviderError("provider_bad_response", "The data provider response was too large.");
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

/**
 * OpenStreetMap business search through an Overpass endpoint. It needs no credentials, but it is community-run:
 * keep the request volume low and identify the application with a contactable User-Agent.
 */
export class OverpassProvider implements DiscoveryProvider {
  readonly id = "overpass";
  readonly displayName = "OpenStreetMap (Overpass)";
  readonly license: ProviderLicense = {
    name: "Open Database License (ODbL) 1.0",
    url: "https://www.openstreetmap.org/copyright",
    attribution: "© OpenStreetMap contributors",
  };

  constructor(private readonly options: OverpassProviderOptions) {}

  async search(query: BusinessSearchQuery): Promise<BusinessSearchPage> {
    const { endpoint, userAgent, industryFilters } = this.options;
    const queryText = buildOverpassQuery(query, industryFilters);
    const fetchImpl = this.options.fetchImpl ?? fetch;

    let response: Response;
    try {
      response = await fetchImpl(endpoint, {
        method: "POST",
        headers: { "User-Agent": userAgent, Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ data: queryText }),
        redirect: "error",
        signal: AbortSignal.timeout(this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      });
    } catch (error) {
      if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
        throw new DiscoveryProviderError("provider_timeout", "The data provider took too long to respond. Try a smaller area.");
      }
      throw new DiscoveryProviderError("provider_unavailable", "The data provider could not be reached.");
    }

    if (response.status === 429 || response.status === 406) {
      await response.body?.cancel();
      throw new DiscoveryProviderError("provider_rate_limited", `The data provider is rate limiting requests (HTTP ${response.status}). Wait a few minutes and try again.`);
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new DiscoveryProviderError("provider_unavailable", `The data provider is unavailable right now (HTTP ${response.status}).`);
    }

    const text = await readBounded(response, this.options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES);
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new DiscoveryProviderError("provider_bad_response", "The data provider returned an unexpected response.");
    }
    const { records } = parseOverpassResponse(json, {
      query,
      filters: industryFilters,
      observedAt: (this.options.now ?? (() => new Date()))().toISOString(),
    });
    return { records };
  }
}
