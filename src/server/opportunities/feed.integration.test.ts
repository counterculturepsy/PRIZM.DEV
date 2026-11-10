// @vitest-environment node

import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { describe, expect, it, vi } from "vitest";
import { createWorkspaceScope } from "@/modules/workspaces/scope";
import {
  auditFindings,
  companies,
  idealCustomerProfiles,
  leads,
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

type Severity = "info" | "low" | "medium" | "high";
type FindingSpec = [typeof auditFindings.$inferInsert["category"], Severity, "high" | "medium" | "low"];

async function setup() {
  const client = new PGlite();
  const db = drizzle(client);
  await migrate(db, { migrationsFolder: "drizzle" });
  const user = one(await db.insert(users).values({ email: "feed@example.com" }).returning({ id: users.id }));
  const [alpha, beta] = await db.insert(workspaces).values([
    { name: "Alpha", slug: "feed-alpha", currency: "ZAR" },
    { name: "Beta", slug: "feed-beta", currency: "ZAR" },
  ]).returning({ id: workspaces.id });
  if (!alpha || !beta) throw new Error("Workspaces were not created");
  await db.insert(idealCustomerProfiles).values({ workspaceId: alpha.id, industries: ["Hospitality"], cities: ["Stellenbosch"] });
  vi.resetModules();
  vi.doMock("@/server/db", () => ({ getDatabase: () => db }));
  const mappings = await import("./mappings");
  const { materializeOpportunityIntelligence } = await import("./service");
  const { listOpportunityFeed } = await import("./queries");
  const scope = (workspaceId: string, role: "owner" | "viewer" = "owner") => createWorkspaceScope({ workspaceId, userId: user.id, role });

  async function createCompanyAudit(input: { workspaceId: string; key: string; industry?: string | null; city?: string | null; email?: string | null; findings: FindingSpec[] }) {
    const company = one(await db.insert(companies).values({
      workspaceId: input.workspaceId,
      name: `Company ${input.key}`,
      dedupeKey: `domain:${input.key}.example`,
      website: `https://${input.key}.example`,
      domain: `${input.key}.example`,
      industry: input.industry ?? null,
      city: input.city ?? null,
      email: input.email ?? null,
    }).returning({ id: companies.id }));
    const website = one(await db.insert(websites).values({
      workspaceId: input.workspaceId,
      companyId: company.id,
      url: `https://${input.key}.example/`,
      normalizedOrigin: `https://${input.key}.example`,
    }).returning({ id: websites.id }));
    const audit = one(await db.insert(websiteAudits).values({
      workspaceId: input.workspaceId,
      websiteId: website.id,
      requestedByUserId: user.id,
      status: "completed",
      authorizationBasis: "synthetic",
      score: 80,
      completedAt: new Date("2026-10-27T08:00:00Z"),
    }).returning({ id: websiteAudits.id }));
    await db.insert(auditFindings).values(input.findings.map(([category, severity, confidence], index) => ({
      workspaceId: input.workspaceId,
      auditId: audit.id,
      category,
      code: `${category}.synthetic_${index}`,
      severity,
      title: `${category} finding ${index}`,
      summary: "Synthetic finding.",
      evidence: "Synthetic evidence",
      sourceUrl: `https://${input.key}.example/`,
      confidence,
      scoreImpact: 5,
      observedAt: new Date(),
    })));
    return { companyId: company.id, auditId: audit.id };
  }

  const materialize = (workspaceId: string, auditId: string) => materializeOpportunityIntelligence({ workspaceId, auditId });
  return { client, db, user, alpha, beta, scope, mappings, createCompanyAudit, materialize, listOpportunityFeed };
}

const byCompany = <T extends { companyName: string; type: string }>(rows: readonly T[], key: string, type?: string) =>
  one(rows.filter((row) => row.companyName === `Company ${key}` && (type === undefined || row.type === type)));

describe("opportunity feed", () => {
  it("never resolves historical rows from current mappings, and snapshots stay frozen", async () => {
    const ctx = await setup();
    const { client, db, alpha, scope, mappings, createCompanyAudit, materialize, listOpportunityFeed } = ctx;
    const owner = scope(alpha.id);
    const maintenance = one(await db.insert(services).values({ workspaceId: alpha.id, name: "Ongoing Maintenance", slug: "maintenance" }).returning({ id: services.id }));
    const redesign = one(await db.insert(services).values({ workspaceId: alpha.id, name: "Website Redesign", slug: "redesign", startingPriceMinor: 15_000, averagePriceMinor: 25_000 }).returning({ id: services.id }));

    // Generated before any mapping exists: a genuine historical row with no snapshot.
    const historic = await createCompanyAudit({ workspaceId: alpha.id, key: "historic", findings: [["security", "high", "high"]] });
    await materialize(alpha.id, historic.auditId);

    await mappings.addServiceMapping(owner, { opportunityType: "security_hardening", serviceId: maintenance.id });
    await mappings.setPreferredService(owner, { opportunityType: "security_hardening", serviceId: maintenance.id });
    await mappings.addServiceMapping(owner, { opportunityType: "accessibility_remediation", serviceId: redesign.id });
    await mappings.setPreferredService(owner, { opportunityType: "accessibility_remediation", serviceId: redesign.id });
    await mappings.addServiceMapping(owner, { opportunityType: "seo_improvement", serviceId: maintenance.id });

    const priced = await createCompanyAudit({ workspaceId: alpha.id, key: "priced", findings: [["accessibility", "medium", "high"]] });
    const unpriced = await createCompanyAudit({ workspaceId: alpha.id, key: "unpriced", findings: [["security", "low", "medium"]] });
    const noPreferred = await createCompanyAudit({ workspaceId: alpha.id, key: "nopreferred", findings: [["seo", "info", "high"]] });
    for (const audit of [priced, unpriced, noPreferred]) await materialize(alpha.id, audit.auditId);

    const rows = await listOpportunityFeed(owner);
    expect(rows).toHaveLength(4);
    // The historical security opportunity stays "no snapshot" even though security is mapped today.
    expect(byCompany(rows, "historic").recommendation).toEqual({ kind: "none", serviceLabel: "No service recommendation confirmed", note: "No recommendation snapshot", priceLabel: "Price not recorded" });
    expect(byCompany(rows, "priced").recommendation).toMatchObject({ kind: "preferred", serviceLabel: "Website Redesign", priceLabel: expect.stringMatching(/150.*250/) });
    expect(byCompany(rows, "unpriced").recommendation).toEqual({ kind: "preferred", serviceLabel: "Ongoing Maintenance", note: null, priceLabel: "Price not configured" });
    expect(byCompany(rows, "nopreferred").recommendation).toEqual({ kind: "no_preferred", serviceLabel: "No service recommendation confirmed", note: null, priceLabel: "No price shown" });

    // Rename, reprice, deactivate and remap: recorded snapshots must not move.
    const before = rows.map((row) => [row.companyName, row.recommendation]);
    await db.update(services).set({ name: "Renamed", startingPriceMinor: 99_000, averagePriceMinor: 120_000 }).where(eq(services.id, redesign.id));
    await db.update(services).set({ active: false }).where(eq(services.id, maintenance.id));
    await mappings.setPreferredService(owner, { opportunityType: "accessibility_remediation", serviceId: null });
    await mappings.removeServiceMapping(owner, { opportunityType: "accessibility_remediation", serviceId: redesign.id });
    const after = await listOpportunityFeed(owner);
    expect(after.map((row) => [row.companyName, row.recommendation])).toEqual(before);
    expect(byCompany(after, "historic").recommendation.kind).toBe("none");

    // Rows without a current lead score stay excluded, exactly as before.
    const unscored = await createCompanyAudit({ workspaceId: alpha.id, key: "unscored", findings: [["performance", "low", "high"]] });
    await db.insert(opportunities).values({
      workspaceId: alpha.id, companyId: unscored.companyId, auditId: unscored.auditId, type: "performance_optimization",
      title: "Unscored", summary: "Unscored", businessImpact: "x", recommendedSolution: "x", confidence: "high",
    });
    expect((await listOpportunityFeed(owner)).some((row) => row.companyName === "Company unscored")).toBe(false);
    // Three opportunities were generated after mapping; the historical one has no snapshot and never gained one.
    expect(await db.select().from(opportunityServiceRecommendations)).toHaveLength(3);
    await client.close();
  });

  it("aggregates severity, handles missing evidence, and labels every suitability and CRM state", async () => {
    const ctx = await setup();
    const { client, db, alpha, scope, createCompanyAudit, materialize, listOpportunityFeed } = ctx;
    const owner = scope(alpha.id);

    const match = await createCompanyAudit({
      workspaceId: alpha.id, key: "match", industry: "Hospitality", city: "Stellenbosch", email: "hello@match.example",
      findings: [["security", "info", "high"], ["security", "medium", "medium"], ["seo", "info", "high"]],
    });
    const mismatch = await createCompanyAudit({ workspaceId: alpha.id, key: "mismatch", industry: "Mining", city: "Durban", findings: [["security", "high", "high"], ["security", "low", "low"]] });
    const absent = await createCompanyAudit({ workspaceId: alpha.id, key: "absent", findings: [["mobile", "low", "high"]] });
    for (const audit of [match, mismatch, absent]) await materialize(alpha.id, audit.auditId);

    // An opportunity with no linked evidence at all.
    await db.insert(opportunities).values({
      workspaceId: alpha.id, companyId: absent.companyId, auditId: absent.auditId, type: "website_improvement",
      title: "No evidence", summary: "No evidence", businessImpact: "x", recommendedSolution: "x", confidence: "low",
    });

    // Lead linked to the match company's security opportunity; its other opportunity sees a company lead.
    const matchOpportunities = await db.select({ id: opportunities.id, type: opportunities.type }).from(opportunities).where(eq(opportunities.companyId, match.companyId));
    const matchSecurity = one(matchOpportunities.filter((row) => row.type === "security_hardening"));
    await db.insert(leads).values({ workspaceId: alpha.id, companyId: match.companyId, sourceOpportunityId: matchSecurity.id, title: "Lead", status: "qualified" });

    const rows = await listOpportunityFeed(owner);
    // Severity aggregation: highest across linked findings, independent of confidence.
    expect(byCompany(rows, "match", "security_hardening")).toMatchObject({ highestSeverity: "medium", evidenceCount: 2 });
    expect(byCompany(rows, "match", "seo_improvement")).toMatchObject({ highestSeverity: "info", evidenceCount: 1 });
    expect(byCompany(rows, "mismatch", "security_hardening")).toMatchObject({ highestSeverity: "high", evidenceCount: 2, confidence: "low" });
    expect(byCompany(rows, "absent", "website_improvement")).toMatchObject({ highestSeverity: null, evidenceCount: 0 });

    // Suitability: verified match, verified mismatch, and missing data are distinct.
    const states = (key: string, type: string) => Object.fromEntries(byCompany(rows, key, type).suitability.checks.map((check) => [check.key, check.assessment]));
    expect(states("match", "security_hardening")).toEqual({ industry: "positive", city: "positive", contact: "positive" });
    expect(states("mismatch", "security_hardening")).toEqual({ industry: "negative", city: "negative", contact: "missing" });
    expect(states("absent", "mobile_experience")).toEqual({ industry: "missing", city: "missing", contact: "missing" });

    // CRM status from existing leads only.
    expect(byCompany(rows, "match", "security_hardening").crm).toMatchObject({ kind: "linked", status: "qualified", label: "Lead qualified" });
    expect(byCompany(rows, "match", "seo_improvement").crm).toMatchObject({ kind: "company", status: "qualified" });
    expect(byCompany(rows, "mismatch", "security_hardening").crm).toEqual({ kind: "none", label: "No lead created" });

    // Existing ordering is preserved: lead score, descending.
    const scores = rows.map((row) => row.totalScore);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
    await client.close();
  });

  it("isolates workspaces, ICP data and read access", async () => {
    const ctx = await setup();
    const { client, alpha, beta, scope, createCompanyAudit, materialize, listOpportunityFeed } = ctx;
    const alphaAudit = await createCompanyAudit({ workspaceId: alpha.id, key: "alphaco", industry: "Hospitality", city: "Stellenbosch", findings: [["security", "high", "high"]] });
    // Beta has no ICP, so even an identical industry and city must read as missing data, not a match.
    const betaAudit = await createCompanyAudit({ workspaceId: beta.id, key: "betaco", industry: "Hospitality", city: "Stellenbosch", findings: [["security", "medium", "high"]] });
    await materialize(alpha.id, alphaAudit.auditId);
    await materialize(beta.id, betaAudit.auditId);

    const alphaRows = await listOpportunityFeed(scope(alpha.id));
    const betaRows = await listOpportunityFeed(scope(beta.id));
    expect(alphaRows.map((row) => row.companyName)).toEqual(["Company alphaco"]);
    expect(betaRows.map((row) => row.companyName)).toEqual(["Company betaco"]);
    expect(Object.fromEntries(alphaRows[0]?.suitability.checks.map((check) => [check.key, check.assessment]) ?? [])).toMatchObject({ industry: "positive", city: "positive" });
    expect(Object.fromEntries(betaRows[0]?.suitability.checks.map((check) => [check.key, check.assessment]) ?? [])).toMatchObject({ industry: "missing", city: "missing" });
    // Read-only roles see the same feed; the query has no role-specific behaviour or write path.
    expect((await listOpportunityFeed(scope(alpha.id, "viewer"))).map((row) => row.opportunityId)).toEqual(alphaRows.map((row) => row.opportunityId));
    await client.close();
  });
});

describe("recommendation presentation safeguard", () => {
  it("only an explicitly preferred snapshot service is ever presented as recommended", async () => {
    const ctx = await setup();
    const { client, db, alpha, scope, mappings, createCompanyAudit, materialize, listOpportunityFeed } = ctx;
    const { getCompanyOpportunityIntelligence } = await import("./queries");
    const owner = scope(alpha.id);
    const redesign = one(await db.insert(services).values({ workspaceId: alpha.id, name: "Alpha Redesign Service", slug: "alpha-redesign" }).returning({ id: services.id }));
    const maintenance = one(await db.insert(services).values({ workspaceId: alpha.id, name: "Beta Maintenance Service", slug: "beta-maintenance" }).returning({ id: services.id }));
    const extra = one(await db.insert(services).values({ workspaceId: alpha.id, name: "Gamma Extra Service", slug: "gamma-extra" }).returning({ id: services.id }));

    // Multiple mappings with one preferred (accessibility); non-preferred mappings only (security).
    for (const serviceId of [redesign.id, maintenance.id, extra.id]) await mappings.addServiceMapping(owner, { opportunityType: "accessibility_remediation", serviceId });
    await mappings.setPreferredService(owner, { opportunityType: "accessibility_remediation", serviceId: redesign.id });
    for (const serviceId of [maintenance.id, extra.id]) await mappings.addServiceMapping(owner, { opportunityType: "security_hardening", serviceId });

    const multi = await createCompanyAudit({ workspaceId: alpha.id, key: "multi", findings: [["accessibility", "low", "high"]] });
    const only = await createCompanyAudit({ workspaceId: alpha.id, key: "only", findings: [["security", "low", "high"]] });
    await materialize(alpha.id, multi.auditId);
    await materialize(alpha.id, only.auditId);

    const rows = await listOpportunityFeed(owner);
    expect(byCompany(rows, "multi").recommendation).toEqual({ kind: "preferred", serviceLabel: "Alpha Redesign Service", note: null, priceLabel: "Price not configured" });
    expect(byCompany(rows, "only").recommendation).toEqual({ kind: "no_preferred", serviceLabel: "No service recommendation confirmed", note: null, priceLabel: "No price shown" });
    // Neither surface can carry a non-preferred service name.
    expect(JSON.stringify(rows)).not.toMatch(/Beta Maintenance Service|Gamma Extra Service/);
    for (const company of [multi, only]) {
      const report = await getCompanyOpportunityIntelligence(owner, company.companyId);
      const presented = JSON.stringify(report?.opportunities.map((entry) => entry.recommendation));
      expect(presented).not.toMatch(/Beta Maintenance Service|Gamma Extra Service/);
    }
    const onlyReport = await getCompanyOpportunityIntelligence(owner, only.companyId);
    expect(JSON.stringify(onlyReport?.opportunities.map((entry) => entry.recommendation))).not.toMatch(/Alpha Redesign Service/);

    // The stored snapshot keeps the complete history, including non-preferred services.
    const stored = await db.select().from(opportunityServiceRecommendations);
    expect(stored.map((row) => row.serviceName).sort()).toEqual(["Alpha Redesign Service", "Beta Maintenance Service", "Beta Maintenance Service", "Gamma Extra Service", "Gamma Extra Service"]);

    // Clearing the preferred flag keeps every mapping record and leaves generated snapshots untouched.
    const mappingsBefore = await db.select().from(opportunityServiceMappings);
    await mappings.setPreferredService(owner, { opportunityType: "accessibility_remediation", serviceId: null });
    const mappingsAfter = await db.select().from(opportunityServiceMappings);
    expect(mappingsAfter).toHaveLength(mappingsBefore.length);
    expect(mappingsAfter.filter((row) => row.opportunityType === "accessibility_remediation").every((row) => !row.isPreferred)).toBe(true);
    expect(await db.select().from(opportunityServiceRecommendations)).toEqual(stored);
    expect(byCompany(await listOpportunityFeed(owner), "multi").recommendation.serviceLabel).toBe("Alpha Redesign Service");

    // A new analysis after clearing confirms nothing and names no service.
    const later = await createCompanyAudit({ workspaceId: alpha.id, key: "later", findings: [["accessibility", "low", "high"]] });
    await materialize(alpha.id, later.auditId);
    const laterRow = byCompany(await listOpportunityFeed(owner), "later");
    expect(laterRow.recommendation).toEqual({ kind: "no_preferred", serviceLabel: "No service recommendation confirmed", note: null, priceLabel: "No price shown" });
    expect(JSON.stringify(laterRow)).not.toMatch(/Alpha Redesign Service|Beta Maintenance Service|Gamma Extra Service/);
    await client.close();
  });
});
