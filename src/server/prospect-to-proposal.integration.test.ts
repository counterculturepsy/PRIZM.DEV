// @vitest-environment node

import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { describe, expect, it, vi } from "vitest";
import { createWorkspaceScope } from "@/modules/workspaces/scope";
import {
  auditFindings,
  auditLogs,
  campaignMessages,
  campaigns,
  companies,
  leads,
  opportunities,
  opportunityEvidence,
  proposalVersions,
  users,
  websiteAudits,
  websites,
  workspaceMembers,
  workspaces,
} from "@/server/db/schema";

function one<T>(rows: readonly T[]): T {
  const [row] = rows;
  if (row === undefined) throw new Error("Fixture row was not created");
  return row;
}

describe("prospect-to-proposal vertical slice", () => {
  it("preserves tenant-owned evidence through a deduplicated lead and privileged proposal approval", async () => {
    const client = new PGlite();
    const db = drizzle(client);
    await migrate(db, { migrationsFolder: "drizzle" });

    const owner = one(await db.insert(users).values({ email: "slice-owner@example.com" }).returning({ id: users.id }));
    const sales = one(await db.insert(users).values({ email: "slice-sales@example.com" }).returning({ id: users.id }));
    const [alpha, beta] = await db.insert(workspaces).values([
      { name: "Slice Alpha", slug: "slice-alpha", currency: "ZAR" },
      { name: "Slice Beta", slug: "slice-beta", currency: "USD" },
    ]).returning({ id: workspaces.id });
    if (!alpha || !beta) throw new Error("Workspace fixtures were not created");
    await db.insert(workspaceMembers).values([
      { workspaceId: alpha.id, userId: owner.id, role: "owner", status: "active" },
      { workspaceId: alpha.id, userId: sales.id, role: "sales", status: "active" },
      { workspaceId: beta.id, userId: owner.id, role: "owner", status: "active" },
    ]);

    const company = one(await db.insert(companies).values({
      workspaceId: alpha.id,
      name: "Evidence Client",
      dedupeKey: "domain:evidence-client.example",
      website: "https://evidence-client.example",
      domain: "evidence-client.example",
      industry: "Professional services",
      city: "Cape Town",
    }).returning({ id: companies.id }));
    const website = one(await db.insert(websites).values({
      workspaceId: alpha.id,
      companyId: company.id,
      url: "https://evidence-client.example/",
      normalizedOrigin: "https://evidence-client.example",
    }).returning({ id: websites.id }));
    const audit = one(await db.insert(websiteAudits).values({
      workspaceId: alpha.id,
      websiteId: website.id,
      requestedByUserId: owner.id,
      authorizationBasis: "isolated integration fixture",
      status: "completed",
      score: 82,
      completedAt: new Date("2026-11-09T08:00:00Z"),
    }).returning({ id: websiteAudits.id }));
    await db.insert(auditFindings).values({
      workspaceId: alpha.id,
      auditId: audit.id,
      category: "accessibility",
      code: "a11y.form_label_missing",
      severity: "medium",
      title: "Form label missing",
      summary: "A form control had no associated label.",
      evidence: "The input had no label association.",
      sourceUrl: "https://evidence-client.example/contact",
      observedAt: new Date("2026-11-09T08:00:00Z"),
      confidence: "high",
      scoreImpact: 12,
    });

    vi.resetModules();
    vi.doMock("@/server/db", () => ({ getDatabase: () => db }));
    const opportunityService = await import("@/server/opportunities/service");
    const crmService = await import("@/server/crm/service");
    const proposalService = await import("@/server/proposals/service");

    const ownerScope = createWorkspaceScope({ workspaceId: alpha.id, userId: owner.id, role: "owner" });
    const salesScope = createWorkspaceScope({ workspaceId: alpha.id, userId: sales.id, role: "sales" });
    const betaScope = createWorkspaceScope({ workspaceId: beta.id, userId: owner.id, role: "owner" });

    await expect(opportunityService.materializeOpportunityIntelligence({
      workspaceId: alpha.id,
      auditId: audit.id,
      actorUserId: owner.id,
    })).resolves.toMatchObject({ opportunityCount: 1 });
    const sourceOpportunity = one(await db.select().from(opportunities).where(eq(opportunities.auditId, audit.id)));
    expect(await db.select().from(opportunityEvidence).where(eq(opportunityEvidence.opportunityId, sourceOpportunity.id))).toHaveLength(1);

    const createdLead = await crmService.createCrmLead(ownerScope, {
      companyId: company.id,
      sourceOpportunityId: sourceOpportunity.id,
      title: "Evidence-backed accessibility opportunity",
    });
    expect(createdLead.created).toBe(true);
    await expect(crmService.createCrmLead(ownerScope, {
      companyId: company.id,
      sourceOpportunityId: sourceOpportunity.id,
      title: "Duplicate attempt",
    })).resolves.toEqual({ leadId: createdLead.leadId, created: false });
    await expect(crmService.createCrmLead(betaScope, {
      companyId: company.id,
      sourceOpportunityId: sourceOpportunity.id,
      title: "Cross-tenant attempt",
    })).rejects.toThrow("active workspace");

    await opportunityService.materializeOpportunityIntelligence({ workspaceId: alpha.id, auditId: audit.id, actorUserId: owner.id });
    expect(one(await db.select().from(leads).where(eq(leads.id, createdLead.leadId)))).toMatchObject({ sourceOpportunityId: sourceOpportunity.id });
    expect(one(await db.select().from(opportunities).where(eq(opportunities.id, sourceOpportunity.id))).id).toBe(sourceOpportunity.id);

    const requestKey = randomUUID();
    const draft = {
      leadId: createdLead.leadId,
      requestKey,
      title: "Accessibility remediation proposal",
      summary: "Scope grounded in the reviewed audit evidence.",
      scope: "Confirm and remediate the cited accessibility barrier.",
      deliverables: "Remediation, regression checks, and an evidence summary.",
      assumptions: "Access to the current website source is supplied.",
      exclusions: "No unrelated redesign or outbound communication.",
      timeline: "Two weeks after access is supplied.",
      discountMinor: 0,
      items: [{ description: "Accessibility remediation", quantity: 1, unitAmountMinor: 25_000 }],
    };
    const proposalId = await proposalService.createProposal(salesScope, draft);
    expect(await proposalService.createProposal(salesScope, draft)).toBe(proposalId);
    await expect(proposalService.getProposal(betaScope, proposalId)).resolves.toBeNull();
    await expect(proposalService.approveProposal(betaScope, { proposalId, note: "Cross-tenant review" })).rejects.toThrow("unavailable");
    await expect(proposalService.approveProposal(salesScope, { proposalId, note: "Sales cannot approve" })).rejects.toThrow("role");

    await proposalService.approveProposal(ownerScope, { proposalId, note: "Evidence, scope, and price reviewed" });
    expect(await proposalService.getProposal(ownerScope, proposalId)).toMatchObject({ status: "approved", currentVersion: 1 });
    await proposalService.reviseProposal(salesScope, proposalId, {
      title: "Revised accessibility remediation proposal",
      summary: draft.summary,
      scope: draft.scope,
      deliverables: draft.deliverables,
      assumptions: draft.assumptions,
      exclusions: draft.exclusions,
      timeline: "Three weeks after access is supplied.",
      discountMinor: 0,
      items: [{ description: "Accessibility remediation", quantity: 1, unitAmountMinor: 30_000 }],
    });
    expect(await proposalService.getProposal(ownerScope, proposalId)).toMatchObject({
      status: "draft",
      currentVersion: 2,
      approvedAt: null,
      approvedByUserId: null,
      approvalNote: null,
    });
    await proposalService.approveProposal(ownerScope, { proposalId, note: "Revised version reviewed" });
    expect(await db.select().from(proposalVersions).where(eq(proposalVersions.proposalId, proposalId))).toHaveLength(2);

    expect(await db.select().from(campaigns)).toHaveLength(0);
    expect(await db.select().from(campaignMessages)).toHaveLength(0);
    const actions = (await db.select({ action: auditLogs.action }).from(auditLogs)).map((row) => row.action);
    expect(actions).toEqual(expect.arrayContaining([
      "opportunity_intelligence.materialized",
      "crm.lead_created",
      "proposal.created",
      "proposal.approved",
      "proposal.revised",
    ]));
    await client.close();
  });
});
