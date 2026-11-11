// @vitest-environment node

import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { describe, expect, it, vi } from "vitest";
import { createWorkspaceScope } from "@/modules/workspaces/scope";
import {
  auditLogs,
  companies,
  crmActivities,
  crmTasks,
  deals,
  discoveryRuns,
  leads,
  opportunities,
  proposals,
  users,
  websiteAudits,
  websites,
  workspaceMembers,
  workspaces,
} from "@/server/db/schema";

describe("client acquisition dashboard queries", () => {
  it("aggregates the selected workspace, range and statuses without leaking tenant data", async () => {
    const client = new PGlite();
    const db = drizzle(client);
    await migrate(db, { migrationsFolder: "drizzle" });
    try {
      const [user] = await db.insert(users).values({ email: "owner@dashboard.example", name: "Dashboard Owner" }).returning({ id: users.id });
      const [alpha, beta] = await db.insert(workspaces).values([
        { name: "Alpha", slug: "dashboard-alpha" },
        { name: "Beta", slug: "dashboard-beta", currency: "USD" },
      ]).returning({ id: workspaces.id });
      if (!user || !alpha || !beta) throw new Error("Dashboard fixtures were not created");
      await db.insert(workspaceMembers).values([
        { workspaceId: alpha.id, userId: user.id, role: "owner", status: "active", joinedAt: new Date("2026-01-01T00:00:00Z") },
        { workspaceId: beta.id, userId: user.id, role: "owner", status: "active", joinedAt: new Date("2026-01-01T00:00:00Z") },
      ]);

      const alphaCompanies = await db.insert(companies).values([
        { workspaceId: alpha.id, name: "Recent Alpha", dedupeKey: "recent-alpha", website: "https://alpha.example", createdAt: new Date("2026-03-25T00:00:00Z") },
        { workspaceId: alpha.id, name: "Historic Alpha", dedupeKey: "historic-alpha", createdAt: new Date("2025-01-01T00:00:00Z") },
      ]).returning({ id: companies.id });
      const [betaCompany] = await db.insert(companies).values({ workspaceId: beta.id, name: "Private Beta", dedupeKey: "private-beta", createdAt: new Date("2026-03-28T00:00:00Z") }).returning({ id: companies.id });
      if (!alphaCompanies[0] || !alphaCompanies[1] || !betaCompany) throw new Error("Company fixtures were not created");

      const [alphaWebsite, betaWebsite] = await Promise.all([
        db.insert(websites).values({ workspaceId: alpha.id, companyId: alphaCompanies[0].id, url: "https://alpha.example", normalizedOrigin: "https://alpha.example" }).returning({ id: websites.id }),
        db.insert(websites).values({ workspaceId: beta.id, companyId: betaCompany.id, url: "https://beta.example", normalizedOrigin: "https://beta.example" }).returning({ id: websites.id }),
      ]);
      const [alphaAudit] = await db.insert(websiteAudits).values({ workspaceId: alpha.id, websiteId: alphaWebsite[0]!.id, requestedByUserId: user.id, status: "completed", authorizationBasis: "fixture", completedAt: new Date("2026-03-26T00:00:00Z") }).returning({ id: websiteAudits.id });
      const [betaAudit] = await db.insert(websiteAudits).values({ workspaceId: beta.id, websiteId: betaWebsite[0]!.id, requestedByUserId: user.id, status: "completed", authorizationBasis: "fixture", completedAt: new Date("2026-03-29T00:00:00Z") }).returning({ id: websiteAudits.id });
      if (!alphaAudit || !betaAudit) throw new Error("Audit fixtures were not created");

      const [alphaOpportunity] = await db.insert(opportunities).values({ workspaceId: alpha.id, companyId: alphaCompanies[0].id, auditId: alphaAudit.id, type: "website_improvement", title: "Improve Alpha", summary: "Evidence summary", businessImpact: "Lost conversions", recommendedSolution: "Repair the experience", createdAt: new Date("2026-03-27T00:00:00Z") }).returning({ id: opportunities.id });
      await db.insert(opportunities).values({ workspaceId: beta.id, companyId: betaCompany.id, auditId: betaAudit.id, type: "seo_improvement", title: "Private opportunity", summary: "Private", businessImpact: "Private", recommendedSolution: "Private", createdAt: new Date("2026-03-29T00:00:00Z") });
      if (!alphaOpportunity) throw new Error("Opportunity fixture was not created");

      const [activeLead, archivedLead] = await db.insert(leads).values([
        { workspaceId: alpha.id, companyId: alphaCompanies[0].id, sourceOpportunityId: alphaOpportunity.id, title: "Alpha lead", status: "qualified", createdAt: new Date("2026-03-28T00:00:00Z") },
        { workspaceId: alpha.id, companyId: alphaCompanies[1].id, title: "Archived lead", status: "archived", createdAt: new Date("2026-03-28T00:00:00Z") },
      ]).returning({ id: leads.id });
      const [betaLead] = await db.insert(leads).values({ workspaceId: beta.id, companyId: betaCompany.id, title: "Private lead", status: "qualified", createdAt: new Date("2026-03-29T00:00:00Z") }).returning({ id: leads.id });
      if (!activeLead || !archivedLead || !betaLead) throw new Error("Lead fixtures were not created");
      await db.insert(deals).values([
        { workspaceId: alpha.id, leadId: activeLead.id, stage: "proposal", valueMinor: 250_000, currency: "ZAR", createdAt: new Date("2026-03-28T00:00:00Z") },
        { workspaceId: alpha.id, leadId: archivedLead.id, stage: "identified", valueMinor: 10_000, currency: "USD", createdAt: new Date("2026-03-28T00:00:00Z") },
        { workspaceId: beta.id, leadId: betaLead.id, stage: "proposal", valueMinor: 999_999, currency: "USD", createdAt: new Date("2026-03-29T00:00:00Z") },
      ]);

      const [draftProposal] = await db.insert(proposals).values({ workspaceId: alpha.id, leadId: activeLead.id, requestKey: randomUUID(), title: "Alpha draft", createdByUserId: user.id, createdAt: new Date("2026-03-29T00:00:00Z") }).returning({ id: proposals.id });
      await db.insert(proposals).values({ workspaceId: beta.id, leadId: betaLead.id, requestKey: randomUUID(), title: "Private proposal", createdByUserId: user.id, createdAt: new Date("2026-03-29T00:00:00Z") });
      await db.insert(crmTasks).values({ workspaceId: alpha.id, leadId: activeLead.id, createdByUserId: user.id, title: "Call Alpha", status: "open", dueAt: new Date("2026-03-30T00:00:00Z") });
      await db.insert(crmActivities).values({ workspaceId: alpha.id, leadId: activeLead.id, actorUserId: user.id, type: "lead_created", summary: "Alpha lead created", occurredAt: new Date("2026-03-28T00:00:00Z") });
      await db.insert(discoveryRuns).values({ workspaceId: alpha.id, createdByUserId: user.id, provider: "approved_csv", status: "completed", resultCount: 2, startedAt: new Date("2026-03-25T00:00:00Z"), completedAt: new Date("2026-03-25T00:01:00Z") });
      await db.insert(auditLogs).values({ workspaceId: alpha.id, actorUserId: user.id, action: "proposal_created", targetType: "proposal", targetId: draftProposal!.id, createdAt: new Date("2026-03-29T00:00:00Z") });

      vi.resetModules();
      vi.doMock("@/server/db", () => ({ getDatabase: () => db }));
      const { getClientAcquisitionDashboard, parseDashboardFilters } = await import("./queries");
      const alphaScope = createWorkspaceScope({ workspaceId: alpha.id, userId: user.id, role: "owner" });
      const asOf = new Date("2026-04-01T00:00:00Z");
      const report = await getClientAcquisitionDashboard(alphaScope, parseDashboardFilters({ range: "30d" }), asOf);

      expect(report.metrics).toEqual({ prospects: 1, auditedBusinesses: 1, opportunities: 1, activeLeads: 1, pipeline: [{ currency: "ZAR", count: 1, valueMinor: 250_000, unvaluedCount: 0 }], pendingProposals: 1 });
      expect(report.funnel.map(({ count }) => count)).toEqual([1, 1, 1, 1, 1, 0]);
      expect(report.funnel.map(({ href }) => href)).toEqual([
        "/app/companies",
        "/app/audits",
        "/app/discover/opportunities",
        "/app/leads",
        "/app/proposals",
        "/app/proposals?status=approved",
      ]);
      expect(report.recentActivity.map(({ kind }) => kind).sort()).toEqual(["audit", "crm", "import", "opportunity", "proposal"]);
      expect(report.recentActivity.find(({ kind }) => kind === "crm")?.href).toBe(`/app/leads/${activeLead.id}`);
      expect(report.recentActivity.find(({ kind }) => kind === "opportunity")?.href).toBe("/app/discover/opportunities");
      expect(report.priorities.overdueFollowUps).toHaveLength(1);
      expect(report.priorities.overdueFollowUps[0]?.href).toBe(`/app/leads/${activeLead.id}`);
      expect(report.priorities.unreviewedOpportunities).toHaveLength(0);
      expect(report.priorities.pendingApprovals).toHaveLength(1);
      expect(JSON.stringify(report)).not.toContain("Private");

      const archived = await getClientAcquisitionDashboard(alphaScope, parseDashboardFilters({ range: "30d", leadStatus: "archived" }), asOf);
      expect(archived.metrics.activeLeads).toBe(1);
      expect(archived.metrics.pipeline).toEqual([{ currency: "USD", count: 1, valueMinor: 10_000, unvaluedCount: 0 }]);

      const viewerScope = createWorkspaceScope({ workspaceId: alpha.id, userId: user.id, role: "viewer" });
      const viewer = await getClientAcquisitionDashboard(viewerScope, parseDashboardFilters({ range: "30d" }), asOf);
      expect(viewer.metrics.pipeline).toBeNull();
    } finally {
      await client.close();
    }
  });

  it("returns stable zero and empty states for a workspace with no acquisition records", async () => {
    const client = new PGlite();
    const db = drizzle(client);
    await migrate(db, { migrationsFolder: "drizzle" });
    try {
      const [user] = await db.insert(users).values({ email: "empty@dashboard.example" }).returning({ id: users.id });
      const [workspace] = await db.insert(workspaces).values({ name: "Empty", slug: "dashboard-empty" }).returning({ id: workspaces.id });
      if (!user || !workspace) throw new Error("Empty fixtures were not created");
      await db.insert(workspaceMembers).values({ workspaceId: workspace.id, userId: user.id, role: "owner", status: "active", joinedAt: new Date() });
      vi.resetModules();
      vi.doMock("@/server/db", () => ({ getDatabase: () => db }));
      const { getClientAcquisitionDashboard, parseDashboardFilters } = await import("./queries");
      const scope = createWorkspaceScope({ workspaceId: workspace.id, userId: user.id, role: "owner" });
      const report = await getClientAcquisitionDashboard(scope, parseDashboardFilters({ range: "invalid", leadStatus: "invalid", proposalStatus: "invalid" }), new Date("2026-04-01T00:00:00Z"));
      expect(report.filters).toEqual({ range: "30d", leadStatus: "active", proposalStatus: "all" });
      expect(report.metrics).toEqual({ prospects: 0, auditedBusinesses: 0, opportunities: 0, activeLeads: 0, pipeline: [], pendingProposals: 0 });
      expect(report.recentActivity).toEqual([]);
      expect(report.priorities).toEqual({ overdueFollowUps: [], unreviewedOpportunities: [], pendingApprovals: [] });
    } finally {
      await client.close();
    }
  });
});
