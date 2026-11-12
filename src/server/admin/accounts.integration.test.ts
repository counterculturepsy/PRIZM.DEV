// @vitest-environment node

import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { accountApprovalAudits, accountNotificationEvents, users } from "@/server/db/schema";

async function setup() {
  const client = new PGlite();
  const db = drizzle(client);
  await migrate(db, { migrationsFolder: "drizzle" });
  const [admin, secondAdmin, owner, pending] = await db.insert(users).values([
    { email: "platform-admin@example.test", accountStatus: "approved", isPlatformAdmin: true },
    { email: "second-admin@example.test", accountStatus: "approved", isPlatformAdmin: true },
    { email: "workspace-owner@example.test", accountStatus: "approved" },
    { email: "pending@example.test", accountStatus: "pending" },
  ]).returning();
  if (!admin || !secondAdmin || !owner || !pending) throw new Error("Fixtures were not created.");
  vi.resetModules();
  vi.doMock("@/server/db", () => ({ getDatabase: () => db }));
  vi.doMock("@/server/auth/session", () => ({ requireSession: vi.fn() }));
  const service = await import("./accounts");
  return { client, db, admin, secondAdmin, owner, pending, ...service };
}

describe("platform account administration", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("approves a pending account and writes audit and notification events", async () => {
    const { client, db, admin, pending, changeAccountStatus } = await setup();
    await changeAccountStatus(admin.id, pending.id, "approve");
    const [updated] = await db.select().from(users).where(eq(users.id, pending.id));
    expect(updated).toMatchObject({ accountStatus: "approved", authVersion: 1 });
    expect(await db.select().from(accountApprovalAudits)).toHaveLength(1);
    expect(await db.select().from(accountNotificationEvents)).toEqual([
      expect.objectContaining({ targetUserId: pending.id, actorUserId: admin.id, eventType: "account_approved", audience: "user" }),
    ]);
    await client.close();
  });

  it("does not treat a normal or workspace-owning account as a platform administrator", async () => {
    const { client, owner, pending, changeAccountStatus, AccountAdministrationError } = await setup();
    await expect(changeAccountStatus(owner.id, pending.id, "approve")).rejects.toBeInstanceOf(AccountAdministrationError);
    await client.close();
  });

  it("prevents self-lockout and protects every platform administrator from queue actions", async () => {
    const { client, admin, secondAdmin, owner, changeAccountStatus, AccountAdministrationError } = await setup();
    await expect(changeAccountStatus(admin.id, admin.id, "suspend")).rejects.toBeInstanceOf(AccountAdministrationError);
    await expect(changeAccountStatus(admin.id, secondAdmin.id, "suspend")).rejects.toBeInstanceOf(AccountAdministrationError);
    await expect(changeAccountStatus(admin.id, owner.id, "suspend")).resolves.toBeUndefined();
    await client.close();
  });

  it("allows only one of two concurrent approval requests to commit", async () => {
    const { client, db, admin, pending, changeAccountStatus } = await setup();
    const outcomes = await Promise.allSettled([
      changeAccountStatus(admin.id, pending.id, "approve"),
      changeAccountStatus(admin.id, pending.id, "approve"),
    ]);
    expect(outcomes.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(await db.select().from(accountApprovalAudits)).toHaveLength(1);
    await client.close();
  });

  it("suspends an approved account and increments its session version", async () => {
    const { client, db, admin, owner, changeAccountStatus } = await setup();
    await changeAccountStatus(admin.id, owner.id, "suspend");
    const [updated] = await db.select().from(users).where(eq(users.id, owner.id));
    expect(updated).toMatchObject({ accountStatus: "suspended", authVersion: 1 });
    await client.close();
  });
});
