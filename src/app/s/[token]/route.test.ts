// @vitest-environment node

import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { describe, expect, it, vi } from "vitest";
import { createWorkspaceScope } from "@/modules/workspaces/scope";
import { kitShareLinks, users, workspaceMembers, workspaces } from "@/server/db/schema";

async function setup(clientIp: { value: string | null }) {
  const client = new PGlite();
  const db = drizzle(client);
  await migrate(db, { migrationsFolder: "drizzle" });
  const [owner] = await db.insert(users).values([{ email: "route-owner@example.com", name: "Olivia Owner" }]).returning();
  const [alpha] = await db.insert(workspaces).values([{ name: "Alpha", slug: "route-alpha" }]).returning();
  if (!owner || !alpha) throw new Error("fixtures");
  await db.insert(workspaceMembers).values({ workspaceId: alpha.id, userId: owner.id, role: "owner", status: "active" });

  vi.resetModules();
  vi.doMock("@/server/db", () => ({ getDatabase: () => db }));
  vi.doMock("@/config/env", () => ({ getServerEnv: () => ({ AUTH_SECRET: "route-test-secret-that-is-longer-than-32-characters" }) }));
  vi.doMock("@/server/auth/request-security", () => ({ trustedClientIp: () => clientIp.value }));
  const library = await import("@/server/kits/library");
  const packs = await import("@/server/kits/packs");
  const route = await import("./route");
  const scope = createWorkspaceScope({ workspaceId: alpha.id, userId: owner.id, role: "owner" });
  const kit = await library.createCapabilityKit(scope, { name: "Kit", content: { profile: { displayName: "Ada Developer" } } });
  const pack = await packs.createKitPack(scope, { kitId: kit.kitId, templateKey: "partnership_introduction", title: "Partner pack", recipientName: "Sam Partner", caseStudyIds: [], assetIds: [] });
  await packs.approveKitPack(scope, pack.packId);
  const get = (token: string) => route.GET(new Request(`http://localhost/s/${token}`), { params: Promise.resolve({ token }) });
  return { client, db, packs, scope, packId: pack.packId, get };
}

describe("public share route", () => {
  it("serves an approved pack's PDF privately, and treats expired, revoked and unknown links identically", async () => {
    const ip = { value: "198.51.100.10" as string | null };
    const t = await setup(ip);
    const link = await t.packs.createKitShareLink(t.scope, { packId: t.packId });
    const ok = await t.get(link.token);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toBe("application/pdf");
    expect(ok.headers.get("cache-control")).toBe("private, no-store");
    expect(ok.headers.get("x-content-type-options")).toBe("nosniff");
    expect(ok.headers.get("content-disposition")).toMatch(/^attachment; filename="Partner pack\.pdf"/);
    expect(Buffer.from(await ok.arrayBuffer()).subarray(0, 5).toString()).toBe("%PDF-");

    const unknown = await t.get("A".repeat(43));
    const malformed = await t.get("short");
    const revoked = await t.packs.createKitShareLink(t.scope, { packId: t.packId });
    await t.packs.revokeKitShareLink(t.scope, revoked.linkId);
    const expired = await t.packs.createKitShareLink(t.scope, { packId: t.packId });
    await t.db.update(kitShareLinks).set({ createdAt: new Date(Date.now() - 3 * 86_400_000), expiresAt: new Date(Date.now() - 86_400_000) }).where(eq(kitShareLinks.id, expired.linkId));
    const responses = [unknown, malformed, await t.get(revoked.token), await t.get(expired.token)];
    for (const response of responses) {
      expect(response.status).toBe(404);
      expect(await response.text()).toBe("This item is unavailable.");
    }
    await t.client.close();
  });

  it("rate limits repeated requests from one address before any lookup, and not other addresses", async () => {
    const ip = { value: "203.0.113.7" as string | null };
    const t = await setup(ip);
    const guess = "B".repeat(43);
    for (let attempt = 1; attempt <= 30; attempt += 1) expect((await t.get(guess)).status).toBe(404);
    const limited = await t.get(guess);
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
    expect(await limited.text()).toBe("Too many requests. Try again later.");
    // A valid link is refused for the limited address too, so the limiter cannot be used as an oracle.
    const link = await t.packs.createKitShareLink(t.scope, { packId: t.packId });
    expect((await t.get(link.token)).status).toBe(429);

    ip.value = "203.0.113.8";
    expect((await t.get(guess)).status).toBe(404);
    expect((await t.get(link.token)).status).toBe(200);
    // Without a trustworthy client address (local development) the limiter does not apply.
    ip.value = null;
    for (let attempt = 0; attempt < 35; attempt += 1) expect((await t.get(guess)).status).toBe(404);
    await t.client.close();
  });
});
