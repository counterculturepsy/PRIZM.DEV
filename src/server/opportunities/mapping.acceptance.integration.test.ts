// @vitest-environment node

import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterEach, describe, expect, it, vi } from "vitest";
import { describeRecommendationPrice } from "@/modules/opportunities/mapping";
import { createWorkspaceScope, workspaceRoles } from "@/modules/workspaces/scope";
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

async function setup() {
  const client = new PGlite();
  const db = drizzle(client);
  await migrate(db, { migrationsFolder: "drizzle" });
  const user = one(await db.insert(users).values({ email: "acceptance@example.com" }).returning({ id: users.id }));
  const workspace = one(await db.insert(workspaces).values({ name: "Acceptance", slug: "acceptance", currency: "ZAR" }).returning({ id: workspaces.id }));
  const maintenance = one(await db.insert(services).values({
    workspaceId: workspace.id,
    name: "Ongoing Maintenance & Technical Support",
    slug: "ongoing-maintenance-technical-support",
  }).returning({ id: services.id }));
  const redesign = one(await db.insert(services).values({
    workspaceId: workspace.id,
    name: "Website Redesign & Modernisation",
    slug: "website-redesign-modernisation",
  }).returning({ id: services.id }));
  vi.resetModules();
  vi.doMock("@/server/db", () => ({ getDatabase: () => db }));
  const scope = (role: (typeof workspaceRoles)[number]) => createWorkspaceScope({ workspaceId: workspace.id, userId: user.id, role });
  return { client, db, user, workspace, maintenance, redesign, scope };
}

type Fixture = Awaited<ReturnType<typeof setup>>;

async function syntheticSecurityAudit({ db, user, workspace }: Fixture) {
  const company = one(await db.insert(companies).values({
    workspaceId: workspace.id,
    name: "[SYNTHETIC] Acceptance Co",
    dedupeKey: "domain:acceptance.invalid",
    website: "https://acceptance.invalid",
    domain: "acceptance.invalid",
  }).returning({ id: companies.id }));
  const website = one(await db.insert(websites).values({
    workspaceId: workspace.id,
    companyId: company.id,
    url: "https://acceptance.invalid/",
    normalizedOrigin: "https://acceptance.invalid",
  }).returning({ id: websites.id }));
  const audit = one(await db.insert(websiteAudits).values({
    workspaceId: workspace.id,
    websiteId: website.id,
    requestedByUserId: user.id,
    status: "completed",
    authorizationBasis: "synthetic",
    score: 85,
    completedAt: new Date("2026-10-27T08:00:00Z"),
  }).returning({ id: websiteAudits.id }));
  await db.insert(auditFindings).values(["csp_missing", "nosniff_missing", "framing_missing"].map((code) => ({
    workspaceId: workspace.id,
    auditId: audit.id,
    category: "security" as const,
    code: `security.${code}`,
    severity: "low" as const,
    title: code,
    summary: "Synthetic finding.",
    evidence: "Header absent",
    sourceUrl: "https://acceptance.invalid/",
    confidence: "high" as const,
    scoreImpact: 5,
    observedAt: new Date(),
  })));
  return { companyId: company.id, auditId: audit.id };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("mapping acceptance: preferred service without a price", () => {
  it("recommends and links the preferred service, keeps price null, and freezes the snapshot", async () => {
    const networkSpy = vi.fn(() => { throw new Error("Network access is not allowed in this test"); });
    vi.stubGlobal("fetch", networkSpy);
    const fixture = await setup();
    const { client, db, maintenance, redesign, workspace, scope } = fixture;
    const { addServiceMapping, removeServiceMapping, setPreferredService } = await import("./mappings");
    const { materializeOpportunityIntelligence } = await import("./service");
    const { getCompanyOpportunityIntelligence } = await import("./queries");
    const owner = scope("owner");

    await addServiceMapping(owner, { opportunityType: "security_hardening", serviceId: maintenance.id });
    await setPreferredService(owner, { opportunityType: "security_hardening", serviceId: maintenance.id });
    const audit = await syntheticSecurityAudit(fixture);
    await materializeOpportunityIntelligence({ workspaceId: workspace.id, auditId: audit.auditId });

    const opportunity = one(await db.select().from(opportunities).where(eq(opportunities.auditId, audit.auditId)));
    expect(opportunity).toMatchObject({
      type: "security_hardening",
      serviceId: maintenance.id,
      estimatedValueMinMinor: null,
      estimatedValueMaxMinor: null,
      currency: null,
      confidence: "high",
    });
    const snapshot = await db.select().from(opportunityServiceRecommendations).where(eq(opportunityServiceRecommendations.opportunityId, opportunity.id));
    const recorded = one(snapshot);
    expect(recorded).toMatchObject({
      serviceId: maintenance.id,
      serviceName: "Ongoing Maintenance & Technical Support",
      isPreferred: true,
      rank: 1,
      priceStatus: "not_configured",
      startingPriceMinor: null,
      averagePriceMinor: null,
      currency: null,
    });
    expect(describeRecommendationPrice(recorded.priceStatus as "not_configured", recorded.startingPriceMinor, recorded.averagePriceMinor, recorded.currency)).toBe("Price not configured");

    const report = await getCompanyOpportunityIntelligence(owner, audit.companyId);
    const entry = one(report?.opportunities ?? []);
    expect(entry.recommendation).toEqual({ kind: "preferred", serviceLabel: "Ongoing Maintenance & Technical Support", note: null, priceLabel: "Price not configured" });
    expect(entry.opportunity.estimatedValueMinMinor).toBeNull();

    // Later mapping, price and name changes must not alter what was recorded.
    await removeServiceMapping(owner, { opportunityType: "security_hardening", serviceId: maintenance.id });
    await addServiceMapping(owner, { opportunityType: "security_hardening", serviceId: redesign.id });
    await setPreferredService(owner, { opportunityType: "security_hardening", serviceId: redesign.id });
    await db.update(services).set({ name: "Renamed later", startingPriceMinor: 99_000, averagePriceMinor: 120_000, active: false }).where(eq(services.id, maintenance.id));

    expect(one(await db.select().from(opportunities).where(eq(opportunities.id, opportunity.id)))).toEqual(opportunity);
    expect(one(await db.select().from(opportunityServiceRecommendations).where(eq(opportunityServiceRecommendations.opportunityId, opportunity.id)))).toEqual(recorded);
    const afterReport = await getCompanyOpportunityIntelligence(owner, audit.companyId);
    expect(one(afterReport?.opportunities ?? []).recommendation).toEqual({ kind: "preferred", serviceLabel: "Ongoing Maintenance & Technical Support", note: null, priceLabel: "Price not configured" });
    expect(one(afterReport?.opportunities ?? []).currentlyMappedCount).toBe(1);
    expect(networkSpy).not.toHaveBeenCalled();
    await client.close();
  });
});

describe("mapping acceptance: role permissions", () => {
  it("lets owners and admins write, and gives every other role read-only access", async () => {
    const { client, db, maintenance, redesign, scope } = await setup();
    const { addServiceMapping, getMappingOverview, MappingError, removeServiceMapping, setPreferredService } = await import("./mappings");
    const writers = ["owner", "admin"] as const;
    const readers = ["sales", "developer", "viewer"] as const;
    expect([...writers, ...readers].sort()).toEqual([...workspaceRoles].sort());

    for (const role of writers) {
      const actor = scope(role);
      await expect(addServiceMapping(actor, { opportunityType: "seo_improvement", serviceId: maintenance.id })).resolves.toEqual({ changed: true });
      await expect(setPreferredService(actor, { opportunityType: "seo_improvement", serviceId: maintenance.id })).resolves.toEqual({ changed: true });
      await expect(removeServiceMapping(actor, { opportunityType: "seo_improvement", serviceId: maintenance.id })).resolves.toEqual({ changed: true });
    }

    await addServiceMapping(scope("owner"), { opportunityType: "mobile_experience", serviceId: redesign.id });
    const rowsBefore = await db.select().from(opportunityServiceMappings);
    const logsBefore = await db.select().from(auditLogs);
    for (const role of readers) {
      const actor = scope(role);
      await expect(addServiceMapping(actor, { opportunityType: "seo_improvement", serviceId: maintenance.id })).rejects.toBeInstanceOf(MappingError);
      await expect(setPreferredService(actor, { opportunityType: "mobile_experience", serviceId: redesign.id })).rejects.toBeInstanceOf(MappingError);
      await expect(setPreferredService(actor, { opportunityType: "mobile_experience", serviceId: null })).rejects.toBeInstanceOf(MappingError);
      await expect(removeServiceMapping(actor, { opportunityType: "mobile_experience", serviceId: redesign.id })).rejects.toBeInstanceOf(MappingError);
      const overview = await getMappingOverview(actor);
      expect(overview.types.find((entry) => entry.type === "mobile_experience")?.services.map((service) => service.serviceId)).toEqual([redesign.id]);
    }
    expect(await db.select().from(opportunityServiceMappings)).toEqual(rowsBefore);
    expect(await db.select().from(auditLogs)).toHaveLength(logsBefore.length);
    await client.close();
  });
});
