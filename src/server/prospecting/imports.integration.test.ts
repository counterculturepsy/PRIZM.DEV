// @vitest-environment node

import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { describe, expect, it, vi } from "vitest";
import { createWorkspaceScope } from "@/modules/workspaces/scope";
import { companies, companySources, discoveryRuns, users, workspaceMembers, workspaces } from "@/server/db/schema";

describe("company CSV imports", () => {
  it("is idempotent within a workspace and isolated between workspaces", async () => {
    const client = new PGlite();
    const db = drizzle(client);
    await migrate(db, { migrationsFolder: "drizzle" });
    const [user] = await db.insert(users).values({ email: "owner@example.com" }).returning({ id: users.id });
    const workspaceRows = await db.insert(workspaces).values([
      { name: "Alpha", slug: "alpha" }, { name: "Beta", slug: "beta" },
    ]).returning({ id: workspaces.id });
    const [alpha, beta] = workspaceRows;
    if (!user || !alpha || !beta) throw new Error("Test fixtures were not created");
    await db.insert(workspaceMembers).values([
      { workspaceId: alpha.id, userId: user.id, role: "owner", status: "active" },
      { workspaceId: beta.id, userId: user.id, role: "owner", status: "active" },
    ]);

    vi.resetModules();
    vi.doMock("@/server/db", () => ({ getDatabase: () => db }));
    const { importCompanyCsv } = await import("./imports");
    const csv = "name,website,industry,city,province,external_id\nAcme Studio,acme.example,Creative,Johannesburg,Gauteng,acme-1";
    const alphaScope = createWorkspaceScope({ workspaceId: alpha.id, userId: user.id, role: "owner" });
    const betaScope = createWorkspaceScope({ workspaceId: beta.id, userId: user.id, role: "owner" });

    await expect(importCompanyCsv(alphaScope, csv)).resolves.toEqual({ rows: 1, created: 1, updated: 0 });
    const partialCsv = "name,website,external_id\nAcme Studio,acme.example,acme-1";
    await expect(importCompanyCsv(alphaScope, partialCsv)).resolves.toEqual({ rows: 1, created: 0, updated: 1 });
    await expect(importCompanyCsv(betaScope, csv)).resolves.toEqual({ rows: 1, created: 1, updated: 0 });

    const alphaCompanies = await db.select().from(companies).where(eq(companies.workspaceId, alpha.id));
    const betaCompanies = await db.select().from(companies).where(eq(companies.workspaceId, beta.id));
    const sources = await db.select().from(companySources).where(eq(companySources.workspaceId, alpha.id));
    const runs = await db.select().from(discoveryRuns).where(eq(discoveryRuns.workspaceId, alpha.id));
    expect(alphaCompanies).toHaveLength(1);
    expect(alphaCompanies[0]?.industry).toBe("Creative");
    expect(betaCompanies).toHaveLength(1);
    expect(sources).toHaveLength(1);
    expect(runs).toHaveLength(2);
    expect(runs.every((run) => run.status === "completed")).toBe(true);
    await client.close();
  });

  it("imports a six-company file and deduplicates by domain and by normalized identity", async () => {
    const client = new PGlite();
    const db = drizzle(client);
    await migrate(db, { migrationsFolder: "drizzle" });
    const [user] = await db.insert(users).values({ email: "owner@example.com" }).returning({ id: users.id });
    const [workspace] = await db.insert(workspaces).values({ name: "Alpha", slug: "alpha" }).returning({ id: workspaces.id });
    if (!user || !workspace) throw new Error("Test fixtures were not created");
    await db.insert(workspaceMembers).values({ workspaceId: workspace.id, userId: user.id, role: "owner", status: "active" });

    vi.resetModules();
    vi.doMock("@/server/db", () => ({ getDatabase: () => db }));
    const { importCompanyCsv } = await import("./imports");
    const scope = createWorkspaceScope({ workspaceId: workspace.id, userId: user.id, role: "owner" });
    const header = "name,website,industry,city,province,country_code,phone,email,description";
    const sixCompanies = [
      header,
      "Sample Dental Studio,sample-dental.example,Healthcare,Cape Town,Western Cape,ZA,+27 21 555 0101,info@sample-dental.example,Fictional practice.",
      "Sample Auto Group,sample-auto.example,Automotive,Johannesburg,Gauteng,ZA,+27 11 555 0102,hello@sample-auto.example,Fictional dealership.",
      "Sample Law Chambers,sample-law.example,Legal,Durban,KwaZulu-Natal,ZA,+27 31 555 0103,office@sample-law.example,Fictional firm.",
      "Sample Bakery Co,sample-bakery.example,Food and beverage,Pretoria,Gauteng,ZA,+27 12 555 0104,orders@sample-bakery.example,Fictional bakery.",
      "Sample Fitness Club,sample-fitness.example,Health and fitness,Gqeberha,Eastern Cape,ZA,+27 41 555 0105,join@sample-fitness.example,Fictional gym.",
      "Sample Estate Agents,sample-estates.example,Real estate,Stellenbosch,Western Cape,ZA,+27 21 555 0106,sales@sample-estates.example,Fictional agency.",
    ].join("\n");

    await expect(importCompanyCsv(scope, sixCompanies)).resolves.toEqual({ rows: 6, created: 6, updated: 0 });
    await expect(importCompanyCsv(scope, sixCompanies)).resolves.toEqual({ rows: 6, created: 0, updated: 6 });

    const sameDomainDifferentCase = `${header}\nSAMPLE DENTAL STUDIO (Pty) Ltd,https://www.Sample-Dental.example/contact,,,,,,,`;
    await expect(importCompanyCsv(scope, sameDomainDifferentCase)).resolves.toEqual({ rows: 1, created: 0, updated: 1 });

    const noWebsite = `${header}\nWalk-in Cafe,,Food and beverage,Cape Town,Western Cape,ZA,,,`;
    await expect(importCompanyCsv(scope, noWebsite)).resolves.toEqual({ rows: 1, created: 1, updated: 0 });
    const sameIdentity = `${header}\nwalk in cafe,,,cape town,,ZA,,,`;
    await expect(importCompanyCsv(scope, sameIdentity)).resolves.toEqual({ rows: 1, created: 0, updated: 1 });

    const stored = await db.select().from(companies).where(eq(companies.workspaceId, workspace.id));
    expect(stored).toHaveLength(7);
    expect(stored.every((company) => company.countryCode === "ZA")).toBe(true);
    const dental = stored.find((company) => company.domain === "sample-dental.example");
    expect(dental?.name).toBe("SAMPLE DENTAL STUDIO (Pty) Ltd");
    expect(dental?.industry).toBe("Healthcare");
    const dentalSources = await db.select().from(companySources).where(eq(companySources.companyId, dental?.id ?? ""));
    expect(dentalSources.length).toBeGreaterThanOrEqual(2);
    expect(dentalSources.every((source) => source.provider === "csv" && source.kind === "user_supplied")).toBe(true);
    await client.close();
  });
});
