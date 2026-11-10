import { createHmac } from "node:crypto";
import { and, eq, lt, sql } from "drizzle-orm";
import { getServerEnv } from "@/config/env";
import { getDatabase } from "@/server/db";
import { authRateLimitWindows } from "@/server/db/schema";

export type AuthRateLimitKind =
  | "login"
  | "login_ip"
  | "registration"
  | "registration_ip"
  | "verification"
  | "verification_ip"
  | "verification_complete"
  | "password_reset"
  | "password_reset_ip"
  | "password_reset_complete";

const policies = {
  login: { maximumAttempts: 10, windowMs: 15 * 60_000 },
  login_ip: { maximumAttempts: 50, windowMs: 15 * 60_000 },
  registration: { maximumAttempts: 5, windowMs: 60 * 60_000 },
  registration_ip: { maximumAttempts: 20, windowMs: 60 * 60_000 },
  verification: { maximumAttempts: 5, windowMs: 60 * 60_000 },
  verification_ip: { maximumAttempts: 20, windowMs: 60 * 60_000 },
  verification_complete: { maximumAttempts: 10, windowMs: 30 * 60_000 },
  password_reset: { maximumAttempts: 5, windowMs: 60 * 60_000 },
  password_reset_ip: { maximumAttempts: 20, windowMs: 60 * 60_000 },
  password_reset_complete: { maximumAttempts: 10, windowMs: 30 * 60_000 },
} as const satisfies Record<AuthRateLimitKind, { maximumAttempts: number; windowMs: number }>;

export type AuthRateLimitDecision = Readonly<{
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}>;

function hashIdentifier(kind: AuthRateLimitKind, identifier: string, secret: string): string {
  return createHmac("sha256", secret).update(`${kind}:${identifier.trim().toLowerCase()}`).digest("hex");
}

export async function consumeAuthRateLimit(
  kind: AuthRateLimitKind,
  identifier: string,
  now = new Date(),
): Promise<AuthRateLimitDecision> {
  const policy = policies[kind];
  const identifierHash = hashIdentifier(kind, identifier, getServerEnv().AUTH_SECRET);
  const windowStartedAt = new Date(Math.floor(now.getTime() / policy.windowMs) * policy.windowMs);
  const db = getDatabase();
  const retentionMs = Math.max(...Object.values(policies).map((candidate) => candidate.windowMs)) * 2;
  await db.delete(authRateLimitWindows).where(lt(authRateLimitWindows.updatedAt, new Date(now.getTime() - retentionMs)));
  const [row] = await db
    .insert(authRateLimitWindows)
    .values({ kind, identifierHash, windowStartedAt, updatedAt: now })
    .onConflictDoUpdate({
      target: [authRateLimitWindows.kind, authRateLimitWindows.identifierHash, authRateLimitWindows.windowStartedAt],
      set: {
        attempts: sql`${authRateLimitWindows.attempts} + 1`,
        updatedAt: now,
      },
    })
    .returning({ attempts: authRateLimitWindows.attempts });

  if (!row) throw new Error("Authentication rate-limit state was not recorded.");
  const allowed = row.attempts <= policy.maximumAttempts;
  const windowEndsAt = windowStartedAt.getTime() + policy.windowMs;
  return {
    allowed,
    remaining: Math.max(0, policy.maximumAttempts - row.attempts),
    retryAfterSeconds: allowed ? 0 : Math.max(1, Math.ceil((windowEndsAt - now.getTime()) / 1000)),
  };
}

export async function clearAuthRateLimit(kind: AuthRateLimitKind, identifier: string): Promise<void> {
  const identifierHash = hashIdentifier(kind, identifier, getServerEnv().AUTH_SECRET);
  await getDatabase().delete(authRateLimitWindows).where(and(
    eq(authRateLimitWindows.kind, kind),
    eq(authRateLimitWindows.identifierHash, identifierHash),
  ));
}

export async function deleteExpiredAuthRateLimitWindows(now = new Date()): Promise<number> {
  const retentionMs = Math.max(...Object.values(policies).map((policy) => policy.windowMs)) * 2;
  const rows = await getDatabase().delete(authRateLimitWindows)
    .where(lt(authRateLimitWindows.updatedAt, new Date(now.getTime() - retentionMs)))
    .returning({ kind: authRateLimitWindows.kind });
  return rows.length;
}
