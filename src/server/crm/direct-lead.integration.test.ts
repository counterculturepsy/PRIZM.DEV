// @vitest-environment node

import { PGlite } from "@electric-sql/pglite";
import { count, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { describe, expect, it, vi } from "vitest";
import { createWorkspaceScope } from "@/modules/workspaces/scope";
import { companies, deals, leads, users, workspaceMembers, workspaces } from "@/server/db/schema";

describe("direct lead from a company (no audit, no opportunity)", () => {
  it("creates one lead per company, shows it in CRM reads, and stays tenant isolated", async () => {
    const client = new PGlite();
    const db = drizzle(client);
    await migrate(db, { migrationsFolder: "drizzle" });
    const [user] = await db.insert(users).values({ email: "direct@example.com", name: "Direct User" }).returning({ id: users.id });
    const [alpha, beta] = await db.insert(workspaces).values([
      { name: "Alpha", slug: "direct-alpha", currency: "ZAR" },
      { name: "Beta", slug: "direct-beta", currency: "ZAR" },
    ]).returning({ id: workspaces.id });
    if (!user || !alpha || !beta) throw new Error("Fixtures were not created");
    await db.insert(workspaceMembers).values([
      { workspaceId: alpha.id, userId: user.id, role: "sales", status: "active", joinedAt: new Date() },
      { workspaceId: beta.id, userId: user.id, role: "sales", status: "active", joinedAt: new Date() },
    ]);
    const [company] = await db.insert(companies).values({
      workspaceId: alpha.id, name: "Direct Studio", dedupeKey: "domain:direct-studio.example", industry: "Creative", city: "Cape Town",
    }).returning({ id: companies.id });
    if (!company) throw new Error("Company fixture was not created");

    vi.resetModules();
    vi.doMock("@/server/db", () => ({ getDatabase: () => db }));
    const service = await import("./service");
    const queries = await import("./queries");
    const alphaScope = createWorkspaceScope({ workspaceId: alpha.id, userId: user.id, role: "sales" });
    const betaScope = createWorkspaceScope({ workspaceId: beta.id, userId: user.id, role: "sales" });

    expect(await queries.getLeadIdForCompany(alphaScope, company.id)).toBeNull();
    expect((await queries.listLeadCandidates(alphaScope)).map((row) => row.id)).toContain(company.id);

    // Same call shape the company-profile form sends: no source opportunity.
    const first = await service.createCrmLead(alphaScope, { companyId: company.id, sourceOpportunityId: undefined, title: "Direct Studio" });
    expect(first.created).toBe(true);
    const again = await service.createCrmLead(alphaScope, { companyId: company.id, title: "Direct Studio" });
    expect(again).toEqual({ leadId: first.leadId, created: false });

    const [leadCount] = await db.select({ n: count() }).from(leads).where(eq(leads.companyId, company.id));
    const [dealCount] = await db.select({ n: count() }).from(deals).where(eq(deals.leadId, first.leadId));
    expect(leadCount?.n).toBe(1);
    expect(dealCount?.n).toBe(1);

    expect(await queries.getLeadIdForCompany(alphaScope, company.id)).toBe(first.leadId);
    expect(await queries.getLeadIdForCompany(betaScope, company.id)).toBeNull();
    await expect(service.createCrmLead(betaScope, { companyId: company.id, title: "Cross tenant" })).rejects.toBeInstanceOf(service.CrmMutationError);

    const detail = await queries.getCrmLead(alphaScope, first.leadId);
    expect(detail).toMatchObject({ title: "Direct Studio", companyName: "Direct Studio", stage: "identified", sourceOpportunityId: null, sourceAuditId: null });
    expect(await queries.getCrmLead(betaScope, first.leadId)).toBeNull();
    expect((await queries.listCrmLeads(alphaScope)).map((row) => row.id)).toEqual([first.leadId]);
    expect(await queries.listCrmLeads(betaScope)).toEqual([]);
    expect((await queries.listLeadCandidates(alphaScope)).map((row) => row.id)).not.toContain(company.id);

    // The lead is fully editable without an audit.
    await expect(service.changeDealStage(alphaScope, { leadId: first.leadId, stage: "contacted" })).resolves.toEqual({ changed: true });
  });
});
