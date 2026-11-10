// @vitest-environment node

import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { describe, expect, it, vi } from "vitest";
import { LEGACY_SERVICE_ALIASES } from "@/modules/opportunities/mapping";
import { createWorkspaceScope } from "@/modules/workspaces/scope";
import {
  auditFindings,
  auditLogs,
  companies,
  opportunities,
  opportunityServiceMappings,
  opportunityServiceRecommendations,
  services,
  users,
  websiteAudits,
  websites,
  workspaces,
} from "@/server/db/schema";

function one<T>(rows: readonly T[]): T {
  const [row] = rows;
  if (row === undefined) throw new Error("Fixture row was not created");
  return row;
}

async function createDatabase() {
  const client = new PGlite();
  const db = drizzle(client);
  await migrate(db, { migrationsFolder: "drizzle" });
  return { client, db };
}

type TestDb = Awaited<ReturnType<typeof createDatabase>>["db"];

async function createWorkspaces(db: TestDb) {
  const user = one(await db.insert(users).values({ email: "mapping@example.com" }).returning({ id: users.id }));
  const [alpha, beta] = await db.insert(workspaces).values([
    { name: "Alpha", slug: "map-alpha", currency: "ZAR" },
    { name: "Beta", slug: "map-beta", currency: "ZAR" },
  ]).returning({ id: workspaces.id });
  if (!alpha || !beta) throw new Error("Workspaces were not created");
  const scope = (workspaceId: string, role: "owner" | "developer" = "owner") => createWorkspaceScope({ workspaceId, userId: user.id, role });
  return { user, alpha, beta, scope };
}

async function createAudit(db: TestDb, input: { workspaceId: string; userId: string; categories: Array<[typeof auditFindings.$inferInsert["category"], "high" | "medium" | "low"]>; completedAt: string }) {
  const company = one(await db.insert(companies).values({
    workspaceId: input.workspaceId,
    name: `Company ${input.completedAt}`,
    dedupeKey: `domain:${input.completedAt}.example`,
    website: `https://${input.completedAt}.example`,
    domain: `${input.completedAt}.example`,
  }).returning({ id: companies.id }));
  const website = one(await db.insert(websites).values({
    workspaceId: input.workspaceId,
    companyId: company.id,
    url: `https://${input.completedAt}.example/`,
    normalizedOrigin: `https://${input.completedAt}.example`,
  }).returning({ id: websites.id }));
  const audit = one(await db.insert(websiteAudits).values({
    workspaceId: input.workspaceId,
    websiteId: website.id,
    requestedByUserId: input.userId,
    status: "completed",
    authorizationBasis: "test",
    score: 80,
    completedAt: new Date(`${input.completedAt}T10:00:00Z`),
  }).returning({ id: websiteAudits.id }));
  await db.insert(auditFindings).values(input.categories.map(([category, confidence], index) => ({
    workspaceId: input.workspaceId,
    auditId: audit.id,
    category,
    code: `${category}.test_${index}`,
    severity: "medium" as const,
    title: `${category} finding`,
    summary: "A bounded test finding.",
    evidence: "Observed in test",
    sourceUrl: `https://${input.completedAt}.example/`,
    confidence,
    scoreImpact: 6,
    observedAt: new Date(),
  })));
  return { companyId: company.id, auditId: audit.id };
}

describe("migration 0011 legacy alias seed", () => {
  it("seeds exact slug matches idempotently, per workspace, without overwriting explicit mappings", async () => {
    const { client, db } = await createDatabase();
    const { alpha, beta } = await createWorkspaces(db);
    const migration = readFileSync("drizzle/0011_opportunity_service_mappings.sql", "utf8");
    const seed = /-- legacy-alias-seed:begin([\s\S]*?)-- legacy-alias-seed:end/.exec(migration)?.[1];
    if (!seed) throw new Error("Seed block not found in migration 0011");

    for (const [type, slugs] of Object.entries(LEGACY_SERVICE_ALIASES)) {
      for (const slug of slugs) expect(seed).toContain(`('${type}', '${slug}')`);
    }

    const alphaAudit = one(await db.insert(services).values({ workspaceId: alpha.id, name: "Accessibility audit", slug: "accessibility-audit" }).returning({ id: services.id }));
    const alphaSeo = one(await db.insert(services).values({ workspaceId: alpha.id, name: "SEO", slug: "seo" }).returning({ id: services.id }));
    const alphaCustom = one(await db.insert(services).values({ workspaceId: alpha.id, name: "Custom website", slug: "custom-website-design-development" }).returning({ id: services.id }));
    await db.insert(services).values({ workspaceId: alpha.id, name: "Near miss", slug: "Accessibility" });
    const betaAudit = one(await db.insert(services).values({ workspaceId: beta.id, name: "Accessibility audit", slug: "accessibility-audit" }).returning({ id: services.id }));

    await client.exec(seed);
    const rows = () => db.select().from(opportunityServiceMappings);
    const first = await rows();
    expect(first).toHaveLength(3);
    expect(first.every((row) => !row.isPreferred)).toBe(true);
    expect(first.filter((row) => row.workspaceId === alpha.id).map((row) => `${row.opportunityType}:${row.serviceId}`).sort())
      .toEqual([`accessibility_remediation:${alphaAudit.id}`, `seo_improvement:${alphaSeo.id}`].sort());
    expect(first.find((row) => row.workspaceId === beta.id)?.serviceId).toBe(betaAudit.id);
    expect(first.some((row) => row.serviceId === alphaCustom.id)).toBe(false);

    await db.update(opportunityServiceMappings).set({ isPreferred: true }).where(and(
      eq(opportunityServiceMappings.workspaceId, alpha.id),
      eq(opportunityServiceMappings.serviceId, alphaAudit.id),
    ));
    await db.insert(opportunityServiceMappings).values({ workspaceId: alpha.id, opportunityType: "website_improvement", serviceId: alphaCustom.id });
    await client.exec(seed);
    const second = await rows();
    expect(second).toHaveLength(4);
    expect(second.find((row) => row.serviceId === alphaAudit.id && row.workspaceId === alpha.id)?.isPreferred).toBe(true);
    await client.close();
  });

  it("is additive: the migration only creates new tables and constraints", () => {
    const migration = readFileSync("drizzle/0011_opportunity_service_mappings.sql", "utf8");
    // Statement-level check: `ON UPDATE no action` inside a constraint is not an UPDATE statement.
    expect(migration).not.toMatch(/^\s*(DROP|TRUNCATE|DELETE\s+FROM|UPDATE\s)/im);
    expect(migration).not.toMatch(/--> statement-breakpoint\s*(DROP|TRUNCATE|DELETE\s+FROM|UPDATE\s)/i);
    const alters = migration.match(/ALTER TABLE "([a-z_]+)"/g) ?? [];
    expect(alters.length).toBeGreaterThan(0);
    for (const statement of alters) expect(statement).toMatch(/opportunity_service_(mappings|recommendations)/);
  });
});

describe("service mapping administration", () => {
  it("enforces workspace isolation, roles, active services and preferred uniqueness", async () => {
    const { client, db } = await createDatabase();
    const { alpha, beta, scope } = await createWorkspaces(db);
    const alphaService = one(await db.insert(services).values({ workspaceId: alpha.id, name: "Alpha service", slug: "alpha-service" }).returning({ id: services.id }));
    const alphaSecond = one(await db.insert(services).values({ workspaceId: alpha.id, name: "Alpha second", slug: "alpha-second" }).returning({ id: services.id }));
    const dormant = one(await db.insert(services).values({ workspaceId: alpha.id, name: "Dormant", slug: "dormant", active: false }).returning({ id: services.id }));
    const betaService = one(await db.insert(services).values({ workspaceId: beta.id, name: "Beta service", slug: "beta-service" }).returning({ id: services.id }));

    vi.resetModules();
    vi.doMock("@/server/db", () => ({ getDatabase: () => db }));
    const { addServiceMapping, getMappingOverview, MappingError, removeServiceMapping, setPreferredService } = await import("./mappings");
    const alphaOwner = scope(alpha.id);
    const betaOwner = scope(beta.id);

    // Server functions: cross-workspace, role and activity checks.
    await expect(addServiceMapping(alphaOwner, { opportunityType: "seo_improvement", serviceId: betaService.id })).rejects.toBeInstanceOf(MappingError);
    await expect(addServiceMapping(scope(alpha.id, "developer"), { opportunityType: "seo_improvement", serviceId: alphaService.id })).rejects.toBeInstanceOf(MappingError);
    await expect(addServiceMapping(alphaOwner, { opportunityType: "seo_improvement", serviceId: dormant.id })).rejects.toBeInstanceOf(MappingError);
    await expect(addServiceMapping(alphaOwner, { opportunityType: "not_a_type", serviceId: alphaService.id })).rejects.toBeInstanceOf(MappingError);

    // Multiple services per type, at most one preferred.
    await expect(addServiceMapping(alphaOwner, { opportunityType: "seo_improvement", serviceId: alphaService.id })).resolves.toEqual({ changed: true });
    await expect(addServiceMapping(alphaOwner, { opportunityType: "seo_improvement", serviceId: alphaService.id })).resolves.toEqual({ changed: false });
    await addServiceMapping(alphaOwner, { opportunityType: "seo_improvement", serviceId: alphaSecond.id });
    await expect(setPreferredService(alphaOwner, { opportunityType: "seo_improvement", serviceId: betaService.id })).rejects.toBeInstanceOf(MappingError);
    await expect(setPreferredService(alphaOwner, { opportunityType: "website_improvement", serviceId: alphaService.id })).rejects.toBeInstanceOf(MappingError);
    await setPreferredService(alphaOwner, { opportunityType: "seo_improvement", serviceId: alphaService.id });
    await setPreferredService(alphaOwner, { opportunityType: "seo_improvement", serviceId: alphaSecond.id });
    const preferred = await db.select().from(opportunityServiceMappings).where(and(eq(opportunityServiceMappings.workspaceId, alpha.id), eq(opportunityServiceMappings.isPreferred, true)));
    expect(preferred.map((row) => row.serviceId)).toEqual([alphaSecond.id]);
    await setPreferredService(alphaOwner, { opportunityType: "seo_improvement", serviceId: null });
    expect(await db.select().from(opportunityServiceMappings).where(eq(opportunityServiceMappings.isPreferred, true))).toHaveLength(0);

    // Beta is isolated from alpha in both directions.
    await addServiceMapping(betaOwner, { opportunityType: "seo_improvement", serviceId: betaService.id });
    await setPreferredService(betaOwner, { opportunityType: "seo_improvement", serviceId: betaService.id });
    const betaOverview = await getMappingOverview(betaOwner);
    expect(betaOverview.catalogue.map((service) => service.id)).toEqual([betaService.id]);
    expect(betaOverview.types.find((entry) => entry.type === "seo_improvement")?.services.map((service) => service.serviceId)).toEqual([betaService.id]);
    const alphaOverview = await getMappingOverview(alphaOwner);
    expect(alphaOverview.types.find((entry) => entry.type === "seo_improvement")?.services.map((service) => service.serviceId).sort()).toEqual([alphaSecond.id, alphaService.id].sort());
    expect(alphaOverview.types.find((entry) => entry.type === "mobile_experience")).toMatchObject({ effectiveCount: 0, services: [] });
    await expect(removeServiceMapping(betaOwner, { opportunityType: "seo_improvement", serviceId: alphaService.id })).resolves.toEqual({ changed: false });

    // Database constraints hold independently of the server functions.
    await expect(db.insert(opportunityServiceMappings).values({ workspaceId: beta.id, opportunityType: "mobile_experience", serviceId: alphaService.id })).rejects.toThrow();
    await db.insert(opportunityServiceMappings).values({ workspaceId: alpha.id, opportunityType: "mobile_experience", serviceId: alphaService.id, isPreferred: true });
    await expect(db.insert(opportunityServiceMappings).values({ workspaceId: alpha.id, opportunityType: "mobile_experience", serviceId: alphaSecond.id, isPreferred: true })).rejects.toThrow();
    await expect(db.insert(opportunityServiceMappings).values({ workspaceId: alpha.id, opportunityType: "mobile_experience", serviceId: alphaService.id })).rejects.toThrow();

    // Removing a mapping deletes only that mapping, and every change is audited.
    await removeServiceMapping(alphaOwner, { opportunityType: "seo_improvement", serviceId: alphaSecond.id });
    expect(await db.select().from(opportunityServiceMappings).where(eq(opportunityServiceMappings.serviceId, alphaSecond.id))).toHaveLength(0);
    expect(await db.select().from(services).where(eq(services.id, alphaSecond.id))).toHaveLength(1);
    const actions = (await db.select({ action: auditLogs.action }).from(auditLogs)).map((row) => row.action);
    expect(actions).toEqual(expect.arrayContaining(["opportunity_service_mapping.added", "opportunity_service_mapping.removed", "opportunity_service_mapping.preferred_changed"]));
    await client.close();
  });
});

describe("recommendation snapshots", () => {
  it("snapshots names, preferred status and prices, survives service changes, and never rewrites history", async () => {
    const { client, db } = await createDatabase();
    const { user, alpha, beta, scope } = await createWorkspaces(db);
    const redesign = one(await db.insert(services).values({ workspaceId: alpha.id, name: "Website Redesign", slug: "website-redesign", startingPriceMinor: 15_000, averagePriceMinor: 25_000 }).returning({ id: services.id }));
    const maintenance = one(await db.insert(services).values({ workspaceId: alpha.id, name: "Maintenance", slug: "maintenance" }).returning({ id: services.id }));
    const extra = one(await db.insert(services).values({ workspaceId: alpha.id, name: "Extra", slug: "extra" }).returning({ id: services.id }));
    const dormant = one(await db.insert(services).values({ workspaceId: alpha.id, name: "Dormant", slug: "dormant", active: false, startingPriceMinor: 1 }).returning({ id: services.id }));
    const betaService = one(await db.insert(services).values({ workspaceId: beta.id, name: "Beta only", slug: "beta-only", startingPriceMinor: 99_000, averagePriceMinor: 99_999 }).returning({ id: services.id }));

    vi.resetModules();
    vi.doMock("@/server/db", () => ({ getDatabase: () => db }));
    const { addServiceMapping, setPreferredService } = await import("./mappings");
    const { materializeOpportunityIntelligence } = await import("./service");
    const { getCompanyOpportunityIntelligence } = await import("./queries");
    const owner = scope(alpha.id);

    await addServiceMapping(owner, { opportunityType: "accessibility_remediation", serviceId: maintenance.id });
    await addServiceMapping(owner, { opportunityType: "accessibility_remediation", serviceId: redesign.id });
    await setPreferredService(owner, { opportunityType: "accessibility_remediation", serviceId: redesign.id });
    await addServiceMapping(owner, { opportunityType: "security_hardening", serviceId: maintenance.id });
    await setPreferredService(owner, { opportunityType: "security_hardening", serviceId: maintenance.id });
    await db.insert(opportunityServiceMappings).values({ workspaceId: alpha.id, opportunityType: "accessibility_remediation", serviceId: dormant.id });
    await db.insert(opportunityServiceMappings).values({ workspaceId: beta.id, opportunityType: "accessibility_remediation", serviceId: betaService.id, isPreferred: true });

    const first = await createAudit(db, { workspaceId: alpha.id, userId: user.id, completedAt: "2026-10-20", categories: [["accessibility", "high"], ["security", "medium"], ["seo", "high"]] });
    await materializeOpportunityIntelligence({ workspaceId: alpha.id, auditId: first.auditId, actorUserId: user.id });

    const generated = await db.select().from(opportunities).where(eq(opportunities.auditId, first.auditId));
    const byType = (type: string) => generated.find((row) => row.type === type);
    // Priced preferred service: link and price range come from it only.
    expect(byType("accessibility_remediation")).toMatchObject({ serviceId: redesign.id, estimatedValueMinMinor: 15_000, estimatedValueMaxMinor: 25_000, currency: "ZAR", confidence: "high" });
    // Preferred service without a price: still linked, no price or currency invented.
    expect(byType("security_hardening")).toMatchObject({ serviceId: maintenance.id, estimatedValueMinMinor: null, estimatedValueMaxMinor: null, currency: null, confidence: "medium" });
    // Unmapped type: valid opportunity, no service, no recommendations.
    expect(byType("seo_improvement")).toMatchObject({ serviceId: null, estimatedValueMinMinor: null, currency: null, confidence: "high" });

    const snapshotFor = async (opportunityId: string) => (await db.select().from(opportunityServiceRecommendations)
      .where(eq(opportunityServiceRecommendations.opportunityId, opportunityId))).sort((a, b) => a.rank - b.rank);
    const accessibility = await snapshotFor(byType("accessibility_remediation")?.id ?? "");
    expect(accessibility.map((row) => [row.serviceName, row.isPreferred, row.rank, row.priceStatus, row.startingPriceMinor, row.averagePriceMinor, row.currency]))
      .toEqual([["Website Redesign", true, 1, "configured", 15_000, 25_000, "ZAR"], ["Maintenance", false, 2, "not_configured", null, null, null]]);
    expect(accessibility.some((row) => row.serviceId === dormant.id || row.serviceId === betaService.id)).toBe(false);
    expect(await snapshotFor(byType("seo_improvement")?.id ?? "")).toHaveLength(0);

    // A pre-existing historical opportunity must not be touched by later mapping work.
    const historicalAudit = await createAudit(db, { workspaceId: alpha.id, userId: user.id, completedAt: "2026-09-01", categories: [["performance", "low"]] });
    const historical = one(await db.insert(opportunities).values({
      workspaceId: alpha.id, companyId: historicalAudit.companyId, auditId: historicalAudit.auditId, type: "performance_optimization",
      title: "Historical", summary: "Historical", businessImpact: "Historical", recommendedSolution: "Historical", confidence: "low",
    }).returning());
    await addServiceMapping(owner, { opportunityType: "performance_optimization", serviceId: maintenance.id });

    // Changing and deactivating the live services does not rewrite snapshots.
    await db.update(services).set({ name: "Renamed", startingPriceMinor: 70_000, averagePriceMinor: 80_000 }).where(eq(services.id, redesign.id));
    await db.update(services).set({ active: false }).where(eq(services.id, maintenance.id));
    const afterEdits = await snapshotFor(byType("accessibility_remediation")?.id ?? "");
    expect(afterEdits.map((row) => [row.serviceName, row.startingPriceMinor])).toEqual([["Website Redesign", 15_000], ["Maintenance", null]]);
    const report = await getCompanyOpportunityIntelligence(owner, first.companyId);
    const reportAccessibility = report?.opportunities.find((entry) => entry.opportunity.type === "accessibility_remediation");
    expect(reportAccessibility?.recommendation).toMatchObject({ kind: "preferred", serviceLabel: "Website Redesign" });
    // The non-preferred snapshot service is stored but never presented as recommended.
    expect(JSON.stringify(reportAccessibility?.recommendation)).not.toContain("Maintenance");
    expect(reportAccessibility?.currentlyMappedCount).toBe(1);
    expect(report?.opportunities.find((entry) => entry.opportunity.type === "seo_improvement")).toMatchObject({ recommendation: { kind: "none" }, currentlyMappedCount: 0 });
    expect(report?.assessment.websiteHealth.score).toBe(80);
    expect(await getCompanyOpportunityIntelligence(scope(beta.id), first.companyId)).toBeNull();

    // No automatic backfill: the historical row is identical and has no recommendations.
    const historicalAfter = one(await db.select().from(opportunities).where(eq(opportunities.id, historical.id)));
    expect(historicalAfter).toEqual(historical);
    expect(await snapshotFor(historical.id)).toHaveLength(0);

    // A later audit snapshots current state; a deleted, never-linked service keeps its snapshot name.
    await db.update(services).set({ active: true }).where(eq(services.id, maintenance.id));
    await addServiceMapping(owner, { opportunityType: "accessibility_remediation", serviceId: extra.id });
    const second = await createAudit(db, { workspaceId: alpha.id, userId: user.id, completedAt: "2026-10-21", categories: [["accessibility", "high"]] });
    await materializeOpportunityIntelligence({ workspaceId: alpha.id, auditId: second.auditId });
    const secondOpportunity = one(await db.select().from(opportunities).where(eq(opportunities.auditId, second.auditId)));
    expect((await snapshotFor(secondOpportunity.id)).map((row) => row.serviceName)).toEqual(["Renamed", "Extra", "Maintenance"]);
    await db.delete(services).where(eq(services.id, extra.id));
    const afterDelete = await snapshotFor(secondOpportunity.id);
    expect(afterDelete.map((row) => [row.serviceName, row.serviceId === null])).toEqual([["Renamed", false], ["Extra", true], ["Maintenance", false]]);
    // A service linked from an opportunity cannot be deleted from under it.
    await expect(db.delete(services).where(eq(services.id, redesign.id))).rejects.toThrow();

    // Explicit re-materialisation replaces the audit's snapshot without duplicates.
    await materializeOpportunityIntelligence({ workspaceId: alpha.id, auditId: second.auditId });
    const rerun = one(await db.select().from(opportunities).where(eq(opportunities.auditId, second.auditId)));
    expect((await snapshotFor(rerun.id)).map((row) => row.serviceName)).toEqual(["Renamed", "Maintenance"]);
    // Recommendations never alter evidence or confidence.
    expect(rerun.confidence).toBe("high");
    await client.close();
  });

  it("rejects cross-workspace and malformed snapshot rows at the database", async () => {
    const { client, db } = await createDatabase();
    const { user, alpha, beta } = await createWorkspaces(db);
    const alphaService = one(await db.insert(services).values({ workspaceId: alpha.id, name: "A", slug: "a" }).returning({ id: services.id }));
    const audit = await createAudit(db, { workspaceId: alpha.id, userId: user.id, completedAt: "2026-10-22", categories: [["seo", "high"]] });
    const opportunity = one(await db.insert(opportunities).values({
      workspaceId: alpha.id, companyId: audit.companyId, auditId: audit.auditId, type: "seo_improvement",
      title: "T", summary: "S", businessImpact: "B", recommendedSolution: "R", confidence: "high",
    }).returning({ id: opportunities.id }));
    const base = { auditId: audit.auditId, opportunityId: opportunity.id, serviceName: "A", rank: 1, priceStatus: "not_configured" };
    await expect(db.insert(opportunityServiceRecommendations).values({ ...base, workspaceId: beta.id, serviceId: alphaService.id })).rejects.toThrow();
    await expect(db.insert(opportunityServiceRecommendations).values({ ...base, workspaceId: beta.id, serviceId: null })).rejects.toThrow();
    await expect(db.insert(opportunityServiceRecommendations).values({ ...base, workspaceId: alpha.id, serviceId: alphaService.id, priceStatus: "guess" })).rejects.toThrow();
    await expect(db.insert(opportunityServiceRecommendations).values({ ...base, workspaceId: alpha.id, serviceId: alphaService.id, startingPriceMinor: 100 })).rejects.toThrow();
    await expect(db.insert(opportunityServiceRecommendations).values({ ...base, workspaceId: alpha.id, serviceId: alphaService.id, priceStatus: "configured", currency: "ZAR" })).rejects.toThrow();
    await db.insert(opportunityServiceRecommendations).values({ ...base, workspaceId: alpha.id, serviceId: alphaService.id, isPreferred: true });
    await expect(db.insert(opportunityServiceRecommendations).values({ ...base, workspaceId: alpha.id, serviceId: null, rank: 2, isPreferred: true })).rejects.toThrow();
    await client.close();
  });
});
