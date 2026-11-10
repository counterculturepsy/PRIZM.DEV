// @vitest-environment node

import { PGlite } from "@electric-sql/pglite";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { describe, expect, it, vi } from "vitest";
import type { WebsiteAuditProvider } from "@/modules/audits/types";
import type { BusinessSearchRecord, DiscoveryProvider, SourcedValue } from "@/modules/prospecting/providers";
import { createWorkspaceScope } from "@/modules/workspaces/scope";
import { auditLogs, companies, leadScores, leads, users, websiteAudits, workspaceMembers, workspaces } from "@/server/db/schema";

const observedAt = "2026-10-26T10:00:00.000Z";
const fact = (value: string, kind: SourcedValue<string>["kind"] = "observed"): SourcedValue<string> => ({ value, kind, confidence: "medium", source: "openstreetmap", observedAt });

async function setup() {
  const client = new PGlite();
  const db = drizzle(client);
  await migrate(db, { migrationsFolder: "drizzle" });
  const [user] = await db.insert(users).values({ email: "owner@example.com" }).returning({ id: users.id });
  const rows = await db.insert(workspaces).values([{ name: "Alpha", slug: "alpha" }, { name: "Beta", slug: "beta" }]).returning({ id: workspaces.id });
  const [alpha, beta] = rows;
  if (!user || !alpha || !beta) throw new Error("Test fixtures were not created");
  await db.insert(workspaceMembers).values([
    { workspaceId: alpha.id, userId: user.id, role: "owner", status: "active" },
    { workspaceId: beta.id, userId: user.id, role: "owner", status: "active" },
  ]);
  vi.resetModules();
  vi.doMock("@/server/db", () => ({ getDatabase: () => db }));
  return {
    client, db,
    discovery: await import("./discovery"),
    queries: await import("./queries"),
    audits: await import("@/server/audits/service"),
    crm: await import("@/server/crm/service"),
    alpha: createWorkspaceScope({ workspaceId: alpha.id, userId: user.id, role: "owner" }),
    beta: createWorkspaceScope({ workspaceId: beta.id, userId: user.id, role: "owner" }),
  };
}

const provider = (records: BusinessSearchRecord[]): DiscoveryProvider => ({
  id: "overpass",
  displayName: "OpenStreetMap (Overpass)",
  license: { name: "ODbL", url: "https://www.openstreetmap.org/copyright", attribution: "© OpenStreetMap contributors" },
  search: async () => ({ records }),
});

describe("discovered companies in the existing workflows", () => {
  it("flows from discovery into audits, opportunity scoring and the CRM, isolated per workspace", async () => {
    const { client, db, discovery, queries, audits, crm, alpha, beta } = await setup();
    const records: BusinessSearchRecord[] = [
      { externalId: "node/1", name: fact("Fixture Dental Clinic"), website: fact("https://fixture-dental.example/"), industry: fact("Medical & Dental Practices"), city: fact("Cape Town", "inferred"), sourceUrl: "https://www.openstreetmap.org/node/1" },
      { externalId: "node/2", name: fact("Fixture Cafe No Website"), industry: fact("Restaurants & Cafés"), city: fact("Cape Town", "inferred"), sourceUrl: "https://www.openstreetmap.org/node/2" },
    ];
    await expect(discovery.runCompanyDiscovery(alpha, { industry: "Medical & Dental Practices", city: "Cape Town" }, { provider: provider(records) }))
      .resolves.toMatchObject({ created: 2 });

    const withSite = (await db.select().from(companies).where(eq(companies.workspaceId, alpha.workspaceId))).find((company) => company.domain === "fixture-dental.example");
    const withoutSite = (await db.select().from(companies).where(eq(companies.workspaceId, alpha.workspaceId))).find((company) => company.website === null);
    if (!withSite || !withoutSite) throw new Error("Discovered companies were not stored");

    await expect(audits.queueWebsiteAudit(alpha, { companyId: withoutSite.id, authorizationConfirmed: true })).rejects.toBeInstanceOf(audits.AuditRequestError);
    await expect(audits.queueWebsiteAudit(beta, { companyId: withSite.id, authorizationConfirmed: true })).rejects.toBeInstanceOf(audits.AuditRequestError);
    const audit = await audits.queueWebsiteAudit(alpha, { companyId: withSite.id, authorizationConfirmed: true });

    const auditProvider: WebsiteAuditProvider = {
      id: "test-provider",
      inspect: async (url) => ({
        requestedUrl: url.toString(), finalUrl: url.toString(), status: 200, contentType: "text/html", headers: {},
        body: Buffer.from("<html><body><h1>Fixture Dental Clinic</h1></body></html>"), responseBytes: 58,
        durationMs: 40, observedAt: new Date("2026-10-26T10:05:00Z"), robotsAllowed: true,
      }),
    };
    await expect(audits.processNextAuditJob(auditProvider, "worker-1")).resolves.toEqual({ auditId: audit.id, status: "completed" });
    const [storedAudit] = await db.select().from(websiteAudits).where(eq(websiteAudits.id, audit.id));
    expect(storedAudit?.status).toBe("completed");

    const scores = await db.select().from(leadScores).where(and(eq(leadScores.workspaceId, alpha.workspaceId), eq(leadScores.companyId, withSite.id)));
    expect(scores).toHaveLength(1);
    expect(scores[0]?.isCurrent).toBe(true);
    const failures = await db.select().from(auditLogs).where(eq(auditLogs.action, "opportunity_intelligence.failed"));
    expect(failures).toHaveLength(0);

    await expect(crm.createCrmLead(beta, { companyId: withSite.id, title: "Cross-tenant attempt" })).rejects.toBeInstanceOf(crm.CrmMutationError);
    await expect(crm.createCrmLead(alpha, { companyId: withSite.id, title: "Fixture Dental Clinic" })).resolves.toMatchObject({ created: true });
    await expect(crm.createCrmLead(alpha, { companyId: withSite.id, title: "Fixture Dental Clinic" })).resolves.toMatchObject({ created: false });
    expect(await db.select().from(leads).where(eq(leads.workspaceId, alpha.workspaceId))).toHaveLength(1);
    expect(await db.select().from(leads).where(eq(leads.workspaceId, beta.workspaceId))).toHaveLength(0);

    expect(await queries.countCompanyMatches(beta)).toBe(0);
    expect(await queries.countCompanyMatches(alpha)).toBe(2);
    await client.close();
  });
});

describe("company list pagination", () => {
  it("pages deterministically, applies filters to the total, and never crosses workspaces", async () => {
    const { client, db, queries, alpha, beta } = await setup();
    const pad = (value: number) => String(value).padStart(2, "0");
    await db.insert(companies).values(Array.from({ length: 30 }, (_, index) => ({
      workspaceId: alpha.workspaceId, name: `Fixture Company ${pad(index)}`, dedupeKey: `identity:alpha-${index}`,
      city: index % 2 === 0 ? "Cape Town" : "Durban", industry: index < 10 ? "Legal & Accounting Services" : "Beauty & Wellness",
    })));
    await db.insert(companies).values([{ workspaceId: beta.workspaceId, name: "Fixture Beta One", dedupeKey: "identity:beta-1" }, { workspaceId: beta.workspaceId, name: "Fixture Beta Two", dedupeKey: "identity:beta-2" }]);

    expect(queries.COMPANY_PAGE_SIZE).toBe(24);
    expect(await queries.countCompanyMatches(alpha)).toBe(30);
    const first = await queries.listCompanies(alpha, {}, 1);
    const second = await queries.listCompanies(alpha, {}, 2);
    expect(first).toHaveLength(24);
    expect(second).toHaveLength(6);
    expect(await queries.listCompanies(alpha, {}, 3)).toHaveLength(0);
    expect(first[0]?.name).toBe("Fixture Company 00");
    expect(second[5]?.name).toBe("Fixture Company 29");
    expect(new Set([...first, ...second].map((company) => company.id)).size).toBe(30);
    expect(await queries.listCompanies(alpha, {}, 0)).toHaveLength(24);

    expect(await queries.countCompanyMatches(alpha, { city: "Durban" })).toBe(15);
    expect(await queries.countCompanyMatches(alpha, { industry: "Legal & Accounting Services", city: "Cape Town" })).toBe(5);
    expect(await queries.countCompanyMatches(alpha, { q: "company 07" })).toBe(1);
    expect(await queries.countCompanyMatches(beta)).toBe(2);
    expect((await queries.listCompanies(beta, {}, 1)).every((company) => company.workspaceId === beta.workspaceId)).toBe(true);
    await client.close();
  });
});
