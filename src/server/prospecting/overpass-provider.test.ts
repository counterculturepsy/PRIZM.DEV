// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { DiscoveryProviderError } from "@/modules/prospecting/providers";
import { OverpassProvider } from "./overpass-provider";

const filters = { Dentists: ["amenity=dentist"] };
const query = { countryCode: "ZA", city: "Cape Town", industries: ["Dentists"] };
const body = { elements: [{ type: "node", id: 7, tags: { name: "Fixture Dental Clinic", amenity: "dentist", website: "fixture-dental.example" } }] };

function provider(fetchImpl: typeof fetch, extra: Partial<ConstructorParameters<typeof OverpassProvider>[0]> = {}) {
  return new OverpassProvider({
    endpoint: "https://overpass.example/api/interpreter",
    userAgent: "PRIZMDEV/1.0 (https://example.com/contact)",
    industryFilters: filters,
    fetchImpl,
    now: () => new Date("2026-10-26T10:00:00.000Z"),
    ...extra,
  });
}

const okResponse = (value: unknown = body, init: ResponseInit = {}) => new Response(JSON.stringify(value), { status: 200, ...init });

async function failureCode(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(DiscoveryProviderError);
    return (error as DiscoveryProviderError).code;
  }
  throw new Error("Expected the search to fail");
}

describe("OverpassProvider", () => {
  it("sends one identified, non-redirecting POST and returns attributed records", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(okResponse());
    const page = await provider(fetchImpl).search(query);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe("https://overpass.example/api/interpreter");
    expect(init?.method).toBe("POST");
    expect(init?.redirect).toBe("error");
    expect((init?.headers as Record<string, string>)["User-Agent"]).toBe("PRIZMDEV/1.0 (https://example.com/contact)");
    expect((init?.body as URLSearchParams).get("data")).toContain('["amenity"="dentist"]');
    expect(page.records).toHaveLength(1);
    expect(page.records[0]).toMatchObject({ externalId: "node/7", name: { value: "Fixture Dental Clinic", source: "openstreetmap" } });
  });

  it("treats 429 and 406 as rate limiting so callers back off", async () => {
    for (const status of [429, 406]) {
      const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response("slow down", { status }));
      expect(await failureCode(provider(fetchImpl).search(query))).toBe("provider_rate_limited");
      const again = vi.fn<typeof fetch>().mockResolvedValue(new Response("slow down", { status }));
      await expect(provider(again).search(query)).rejects.toThrow(`HTTP ${status}`);
    }
  });

  it("maps server errors, network failures and timeouts to distinct codes", async () => {
    expect(await failureCode(provider(vi.fn<typeof fetch>().mockResolvedValue(new Response("", { status: 503 }))).search(query))).toBe("provider_unavailable");
    await expect(provider(vi.fn<typeof fetch>().mockResolvedValue(new Response("at capacity", { status: 502 }))).search(query)).rejects.toThrow("HTTP 502");
    expect(await failureCode(provider(vi.fn<typeof fetch>().mockRejectedValue(new TypeError("fetch failed"))).search(query))).toBe("provider_unavailable");
    const timeout = Object.assign(new Error("timed out"), { name: "TimeoutError" });
    expect(await failureCode(provider(vi.fn<typeof fetch>().mockRejectedValue(timeout)).search(query))).toBe("provider_timeout");
  });

  it("rejects malformed, wrongly shaped and oversized responses without leaking their content", async () => {
    expect(await failureCode(provider(vi.fn<typeof fetch>().mockResolvedValue(new Response("<html>oops</html>", { status: 200 }))).search(query))).toBe("provider_bad_response");
    expect(await failureCode(provider(vi.fn<typeof fetch>().mockResolvedValue(okResponse({ elements: "nope" }))).search(query))).toBe("provider_bad_response");
    const big = okResponse({ elements: [], padding: "x".repeat(500) });
    expect(await failureCode(provider(vi.fn<typeof fetch>().mockResolvedValue(big), { maxResponseBytes: 100 }).search(query))).toBe("provider_bad_response");
    const declared = okResponse(body, { headers: { "content-length": "999999" } });
    expect(await failureCode(provider(vi.fn<typeof fetch>().mockResolvedValue(declared), { maxResponseBytes: 100 }).search(query))).toBe("provider_bad_response");
  });

  it("never contacts the provider for an invalid query", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    expect(await failureCode(provider(fetchImpl).search({ ...query, city: 'Cape Town"];' }))).toBe("invalid_query");
    expect(await failureCode(provider(fetchImpl).search({ ...query, industries: ["Plumbers"] }))).toBe("invalid_query");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("declares its licence for attribution", () => {
    const instance = provider(vi.fn<typeof fetch>());
    expect(instance.id).toBe("overpass");
    expect(instance.license).toMatchObject({ attribution: "© OpenStreetMap contributors", url: "https://www.openstreetmap.org/copyright" });
  });
});
