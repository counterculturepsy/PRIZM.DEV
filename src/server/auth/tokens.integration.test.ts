// @vitest-environment node

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { hashPassword, verifyPassword } from "@/modules/auth/password";
import { authActionTokens, authSecurityEvents, sessions, users } from "@/server/db/schema";
import type { AuthEmailDelivery } from "./email-delivery";

describe("authentication action tokens", () => {
  it("verifies email once without storing the raw token", async () => {
    const client = new PGlite();
    const db = drizzle(client);
    await migrate(db, { migrationsFolder: "drizzle" });
    const [user] = await db.insert(users).values({ email: "verify@example.com", passwordHash: await hashPassword("InitialPassword123") }).returning();
    if (!user) throw new Error("user fixture");
    const deliveries: string[] = [];
    const delivery: AuthEmailDelivery = {
      async sendVerification(input) { deliveries.push(input.verificationUrl); },
      async sendPasswordReset() { throw new Error("unexpected reset"); },
      async sendAccountStatus() { throw new Error("unexpected account status"); },
      async sendPendingRegistration() { throw new Error("unexpected registration notification"); },
    };
    vi.resetModules();
    vi.doMock("@/server/db", () => ({ getDatabase: () => db }));
    vi.doMock("@/config/env", () => ({ getServerEnv: () => ({ AUTH_SECRET: "test-auth-secret-that-is-at-least-thirty-two-characters", NEXTAUTH_URL: "https://app.example.test" }) }));
    const tokens = await import("./tokens");
    const rawToken = "v".repeat(43);

    await expect(tokens.requestEmailVerification(user.email, {}, { delivery, now: new Date("2026-11-09T08:00:00Z"), tokenFactory: () => rawToken }))
      .resolves.toEqual({ accepted: true, deliveryOutcome: "provider_accepted" });
    expect(deliveries).toEqual([`https://app.example.test/verify-email?token=${rawToken}`]);
    const stored = await db.select().from(authActionTokens);
    expect(stored).toHaveLength(1);
    expect(stored[0]?.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(stored)).not.toContain(rawToken);

    await expect(tokens.verifyEmailToken(rawToken, {}, new Date("2026-11-09T08:05:00Z"))).resolves.toBe(true);
    await expect(tokens.verifyEmailToken(rawToken, {}, new Date("2026-11-09T08:06:00Z"))).resolves.toBe(false);
    const [verified] = await db.select({ emailVerified: users.emailVerified }).from(users).where(eq(users.id, user.id));
    expect(verified?.emailVerified?.toISOString()).toBe("2026-11-09T08:05:00.000Z");
    const events = await db.select().from(authSecurityEvents);
    expect(events).toContainEqual(expect.objectContaining({ eventType: "email_verification_requested", outcome: "provider_accepted" }));
    expect(JSON.stringify(events)).not.toContain(user.email);
    await client.close();
  });

  it("resets a password once, increments the session version and deletes database sessions", async () => {
    const client = new PGlite();
    const db = drizzle(client);
    await migrate(db, { migrationsFolder: "drizzle" });
    const oldPassword = "InitialPassword123";
    const newPassword = "ReplacementPassword456";
    const [user] = await db.insert(users).values({ email: "reset@example.com", passwordHash: await hashPassword(oldPassword) }).returning();
    if (!user) throw new Error("user fixture");
    await db.insert(sessions).values({ sessionToken: "database-session", userId: user.id, expires: new Date("2026-12-01T00:00:00Z") });
    let resetUrl = "";
    const delivery: AuthEmailDelivery = {
      async sendVerification() { throw new Error("unexpected verification"); },
      async sendPasswordReset(input) { resetUrl = input.resetUrl; },
      async sendAccountStatus() { throw new Error("unexpected account status"); },
      async sendPendingRegistration() { throw new Error("unexpected registration notification"); },
    };
    vi.resetModules();
    vi.doMock("@/server/db", () => ({ getDatabase: () => db }));
    vi.doMock("@/config/env", () => ({ getServerEnv: () => ({ AUTH_SECRET: "test-auth-secret-that-is-at-least-thirty-two-characters", NEXTAUTH_URL: "https://app.example.test" }) }));
    const tokens = await import("./tokens");
    const rawToken = "r".repeat(43);

    await expect(tokens.requestPasswordReset(user.email, {}, { delivery, now: new Date("2026-11-09T09:00:00Z"), tokenFactory: () => rawToken }))
      .resolves.toEqual({ accepted: true, deliveryOutcome: "provider_accepted" });
    expect(resetUrl).toBe(`https://app.example.test/reset-password?token=${rawToken}`);
    await expect(tokens.resetPasswordWithToken(rawToken, newPassword, {}, new Date("2026-11-09T09:05:00Z"))).resolves.toBe(true);
    await expect(tokens.resetPasswordWithToken(rawToken, newPassword, {}, new Date("2026-11-09T09:06:00Z"))).resolves.toBe(false);

    const [updated] = await db.select().from(users).where(eq(users.id, user.id));
    expect(updated?.authVersion).toBe(1);
    expect(updated?.passwordChangedAt?.toISOString()).toBe("2026-11-09T09:05:00.000Z");
    expect(await verifyPassword(newPassword, updated?.passwordHash ?? "")).toBe(true);
    expect(await verifyPassword(oldPassword, updated?.passwordHash ?? "")).toBe(false);
    expect(await db.select().from(sessions)).toEqual([]);
    expect(await db.select().from(authSecurityEvents)).toContainEqual(expect.objectContaining({ eventType: "password_reset_requested", outcome: "provider_accepted" }));
    await client.close();
  });

  it("does not issue tokens when delivery is disabled and gives unknown accounts the same accepted result", async () => {
    const client = new PGlite();
    const db = drizzle(client);
    await migrate(db, { migrationsFolder: "drizzle" });
    await db.insert(users).values({ email: "known@example.com", passwordHash: await hashPassword("InitialPassword123") });
    vi.resetModules();
    vi.doMock("@/server/db", () => ({ getDatabase: () => db }));
    vi.doMock("@/config/env", () => ({ getServerEnv: () => ({ AUTH_SECRET: "test-auth-secret-that-is-at-least-thirty-two-characters", NEXTAUTH_URL: "https://app.example.test" }) }));
    const tokens = await import("./tokens");

    await expect(tokens.requestPasswordReset("known@example.com", {}, { delivery: null })).resolves.toEqual({ accepted: true, deliveryOutcome: "provider_unavailable" });
    await expect(tokens.requestPasswordReset("missing@example.com", {}, { delivery: null })).resolves.toEqual({ accepted: true, deliveryOutcome: "ineligible" });
    await expect(tokens.requestEmailVerification("known@example.com", {}, { delivery: null })).resolves.toEqual({ accepted: true, deliveryOutcome: "provider_unavailable" });
    expect(await db.select().from(authActionTokens)).toEqual([]);
    expect(JSON.stringify(await db.select().from(authSecurityEvents))).not.toContain("example.com");
    await client.close();
  });

  it("invalidates the action token when the selected provider cannot deliver it", async () => {
    const client = new PGlite();
    const db = drizzle(client);
    await migrate(db, { migrationsFolder: "drizzle" });
    const [user] = await db.insert(users).values({
      email: "undeliverable@example.com",
      passwordHash: await hashPassword("InitialPassword123"),
    }).returning();
    if (!user) throw new Error("user fixture");
    const delivery: AuthEmailDelivery = {
      async sendVerification() { throw new Error("provider rejected request"); },
      async sendPasswordReset() { throw new Error("provider rejected request"); },
      async sendAccountStatus() { throw new Error("unexpected account status"); },
      async sendPendingRegistration() { throw new Error("unexpected registration notification"); },
    };
    vi.resetModules();
    vi.doMock("@/server/db", () => ({ getDatabase: () => db }));
    vi.doMock("@/config/env", () => ({ getServerEnv: () => ({ AUTH_SECRET: "test-auth-secret-that-is-at-least-thirty-two-characters", NEXTAUTH_URL: "https://app.example.test" }) }));
    const tokens = await import("./tokens");
    const rawToken = "u".repeat(43);
    const now = new Date("2026-11-12T10:00:00Z");

    await expect(tokens.requestEmailVerification(user.email, {}, { delivery, now, tokenFactory: () => rawToken }))
      .resolves.toEqual({ accepted: true, deliveryOutcome: "provider_failed" });
    await expect(tokens.verifyEmailToken(rawToken, {}, new Date("2026-11-12T10:01:00Z"))).resolves.toBe(false);
    const [stored] = await db.select().from(authActionTokens);
    expect(stored?.usedAt?.toISOString()).toBe(now.toISOString());
    expect(stored?.tokenHash).not.toBe(rawToken);
    await client.close();
  });

  it("distinguishes internal outcomes while cancelling failed tokens and recording delivery_failed", async () => {
    const client = new PGlite();
    const db = drizzle(client);
    await migrate(db, { migrationsFolder: "drizzle" });
    await db.insert(users).values([
      { email: "failing@example.test", passwordHash: await hashPassword("InitialPassword123") },
      { email: "verified@example.test", passwordHash: await hashPassword("InitialPassword123"), emailVerified: new Date("2026-11-01T00:00:00Z") },
    ]);
    const delivery: AuthEmailDelivery = {
      async sendVerification() { throw new Error("provider rejected request"); },
      async sendPasswordReset() { throw new Error("provider rejected request"); },
      async sendAccountStatus() { throw new Error("unexpected account status"); },
      async sendPendingRegistration() { throw new Error("unexpected registration notification"); },
    };
    vi.resetModules();
    vi.doMock("@/server/db", () => ({ getDatabase: () => db }));
    vi.doMock("@/config/env", () => ({ getServerEnv: () => ({ AUTH_SECRET: "test-auth-secret-that-is-at-least-thirty-two-characters", NEXTAUTH_URL: "https://app.example.test" }) }));
    const tokens = await import("./tokens");
    const now = new Date("2026-11-13T10:00:00Z");
    let counter = 0;
    const deps = { delivery, now, tokenFactory: () => String(counter++).padStart(43, "t") };

    const failedVerification = await tokens.requestEmailVerification("failing@example.test", {}, deps);
    const unknownVerification = await tokens.requestEmailVerification("missing@example.test", {}, deps);
    const verifiedVerification = await tokens.requestEmailVerification("verified@example.test", {}, deps);
    expect(failedVerification).toEqual({ accepted: true, deliveryOutcome: "provider_failed" });
    expect(unknownVerification).toEqual({ accepted: true, deliveryOutcome: "ineligible" });
    expect(verifiedVerification).toEqual({ accepted: true, deliveryOutcome: "ineligible" });

    const failedReset = await tokens.requestPasswordReset("failing@example.test", {}, deps);
    const unknownReset = await tokens.requestPasswordReset("missing@example.test", {}, deps);
    expect(failedReset).toEqual({ accepted: true, deliveryOutcome: "provider_failed" });
    expect(unknownReset).toEqual({ accepted: true, deliveryOutcome: "ineligible" });

    const issued = await db.select().from(authActionTokens);
    expect(issued.map((token) => token.purpose).sort()).toEqual(["email_verification", "password_reset"]);
    expect(issued.every((token) => token.usedAt?.toISOString() === now.toISOString())).toBe(true);

    const failures = await db.select().from(authSecurityEvents).where(eq(authSecurityEvents.outcome, "delivery_failed"));
    expect(failures.map((event) => event.eventType).sort()).toEqual(["email_verification_requested", "password_reset_requested"]);
    expect(JSON.stringify(await db.select().from(authSecurityEvents))).not.toContain("example.test");
    await client.close();
  });
});
