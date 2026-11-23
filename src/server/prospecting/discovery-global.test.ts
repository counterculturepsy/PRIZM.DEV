// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { serverEnvSchema, type ServerEnv } from "@/config/env";
import { assertKeyword, buildOverpassQuery, OSM_INDUSTRY_FILTERS } from "@/modules/prospecting/overpass";
import { DiscoveryProviderError, type DiscoveryProvider } from "@/modules/prospecting/providers";
import { signCandidate, verifyCandidate } from "./candidate-token";
import { FixtureProvider } from "./fixture-provider";
import { datasetCoverage } from "./osm-extract-provider";
import { createDiscoveryProviders, selectProvider } from "./provider-router";

vi.mock("@/server/db", () => ({ getDatabase: () => { throw new Error("The database is not used by these unit tests"); } }));

const westernCape = { regionKey: "western-cape", regionLabel: "Western Cape", bbox: { minLon: 17.5, minLat: -35, maxLon: 24.6, maxLat: -30.2 } };
const baseEnv = { NODE_ENV: "test", NEXTAUTH_URL: "http://localhost:3000", DATABASE_URL: "postgresql://user:password@localhost:5432/prizm", AUTH_SECRET: "a-test-secret-that-is-longer-than-thirty-two-characters" };
const envWith = (extra: Record<string, string>): ServerEnv => serverEnvSchema.parse({ ...baseEnv, ...extra });

describe("Overpass queries for other countries", () => {
  it("searches Hanoi by its local and English names under both name keys, inside Vietnam", () => {
    const query = buildOverpassQuery({ countryCode: "VN", city: "hanoi", industries: ["Restaurants & Cafés"] }, OSM_INDUSTRY_FILTERS);
    expect(query).toContain('area["ISO3166-1"="VN"]->.country;');
    expect(query).toContain('area["boundary"="administrative"]["name"="Hà Nội"]->.place0a;');
    expect(query).toContain('area["boundary"="administrative"]["name:en"="Hà Nội"]->.place0b;');
    expect(query).toContain('area["boundary"="administrative"]["name"="Hanoi"]->.place1a;');
    expect(query).toContain("(.place0a; .place0b; .place1a; .place1b;)->.place;");
    expect(query).toContain('nwr(area.country)(area.place)["amenity"="restaurant"]["name"];');
    expect(query).not.toContain("ZA");
  });

  it("resolves an alias to the same query as the canonical city", () => {
    const canonical = buildOverpassQuery({ countryCode: "VN", city: "Ho Chi Minh City", industries: ["Restaurants & Cafés"] }, OSM_INDUSTRY_FILTERS);
    expect(buildOverpassQuery({ countryCode: "VN", city: "Saigon", industries: ["Restaurants & Cafés"] }, OSM_INDUSTRY_FILTERS)).toBe(canonical);
    expect(buildOverpassQuery({ countryCode: "VN", city: "HCMC", industries: ["Restaurants & Cafés"] }, OSM_INDUSTRY_FILTERS)).toBe(canonical);
  });

  it("keeps the original single-name query for cities with one OpenStreetMap name, and for unregistered cities", () => {
    expect(buildOverpassQuery({ countryCode: "ZA", city: "Cape Town", industries: ["Restaurants & Cafés"] }, OSM_INDUSTRY_FILTERS))
      .toContain('area["boundary"="administrative"]["name"="Cape Town"]->.place;');
    expect(buildOverpassQuery({ countryCode: "VN", city: "Nha Trang", industries: ["Restaurants & Cafés"] }, OSM_INDUSTRY_FILTERS))
      .toContain('["name"="Nha Trang"]->.place;');
  });

  it("does not resolve a city through another country's registry", () => {
    expect(buildOverpassQuery({ countryCode: "VN", city: "Johannesburg", industries: ["Restaurants & Cafés"] }, OSM_INDUSTRY_FILTERS))
      .toContain('["name"="Johannesburg"]->.place;');
  });

  it("adds a case-insensitive name filter for a keyword and rejects anything that could alter the query", () => {
    const query = buildOverpassQuery({ countryCode: "VN", city: "Hanoi", industries: ["IT & Software Companies"], keyword: "Phần Mềm" }, OSM_INDUSTRY_FILTERS);
    expect(query).toContain('["office"="it"]["name"~"Phần Mềm",i];');
    for (const keyword of ['a"];out;//', "x.*", "a|b", "back\\slash", "(a)", "a", "x".repeat(70), "semi;colon"]) {
      expect(() => assertKeyword(keyword), keyword).toThrow(DiscoveryProviderError);
    }
    expect(assertKeyword("  O'Brien   Café-Bar ")).toBe("O'Brien Café-Bar");
  });
});

describe("local extract coverage", () => {
  it("covers Cape Town and rejects every other initial South African target city as outside the extract", () => {
    expect(datasetCoverage(westernCape, { countryCode: "ZA", city: "Cape Town", industries: ["x"] })).toMatchObject({ supported: true });
    for (const city of ["Johannesburg", "Pretoria", "Durban", "Gqeberha", "Bloemfontein", "Joburg"]) {
      const decision = datasetCoverage(westernCape, { countryCode: "ZA", city, industries: ["x"] });
      expect(decision, city).toMatchObject({ supported: false, reason: expect.stringContaining("outside the loaded Western Cape extract") });
    }
  });

  it("never serves another country, even for cities with the same name", () => {
    expect(datasetCoverage(westernCape, { countryCode: "VN", city: "Hanoi", industries: ["x"] })).toEqual({ supported: false, reason: "The loaded Western Cape extract covers South Africa only." });
  });

  it("fails closed for an extract whose region has no verified country, and defers unknown cities to the locality lookup", () => {
    expect(datasetCoverage({ ...westernCape, regionKey: "mystery" }, { countryCode: "ZA", city: "Cape Town", industries: ["x"] })).toMatchObject({ supported: false });
    expect(datasetCoverage(westernCape, { countryCode: "ZA", city: "Stellenbosch", industries: ["x"] })).toMatchObject({ supported: true });
  });
});

describe("provider configuration and routing", () => {
  it("builds nothing unless a provider is enabled, and keeps real sources ahead of fixtures", () => {
    expect(createDiscoveryProviders(envWith({}))).toEqual([]);
    const providers = createDiscoveryProviders(envWith({ DISCOVERY_PROVIDERS: "fixture,osm_extract", DISCOVERY_TERMS_VERIFIED_FOR: "fixture,osm_extract" }));
    expect(providers.map((provider) => provider.id)).toEqual(["osm_extract", "fixture"]);
    expect(providers.map((provider) => provider.capabilities?.dataKind)).toEqual(["local_dataset", "synthetic_fixture"]);
  });

  it("still honours the original single DISCOVERY_PROVIDER setting", () => {
    const providers = createDiscoveryProviders(envWith({ DISCOVERY_PROVIDER: "osm_extract", DISCOVERY_TERMS_VERIFIED_FOR: "osm_extract" }));
    expect(providers.map((provider) => provider.id)).toEqual(["osm_extract"]);
  });

  it("requires terms acknowledgement for every listed provider and a contact for Overpass", () => {
    expect(serverEnvSchema.safeParse({ ...baseEnv, DISCOVERY_PROVIDERS: "osm_extract,fixture", DISCOVERY_TERMS_VERIFIED_FOR: "osm_extract" }).success).toBe(false);
    expect(serverEnvSchema.safeParse({ ...baseEnv, DISCOVERY_PROVIDERS: "osm_extract,fixture", DISCOVERY_TERMS_VERIFIED_FOR: "osm_extract, fixture" }).success).toBe(true);
    expect(serverEnvSchema.safeParse({ ...baseEnv, DISCOVERY_PROVIDERS: "overpass", DISCOVERY_TERMS_VERIFIED_FOR: "overpass" }).success).toBe(false);
    expect(serverEnvSchema.safeParse({ ...baseEnv, DISCOVERY_PROVIDERS: "overpass", DISCOVERY_TERMS_VERIFIED_FOR: "overpass", DISCOVERY_USER_AGENT: "PRIZMDEV/1.0 (https://example.com/contact)" }).success).toBe(true);
    expect(serverEnvSchema.safeParse({ ...baseEnv, DISCOVERY_PROVIDERS: "bing", DISCOVERY_TERMS_VERIFIED_FOR: "bing" }).success).toBe(false);
  });

  it("refuses the synthetic fixture provider on a Vercel production deployment, and allows it elsewhere only when acknowledged", () => {
    const fixtureEnv = { ...baseEnv, DISCOVERY_PROVIDERS: "fixture", DISCOVERY_TERMS_VERIFIED_FOR: "fixture" };
    vi.stubEnv("VERCEL_ENV", "production");
    try {
      const refused = serverEnvSchema.safeParse({ ...fixtureEnv, NODE_ENV: "production" });
      expect(refused.success).toBe(false);
      expect(refused.error?.issues.some((issue) => issue.message.includes("never be enabled on a Vercel production deployment"))).toBe(true);
    } finally {
      vi.unstubAllEnvs();
    }
    vi.stubEnv("VERCEL_ENV", "preview");
    try {
      expect(serverEnvSchema.safeParse({ ...fixtureEnv, NODE_ENV: "production" }).success).toBe(true);
    } finally {
      vi.unstubAllEnvs();
    }
    expect(serverEnvSchema.safeParse({ ...baseEnv, DISCOVERY_PROVIDERS: "fixture" }).success).toBe(false);
  });

  it("declares what each provider can do", () => {
    const [extract, overpass] = [
      createDiscoveryProviders(envWith({ DISCOVERY_PROVIDER: "osm_extract", DISCOVERY_TERMS_VERIFIED_FOR: "osm_extract" }))[0],
      createDiscoveryProviders(envWith({ DISCOVERY_PROVIDER: "overpass", DISCOVERY_TERMS_VERIFIED_FOR: "overpass", DISCOVERY_USER_AGENT: "PRIZMDEV/1.0 (https://example.com/contact)" }))[0],
    ];
    expect(extract?.capabilities).toMatchObject({ countries: ["ZA"], dataKind: "local_dataset", keyword: true, region: false });
    expect(overpass).toBeDefined();
  });

  it("falls through providers that decline and names every reason when none can serve the place", async () => {
    const decline = (id: string, reason: string): DiscoveryProvider => ({
      id, displayName: id, license: { name: "t", url: "https://example.com", attribution: "t" },
      async coverage() { return { supported: false, reason }; },
      async search() { throw new Error("must not be called"); },
    });
    const broken: DiscoveryProvider = { ...decline("broken", ""), async coverage() { throw new Error("db down with internal detail"); } };
    const error = await selectProvider([decline("a", "A has no data for Hanoi"), broken], { countryCode: "VN", city: "Hanoi", industries: ["x"] }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DiscoveryProviderError);
    expect((error as DiscoveryProviderError).code).toBe("unsupported_location");
    const message = (error as Error).message;
    expect(message).toContain("No configured data source covers Hanoi, Vietnam.");
    expect(message).toContain("A has no data for Hanoi.");
    expect(message).toContain("broken could not check its coverage right now.");
    expect(message).not.toContain("internal detail");
  });
});

describe("synthetic fixture provider", () => {
  it("only covers the cities it has data for and labels itself as synthetic", async () => {
    const provider = new FixtureProvider();
    expect(provider.capabilities.dataKind).toBe("synthetic_fixture");
    expect(await provider.coverage({ countryCode: "VN", city: "Saigon", industries: ["Restaurants & Cafés"] })).toMatchObject({ supported: true });
    expect(await provider.coverage({ countryCode: "VN", city: "Hai Phong", industries: ["Restaurants & Cafés"] })).toMatchObject({ supported: false });
    expect(await provider.coverage({ countryCode: "ZA", city: "Hanoi", industries: ["Restaurants & Cafés"] })).toMatchObject({ supported: false });
  });

  it("rejects a malformed page marker and returns accent-preserving names", async () => {
    const provider = new FixtureProvider();
    await expect(provider.search({ countryCode: "VN", city: "Hanoi", industries: ["Restaurants & Cafés"], cursor: "!!" })).rejects.toMatchObject({ code: "invalid_query" });
    const page = await provider.search({ countryCode: "VN", city: "Hà Nội", industries: ["Restaurants & Cafés"], keyword: "Quán Phở" });
    expect(page.records.map((record) => record.name.value)).toEqual(["Quán Phở Hà Nội [FIXTURE]"]);
  });
});

describe("candidate tokens", () => {
  const secret = "token-secret-".padEnd(40, "z");
  const workspaceId = "11111111-1111-4111-8111-111111111111";
  const candidate = { provider: "fixture", country: "VN", record: { externalId: "fixture/1", name: { value: "Quán Phở", kind: "observed" as const, confidence: "low" as const, source: "fixture", observedAt: "2026-11-23T00:00:00.000Z" } }, provenance: { dataset_id: "fixture" } };

  it("round-trips for the issuing workspace and preserves diacritics", () => {
    const now = new Date("2026-11-23T10:00:00.000Z");
    const token = signCandidate(secret, workspaceId, candidate, now);
    expect(verifyCandidate(secret, workspaceId, token, now)).toEqual(candidate);
  });

  it("refuses another workspace, another key, and an expired token", () => {
    const now = new Date("2026-11-23T10:00:00.000Z");
    const token = signCandidate(secret, workspaceId, candidate, now);
    expect(verifyCandidate(secret, "22222222-2222-4222-8222-222222222222", token, now)).toBeNull();
    expect(verifyCandidate("different-".padEnd(40, "q"), workspaceId, token, now)).toBeNull();
    expect(verifyCandidate(secret, workspaceId, token, new Date(now.getTime() + 61 * 60 * 1000))).toBeNull();
  });
});
