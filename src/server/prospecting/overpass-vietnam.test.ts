// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { OSM_INDUSTRY_FILTERS } from "@/modules/prospecting/overpass";
import { OverpassProvider } from "./overpass-provider";

const USER_AGENT = "PRIZMDEV/1.0 (https://example.com/contact)";
const hanoiQuery = { countryCode: "VN", city: "Hà Nội", industries: ["IT & Software Companies"] } as const;

const elements = [
  {
    type: "node", id: 101,
    tags: { name: "Công Ty Phần Mềm Mẫu", office: "it", "contact:website": "https://phanmem.example.test", phone: "+84 24 0000 0000", "contact:email": "hello@phanmem.example.test", "addr:housenumber": "12", "addr:street": "Phố Huế", "addr:city": "Hà Nội", "addr:state": "Hà Nội" },
  },
  { type: "way", id: 102, tags: { name: "Studio Không Địa Chỉ", office: "it" } },
  { type: "node", id: 103, tags: { office: "it" } },
];

function provider(fetchImpl: typeof fetch, extra: Partial<ConstructorParameters<typeof OverpassProvider>[0]> = {}) {
  return new OverpassProvider({ endpoint: "https://overpass.example.test/api/interpreter", userAgent: USER_AGENT, industryFilters: OSM_INDUSTRY_FILTERS, now: () => new Date("2026-11-23T00:00:00.000Z"), fetchImpl, ...extra });
}
const json = (body: unknown, init: ResponseInit = { status: 200 }) => new Response(JSON.stringify(body), init);

describe("Overpass adapter for Hanoi (no network: fetch is mocked)", () => {
  it("sends one bounded POST for Vietnam and Hà Nội with the contact User-Agent, and never follows redirects", async () => {
    const fetchImpl = vi.fn(async () => json({ elements }));
    await provider(fetchImpl as unknown as typeof fetch).search(hanoiQuery);

    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://overpass.example.test/api/interpreter");
    expect(init.method).toBe("POST");
    expect(init.redirect).toBe("error");
    expect((init.headers as Record<string, string>)["User-Agent"]).toBe(USER_AGENT);
    expect(init.signal).toBeInstanceOf(AbortSignal);
    const query = (init.body as URLSearchParams).get("data") ?? "";
    expect(query).toContain('area["ISO3166-1"="VN"]->.country;');
    expect(query).toContain('["name"="Hà Nội"]');
    expect(query).toContain('["name:en"="Hanoi"]');
    expect(query).toContain('["office"="it"]["name"]');
    expect(query).toContain("[timeout:25]");
    expect(query).toContain("out center tags 100;");
  });

  it("keeps Vietnamese text, takes websites and contacts from contact:* tags, and marks inferred locations", async () => {
    const page = await provider((async () => json({ elements })) as unknown as typeof fetch).search(hanoiQuery);
    expect(page.records).toHaveLength(2);
    const [first, second] = page.records;
    expect(first?.name.value).toBe("Công Ty Phần Mềm Mẫu");
    expect(first?.website?.value).toBe("https://phanmem.example.test");
    expect(first?.phone?.value).toBe("+84 24 0000 0000");
    expect(first?.email?.value).toBe("hello@phanmem.example.test");
    expect(first?.address?.value).toBe("12 Phố Huế");
    expect(first?.city).toMatchObject({ value: "Hà Nội", kind: "observed" });
    expect(first?.industry?.value).toBe("IT & Software Companies");
    expect(first?.externalId).toBe("node/101");
    expect(second?.city).toMatchObject({ value: "Hà Nội", kind: "inferred", source: "openstreetmap:search-area" });
    expect(second?.website).toBeUndefined();
    expect(page.records.every((record) => record.name.observedAt === "2026-11-23T00:00:00.000Z")).toBe(true);
  });

  it("states its licence, attribution and capabilities, and declares itself a live, unverified API", () => {
    const overpass = provider(vi.fn() as unknown as typeof fetch);
    expect(overpass.license).toMatchObject({ name: "Open Database License (ODbL) 1.0", attribution: "© OpenStreetMap contributors" });
    expect(overpass.capabilities).toMatchObject({ countries: "any", dataKind: "live_api", keyword: true, region: true });
  });

  it.each([
    ["HTTP 429", () => new Response("slow down", { status: 429 }), "provider_rate_limited"],
    ["HTTP 406", () => new Response("rejected", { status: 406 }), "provider_rate_limited"],
    ["HTTP 502", () => new Response("bad gateway", { status: 502 }), "provider_unavailable"],
    ["HTTP 504", () => new Response("gateway timeout", { status: 504 }), "provider_unavailable"],
    ["a non-JSON body", () => new Response("<html>busy</html>", { status: 200 }), "provider_bad_response"],
    ["JSON of the wrong shape", () => json({ remark: "runtime error" }), "provider_bad_response"],
  ] as const)("maps %s to %s without leaking the body", async (_label, respond, code) => {
    const error = await provider((async () => respond()) as unknown as typeof fetch).search(hanoiQuery).catch((e: unknown) => e);
    expect(error).toMatchObject({ code });
    expect(String((error as Error).message)).not.toMatch(/html|slow down|bad gateway|runtime error/i);
  });

  it("maps a timeout, a network failure and an oversized response to typed errors", async () => {
    const timeout = Object.assign(new Error("aborted"), { name: "TimeoutError" });
    await expect(provider((async () => { throw timeout; }) as unknown as typeof fetch).search(hanoiQuery)).rejects.toMatchObject({ code: "provider_timeout" });
    await expect(provider((async () => { throw new Error("ECONNRESET 10.0.0.1"); }) as unknown as typeof fetch).search(hanoiQuery)).rejects.toMatchObject({ code: "provider_unavailable", message: expect.not.stringContaining("10.0.0.1") });
    const big = (async () => new Response("{}", { status: 200, headers: { "content-length": "9000000" } })) as unknown as typeof fetch;
    await expect(provider(big).search(hanoiQuery)).rejects.toMatchObject({ code: "provider_bad_response" });
  });

  it("rejects input that could alter the query before any request is made", async () => {
    const fetchImpl = vi.fn();
    for (const city of ['Hà Nội"];out;//', "Hà Nội; node(1)", "x"]) {
      await expect(provider(fetchImpl as unknown as typeof fetch).search({ ...hanoiQuery, city })).rejects.toMatchObject({ code: "invalid_query" });
    }
    await expect(provider(fetchImpl as unknown as typeof fetch).search({ ...hanoiQuery, countryCode: "vn" })).rejects.toMatchObject({ code: "invalid_query" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
