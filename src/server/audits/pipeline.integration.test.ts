// @vitest-environment node

import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { EventEmitter } from "node:events";
import type http from "node:http";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { createWorkspaceScope } from "@/modules/workspaces/scope";
import { auditFindings, auditJobs, auditLogs, companies, idealCustomerProfiles, leadScores, opportunities, opportunityEvidence, services, users, websiteAudits, workspaceMembers, workspaces } from "@/server/db/schema";
import type { AuditNetwork } from "./http-provider";

type Route = { status?: number; headers?: Record<string, string>; body?: string } | "hang";
const SECURE = { "content-type": "text/html; charset=utf-8", "content-security-policy": "default-src 'self'; frame-ancestors 'none'", "x-content-type-options": "nosniff" };
const CLEAN = '<!doctype html><html lang="en"><head><title>Fixture Clean Realty Home Page</title><meta name="description" content="Fixture"><meta name="viewport" content="width=device-width"><link rel="canonical" href="https://clean.example/"></head><body><h1>Clean</h1><img alt="Team" src="t.jpg"><label for="e">Email</label><input id="e"></body></html>';
const WEAK = "<html><body><img src='a.jpg'><img src='b.jpg'><input><p>Fixture Weak Realty</p></body></html>";
const LIMITS = { pageIdleMs: 30, pageTotalMs: 120, robotsIdleMs: 30, robotsTotalMs: 80, inspectTotalMs: 300 };

/** Scripted network keyed by "host/path"; unknown routes are 404, robots.txt included. */
function fakeNetwork(routes: Record<string, Route>, dns: Record<string, string[]> = {}): AuditNetwork {
  return {
    lookup: async (hostname) => (dns[hostname] ?? ["93.184.216.34"]).map((address) => ({ address, family: 4 })),
    request: () => (options, callback) => {
      const route = routes[`${(options.headers as Record<string, string>)["Host"]}${options.path}`] ?? { status: 404, headers: { "content-type": "text/plain" }, body: "" };
      const request = new EventEmitter() as EventEmitter & { setTimeout: () => unknown; destroy: () => unknown; end: () => void };
      let closed = false;
      request.setTimeout = () => request;
      request.destroy = () => { closed = true; return request; };
      request.end = () => setImmediate(() => {
        if (closed || route === "hang") return;
        const response = Object.assign(new PassThrough(), { statusCode: route.status ?? 200, headers: route.headers ?? { "content-type": "text/plain" }, complete: false });
        response.on("end", () => { response.complete = true; });
        callback(response as unknown as http.IncomingMessage);
        response.end(route.body ?? "");
      });
      return request as unknown as http.ClientRequest;
    },
  };
}

async function setup() {
  const client = new PGlite();
  const db = drizzle(client);
  await migrate(db, { migrationsFolder: "drizzle" });
  const [user] = await db.insert(users).values({ email: "owner@example.com" }).returning({ id: users.id });
  const rows = await db.insert(workspaces).values([{ name: "Alpha", slug: "alpha", currency: "ZAR" }, { name: "Beta", slug: "beta", currency: "ZAR" }]).returning({ id: workspaces.id });
  const [alpha, beta] = rows;
  if (!user || !alpha || !beta) throw new Error("Test fixtures were not created");
  await db.insert(workspaceMembers).values([
    { workspaceId: alpha.id, userId: user.id, role: "owner", status: "active" },
    { workspaceId: beta.id, userId: user.id, role: "owner", status: "active" },
  ]);
  await db.insert(idealCustomerProfiles).values({ workspaceId: alpha.id, industries: ["Real Estate Agencies"], cities: ["Stellenbosch"] });
  await db.insert(services).values([
    { workspaceId: alpha.id, name: "SEO", slug: "seo", startingPriceMinor: 15_000, averagePriceMinor: 25_000 },
    { workspaceId: alpha.id, name: "Accessibility audit", slug: "accessibility-audit", startingPriceMinor: 12_000, averagePriceMinor: 20_000 },
  ]);
  vi.resetModules();
  vi.doMock("@/server/db", () => ({ getDatabase: () => db }));
  const { SafeHttpAuditProvider } = await import("./http-provider");
  const company = async (name: string, host: string) => {
    const [row] = await db.insert(companies).values({
      workspaceId: alpha.id, name, dedupeKey: `domain:${host}`, website: `https://${host}`, domain: host, industry: "Real Estate Agencies", city: "Stellenbosch", email: `info@${host}`,
    }).returning({ id: companies.id });
    if (!row) throw new Error("Company fixture was not created");
    return row.id;
  };
  return {
    client, db, company, alphaId: alpha.id,
    audits: await import("./service"), queries: await import("./queries"), intelligence: await import("@/server/opportunities/queries"),
    makeProvider: (network: AuditNetwork) => new SafeHttpAuditProvider("PRIZMDEV/1.0 (+https://example.test/contact)", 1_000_000, { ...network, limits: LIMITS }),
    alpha: createWorkspaceScope({ workspaceId: alpha.id, userId: user.id, role: "owner" }),
    beta: createWorkspaceScope({ workspaceId: beta.id, userId: user.id, role: "owner" }),
  };
}

describe("website audit pipeline on a fake network", () => {
  it("scores real findings, refuses hostile or broken sites safely, and never scores error pages", async () => {
    const { client, db, company, audits, queries, intelligence, makeProvider, alpha, beta } = await setup();
    const ids = {
      weak: await company("Fixture Weak Realty", "weak.example"), clean: await company("Fixture Clean Realty", "clean.example"),
      blocked: await company("Fixture Blocked Realty", "blocked.example"), private: await company("Fixture Private Realty", "private.example"),
      down: await company("Fixture Down Realty", "down.example"), slow: await company("Fixture Slow Realty", "slow.example"),
    };
    const provider = makeProvider(fakeNetwork({
      "weak.example/robots.txt": { status: 404 }, "weak.example/": { headers: { "content-type": "text/html" }, body: WEAK },
      "clean.example/robots.txt": { status: 404 }, "clean.example/": { headers: SECURE, body: CLEAN },
      "blocked.example/robots.txt": { headers: { "content-type": "text/plain" }, body: "User-agent: *\nDisallow: /" }, "blocked.example/": { headers: SECURE, body: CLEAN },
      "private.example/robots.txt": { status: 404 }, "private.example/": { headers: SECURE, body: CLEAN },
      "down.example/robots.txt": { status: 404 }, "down.example/": { status: 503, headers: { "content-type": "text/html" }, body: "<html><body>Service unavailable</body></html>" },
      "slow.example/robots.txt": "hang",
    }, { "private.example": ["10.0.0.9"] }));

    const audit: Record<string, string> = {};
    for (const [key, companyId] of Object.entries(ids)) audit[key] = (await audits.queueWebsiteAudit(alpha, { companyId, authorizationConfirmed: true })).id;
    const outcome: Record<string, string> = {};
    for (let index = 0; index < Object.keys(ids).length; index += 1) {
      const result = await audits.processNextAuditJob(provider, "worker-1");
      if (result) outcome[result.auditId] = result.status;
    }
    const status = (key: string) => outcome[audit[key] ?? ""];
    expect(status("weak")).toBe("completed");
    expect(status("clean")).toBe("completed");
    expect(status("blocked")).toBe("blocked");
    expect(status("private")).toBe("blocked");
    expect(status("down")).toBe("partial");
    expect(status("slow")).toBe("queued");

    const stored = await db.select().from(websiteAudits);
    const byKey = (key: string) => stored.find((row) => row.id === audit[key]);
    expect(byKey("blocked")).toMatchObject({ status: "blocked", errorCode: "robots_disallowed", robotsAllowed: false });
    expect(byKey("private")).toMatchObject({ status: "blocked", errorCode: "private_destination" });
    expect(byKey("slow")).toMatchObject({ status: "queued", errorCode: "request_timeout" });
    const codes = async (key: string) => (await db.select().from(auditFindings).where(eq(auditFindings.auditId, audit[key] ?? ""))).map((row) => row.code);
    expect(await codes("weak")).toEqual(expect.arrayContaining(["seo.title_missing", "a11y.image_alt_missing", "a11y.form_label_missing", "mobile.viewport_missing", "security.csp_missing"]));
    expect(await codes("clean")).toEqual([]);
    expect(await codes("blocked")).toEqual([]);
    expect(await codes("down")).toContain("http.error_status");

    const scores = await db.select().from(leadScores);
    const scored = (key: string) => scores.find((row) => row.companyId === ids[key as keyof typeof ids]);
    expect(scored("weak")?.isCurrent).toBe(true);
    expect(scored("clean")).toBeDefined();
    expect(scored("blocked")).toBeUndefined();
    expect(scored("private")).toBeUndefined();
    expect(scored("down")).toBeUndefined();
    expect((scored("weak")?.totalScore ?? 0)).toBeGreaterThan(scored("clean")?.totalScore ?? 100);

    const all = await db.select().from(opportunities);
    expect(all.every((row) => row.companyId === ids.weak)).toBe(true);
    expect(all.map((row) => row.type)).toEqual(expect.arrayContaining(["accessibility_remediation", "seo_improvement", "mobile_experience", "security_hardening"]));
    const evidence = await db.select().from(opportunityEvidence);
    expect(evidence.length).toBeGreaterThanOrEqual(all.length);
    expect(evidence.every((row) => row.auditId === audit["weak"])).toBe(true);
    expect((await db.select().from(auditLogs).where(eq(auditLogs.action, "opportunity_intelligence.failed")))).toHaveLength(0);

    const profile = await intelligence.getCompanyOpportunityIntelligence(alpha, ids.weak);
    expect(profile?.totalScore).toBe(scored("weak")?.totalScore);
    expect(profile?.opportunities.length).toBe(all.length);
    expect(profile?.opportunities.every((item) => item.evidence.length > 0)).toBe(true);
    expect(await intelligence.getCompanyOpportunityIntelligence(alpha, ids.down)).toBeNull();
    const feed = await intelligence.listOpportunityFeed(alpha);
    expect(feed.every((row) => row.companyId === ids.weak)).toBe(true);
    expect(await intelligence.listOpportunityFeed(beta)).toHaveLength(0);
    expect(await intelligence.getCompanyOpportunityIntelligence(beta, ids.weak)).toBeNull();
    expect(await queries.getWebsiteAudit(beta, audit["weak"] ?? "")).toBeNull();
    expect((await queries.getWebsiteAudit(alpha, audit["weak"] ?? ""))?.findings.length).toBeGreaterThan(0);
    expect(await queries.listWebsiteAudits(beta)).toHaveLength(0);
    await client.close();
  });

  it("retries a site that keeps timing out with backoff and then gives up", async () => {
    const { client, db, company, audits, makeProvider, alpha } = await setup();
    const companyId = await company("Fixture Slow Realty", "slow.example");
    const provider = makeProvider(fakeNetwork({ "slow.example/robots.txt": "hang" }));
    const queued = await audits.queueWebsiteAudit(alpha, { companyId, authorizationConfirmed: true });
    const states: string[] = [];
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      await db.update(auditJobs).set({ runAfter: new Date(Date.now() - 1000) }).where(eq(auditJobs.auditId, queued.id));
      states.push((await audits.processNextAuditJob(provider, "worker-1"))?.status ?? "none");
    }
    expect(states).toEqual(["queued", "queued", "failed"]);
    const [audit] = await db.select().from(websiteAudits).where(eq(websiteAudits.id, queued.id));
    const [job] = await db.select().from(auditJobs).where(eq(auditJobs.auditId, queued.id));
    expect(audit).toMatchObject({ status: "failed", errorCode: "request_timeout" });
    expect(job).toMatchObject({ status: "failed", attempts: 3 });
    expect(await audits.processNextAuditJob(provider, "worker-1")).toBeNull();
    await client.close();
  });

  it("caps queued audits and daily requests per workspace without blocking other workspaces", async () => {
    const { client, db, company, audits, alpha, beta, alphaId } = await setup();
    const first = await company("Fixture Cap Realty 0", "cap0.example");
    await audits.queueWebsiteAudit(alpha, { companyId: first, authorizationConfirmed: true });
    await expect(audits.queueWebsiteAudit(alpha, { companyId: first, authorizationConfirmed: true })).rejects.toThrow("already queued or running");
    for (let index = 1; index < 10; index += 1) {
      await audits.queueWebsiteAudit(alpha, { companyId: await company(`Fixture Cap Realty ${index}`, `cap${index}.example`), authorizationConfirmed: true });
    }
    const eleventh = await company("Fixture Cap Realty 10", "cap10.example");
    await expect(audits.queueWebsiteAudit(alpha, { companyId: eleventh, authorizationConfirmed: true })).rejects.toThrow("10 audits are already waiting or running");
    await expect(audits.queueWebsiteAudit(beta, { companyId: eleventh, authorizationConfirmed: true })).rejects.toThrow("valid website");

    await db.update(websiteAudits).set({ status: "completed" }).where(eq(websiteAudits.workspaceId, alphaId));
    const [existing] = await db.select().from(websiteAudits).limit(1);
    if (!existing) throw new Error("Expected an audit row");
    await db.insert(websiteAudits).values(Array.from({ length: 40 }, () => ({ workspaceId: alphaId, websiteId: existing.websiteId, requestedByUserId: existing.requestedByUserId, status: "completed" as const, authorizationBasis: "test" })));
    await expect(audits.queueWebsiteAudit(alpha, { companyId: eleventh, authorizationConfirmed: true })).rejects.toThrow("limit of 50 audit requests");
    await client.close();
  });
});
