// @vitest-environment node

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AUDIT_QUEUE_LIMITS } from "@/modules/audits/queue-limits";
import { createWorkspaceScope } from "@/modules/workspaces/scope";
import { auditJobs, auditLogs, companies, users, websiteAudits, websites, workspaceMembers, workspaces } from "@/server/db/schema";

const USER_AGENT = "PRIZMDEV/1.0 (+https://example.test/contact)";

type Availability = "enabled" | "disabled" | "from-environment";

async function fixture() {
  const client = new PGlite();
  const db = drizzle(client);
  await migrate(db, { migrationsFolder: "drizzle" });
  const [user] = await db.insert(users).values({ email: "gate@example.test" }).returning({ id: users.id });
  const [workspace] = await db.insert(workspaces).values({ name: "Gate", slug: "audit-gate" }).returning({ id: workspaces.id });
  const [otherWorkspace] = await db.insert(workspaces).values({ name: "Other", slug: "audit-gate-other" }).returning({ id: workspaces.id });
  if (!user || !workspace || !otherWorkspace) throw new Error("fixtures");
  await db.insert(workspaceMembers).values([
    { workspaceId: workspace.id, userId: user.id, role: "developer", status: "active" },
    { workspaceId: otherWorkspace.id, userId: user.id, role: "developer", status: "active" },
  ]);
  const addCompany = async (workspaceId: string, label: string) => {
    const domain = `${label}.example.test`;
    const [company] = await db.insert(companies).values({ workspaceId, name: label, dedupeKey: `domain:${domain}`, website: `https://${domain}`, domain }).returning({ id: companies.id });
    if (!company) throw new Error("company");
    return company;
  };
  const company = await addCompany(workspace.id, "gate-co");
  const scope = createWorkspaceScope({ workspaceId: workspace.id, userId: user.id, role: "developer" });
  const counts = async () => ({
    websites: (await db.select().from(websites)).length,
    audits: (await db.select().from(websiteAudits)).length,
    jobs: (await db.select().from(auditJobs)).length,
    logs: (await db.select().from(auditLogs)).length,
  });
  // The same numbers the service's own quota query reads, so "quota unchanged" means exactly that.
  const quotaUsage = async (workspaceId: string) => {
    const rows = (await db.select().from(websiteAudits)).filter((row) => row.workspaceId === workspaceId);
    const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
    return {
      active: rows.filter((row) => row.status === "queued" || row.status === "running").length,
      requestedLast24h: rows.filter((row) => row.requestedAt.getTime() > dayAgo).length,
    };
  };
  const load = async (availability: Availability) => {
    vi.resetModules();
    vi.doMock("@/server/db", () => ({ getDatabase: () => db }));
    if (availability !== "from-environment") vi.doMock("@/server/audits/availability", () => ({ isWebsiteAuditingEnabled: () => availability === "enabled" }));
    return import("./service");
  };
  return { client, db, user, workspace, otherWorkspace, company, scope, counts, quotaUsage, addCompany, load };
}

describe("website audit queue availability gate", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.doUnmock("@/server/db");
    vi.doUnmock("@/server/audits/availability");
    vi.resetModules();
  });

  it("creates no website, audit, job or log row and consumes no quota when auditing is disabled", async () => {
    const { client, company, scope, counts, load } = await fixture();
    const disabled = (await load("disabled")).queueWebsiteAudit;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const refusal = disabled(scope, { companyId: company.id, authorizationConfirmed: true });
      await expect(refusal).rejects.toMatchObject({ name: "AuditPolicyError", code: "worker_disabled" });
      await expect(refusal).rejects.toThrow(/disabled in this environment/i);
      await expect(refusal).rejects.not.toThrow(/WEBSITE_AUDIT_ENABLED|process\.env/);
    }
    expect(await counts()).toEqual({ websites: 0, audits: 0, jobs: 0, logs: 0 });
    // Twelve refused attempts exceed the per-workspace active cap of ten, so any consumed quota would block this call.
    const enabled = (await load("enabled")).queueWebsiteAudit;
    await expect(enabled(scope, { companyId: company.id, authorizationConfirmed: true })).resolves.toMatchObject({ id: expect.any(String) });
    expect(await counts()).toMatchObject({ websites: 1, audits: 1, jobs: 1, logs: 1 });
    await client.close();
  });

  it("checks availability before the confirmation flag or the company lookup", async () => {
    const { client, scope, counts, load } = await fixture();
    const { queueWebsiteAudit } = await load("disabled");
    await expect(queueWebsiteAudit(scope, { companyId: "00000000-0000-4000-8000-000000000000", authorizationConfirmed: false })).rejects.toMatchObject({ code: "worker_disabled" });
    expect(await counts()).toEqual({ websites: 0, audits: 0, jobs: 0, logs: 0 });
    await client.close();
  });

  it("reads the server environment and fails closed when the flag is off or the environment is invalid", async () => {
    const { client, company, scope, counts, load } = await fixture();
    vi.stubEnv("NEXTAUTH_URL", "http://localhost:3003");
    vi.stubEnv("DATABASE_URL", "postgresql://unused:unused@127.0.0.1:1/unused");
    vi.stubEnv("AUTH_SECRET", "placeholder-secret-for-schema-check-only-0000");
    vi.stubEnv("WEBSITE_AUDIT_ENABLED", "");
    const { queueWebsiteAudit } = await load("from-environment");
    await expect(queueWebsiteAudit(scope, { companyId: company.id, authorizationConfirmed: true })).rejects.toMatchObject({ code: "worker_disabled" });

    vi.stubEnv("WEBSITE_AUDIT_ENABLED", "true");
    vi.stubEnv("AUDIT_USER_AGENT", "x");
    await expect(queueWebsiteAudit(scope, { companyId: company.id, authorizationConfirmed: true })).rejects.toMatchObject({ code: "worker_disabled" });
    expect(await counts()).toEqual({ websites: 0, audits: 0, jobs: 0, logs: 0 });

    vi.stubEnv("AUDIT_USER_AGENT", USER_AGENT);
    await expect(queueWebsiteAudit(scope, { companyId: company.id, authorizationConfirmed: true })).resolves.toMatchObject({ id: expect.any(String) });
    expect(await counts()).toMatchObject({ websites: 1, audits: 1, jobs: 1 });
    await client.close();
  });
});

describe("website audit queue when enabled", () => {
  afterEach(() => {
    vi.doUnmock("@/server/db");
    vi.doUnmock("@/server/audits/availability");
    vi.resetModules();
  });

  it("refuses at the active cap without touching website rows, audit rows or quota usage", async () => {
    const { client, workspace, scope, counts, quotaUsage, addCompany, load } = await fixture();
    const { queueWebsiteAudit } = await load("enabled");
    for (let index = 0; index < AUDIT_QUEUE_LIMITS.maxActive; index += 1) {
      const company = await addCompany(workspace.id, `active-${index}`);
      await queueWebsiteAudit(scope, { companyId: company.id, authorizationConfirmed: true });
    }
    const overflow = await addCompany(workspace.id, "active-overflow");
    const before = { counts: await counts(), usage: await quotaUsage(workspace.id) };
    expect(before.usage.active).toBe(AUDIT_QUEUE_LIMITS.maxActive);

    await expect(queueWebsiteAudit(scope, { companyId: overflow.id, authorizationConfirmed: true })).rejects.toMatchObject({ name: "AuditRequestError", message: expect.stringMatching(/already waiting or running/) });
    expect({ counts: await counts(), usage: await quotaUsage(workspace.id) }).toEqual(before);
    await client.close();
  });

  it("refuses at the 24-hour cap without touching website rows, audit rows or quota usage", async () => {
    const { client, db, user, workspace, company, scope, counts, quotaUsage, addCompany, load } = await fixture();
    const [history] = await db.insert(websites).values({ workspaceId: workspace.id, companyId: company.id, url: "https://history.example.test", normalizedOrigin: "https://history.example.test" }).returning({ id: websites.id });
    if (!history) throw new Error("history website");
    await db.insert(websiteAudits).values(Array.from({ length: AUDIT_QUEUE_LIMITS.maxPerDay }, () => ({
      workspaceId: workspace.id, websiteId: history.id, requestedByUserId: user.id,
      authorizationBasis: "test fixture", status: "completed" as const, score: 70, completedAt: new Date(),
    })));
    const next = await addCompany(workspace.id, "daily-next");
    const { queueWebsiteAudit } = await load("enabled");
    const before = { counts: await counts(), usage: await quotaUsage(workspace.id) };
    expect(before.usage).toEqual({ active: 0, requestedLast24h: AUDIT_QUEUE_LIMITS.maxPerDay });

    await expect(queueWebsiteAudit(scope, { companyId: next.id, authorizationConfirmed: true })).rejects.toMatchObject({ name: "AuditRequestError", message: expect.stringMatching(/limit of 50 audit requests in 24 hours/) });
    expect({ counts: await counts(), usage: await quotaUsage(workspace.id) }).toEqual(before);
    await client.close();
  });

  it("refuses a company that belongs to another workspace and changes nothing in either workspace", async () => {
    const { client, workspace, otherWorkspace, scope, counts, quotaUsage, addCompany, load } = await fixture();
    const foreign = await addCompany(otherWorkspace.id, "foreign-co");
    const { queueWebsiteAudit } = await load("enabled");
    const before = { counts: await counts(), mine: await quotaUsage(workspace.id), theirs: await quotaUsage(otherWorkspace.id) };
    expect(before.counts).toEqual({ websites: 0, audits: 0, jobs: 0, logs: 0 });

    await expect(queueWebsiteAudit(scope, { companyId: foreign.id, authorizationConfirmed: true })).rejects.toMatchObject({ name: "AuditRequestError", message: "Choose a workspace company with a valid website." });
    expect({ counts: await counts(), mine: await quotaUsage(workspace.id), theirs: await quotaUsage(otherWorkspace.id) }).toEqual(before);
    await client.close();
  });
});
