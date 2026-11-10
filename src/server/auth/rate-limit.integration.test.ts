// @vitest-environment node

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { describe, expect, it, vi } from "vitest";
import { authRateLimitWindows } from "@/server/db/schema";

describe("durable authentication rate limiting", () => {
  it("limits account-targeted attempts without storing the email address and clears successful-login state", async () => {
    const client = new PGlite();
    const db = drizzle(client);
    await migrate(db, { migrationsFolder: "drizzle" });
    vi.resetModules();
    vi.doMock("@/server/db", () => ({ getDatabase: () => db }));
    vi.doMock("@/config/env", () => ({ getServerEnv: () => ({ AUTH_SECRET: "test-auth-secret-that-is-at-least-thirty-two-characters" }) }));
    const limiter = await import("./rate-limit");

    for (let attempt = 1; attempt <= 10; attempt += 1) {
      await expect(limiter.consumeAuthRateLimit("login", " Owner@Example.com ", new Date("2026-11-09T00:01:00Z")))
        .resolves.toMatchObject({ allowed: true, remaining: 10 - attempt });
    }
    await expect(limiter.consumeAuthRateLimit("login", "owner@example.com", new Date("2026-11-09T00:02:00Z")))
      .resolves.toMatchObject({ allowed: false, remaining: 0, retryAfterSeconds: 780 });

    const stored = await db.select().from(authRateLimitWindows);
    expect(stored).toHaveLength(1);
    expect(stored[0]?.identifierHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(stored)).not.toContain("owner@example.com");

    await limiter.clearAuthRateLimit("login", "OWNER@example.com");
    await expect(limiter.consumeAuthRateLimit("login", "owner@example.com", new Date("2026-11-09T00:03:00Z")))
      .resolves.toMatchObject({ allowed: true, remaining: 9 });
    await client.close();
  });

  it("keeps registration and login policies independent and removes expired windows", async () => {
    const client = new PGlite();
    const db = drizzle(client);
    await migrate(db, { migrationsFolder: "drizzle" });
    vi.resetModules();
    vi.doMock("@/server/db", () => ({ getDatabase: () => db }));
    vi.doMock("@/config/env", () => ({ getServerEnv: () => ({ AUTH_SECRET: "test-auth-secret-that-is-at-least-thirty-two-characters" }) }));
    const limiter = await import("./rate-limit");
    const now = new Date("2026-11-09T01:10:00Z");

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(limiter.consumeAuthRateLimit("registration", "new@example.com", now)).resolves.toMatchObject({ allowed: true });
    }
    await expect(limiter.consumeAuthRateLimit("registration", "new@example.com", now)).resolves.toMatchObject({ allowed: false });
    await expect(limiter.consumeAuthRateLimit("login", "new@example.com", now)).resolves.toMatchObject({ allowed: true });

    expect(await limiter.deleteExpiredAuthRateLimitWindows(new Date("2026-11-09T04:00:00Z"))).toBe(2);
    expect(await db.select().from(authRateLimitWindows)).toEqual([]);
    await client.close();
  });
});
