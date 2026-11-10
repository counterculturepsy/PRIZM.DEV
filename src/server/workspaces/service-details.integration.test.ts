// @vitest-environment node

import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { describe, expect, it, vi } from "vitest";
import { createWorkspaceScope, workspaceRoles } from "@/modules/workspaces/scope";
import { auditLogs, services, users, workspaces } from "@/server/db/schema";

function one<T>(rows: readonly T[]): T {
  const [row] = rows;
  if (row === undefined) throw new Error("Fixture row was not created");
  return row;
}

async function setup() {
  const client = new PGlite();
  const db = drizzle(client);
  await migrate(db, { migrationsFolder: "drizzle" });
  const user = one(await db.insert(users).values({ email: "details@example.com" }).returning({ id: users.id }));
  const [alpha, beta] = await db.insert(workspaces).values([
    { name: "Alpha", slug: "details-alpha", currency: "ZAR" },
    { name: "Beta", slug: "details-beta", currency: "ZAR" },
  ]).returning({ id: workspaces.id });
  if (!alpha || !beta) throw new Error("Workspaces were not created");
  const first = one(await db.insert(services).values({
    workspaceId: alpha.id, name: "Alpha Service", slug: "alpha-service", startingPriceMinor: 10_000, averagePriceMinor: 20_000, deliveryTimeDays: 14, active: true,
  }).returning());
  const second = one(await db.insert(services).values({ workspaceId: alpha.id, name: "Alpha Other", slug: "alpha-other", active: false }).returning());
  const foreign = one(await db.insert(services).values({ workspaceId: beta.id, name: "Beta Service", slug: "beta-service", description: "Beta original", features: ["Beta item"] }).returning());
  vi.resetModules();
  vi.doMock("@/server/db", () => ({ getDatabase: () => db }));
  const { updateServiceDetails, ServiceDetailsError } = await import("./service-details");
  const scope = (workspaceId: string, role: (typeof workspaceRoles)[number] = "owner") => createWorkspaceScope({ workspaceId, userId: user.id, role });
  const row = async (id: string) => one(await db.select().from(services).where(eq(services.id, id)));
  const logs = async () => (await db.select().from(auditLogs)).filter((entry) => entry.action === "service.details_updated");
  return { client, db, alpha, beta, first, second, foreign, scope, row, logs, updateServiceDetails, ServiceDetailsError };
}

describe("service details editor", () => {
  it("lets owners and admins change only description and features, and keeps every immutable field", async () => {
    const { client, alpha, first, second, foreign, scope, row, logs, updateServiceDetails } = await setup();
    const before = await row(first.id);
    const otherBefore = await row(second.id);
    const foreignBefore = await row(foreign.id);

    await expect(updateServiceDetails(scope(alpha.id, "owner"), { serviceId: first.id, description: "  First text  ", features: ["  One  ", "", "Two", "One"] }))
      .resolves.toEqual({ changed: true, fields: ["description", "features"] });
    const after = await row(first.id);
    expect(after.description).toBe("First text");
    expect(after.features).toEqual(["One", "Two"]);
    await expect(updateServiceDetails(scope(alpha.id, "admin"), { serviceId: first.id, description: "Admin text", features: ["One", "Two"] }))
      .resolves.toEqual({ changed: true, fields: ["description"] });

    // Name, slug, status, prices, delivery time, ownership and creation time never change.
    const final = await row(first.id);
    for (const key of ["id", "workspaceId", "name", "slug", "active", "startingPriceMinor", "averagePriceMinor", "deliveryTimeDays", "createdAt"] as const) {
      expect(final[key]).toEqual(before[key]);
    }
    expect(final.updatedAt.getTime()).toBeGreaterThanOrEqual(before.updatedAt.getTime());
    // Other services, in this workspace and in another, are untouched.
    expect(await row(second.id)).toEqual(otherBefore);
    expect(await row(foreign.id)).toEqual(foreignBefore);

    // Audit entries name the changed fields and sizes, never the text.
    const entries = await logs();
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ workspaceId: alpha.id, targetType: "service", targetId: first.id, metadata: { changed: ["description", "features"], descriptionLength: 10, featureCount: 2 } });
    expect(entries[1]?.metadata).toMatchObject({ changed: ["description"], descriptionLength: 10, featureCount: 2 });
    expect(JSON.stringify(entries.map((entry) => entry.metadata))).not.toMatch(/First text|Admin text|One|Two/);
    await client.close();
  });

  it("ignores any attempt to pass immutable fields", async () => {
    const { client, alpha, first, scope, row, updateServiceDetails } = await setup();
    const before = await row(first.id);
    await updateServiceDetails(scope(alpha.id), {
      serviceId: first.id, description: "Only this", features: [], name: "Hacked", slug: "hacked", active: false, startingPriceMinor: 1, averagePriceMinor: 2, deliveryTimeDays: 3, workspaceId: "00000000-0000-4000-8000-000000000000",
    });
    const after = await row(first.id);
    expect(after).toMatchObject({ name: before.name, slug: before.slug, active: before.active, startingPriceMinor: 10_000, averagePriceMinor: 20_000, deliveryTimeDays: 14, workspaceId: before.workspaceId, description: "Only this" });
    await client.close();
  });

  it("records nothing and keeps updated_at when nothing changed", async () => {
    const { client, alpha, first, scope, row, logs, updateServiceDetails } = await setup();
    await updateServiceDetails(scope(alpha.id), { serviceId: first.id, description: "Same", features: ["A"] });
    const saved = await row(first.id);
    await expect(updateServiceDetails(scope(alpha.id), { serviceId: first.id, description: " Same ", features: [" A ", "A"] })).resolves.toEqual({ changed: false });
    expect(await row(first.id)).toEqual(saved);
    expect(await logs()).toHaveLength(1);
    await client.close();
  });

  it("gives every other role read-only access: no change and no audit entry", async () => {
    const { client, alpha, first, scope, row, logs, updateServiceDetails, ServiceDetailsError } = await setup();
    const before = await row(first.id);
    for (const role of workspaceRoles.filter((candidate) => candidate !== "owner" && candidate !== "admin")) {
      await expect(updateServiceDetails(scope(alpha.id, role), { serviceId: first.id, description: "Denied", features: ["Denied"] })).rejects.toBeInstanceOf(ServiceDetailsError);
    }
    expect(await row(first.id)).toEqual(before);
    expect(await logs()).toHaveLength(0);
    await client.close();
  });

  it("isolates workspaces: a service from another workspace cannot be read or changed", async () => {
    const { client, alpha, beta, first, foreign, scope, row, logs, updateServiceDetails, ServiceDetailsError } = await setup();
    const foreignBefore = await row(foreign.id);
    await expect(updateServiceDetails(scope(alpha.id), { serviceId: foreign.id, description: "Cross", features: ["Cross"] })).rejects.toBeInstanceOf(ServiceDetailsError);
    await expect(updateServiceDetails(scope(alpha.id), { serviceId: "00000000-0000-4000-8000-000000000000", description: "Missing", features: [] })).rejects.toBeInstanceOf(ServiceDetailsError);
    expect(await row(foreign.id)).toEqual(foreignBefore);
    expect(await logs()).toHaveLength(0);

    // The owning workspace can edit its own service, and only that one.
    await updateServiceDetails(scope(beta.id), { serviceId: foreign.id, description: "Beta new", features: [] });
    expect((await row(foreign.id)).description).toBe("Beta new");
    expect((await row(first.id)).description).toBe("");
    expect((await logs())[0]?.workspaceId).toBe(beta.id);
    await client.close();
  });

  it("rejects invalid input before touching the database", async () => {
    const { client, alpha, first, scope, row, logs, updateServiceDetails, ServiceDetailsError } = await setup();
    const before = await row(first.id);
    const owner = scope(alpha.id);
    await expect(updateServiceDetails(owner, { serviceId: first.id, description: "x".repeat(501), features: [] })).rejects.toThrow(/500 characters/);
    await expect(updateServiceDetails(owner, { serviceId: first.id, description: "", features: Array.from({ length: 13 }, (_, index) => `Feature ${index}`) })).rejects.toThrow(/at most 12/);
    await expect(updateServiceDetails(owner, { serviceId: first.id, description: "", features: ["y".repeat(81)] })).rejects.toThrow(/80 characters/);
    await expect(updateServiceDetails(owner, { serviceId: "not-a-uuid", description: "", features: [] })).rejects.toBeInstanceOf(ServiceDetailsError);
    await expect(updateServiceDetails(owner, { serviceId: first.id, description: "ok", features: "not a list" })).rejects.toBeInstanceOf(ServiceDetailsError);
    // Boundaries are accepted.
    await expect(updateServiceDetails(owner, { serviceId: first.id, description: "d".repeat(500), features: Array.from({ length: 12 }, (_, index) => String.fromCharCode(97 + index).repeat(80)) })).resolves.toMatchObject({ changed: true });
    expect((await row(first.id)).features).toHaveLength(12);
    expect(await logs()).toHaveLength(1);
    expect(before.description).toBe("");
    await client.close();
  });
});
