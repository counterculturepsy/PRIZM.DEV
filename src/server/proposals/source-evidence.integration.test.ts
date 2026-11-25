// @vitest-environment node
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterEach, describe, expect, it, vi } from "vitest";
import { classifySourceEvidence } from "@/modules/proposals/source-evidence";
import { createWorkspaceScope } from "@/modules/workspaces/scope";
import { companies, leads, opportunities, proposalVersions, users, websiteAudits, websites, workspaceMembers, workspaces } from "@/server/db/schema";

const input = (leadId: string) => ({ leadId, requestKey: randomUUID(), title: "Site proposal", summary: "Review", scope: "Build", deliverables: "Website", assumptions: "Content supplied", exclusions: "Hosting", timeline: "4 weeks", discountMinor: 0, items: [{ description: "Implementation", quantity: 1, unitAmountMinor: 10_000 }] });

describe("proposal source-evidence states", () => {
  afterEach(() => {
    vi.doUnmock("@/server/db");
    vi.resetModules();
  });

  it("derives the state from the saved version and the lead as it is now, never from an assumed age", async () => {
    const client = new PGlite();
    const db = drizzle(client);
    await migrate(db, { migrationsFolder: "drizzle" });
    const [user] = await db.insert(users).values({ email: "evidence@example.test", name: "Evidence Owner" }).returning();
    const [workspace] = await db.insert(workspaces).values({ name: "Evidence", slug: "evidence-states", currency: "ZAR" }).returning();
    if (!user || !workspace) throw new Error("fixtures");
    await db.insert(workspaceMembers).values({ workspaceId: workspace.id, userId: user.id, role: "owner", status: "active", joinedAt: new Date() });
    const [company] = await db.insert(companies).values({ workspaceId: workspace.id, name: "Client", dedupeKey: "evidence-client" }).returning();
    const [website] = await db.insert(websites).values({ workspaceId: workspace.id, companyId: company!.id, url: "https://client.example.test", normalizedOrigin: "https://client.example.test" }).returning();
    const [audit] = await db.insert(websiteAudits).values({ workspaceId: workspace.id, websiteId: website!.id, requestedByUserId: user.id, authorizationBasis: "test fixture", status: "completed", score: 60, completedAt: new Date("2026-11-09T10:00:00Z") }).returning();
    const [opportunity] = await db.insert(opportunities).values({ workspaceId: workspace.id, companyId: company!.id, auditId: audit!.id, type: "accessibility_remediation", title: "Accessible forms", summary: "Observed.", businessImpact: "Impact.", recommendedSolution: "Fix labels.", estimatedValueMinMinor: 15_000, estimatedValueMaxMinor: 25_000, currency: "ZAR", confidence: "high" }).returning();
    // One lead per company is enforced, so the manual lead needs its own company.
    const [manualCompany] = await db.insert(companies).values({ workspaceId: workspace.id, name: "Manual Co", dedupeKey: "evidence-manual" }).returning();
    const [manualLead] = await db.insert(leads).values({ workspaceId: workspace.id, companyId: manualCompany!.id, title: "Manual lead" }).returning();
    const [auditedLead] = await db.insert(leads).values({ workspaceId: workspace.id, companyId: company!.id, sourceOpportunityId: opportunity!.id, title: "Audited lead" }).returning();
    if (!manualLead || !auditedLead || !opportunity) throw new Error("leads");

    vi.resetModules();
    vi.doMock("@/server/db", () => ({ getDatabase: () => db }));
    const service = await import("./service");
    const owner = createWorkspaceScope({ workspaceId: workspace.id, userId: user.id, role: "owner" });
    const stateOf = async (proposalId: string) => {
      const proposal = await service.getProposal(owner, proposalId);
      if (!proposal) throw new Error("proposal missing");
      return { proposal, state: classifySourceEvidence({ hasEvidenceSnapshot: Boolean(proposal.current.snapshot.sourceEvidence), lead: proposal.lead }) };
    };

    // A manual lead: no snapshot, and the lead currently has no source. A newly revised version stays in that state.
    const manualId = await service.createProposal(owner, input(manualLead.id));
    const manual = await stateOf(manualId);
    expect(manual.proposal.lead).toEqual({ sourceOpportunityId: null });
    expect(manual.proposal.current.snapshot.sourceEvidence).toBeUndefined();
    expect(manual.state).toBe("lead_without_source");
    await service.reviseProposal(owner, manualId, input(manualLead.id));
    const manualRevised = await stateOf(manualId);
    expect(manualRevised.proposal.current.version).toBe(2);
    expect(manualRevised.proposal.current.snapshot.sourceEvidence).toBeUndefined();
    expect(manualRevised.state).toBe("lead_without_source");

    // An audited lead: the saved snapshot wins, and it keeps showing after the lead's link is removed.
    const auditedId = await service.createProposal(owner, input(auditedLead.id));
    const audited = await stateOf(auditedId);
    expect(audited.proposal.lead).toEqual({ sourceOpportunityId: opportunity.id });
    expect(audited.proposal.current.snapshot.sourceEvidence).toBeDefined();
    expect(audited.state).toBe("available");
    await db.update(leads).set({ sourceOpportunityId: null }).where(eq(leads.id, auditedLead.id));
    const unlinked = await stateOf(auditedId);
    expect(unlinked.proposal.lead).toEqual({ sourceOpportunityId: null });
    expect(unlinked.state).toBe("available");
    await db.update(leads).set({ sourceOpportunityId: opportunity.id }).where(eq(leads.id, auditedLead.id));

    // A saved version without a snapshot, whose lead is linked: only "no snapshot" is claimed.
    const { sourceEvidence: _removed, ...withoutEvidence } = audited.proposal.current.snapshot;
    void _removed;
    await db.update(proposalVersions).set({ snapshot: withoutEvidence }).where(eq(proposalVersions.proposalId, auditedId));
    const stripped = await stateOf(auditedId);
    expect(stripped.proposal.current.snapshot.sourceEvidence).toBeUndefined();
    expect(stripped.state).toBe("no_snapshot");

    // A brand-new revision of that proposal has no snapshot either, so it must not be described as old.
    await service.reviseProposal(owner, auditedId, input(auditedLead.id));
    const revised = await stateOf(auditedId);
    expect(revised.proposal.current.version).toBe(2);
    expect(revised.proposal.current.snapshot.sourceEvidence).toBeUndefined();
    expect(revised.state).toBe("no_snapshot");

    // A missing lead record is reported as an unavailable snapshot, not as "no linked source audit".
    await client.exec("set session_replication_role = replica");
    await db.delete(leads).where(eq(leads.id, manualLead.id));
    await client.exec("set session_replication_role = origin");
    const orphaned = await stateOf(manualId);
    expect(orphaned.proposal.lead).toBeNull();
    expect(orphaned.state).toBe("no_snapshot");
    await client.close();
  });
});
