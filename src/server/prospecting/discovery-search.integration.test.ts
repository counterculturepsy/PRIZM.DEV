// @vitest-environment node

import { PGlite } from "@electric-sql/pglite";
import { count, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { describe, expect, it, vi } from "vitest";
import type { BusinessSearchQuery, DiscoveryErrorCode, DiscoveryProvider, SourcedValue } from "@/modules/prospecting/providers";
import { createWorkspaceScope } from "@/modules/workspaces/scope";
import { auditLogs, companies, companySources, discoveryRuns, users, workspaceMembers, workspaces } from "@/server/db/schema";

const secret = "test-secret-".padEnd(40, "x");
const generousLimits = { minIntervalSeconds: 0, maxPerHour: 600, maxPerDay: 3000, inProgressSeconds: 60, providerCooldownSeconds: 0 };
const observedAt = "2026-11-23T00:00:00.000Z";
const fact = (value: string): SourcedValue<string> => ({ value, kind: "observed", confidence: "medium", source: "test", observedAt });

async function setup() {
  const client = new PGlite();
  const db = drizzle(client);
  await migrate(db, { migrationsFolder: "drizzle" });
  const [user] = await db.insert(users).values({ email: "owner@example.com" }).returning({ id: users.id });
  const rows = await db.insert(workspaces).values([{ name: "Alpha", slug: "alpha" }, { name: "Beta", slug: "beta" }]).returning({ id: workspaces.id });
  const [alpha, beta] = rows;
  if (!user || !alpha || !beta) throw new Error("Test fixtures were not created");
  await db.insert(workspaceMembers).values([
    { workspaceId: alpha.id, userId: user.id, role: "owner", status: "active" },
    { workspaceId: beta.id, userId: user.id, role: "owner", status: "active" },
  ]);

  vi.resetModules();
  vi.doMock("@/server/db", () => ({ getDatabase: () => db }));
  const search = await import("./discovery-search");
  const fixture = await import("./fixture-provider");
  const tokens = await import("./candidate-token");
  const discovery = await import("./discovery");
  const crm = await import("@/server/crm/service");
  const providers = await import("@/modules/prospecting/providers");
  return {
    db, search, fixture, tokens, discovery, crm, providers,
    alpha: createWorkspaceScope({ workspaceId: alpha.id, userId: user.id, role: "owner" }),
    beta: createWorkspaceScope({ workspaceId: beta.id, userId: user.id, role: "owner" }),
    viewer: createWorkspaceScope({ workspaceId: alpha.id, userId: user.id, role: "viewer" }),
  };
}

/** Stand-in for the local Western Cape extract: declares South Africa, but only really covers Cape Town. */
function westernCapeLike(withGenerousLimits = true): DiscoveryProvider & { search: ReturnType<typeof vi.fn> } {
  const search = vi.fn(async (query: BusinessSearchQuery) => ({
    records: [{ externalId: "node/1", name: fact("Cape Town Dental (test)"), city: fact(query.city ?? "Cape Town"), industry: fact("Medical & Dental Practices") }],
    provenance: { dataset_id: "test-extract", dataset_data_timestamp: observedAt },
  }));
  return {
    id: "osm_extract",
    displayName: "OpenStreetMap extract (local)",
    license: { name: "ODbL", url: "https://www.openstreetmap.org/copyright", attribution: "© OpenStreetMap contributors" },
    ...(withGenerousLimits ? { limits: generousLimits } : {}),
    capabilities: { countries: ["ZA"], region: false, city: true, industry: true, keyword: true, pagination: "cursor", dataKind: "local_dataset" },
    async coverage(query) {
      return query.city === "Cape Town" ? { supported: true, basis: "Test extract" } : { supported: false, reason: `${query.city} is outside the loaded Western Cape extract.` };
    },
    search,
  };
}

function failingProvider(code: DiscoveryErrorCode | "generic", ProviderError: typeof import("@/modules/prospecting/providers").DiscoveryProviderError): DiscoveryProvider {
  return {
    id: `failing_${code}`,
    displayName: "Failing source",
    license: { name: "Test", url: "https://example.com", attribution: "test" },
    limits: generousLimits,
    async search() {
      if (code === "generic") throw new Error("socket hang up with internal detail");
      throw new ProviderError(code, `Safe message for ${code}`);
    },
  };
}

const hanoi = { countryCode: "Vietnam", city: "hà nội", industry: "Restaurants & Cafés" };

describe("global company discovery search", () => {
  it("previews Hanoi restaurants from the fixture source without saving anything, with paging and canonical names", async () => {
    const { db, search, fixture, alpha } = await setup();
    const deps = { providers: [new fixture.FixtureProvider()], secret };

    const first = await search.previewCompanyDiscovery(alpha, hanoi, undefined, deps);

    expect(first.query).toMatchObject({ countryCode: "VN", city: "Hanoi" });
    expect(first.dataKind).toBe("synthetic_fixture");
    expect(first.candidates).toHaveLength(3);
    expect(first.candidates.every((candidate) => candidate.countryCode === "VN" && candidate.name.includes("[FIXTURE]"))).toBe(true);
    expect(first.candidates.map((candidate) => candidate.name)).toContain("Quán Phở Hà Nội [FIXTURE]");
    expect(first.nextCursor).not.toBeNull();

    const second = await search.previewCompanyDiscovery(alpha, hanoi, first.nextCursor ?? undefined, deps);
    expect(second.candidates).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
    expect(new Set([...first.candidates, ...second.candidates].map((candidate) => candidate.externalId)).size).toBe(4);

    const [saved] = await db.select({ n: count() }).from(companies);
    expect(saved?.n).toBe(0);
    const runs = await db.select().from(discoveryRuns).where(eq(discoveryRuns.workspaceId, alpha.workspaceId));
    expect(runs).toHaveLength(2);
    expect(runs.every((run) => run.status === "completed" && (run.filters as Record<string, unknown>)["preview"] === true)).toBe(true);
  });

  it("filters by keyword and reports a region the source cannot apply", async () => {
    const { search, fixture, alpha } = await setup();
    const result = await search.previewCompanyDiscovery(alpha, { countryCode: "VN", city: "Hanoi", province: "Hanoi", industry: "IT & Software Companies", keyword: "cloud" }, undefined, { providers: [new fixture.FixtureProvider()], secret });
    expect(result.candidates.map((candidate) => candidate.name)).toEqual(["Hanoi Cloud Studio [FIXTURE]"]);
    expect(result.ignoredFilters).toHaveLength(1);
    expect(result.ignoredFilters[0]).toContain("not supported");
  });

  it("saves one result, dedupes a repeat save, and creates a direct CRM lead from it", async () => {
    const { db, search, fixture, crm, alpha } = await setup();
    const deps = { providers: [new fixture.FixtureProvider()], secret };
    const preview = await search.previewCompanyDiscovery(alpha, hanoi, undefined, deps);
    const target = preview.candidates[0];
    if (!target) throw new Error("Expected a candidate");

    const saved = await search.saveDiscoveredCandidate(alpha, target.token, deps);
    expect(saved).toMatchObject({ created: true, name: target.name });
    const again = await search.saveDiscoveredCandidate(alpha, target.token, deps);
    expect(again).toMatchObject({ created: false, companyId: saved.companyId });

    const stored = await db.select().from(companies).where(eq(companies.workspaceId, alpha.workspaceId));
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ countryCode: "VN", city: "Hanoi", province: "Hanoi" });
    const sources = await db.select().from(companySources).where(eq(companySources.companyId, saved.companyId));
    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({ provider: "fixture", externalId: target.externalId });
    const audits = await db.select().from(auditLogs).where(eq(auditLogs.action, "prospecting.discovery_company_saved"));
    expect(audits).toHaveLength(2);

    const refreshed = await search.previewCompanyDiscovery(alpha, hanoi, undefined, deps);
    expect(refreshed.candidates.find((candidate) => candidate.externalId === target.externalId)?.existingCompanyId).toBe(saved.companyId);

    const lead = await crm.createCrmLead(alpha, { companyId: saved.companyId, title: saved.name });
    expect(lead.created).toBe(true);
    expect(await crm.createCrmLead(alpha, { companyId: saved.companyId, title: saved.name })).toEqual({ leadId: lead.leadId, created: false });
  });

  it("serves Johannesburg only from a source that covers it and never substitutes Western Cape results", async () => {
    const { search, fixture, alpha } = await setup();
    const local = westernCapeLike();
    const input = { countryCode: "ZA", city: "Johannesburg", industry: "IT & Software Companies" };

    await expect(search.previewCompanyDiscovery(alpha, input, undefined, { providers: [local], secret })).rejects.toMatchObject({
      code: "unsupported_location",
      message: expect.stringContaining("No configured data source covers Johannesburg, South Africa"),
    });
    expect(local.search).not.toHaveBeenCalled();

    const withFixture = await search.previewCompanyDiscovery(alpha, input, undefined, { providers: [local, new fixture.FixtureProvider()], secret });
    expect(withFixture.providerId).toBe("fixture");
    expect(withFixture.candidates.every((candidate) => candidate.city === "Johannesburg" && candidate.name.includes("[FIXTURE]"))).toBe(true);
    expect(local.search).not.toHaveBeenCalled();
  });

  it("keeps existing Cape Town coverage on the real source when a fixture is also enabled", async () => {
    const { search, fixture, alpha } = await setup();
    const local = westernCapeLike();
    const result = await search.previewCompanyDiscovery(alpha, { countryCode: "ZA", city: "cape town", industry: "Medical & Dental Practices" }, undefined, { providers: [new fixture.FixtureProvider(), local], secret });
    expect(result.providerId).toBe("osm_extract");
    expect(result.dataKind).toBe("local_dataset");
    expect(result.candidates.map((candidate) => candidate.name)).toEqual(["Cape Town Dental (test)"]);
    expect(local.search).toHaveBeenCalledOnce();
  });

  it("explains unsupported countries and cities instead of returning anything", async () => {
    const { search, fixture, alpha } = await setup();
    await expect(search.previewCompanyDiscovery(alpha, { countryCode: "VN", city: "Hanoi", industry: "Restaurants & Cafés" }, undefined, { providers: [westernCapeLike()], secret })).rejects.toMatchObject({
      code: "unsupported_location",
      message: expect.stringContaining("covers South Africa only"),
    });
    await expect(search.previewCompanyDiscovery(alpha, { countryCode: "VN", city: "Nha Trang", industry: "Restaurants & Cafés" }, undefined, { providers: [new fixture.FixtureProvider()], secret })).rejects.toMatchObject({
      code: "unsupported_location",
      message: expect.stringContaining("Nha Trang"),
    });
    await expect(search.previewCompanyDiscovery(alpha, { countryCode: "Atlantis", city: "Hanoi", industry: "Restaurants & Cafés" }, undefined, { providers: [new fixture.FixtureProvider()], secret })).rejects.toMatchObject({ code: "invalid_query" });
    await expect(search.previewCompanyDiscovery(alpha, hanoi, undefined, { providers: [], secret })).rejects.toBeInstanceOf((await import("./discovery")).DiscoveryUnavailableError);
  });

  it("isolates workspaces: no shared saved records, and a token is useless in another workspace", async () => {
    const { db, search, fixture, alpha, beta } = await setup();
    const deps = { providers: [new fixture.FixtureProvider()], secret };
    const preview = await search.previewCompanyDiscovery(alpha, hanoi, undefined, deps);
    const target = preview.candidates[0];
    if (!target) throw new Error("Expected a candidate");
    const saved = await search.saveDiscoveredCandidate(alpha, target.token, deps);

    const betaPreview = await search.previewCompanyDiscovery(beta, hanoi, undefined, deps);
    expect(betaPreview.candidates.every((candidate) => candidate.existingCompanyId === null)).toBe(true);
    await expect(search.saveDiscoveredCandidate(beta, target.token, deps)).rejects.toMatchObject({ code: "invalid_query" });
    const betaCompanies = await db.select().from(companies).where(eq(companies.workspaceId, beta.workspaceId));
    expect(betaCompanies).toEqual([]);

    const own = betaPreview.candidates[0];
    if (!own) throw new Error("Expected a candidate");
    const betaSaved = await search.saveDiscoveredCandidate(beta, own.token, deps);
    expect(betaSaved.companyId).not.toBe(saved.companyId);
  });

  it("rejects tampered, expired and malformed tokens and read-only roles", async () => {
    const { db, search, fixture, tokens, alpha, viewer } = await setup();
    const deps = { providers: [new fixture.FixtureProvider()], secret };
    const preview = await search.previewCompanyDiscovery(alpha, hanoi, undefined, deps);
    const target = preview.candidates[0];
    if (!target) throw new Error("Expected a candidate");

    const [body = "", signature = ""] = target.token.split(".");
    const forgedBody = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, "base64url").toString("utf8")), record: { externalId: "evil/1", name: { value: "Injected Co", kind: "observed", confidence: "high", source: "x", observedAt } } })).toString("base64url");
    for (const bad of [`${forgedBody}.${signature}`, `${body}.${signature.slice(0, -2)}AA`, "not-a-token", "", `${target.token}.extra`]) {
      await expect(search.saveDiscoveredCandidate(alpha, bad, deps)).rejects.toMatchObject({ code: "invalid_query" });
    }
    const wrongSecret = tokens.signCandidate("another-secret-".padEnd(40, "y"), alpha.workspaceId, { provider: "fixture", country: "VN", record: { externalId: "fixture/x", name: { value: "Wrong Key", kind: "observed", confidence: "low", source: "x", observedAt } }, provenance: {} }, new Date());
    await expect(search.saveDiscoveredCandidate(alpha, wrongSecret, deps)).rejects.toMatchObject({ code: "invalid_query" });
    await expect(search.saveDiscoveredCandidate(alpha, target.token, { ...deps, now: () => new Date(Date.now() + 2 * 60 * 60 * 1000) })).rejects.toMatchObject({ code: "invalid_query" });

    await expect(search.previewCompanyDiscovery(viewer, hanoi, undefined, deps)).rejects.toMatchObject({ code: "invalid_query" });
    await expect(search.saveDiscoveredCandidate(viewer, target.token, deps)).rejects.toMatchObject({ code: "invalid_query" });
    const [saved] = await db.select({ n: count() }).from(companies);
    expect(saved?.n).toBe(0);
  });

  it("does not merge the same business name across countries", async () => {
    const { db, search, tokens, alpha } = await setup();
    const record = { externalId: "shared/1", name: { value: "Phoenix Studio", kind: "observed" as const, confidence: "medium" as const, source: "test", observedAt }, city: { value: "Springfield", kind: "observed" as const, confidence: "medium" as const, source: "test", observedAt } };
    const sign = (country: string) => tokens.signCandidate(secret, alpha.workspaceId, { provider: "fixture", country, record, provenance: {} }, new Date());
    const za = await search.saveDiscoveredCandidate(alpha, sign("ZA"), { secret });
    const vn = await search.saveDiscoveredCandidate(alpha, sign("VN"), { secret });
    expect(za.companyId).not.toBe(vn.companyId);
    const stored = await db.select().from(companies).where(eq(companies.workspaceId, alpha.workspaceId));
    expect(stored.map((company) => company.countryCode).sort()).toEqual(["VN", "ZA"]);
  });

  it.each([
    ["provider_timeout", "provider_timeout"],
    ["provider_rate_limited", "provider_rate_limited"],
    ["provider_bad_response", "provider_bad_response"],
    ["provider_unavailable", "provider_unavailable"],
    ["generic", "provider_unavailable"],
  ] as const)("surfaces %s as a typed, safe error, saves nothing and marks the run failed", async (input, expectedCode) => {
    const { db, search, providers, alpha } = await setup();
    const rejection = await search.previewCompanyDiscovery(alpha, { countryCode: "ZA", city: "Cape Town", industry: "Dentists" }, undefined, { providers: [failingProvider(input, providers.DiscoveryProviderError)], secret }).catch((error: unknown) => error);
    expect(rejection).toMatchObject({ code: expectedCode });
    expect(String((rejection as Error).message)).not.toContain("internal detail");
    const runs = await db.select().from(discoveryRuns).where(eq(discoveryRuns.workspaceId, alpha.workspaceId));
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ status: "failed", errorCode: expectedCode });
    const [saved] = await db.select({ n: count() }).from(companies);
    expect(saved?.n).toBe(0);
  });

  it("counts previews against the workspace rate limit", async () => {
    const { search, alpha, discovery } = await setup();
    const deps = { providers: [westernCapeLike(false)], secret };
    const input = { countryCode: "ZA", city: "Cape Town", industry: "Dentists" };
    await search.previewCompanyDiscovery(alpha, input, undefined, deps);
    await expect(search.previewCompanyDiscovery(alpha, input, undefined, deps)).rejects.toBeInstanceOf(discovery.DiscoveryRateLimitedError);
  });

  it("still saves in bulk through the original discovery run, now with the requested country", async () => {
    const { db, discovery, fixture, alpha } = await setup();
    const outcome = await discovery.runCompanyDiscovery(alpha, hanoi, { providers: [new fixture.FixtureProvider()] });
    expect(outcome).toMatchObject({ found: 4, created: 4, alreadyKnown: 0 });
    const stored = await db.select().from(companies).where(eq(companies.workspaceId, alpha.workspaceId));
    expect(stored.every((company) => company.countryCode === "VN")).toBe(true);
    const [run] = await db.select().from(discoveryRuns).where(eq(discoveryRuns.workspaceId, alpha.workspaceId));
    expect(run?.filters).toMatchObject({ countryCode: "VN", city: "Hanoi", industry: "Restaurants & Cafés" });
  });
});
