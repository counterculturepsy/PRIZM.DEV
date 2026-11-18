// @vitest-environment node

import { PGlite } from "@electric-sql/pglite";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { describe, expect, it, vi } from "vitest";
import { createWorkspaceScope } from "@/modules/workspaces/scope";
import {
  auditLogs,
  companies,
  contacts,
  crmActivities,
  crmNotes,
  crmTasks,
  deals,
  leads,
  suppressionEntries,
  users,
  workspaceMembers,
  workspaces,
} from "@/server/db/schema";

describe("CRM service", () => {
  it("keeps lead mutations idempotent, audited, and tenant isolated", async () => {
    const client = new PGlite();
    const db = drizzle(client);
    await migrate(db, { migrationsFolder: "drizzle" });
    const [user] = await db.insert(users).values({ email: "sales@example.com", name: "Sales User" }).returning({ id: users.id });
    const [alpha, beta] = await db.insert(workspaces).values([
      { name: "Alpha", slug: "crm-alpha", currency: "ZAR" },
      { name: "Beta", slug: "crm-beta", currency: "ZAR" },
    ]).returning({ id: workspaces.id });
    if (!user || !alpha || !beta) throw new Error("CRM fixtures were not created");
    await db.insert(workspaceMembers).values([
      { workspaceId: alpha.id, userId: user.id, role: "sales", status: "active", joinedAt: new Date() },
      { workspaceId: beta.id, userId: user.id, role: "sales", status: "active", joinedAt: new Date() },
    ]);
    const [company] = await db.insert(companies).values({
      workspaceId: alpha.id, name: "Alpha Studio", dedupeKey: "domain:alpha-studio.example", industry: "Creative",
    }).returning({ id: companies.id });
    if (!company) throw new Error("Company fixture was not created");

    vi.resetModules();
    vi.doMock("@/server/db", () => ({ getDatabase: () => db }));
    const service = await import("./service");
    const queries = await import("./queries");
    const alphaScope = createWorkspaceScope({ workspaceId: alpha.id, userId: user.id, role: "sales" });
    const betaScope = createWorkspaceScope({ workspaceId: beta.id, userId: user.id, role: "sales" });

    const first = await service.createCrmLead(alphaScope, { companyId: company.id, title: "Brand platform" });
    const second = await service.createCrmLead(alphaScope, { companyId: company.id, title: "Duplicate attempt" });
    expect(first.created).toBe(true);
    expect(second).toEqual({ leadId: first.leadId, created: false });
    await expect(service.createCrmLead(betaScope, { companyId: company.id, title: "Cross tenant" })).rejects.toBeInstanceOf(service.CrmMutationError);

    await expect(service.changeDealStage(alphaScope, { leadId: first.leadId, stage: "discovery" })).resolves.toEqual({ changed: true });
    await expect(service.changeDealStage(alphaScope, { leadId: first.leadId, stage: "discovery" })).resolves.toEqual({ changed: false });
    await expect(service.changeDealStage(alphaScope, { leadId: first.leadId, stage: "lost" })).rejects.toBeInstanceOf(service.CrmMutationError);
    const contact = await service.addCrmContact(alphaScope, {
      leadId: first.leadId,
      firstName: "Ari",
      email: "Ari@Example.com",
      sourceKind: "user_supplied",
      sourceLabel: "Client referral",
      confidence: "medium",
    });
    await service.addCrmNote(alphaScope, { leadId: first.leadId, body: "Confirm scope before drafting anything." });
    const task = await service.addCrmTask(alphaScope, { leadId: first.leadId, title: "Review source evidence", assignedToUserId: user.id });
    await expect(service.completeCrmTask(alphaScope, task.id)).resolves.toEqual({ changed: true });
    await expect(service.completeCrmTask(alphaScope, task.id)).resolves.toEqual({ changed: false });
    await expect(service.suppressCrmContact(alphaScope, { leadId: first.leadId, contactId: contact.id, channel: "email", reason: "Opt-out request" })).resolves.toEqual({ created: true });
    await expect(service.suppressCrmContact(alphaScope, { leadId: first.leadId, contactId: contact.id, channel: "email", reason: "Repeated request" })).resolves.toEqual({ created: false });

    await expect(queries.getCrmLead(alphaScope, first.leadId)).resolves.toMatchObject({
      id: first.leadId,
      stage: "discovery",
      contacts: [{ id: contact.id, normalizedEmail: "ari@example.com", doNotContact: true }],
      notes: [{ body: "Confirm scope before drafting anything." }],
      tasks: [{ id: task.id, status: "completed" }],
    });
    await expect(queries.getCrmLead(betaScope, first.leadId)).resolves.toBeNull();
    await expect(queries.listCrmLeads(betaScope)).resolves.toHaveLength(0);

    expect(await db.select().from(leads)).toHaveLength(1);
    expect(await db.select().from(deals)).toHaveLength(1);
    expect(await db.select().from(contacts)).toHaveLength(1);
    expect(await db.select().from(crmNotes)).toHaveLength(1);
    expect(await db.select().from(crmTasks)).toHaveLength(1);
    expect(await db.select().from(suppressionEntries)).toHaveLength(1);
    expect(await db.select().from(crmActivities)).toHaveLength(7);
    expect(await db.select().from(auditLogs).where(and(eq(auditLogs.workspaceId, alpha.id), eq(auditLogs.targetType, "lead")))).toHaveLength(3);

    await expect(db.insert(leads).values({
      workspaceId: beta.id,
      companyId: company.id,
      ownerUserId: user.id,
      title: "Invalid cross-tenant lead",
    })).rejects.toThrow();
    await client.close();
  });

  it("edits lead details with optimistic concurrency, owner validation, activity and tenant isolation", async () => {
    const client = new PGlite();
    const db = drizzle(client);
    await migrate(db, { migrationsFolder: "drizzle" });
    const [owner, outsider, rep] = await db.insert(users).values([
      { email: "owner@example.com", name: "Owner" }, { email: "outsider@example.com", name: "Outsider" }, { email: "rep@example.com", name: "Rep" },
    ]).returning({ id: users.id });
    const [alpha, beta] = await db.insert(workspaces).values([
      { name: "Alpha", slug: "edit-alpha", currency: "ZAR" }, { name: "Beta", slug: "edit-beta", currency: "ZAR" },
    ]).returning({ id: workspaces.id });
    if (!owner || !outsider || !rep || !alpha || !beta) throw new Error("fixtures were not created");
    await db.insert(workspaceMembers).values([
      { workspaceId: alpha.id, userId: owner.id, role: "sales", status: "active", joinedAt: new Date() },
      { workspaceId: alpha.id, userId: rep.id, role: "sales", status: "active", joinedAt: new Date() },
      { workspaceId: beta.id, userId: outsider.id, role: "sales", status: "active", joinedAt: new Date() },
    ]);
    const [company] = await db.insert(companies).values({ workspaceId: alpha.id, name: "Edit Studio", dedupeKey: "domain:edit-studio.example" }).returning({ id: companies.id });
    if (!company) throw new Error("company fixture was not created");

    vi.resetModules();
    vi.doMock("@/server/db", () => ({ getDatabase: () => db }));
    const service = await import("./service");
    const alphaScope = createWorkspaceScope({ workspaceId: alpha.id, userId: owner.id, role: "sales" });
    const betaScope = createWorkspaceScope({ workspaceId: beta.id, userId: outsider.id, role: "sales" });
    const { leadId } = await service.createCrmLead(alphaScope, { companyId: company.id, title: "Brand platform" });
    const token = async () => (await db.select({ updatedAt: leads.updatedAt }).from(leads).where(eq(leads.id, leadId)))[0]!.updatedAt;
    const base = { leadId, title: "Brand platform", ownerUserId: owner.id as string | null, dealValueMinor: null as number | null, currency: "ZAR", expectedCloseAt: null as Date | null };

    // A save that changes nothing is a no-op: no write, no activity.
    await expect(service.updateLeadDetails(alphaScope, { ...base, expectedUpdatedAt: await token() })).resolves.toEqual({ changed: false });
    expect(await db.select().from(crmActivities).where(and(eq(crmActivities.leadId, leadId), eq(crmActivities.type, "lead_updated")))).toHaveLength(0);

    const first = await token();
    const close = new Date("2026-12-31T00:00:00.000Z");
    const saved = await service.updateLeadDetails(alphaScope, { ...base, expectedUpdatedAt: first, title: "Brand platform phase 1", ownerUserId: rep.id, dealValueMinor: 1_250_000, expectedCloseAt: close });
    expect(saved).toEqual({ changed: true, fields: ["title", "owner", "deal value", "expected close date"] });
    const [deal] = await db.select().from(deals).where(eq(deals.leadId, leadId));
    expect(deal).toMatchObject({ valueMinor: 1_250_000, currency: "ZAR" });
    expect(deal?.expectedCloseAt?.toISOString()).toBe(close.toISOString());
    const [lead] = await db.select().from(leads).where(eq(leads.id, leadId));
    expect(lead).toMatchObject({ title: "Brand platform phase 1", ownerUserId: rep.id });

    // The first editor's token is now stale, so a second save based on it is rejected and changes nothing.
    await expect(service.updateLeadDetails(alphaScope, { ...base, expectedUpdatedAt: first, title: "Stale overwrite" })).rejects.toThrow(/changed by someone else/);
    expect((await db.select().from(leads).where(eq(leads.id, leadId)))[0]?.title).toBe("Brand platform phase 1");

    // A stage change also advances the token.
    const beforeStage = await token();
    await new Promise((resolve) => setTimeout(resolve, 5));
    await service.changeDealStage(alphaScope, { leadId, stage: "discovery" });
    expect((await token()).getTime()).toBeGreaterThan(beforeStage.getTime());
    await expect(service.updateLeadDetails(alphaScope, { ...base, expectedUpdatedAt: beforeStage, title: "After stage" })).rejects.toThrow(/changed by someone else/);

    const current = await token();
    await expect(service.updateLeadDetails(alphaScope, { ...base, expectedUpdatedAt: current, ownerUserId: outsider.id })).rejects.toBeInstanceOf(service.CrmMutationError);
    await expect(service.updateLeadDetails(alphaScope, { ...base, expectedUpdatedAt: current, dealValueMinor: -1 })).rejects.toBeInstanceOf(service.CrmMutationError);
    await expect(service.updateLeadDetails(alphaScope, { ...base, expectedUpdatedAt: current, dealValueMinor: 2_147_483_648 })).rejects.toBeInstanceOf(service.CrmMutationError);
    await expect(service.updateLeadDetails(alphaScope, { ...base, expectedUpdatedAt: current, currency: "zar" })).rejects.toBeInstanceOf(service.CrmMutationError);
    await expect(service.updateLeadDetails(alphaScope, { ...base, expectedUpdatedAt: current, title: " x " })).rejects.toBeInstanceOf(service.CrmMutationError);
    await expect(service.updateLeadDetails(betaScope, { ...base, expectedUpdatedAt: current, title: "Cross tenant edit" })).rejects.toThrow(/active workspace/);

    await service.updateLeadDetails(alphaScope, { ...base, expectedUpdatedAt: current, title: "Brand platform phase 1", ownerUserId: null, dealValueMinor: 1_250_000, currency: "USD", expectedCloseAt: close });
    expect((await db.select().from(deals).where(eq(deals.leadId, leadId)))[0]).toMatchObject({ currency: "USD", valueMinor: 1_250_000 });
    expect((await db.select().from(leads).where(eq(leads.id, leadId)))[0]?.ownerUserId).toBeNull();

    const activities = await db.select().from(crmActivities).where(and(eq(crmActivities.leadId, leadId), eq(crmActivities.type, "lead_updated")));
    expect(activities).toHaveLength(2);
    const audits = await db.select().from(auditLogs).where(and(eq(auditLogs.targetId, leadId), eq(auditLogs.action, "crm.lead_updated")));
    expect(audits).toHaveLength(2);
    expect(JSON.stringify(audits.map((row) => row.metadata))).not.toMatch(/Cross tenant|Stale overwrite/);
    await client.close();
  });
});
