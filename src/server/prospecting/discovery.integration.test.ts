// @vitest-environment node

import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { describe, expect, it, vi } from "vitest";
import type { ServerEnv } from "@/config/env";
import type { BusinessSearchRecord, DiscoveryProvider, SourcedValue } from "@/modules/prospecting/providers";
import { createWorkspaceScope } from "@/modules/workspaces/scope";
import { auditLogs, companies, companySources, discoveryRuns, users, workspaceMembers, workspaces } from "@/server/db/schema";

const observedAt = "2026-10-26T10:00:00.000Z";
const fact = (value: string, kind: SourcedValue<string>["kind"] = "observed"): SourcedValue<string> => ({ value, kind, confidence: "medium", source: "openstreetmap", observedAt });
const input = { industry: "Dentists", city: "Cape Town" };

function record(id: number, name: string, extra: Partial<BusinessSearchRecord> = {}): BusinessSearchRecord {
  return { externalId: `node/${id}`, name: fact(name), sourceUrl: `https://www.openstreetmap.org/node/${id}`, ...extra };
}

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
  const discovery = await import("./discovery");
  const imports = await import("./imports");
  const providers = await import("@/modules/prospecting/providers");

  const provider = (search: DiscoveryProvider["search"]): DiscoveryProvider => ({
    id: "overpass",
    displayName: "OpenStreetMap (Overpass)",
    license: { name: "ODbL", url: "https://www.openstreetmap.org/copyright", attribution: "© OpenStreetMap contributors" },
    search,
  });
  return {
    client, db, discovery, imports, providers, provider,
    alpha: createWorkspaceScope({ workspaceId: alpha.id, userId: user.id, role: "owner" }),
    beta: createWorkspaceScope({ workspaceId: beta.id, userId: user.id, role: "owner" }),
  };
}

const later = (minutes: number) => () => new Date(Date.now() + minutes * 60_000);

describe("company discovery", () => {
  it("saves provider results with attribution and never overwrites user-supplied fields", async () => {
    const { client, db, discovery, imports, provider, alpha } = await setup();
    await imports.importCompanyCsv(alpha, "name,website,industry\nFixture Dental Clinic,fixture-dental.example,Healthcare (mine)");
    const search = vi.fn(async () => ({
      records: [
        record(1, "Fixture Dental Clinic Cape Town", {
          website: fact("https://www.fixture-dental.example/"), phone: fact("+27 21 555 0100"), industry: fact("Dentists"), city: fact("Cape Town", "inferred"),
        }),
        record(2, "Fixture Smile Studio", { city: fact("Cape Town", "inferred"), industry: fact("Dentists") }),
      ],
    }));

    const outcome = await discovery.runCompanyDiscovery(alpha, input, { provider: provider(search) });

    expect(outcome).toMatchObject({ found: 2, created: 1, alreadyKnown: 1, skipped: 0, attribution: "© OpenStreetMap contributors" });
    const stored = await db.select().from(companies).where(eq(companies.workspaceId, alpha.workspaceId));
    expect(stored).toHaveLength(2);
    const existing = stored.find((company) => company.domain === "fixture-dental.example");
    expect(existing?.name).toBe("Fixture Dental Clinic");
    expect(existing?.industry).toBe("Healthcare (mine)");
    expect(existing?.phone).toBe("+27 21 555 0100");
    expect(existing?.city).toBe("Cape Town");

    const sources = await db.select().from(companySources).where(eq(companySources.provider, "overpass"));
    expect(sources).toHaveLength(2);
    expect(sources.every((source) => source.kind === "observed" && source.confidence === "medium")).toBe(true);
    expect(sources[0]?.sourceUrl).toMatch(/^https:\/\/www\.openstreetmap\.org\/node\//);
    expect(sources.some((source) => source.snapshot["basis_city"] === "search_area")).toBe(true);

    const [run] = await db.select().from(discoveryRuns).where(eq(discoveryRuns.provider, "overpass"));
    expect(run).toMatchObject({ status: "completed", resultCount: 2 });
    expect(run?.filters).toMatchObject({ industry: "Dentists", city: "Cape Town", countryCode: "ZA" });
    const logs = await db.select().from(auditLogs).where(eq(auditLogs.action, "prospecting.discovery_run"));
    expect(logs).toHaveLength(1);
    await client.close();
  });

  it("is idempotent across runs and does not duplicate sources", async () => {
    const { client, db, discovery, provider, alpha } = await setup();
    const search = vi.fn(async () => ({ records: [record(1, "Fixture One"), record(2, "Fixture Two")] }));
    await expect(discovery.runCompanyDiscovery(alpha, input, { provider: provider(search) })).resolves.toMatchObject({ created: 2, alreadyKnown: 0 });
    await expect(discovery.runCompanyDiscovery(alpha, input, { provider: provider(search), now: later(10) })).resolves.toMatchObject({ created: 0, alreadyKnown: 2 });
    expect(await db.select().from(companies)).toHaveLength(2);
    expect(await db.select().from(companySources)).toHaveLength(2);
    await client.close();
  });

  it("rate limits per workspace without blocking other workspaces", async () => {
    const { client, db, discovery, provider, alpha, beta } = await setup();
    const search = vi.fn(async () => ({ records: [record(1, "Fixture One")] }));
    await discovery.runCompanyDiscovery(alpha, input, { provider: provider(search) });
    await expect(discovery.runCompanyDiscovery(alpha, input, { provider: provider(search) })).rejects.toBeInstanceOf(discovery.DiscoveryRateLimitedError);
    expect(search).toHaveBeenCalledTimes(1);
    expect(await db.select().from(discoveryRuns).where(eq(discoveryRuns.workspaceId, alpha.workspaceId))).toHaveLength(1);
    await expect(discovery.runCompanyDiscovery(beta, input, { provider: provider(search) })).resolves.toMatchObject({ created: 1 });
    const betaCompanies = await db.select().from(companies).where(eq(companies.workspaceId, beta.workspaceId));
    expect(betaCompanies).toHaveLength(1);
    await client.close();
  });

  it("records provider failures, saves nothing, and backs off after a rate limit", async () => {
    const { client, db, discovery, providers, provider, alpha } = await setup();
    const failing = provider(async () => { throw new providers.DiscoveryProviderError("provider_rate_limited", "Slow down."); });
    await expect(discovery.runCompanyDiscovery(alpha, input, { provider: failing })).rejects.toMatchObject({ code: "provider_rate_limited" });
    const [run] = await db.select().from(discoveryRuns).where(eq(discoveryRuns.workspaceId, alpha.workspaceId));
    expect(run).toMatchObject({ status: "failed", errorCode: "provider_rate_limited" });
    expect(await db.select().from(companies)).toHaveLength(0);

    const retry = provider(async () => ({ records: [] }));
    await expect(discovery.runCompanyDiscovery(alpha, input, { provider: retry, now: later(0.6) })).rejects.toBeInstanceOf(discovery.DiscoveryRateLimitedError);
    await expect(discovery.runCompanyDiscovery(alpha, input, { provider: retry, now: later(5) })).resolves.toMatchObject({ found: 0, created: 0 });
    await client.close();
  });

  it("hides unexpected provider errors behind a safe message", async () => {
    const { client, discovery, provider, alpha, db } = await setup();
    const leaky = provider(async () => { throw new Error("secret-token-abc123 rejected"); });
    await expect(discovery.runCompanyDiscovery(alpha, input, { provider: leaky })).rejects.toMatchObject({
      code: "provider_unavailable", message: expect.not.stringContaining("secret-token"),
    });
    const [run] = await db.select().from(discoveryRuns);
    expect(run?.errorCode).toBe("provider_unavailable");
    await client.close();
  });

  it("refuses to run when no provider is enabled", async () => {
    const { client, db, discovery, alpha } = await setup();
    await expect(discovery.runCompanyDiscovery(alpha, input, { provider: null })).rejects.toBeInstanceOf(discovery.DiscoveryUnavailableError);
    expect(await db.select().from(discoveryRuns)).toHaveLength(0);
    await client.close();
  });

  it("validates input before creating a run", async () => {
    const { client, db, discovery, provider, alpha } = await setup();
    const search = vi.fn(async () => ({ records: [] }));
    await expect(discovery.runCompanyDiscovery(alpha, { industry: "Dentists" }, { provider: provider(search) })).rejects.toMatchObject({ code: "invalid_query" });
    await expect(discovery.runCompanyDiscovery(alpha, { city: "Cape Town" }, { provider: provider(search) })).rejects.toMatchObject({ code: "invalid_query" });
    expect(search).not.toHaveBeenCalled();
    expect(await db.select().from(discoveryRuns)).toHaveLength(0);
    await client.close();
  });

  it("keeps a company when one optional field is invalid and says what was dropped", async () => {
    const { client, db, discovery, provider, alpha } = await setup();
    const search = vi.fn(async () => ({ records: [record(1, "Fixture One", { email: fact("not-an-email"), phone: fact("+27 21 555 0100") }), record(2, "")] }));
    await expect(discovery.runCompanyDiscovery(alpha, input, { provider: provider(search) })).resolves.toMatchObject({ created: 1, skipped: 1 });
    const [company] = await db.select().from(companies);
    expect(company).toMatchObject({ name: "Fixture One", email: null, phone: "+27 21 555 0100" });
    const [source] = await db.select().from(companySources);
    expect(source?.snapshot["dropped_invalid_fields"]).toBe("email");
    await client.close();
  });

  it("reports the configured industries only when a provider is enabled", async () => {
    const { client, discovery } = await setup();
    const enabledEnv = { DISCOVERY_PROVIDER: "overpass", DISCOVERY_USER_AGENT: "PRIZMDEV/1.0 (https://example.com/contact)" } as ServerEnv;
    expect(discovery.getDiscoveryStatus({ DISCOVERY_PROVIDER: "none" } as ServerEnv)).toMatchObject({ enabled: false });
    const status = discovery.getDiscoveryStatus(enabledEnv);
    expect(status.enabled).toBe(true);
    if (status.enabled) {
      expect(status.industries).toHaveLength(10);
      expect(status.license.attribution).toBe("© OpenStreetMap contributors");
    }
    expect(discovery.getDiscoveryStatus(enabledEnv, {})).toEqual({ enabled: false, reason: "No industries are configured for discovery yet." });
    await client.close();
  });

  it("stops following cursors after the page cap", async () => {
    const { client, discovery, provider, alpha } = await setup();
    let page = 0;
    const search = vi.fn(async () => { page += 1; return { records: [record(page, `Fixture ${page}`)], cursor: `next-${page}` }; });
    const outcome = await discovery.runCompanyDiscovery(alpha, input, { provider: provider(search) });
    expect(search).toHaveBeenCalledTimes(3);
    expect(outcome.found).toBe(3);
    await client.close();
  });
});
