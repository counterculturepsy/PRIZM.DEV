// @vitest-environment node
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { createWorkspaceScope } from "@/modules/workspaces/scope";
import {
  auditFindings, auditLogs, companies, leads, opportunities, opportunityEvidence,
  opportunityServiceRecommendations, proposals, proposalVersions, users, websiteAudits,
  websites, workspaceMembers, workspaces,
} from "@/server/db/schema";

async function fixture() {
  const client = new PGlite(); const db = drizzle(client); await migrate(db, { migrationsFolder: "drizzle" });
  const [user] = await db.insert(users).values({ email: "proposal@example.com", name: "Proposal Owner" }).returning();
  const [alpha, beta] = await db.insert(workspaces).values([{ name: "Alpha", slug: "proposal-alpha", currency: "ZAR" }, { name: "Beta", slug: "proposal-beta", currency: "USD" }]).returning();
  if (!user || !alpha || !beta) throw new Error("fixtures");
  await db.insert(workspaceMembers).values([{ workspaceId: alpha.id, userId: user.id, role: "owner", status: "active", joinedAt: new Date() }, { workspaceId: beta.id, userId: user.id, role: "owner", status: "active", joinedAt: new Date() }]);
  const [company] = await db.insert(companies).values({ workspaceId: alpha.id, name: "Client", dedupeKey: "proposal-client" }).returning();
  const [website] = await db.insert(websites).values({ workspaceId: alpha.id, companyId: company!.id, url: "https://client.example", normalizedOrigin: "https://client.example" }).returning();
  const observedAt = new Date("2026-11-09T10:00:00Z");
  const [audit] = await db.insert(websiteAudits).values({ workspaceId: alpha.id, websiteId: website!.id, requestedByUserId: user.id, authorizationBasis: "test fixture", status: "completed", score: 58, completedAt: observedAt }).returning();
  const [finding] = await db.insert(auditFindings).values({ workspaceId: alpha.id, auditId: audit!.id, category: "accessibility", code: "missing-label", severity: "high", title: "Form label missing", summary: "A public form control has no accessible label.", evidence: "The newsletter input has no associated label.", sourceUrl: "https://client.example/contact", confidence: "high", scoreImpact: 12, observedAt }).returning();
  const [opportunity] = await db.insert(opportunities).values({ workspaceId: alpha.id, companyId: company!.id, auditId: audit!.id, type: "accessibility_remediation", title: "Accessible form remediation", summary: "Observed form controls need accessible labels.", businessImpact: "Customers using assistive technology may be unable to complete the form.", recommendedSolution: "Add programmatic labels and verify keyboard and screen-reader behavior.", estimatedValueMinMinor: 15_000, estimatedValueMaxMinor: 25_000, currency: "ZAR", confidence: "high" }).returning();
  await db.insert(opportunityEvidence).values({ workspaceId: alpha.id, auditId: audit!.id, opportunityId: opportunity!.id, findingId: finding!.id });
  await db.insert(opportunityServiceRecommendations).values({ workspaceId: alpha.id, auditId: audit!.id, opportunityId: opportunity!.id, serviceName: "Accessibility remediation", isPreferred: true, rank: 1, priceStatus: "configured", startingPriceMinor: 15_000, averagePriceMinor: 20_000, currency: "ZAR" });
  const [lead] = await db.insert(leads).values({ workspaceId: alpha.id, companyId: company!.id, sourceOpportunityId: opportunity!.id, title: "Client opportunity" }).returning();
  if (!lead || !opportunity || !finding || !audit) throw new Error("source fixtures");
  return { client, db, user, alpha, beta, lead, opportunity, finding, audit };
}

const input = (leadId: string, requestKey = randomUUID()) => ({ leadId, requestKey, title: "Site proposal", summary: "Review", scope: "Build", deliverables: "Website", assumptions: "Content supplied", exclusions: "Hosting", timeline: "4 weeks", discountMinor: 500, items: [{ description: "Implementation", quantity: 2, unitAmountMinor: 10_000 }] });

describe("proposal service", () => {
  it("preserves evidence and attributed lifecycle history across revisions", async () => {
    const { client, db, user, alpha, beta, lead, opportunity, finding, audit } = await fixture();
    vi.resetModules(); vi.doMock("@/server/db", () => ({ getDatabase: () => db })); const service = await import("./service");
    const owner = createWorkspaceScope({ workspaceId: alpha.id, userId: user.id, role: "owner" });
    const betaOwner = createWorkspaceScope({ workspaceId: beta.id, userId: user.id, role: "owner" });
    const viewer = createWorkspaceScope({ workspaceId: alpha.id, userId: user.id, role: "viewer" });
    const draft = input(lead.id); const id = await service.createProposal(owner, draft);
    expect(await service.createProposal(owner, draft)).toBe(id);
    await expect(service.createProposal(viewer, input(lead.id))).rejects.toThrow("role");
    await expect(service.getProposal(betaOwner, id)).resolves.toBeNull();
    const original = (await service.getProposal(owner, id))!;
    expect(original.current.snapshot.totalMinor).toBe(19_500);
    expect(original.current.snapshot.sourceEvidence).toMatchObject({ opportunity: { id: opportunity.id, auditId: audit.id, title: "Accessible form remediation" }, findings: [{ id: finding.id, evidence: "The newsletter input has no associated label." }], recommendations: [{ serviceName: "Accessibility remediation", startingPriceMinor: 15_000 }] });
    expect(original.current.createdBy).toMatchObject({ id: user.id, name: "Proposal Owner", email: user.email });
    expect(original.history).toEqual([expect.objectContaining({ action: "proposal.created", actor: expect.objectContaining({ id: user.id }), toStatus: "draft", version: 1 })]);
    await service.approveProposal(owner, { proposalId: id, note: "Scope and price reviewed" });
    await db.update(auditFindings).set({ evidence: "Upstream changed." }).where(eq(auditFindings.id, finding.id));
    await db.update(opportunities).set({ title: "Upstream changed" }).where(eq(opportunities.id, opportunity.id));
    await service.reviseProposal(owner, id, { ...draft, title: "Revised proposal", discountMinor: 0, items: [{ description: "Implementation", quantity: 3, unitAmountMinor: 10_000 }] });
    const revised = (await service.getProposal(owner, id))!;
    expect(revised).toMatchObject({ status: "draft", currentVersion: 2 });
    expect(revised.current.snapshot.sourceEvidence).toEqual(original.current.snapshot.sourceEvidence);
    expect(revised.versions[1]!.snapshot.totalMinor).toBe(19_500);
    expect(revised.history).toEqual([
      expect.objectContaining({ action: "proposal.created", toStatus: "draft", version: 1 }),
      expect.objectContaining({ action: "proposal.approved", fromStatus: "draft", toStatus: "approved", version: 1, note: "Scope and price reviewed" }),
      expect.objectContaining({ action: "proposal.revised", fromStatus: "approved", toStatus: "draft", version: 2 }),
    ]);
    await expect(service.approveProposal(viewer, { proposalId: id, note: "No" })).rejects.toThrow("role");
    await service.approveProposal(owner, { proposalId: id, note: "Revised scope reviewed" });
    expect(await db.select().from(proposalVersions)).toHaveLength(2);
    expect(await db.select().from(auditLogs).where(eq(auditLogs.targetId, id))).toHaveLength(4);
    expect(await db.select().from(proposals)).toHaveLength(1);
    await client.close();
  });

  it("revalidates active workspace membership for reads and mutations", async () => {
    const { client, db, user, alpha, lead } = await fixture();
    vi.resetModules(); vi.doMock("@/server/db", () => ({ getDatabase: () => db })); const service = await import("./service");
    const owner = createWorkspaceScope({ workspaceId: alpha.id, userId: user.id, role: "owner" });
    const staleAdmin = createWorkspaceScope({ workspaceId: alpha.id, userId: user.id, role: "admin" });
    const id = await service.createProposal(owner, input(lead.id));
    await expect(service.listProposals(staleAdmin)).rejects.toThrow("membership changed");
    await db.update(workspaceMembers).set({ status: "suspended" }).where(eq(workspaceMembers.userId, user.id));
    await expect(service.listProposals(owner)).rejects.toThrow("membership changed");
    await expect(service.getProposal(owner, id)).rejects.toThrow("membership changed");
    await expect(service.createProposal(owner, input(lead.id))).rejects.toThrow("membership changed");
    await expect(service.reviseProposal(owner, id, input(lead.id))).rejects.toThrow("membership changed");
    await expect(service.approveProposal(owner, { proposalId: id, note: "No" })).rejects.toThrow("membership changed");
    await db.update(workspaceMembers).set({ status: "active" }).where(eq(workspaceMembers.userId, user.id));
    await db.update(workspaces).set({ status: "suspended" }).where(eq(workspaces.id, alpha.id));
    await expect(service.getProposal(owner, id)).rejects.toThrow("membership changed");
    await client.close();
  });
});
