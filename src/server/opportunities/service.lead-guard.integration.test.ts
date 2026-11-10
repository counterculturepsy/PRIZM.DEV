// @vitest-environment node

import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { describe, expect, it, vi } from "vitest";
import {
  auditFindings, auditLogs, companies, leadScores, leads, opportunities, opportunityEvidence,
  opportunityServiceMappings, opportunityServiceRecommendations, services, users, websiteAudits, websites, workspaces,
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
  const user = one(await db.insert(users).values({ email: "guard@example.com" }).returning({ id: users.id }));
  const workspace = one(await db.insert(workspaces).values({ name: "Guard", slug: "guard", currency: "ZAR" }).returning({ id: workspaces.id }));
  const service = one(await db.insert(services).values({
    workspaceId: workspace.id,
    name: "Security review",
    slug: "security-review",
    startingPriceMinor: 10_000,
    averagePriceMinor: 15_000,
  }).returning({ id: services.id }));
  await db.insert(opportunityServiceMappings).values({
    workspaceId: workspace.id,
    opportunityType: "security_hardening",
    serviceId: service.id,
    isPreferred: true,
  });
  vi.resetModules();
  vi.doMock("@/server/db", () => ({ getDatabase: () => db }));
  const { materializeOpportunityIntelligence, LeadLinkedOpportunitiesError, OpportunityMaterializationError } = await import("./service");

  async function audit(input: { key: string; at: string; findings: Array<[typeof auditFindings.$inferInsert["category"], string]>; companyId?: string; websiteId?: string }) {
    const companyId = input.companyId ?? one(await db.insert(companies).values({
      workspaceId: workspace.id, name: `Company ${input.key}`, dedupeKey: `domain:${input.key}.example`, website: `https://${input.key}.example`, domain: `${input.key}.example`,
    }).returning({ id: companies.id })).id;
    const websiteId = input.websiteId ?? one(await db.insert(websites).values({
      workspaceId: workspace.id, companyId, url: `https://${input.key}.example/`, normalizedOrigin: `https://${input.key}.example`,
    }).returning({ id: websites.id })).id;
    const auditId = one(await db.insert(websiteAudits).values({
      workspaceId: workspace.id, websiteId, requestedByUserId: user.id, status: "completed", authorizationBasis: "synthetic", score: 80, completedAt: new Date(`${input.at}T08:00:00Z`),
    }).returning({ id: websiteAudits.id })).id;
    await db.insert(auditFindings).values(input.findings.map(([category, code]) => ({
      workspaceId: workspace.id, auditId, category, code, severity: "low" as const, title: code, summary: "Synthetic.", evidence: "Synthetic", sourceUrl: "https://x.example/", confidence: "high" as const, scoreImpact: 3, observedAt: new Date(),
    })));
    return { companyId, websiteId, auditId };
  }
  const materialize = (auditId: string) => materializeOpportunityIntelligence({ workspaceId: workspace.id, auditId });
  // Every table the materializer or a lead touches, in a stable order, for before/after comparison.
  const dump = async () => JSON.stringify({
    leads: await db.select().from(leads),
    opportunities: (await db.select().from(opportunities)).sort((a, b) => a.id.localeCompare(b.id)),
    evidence: (await db.select().from(opportunityEvidence)).sort((a, b) => `${a.opportunityId}${a.findingId}`.localeCompare(`${b.opportunityId}${b.findingId}`)),
    scores: (await db.select().from(leadScores)).sort((a, b) => a.id.localeCompare(b.id)),
    recommendations: (await db.select().from(opportunityServiceRecommendations)).sort((a, b) => a.id.localeCompare(b.id)),
    logs: (await db.select({ action: auditLogs.action }).from(auditLogs)).map((row) => row.action).sort(),
  });
  return { client, db, service, workspace, audit, materialize, dump, LeadLinkedOpportunitiesError, OpportunityMaterializationError };
}

describe("lead-linked opportunity re-materialization", () => {
  it("allows an identical rerun while preserving a linked opportunity and its child snapshots", async () => {
    const { client, db, workspace, audit, materialize } = await setup();
    const a = await audit({ key: "linked", at: "2026-10-27", findings: [["security", "security.csp_missing"], ["seo", "seo.canonical_missing"]] });
    await materialize(a.auditId);
    const generated = await db.select().from(opportunities).where(eq(opportunities.auditId, a.auditId));
    const security = one(generated.filter((row) => row.type === "security_hardening"));
    await db.insert(leads).values({ workspaceId: workspace.id, companyId: a.companyId, sourceOpportunityId: security.id, title: "Linked lead", status: "qualified" });
    const beforeOpportunity = one(await db.select().from(opportunities).where(eq(opportunities.id, security.id)));
    const beforeEvidence = await db.select().from(opportunityEvidence).where(eq(opportunityEvidence.opportunityId, security.id));
    const beforeRecommendations = await db.select().from(opportunityServiceRecommendations).where(eq(opportunityServiceRecommendations.opportunityId, security.id));

    await expect(materialize(a.auditId)).resolves.toMatchObject({ opportunityCount: 2 });

    expect(one(await db.select().from(leads)).sourceOpportunityId).toBe(security.id);
    expect(one(await db.select().from(opportunities).where(eq(opportunities.id, security.id)))).toEqual(beforeOpportunity);
    expect(await db.select().from(opportunityEvidence).where(eq(opportunityEvidence.opportunityId, security.id))).toEqual(beforeEvidence);
    expect(await db.select().from(opportunityServiceRecommendations).where(eq(opportunityServiceRecommendations.opportunityId, security.id))).toEqual(beforeRecommendations);
    await client.close();
  });

  it("rejects a material evidence or recommendation change for a linked opportunity before writing", async () => {
    const { client, db, service, workspace, audit, materialize, dump, LeadLinkedOpportunitiesError } = await setup();
    const a = await audit({ key: "changed", at: "2026-10-27", findings: [["security", "security.csp_missing"], ["seo", "seo.canonical_missing"]] });
    await materialize(a.auditId);
    const security = one((await db.select().from(opportunities).where(eq(opportunities.auditId, a.auditId))).filter((row) => row.type === "security_hardening"));
    await db.insert(leads).values({ workspaceId: workspace.id, companyId: a.companyId, sourceOpportunityId: security.id, title: "Linked lead", status: "qualified" });
    await db.insert(auditFindings).values({
      workspaceId: workspace.id,
      auditId: a.auditId,
      category: "security",
      code: "security.hsts_missing",
      severity: "medium",
      title: "HSTS missing",
      summary: "Synthetic.",
      evidence: "Synthetic",
      sourceUrl: "https://x.example/",
      confidence: "medium",
      scoreImpact: 5,
      observedAt: new Date(),
    });
    await db.update(services).set({ name: "Updated security review", startingPriceMinor: 20_000, averagePriceMinor: 30_000 }).where(eq(services.id, service.id));
    const before = await dump();

    await expect(materialize(a.auditId)).rejects.toBeInstanceOf(LeadLinkedOpportunitiesError);
    expect(await dump()).toBe(before);
    await client.close();
  });

  it("refreshes material evidence and recommendation snapshots while the opportunity is unlinked", async () => {
    const { client, db, service, audit, materialize } = await setup();
    const a = await audit({ key: "unlinked-refresh", at: "2026-10-27", findings: [["security", "security.csp_missing"]] });
    await materialize(a.auditId);
    const security = one(await db.select().from(opportunities).where(eq(opportunities.auditId, a.auditId)));
    await db.insert(auditFindings).values({
      workspaceId: security.workspaceId,
      auditId: a.auditId,
      category: "security",
      code: "security.hsts_missing",
      severity: "medium",
      title: "HSTS missing",
      summary: "Synthetic.",
      evidence: "Synthetic",
      sourceUrl: "https://x.example/",
      confidence: "medium",
      scoreImpact: 5,
      observedAt: new Date(),
    });
    await db.update(services).set({ name: "Updated security review", startingPriceMinor: 20_000, averagePriceMinor: 30_000 }).where(eq(services.id, service.id));

    await expect(materialize(a.auditId)).resolves.toMatchObject({ opportunityCount: 1 });
    expect(one(await db.select().from(opportunities).where(eq(opportunities.id, security.id)))).toMatchObject({ id: security.id, summary: "2 observed audit findings support this opportunity." });
    expect(await db.select().from(opportunityEvidence).where(eq(opportunityEvidence.opportunityId, security.id))).toHaveLength(2);
    expect(await db.select().from(opportunityServiceRecommendations).where(eq(opportunityServiceRecommendations.opportunityId, security.id))).toEqual([
      expect.objectContaining({
        opportunityId: security.id,
        serviceId: service.id,
        serviceName: "Updated security review",
        isPreferred: true,
        rank: 1,
        startingPriceMinor: 20_000,
        averagePriceMinor: 30_000,
      }),
    ]);
    await client.close();
  });

  it("keeps normal materialization working for new audits, unlinked leads, and audits superseded by a newer one", async () => {
    const { client, db, workspace, audit, materialize } = await setup();

    // A first-time audit materializes normally.
    const fresh = await audit({ key: "fresh", at: "2026-10-27", findings: [["security", "security.csp_missing"]] });
    await expect(materialize(fresh.auditId)).resolves.toMatchObject({ opportunityCount: 1 });

    // A lead that is not linked to an opportunity does not block reprocessing.
    await db.insert(leads).values({ workspaceId: workspace.id, companyId: fresh.companyId, title: "Unlinked lead", status: "new" });
    await expect(materialize(fresh.auditId)).resolves.toMatchObject({ opportunityCount: 1 });

    // A lead linked to an OLDER audit does not block materializing a NEWER audit; the older opportunity is kept.
    const older = await audit({ key: "history", at: "2026-10-01", findings: [["security", "security.csp_missing"]] });
    await materialize(older.auditId);
    const olderOpportunity = one(await db.select().from(opportunities).where(eq(opportunities.auditId, older.auditId)));
    await db.insert(leads).values({ workspaceId: workspace.id, companyId: older.companyId, sourceOpportunityId: olderOpportunity.id, title: "Lead from older audit", status: "new" });
    const newer = await audit({ key: "history", at: "2026-10-20", findings: [["security", "security.csp_missing"]], companyId: older.companyId, websiteId: older.websiteId });
    await expect(materialize(newer.auditId)).resolves.toMatchObject({ opportunityCount: 1 });
    expect((await db.select().from(opportunities).where(eq(opportunities.id, olderOpportunity.id))).length).toBe(1);
    await client.close();
  });

  it("still refuses to remove an opportunity that a lead references", async () => {
    const { client, db, workspace, audit, materialize, dump, LeadLinkedOpportunitiesError } = await setup();
    const a = await audit({ key: "removed", at: "2026-10-27", findings: [["security", "security.csp_missing"], ["seo", "seo.canonical_missing"]] });
    await materialize(a.auditId);
    const security = one((await db.select().from(opportunities).where(eq(opportunities.auditId, a.auditId))).filter((row) => row.type === "security_hardening"));
    await db.insert(leads).values({ workspaceId: workspace.id, companyId: a.companyId, sourceOpportunityId: security.id, title: "Linked lead" });
    await db.delete(auditFindings).where(eq(auditFindings.category, "security"));
    const before = await dump();

    await expect(materialize(a.auditId)).rejects.toBeInstanceOf(LeadLinkedOpportunitiesError);
    expect(await dump()).toBe(before);
    await client.close();
  });
});
