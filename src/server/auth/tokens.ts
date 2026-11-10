import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { getServerEnv } from "@/config/env";
import { passwordSchema } from "@/modules/auth/validation";
import { hashPassword } from "@/modules/auth/password";
import { getDatabase } from "@/server/db";
import { authActionTokens, sessions, users } from "@/server/db/schema";
import type { AuthEmailDelivery } from "./email-delivery";
import { getAuthEmailDelivery } from "./email-delivery";
import { recordAuthSecurityEvent } from "./events";

type TokenPurpose = "email_verification" | "password_reset";
type RequestContext = Readonly<{ clientIp?: string | null }>;
type TokenRequestDeps = Readonly<{
  delivery?: AuthEmailDelivery | null;
  now?: Date;
  baseUrl?: string;
  tokenFactory?: () => string;
}>;

const VERIFICATION_TTL_MS = 24 * 60 * 60_000;
const RESET_TTL_MS = 30 * 60_000;

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function secureToken(): string {
  return randomBytes(32).toString("base64url");
}

async function issueToken(
  userId: string,
  purpose: TokenPurpose,
  now: Date,
  ttlMs: number,
  factory: () => string,
): Promise<{ rawToken: string; expiresAt: Date }> {
  const rawToken = factory();
  const expiresAt = new Date(now.getTime() + ttlMs);
  await getDatabase().transaction(async (tx) => {
    await tx.update(authActionTokens).set({ usedAt: now }).where(and(
      eq(authActionTokens.userId, userId),
      eq(authActionTokens.purpose, purpose),
      isNull(authActionTokens.usedAt),
    ));
    await tx.insert(authActionTokens).values({ userId, purpose, tokenHash: tokenHash(rawToken), expiresAt, createdAt: now });
  });
  return { rawToken, expiresAt };
}

export async function requestEmailVerification(
  email: string,
  context: RequestContext = {},
  deps: TokenRequestDeps = {},
): Promise<{ accepted: true; deliveryAvailable: boolean }> {
  const now = deps.now ?? new Date();
  const delivery = deps.delivery === undefined ? getAuthEmailDelivery() : deps.delivery;
  const [user] = await getDatabase().select({ id: users.id, email: users.email, name: users.name, emailVerified: users.emailVerified })
    .from(users).where(eq(users.email, email)).limit(1);
  if (!user || user.emailVerified) {
    await recordAuthSecurityEvent({ eventType: "email_verification_requested", outcome: "accepted", identifier: email, clientIp: context.clientIp });
    return { accepted: true, deliveryAvailable: Boolean(delivery) };
  }
  if (!delivery) {
    await recordAuthSecurityEvent({ eventType: "email_verification_requested", outcome: "delivery_unavailable", userId: user.id, identifier: email, clientIp: context.clientIp });
    return { accepted: true, deliveryAvailable: false };
  }

  const issued = await issueToken(user.id, "email_verification", now, VERIFICATION_TTL_MS, deps.tokenFactory ?? secureToken);
  const url = new URL("/verify-email", deps.baseUrl ?? getServerEnv().NEXTAUTH_URL);
  url.searchParams.set("token", issued.rawToken);
  try {
    await delivery.sendVerification({ email: user.email, name: user.name, verificationUrl: url.toString(), expiresAt: issued.expiresAt });
    await recordAuthSecurityEvent({ eventType: "email_verification_requested", outcome: "delivered", userId: user.id, identifier: email, clientIp: context.clientIp });
  } catch {
    await getDatabase().update(authActionTokens).set({ usedAt: now }).where(eq(authActionTokens.tokenHash, tokenHash(issued.rawToken)));
    await recordAuthSecurityEvent({ eventType: "email_verification_requested", outcome: "delivery_failed", userId: user.id, identifier: email, clientIp: context.clientIp });
  }
  return { accepted: true, deliveryAvailable: true };
}

export async function verifyEmailToken(rawToken: string, context: RequestContext = {}, now = new Date()): Promise<boolean> {
  const hash = tokenHash(rawToken);
  const userId = await getDatabase().transaction(async (tx) => {
    const [claimed] = await tx.update(authActionTokens).set({ usedAt: now }).where(and(
      eq(authActionTokens.tokenHash, hash),
      eq(authActionTokens.purpose, "email_verification"),
      isNull(authActionTokens.usedAt),
      gt(authActionTokens.expiresAt, now),
    )).returning({ userId: authActionTokens.userId });
    if (!claimed) return null;
    await tx.update(users).set({ emailVerified: now, updatedAt: now }).where(eq(users.id, claimed.userId));
    return claimed.userId;
  });
  await recordAuthSecurityEvent({ eventType: "email_verification_completed", outcome: userId ? "success" : "invalid_or_expired", userId, identifier: hash, clientIp: context.clientIp });
  return Boolean(userId);
}

export async function requestPasswordReset(
  email: string,
  context: RequestContext = {},
  deps: TokenRequestDeps = {},
): Promise<{ accepted: true; deliveryAvailable: boolean }> {
  const now = deps.now ?? new Date();
  const delivery = deps.delivery === undefined ? getAuthEmailDelivery() : deps.delivery;
  const [user] = await getDatabase().select({ id: users.id, email: users.email, name: users.name, passwordHash: users.passwordHash })
    .from(users).where(eq(users.email, email)).limit(1);
  if (!user?.passwordHash) {
    await recordAuthSecurityEvent({ eventType: "password_reset_requested", outcome: "accepted", identifier: email, clientIp: context.clientIp });
    return { accepted: true, deliveryAvailable: Boolean(delivery) };
  }
  if (!delivery) {
    await recordAuthSecurityEvent({ eventType: "password_reset_requested", outcome: "delivery_unavailable", userId: user.id, identifier: email, clientIp: context.clientIp });
    return { accepted: true, deliveryAvailable: false };
  }

  const issued = await issueToken(user.id, "password_reset", now, RESET_TTL_MS, deps.tokenFactory ?? secureToken);
  const url = new URL("/reset-password", deps.baseUrl ?? getServerEnv().NEXTAUTH_URL);
  url.searchParams.set("token", issued.rawToken);
  try {
    await delivery.sendPasswordReset({ email: user.email, name: user.name, resetUrl: url.toString(), expiresAt: issued.expiresAt });
    await recordAuthSecurityEvent({ eventType: "password_reset_requested", outcome: "delivered", userId: user.id, identifier: email, clientIp: context.clientIp });
  } catch {
    await getDatabase().update(authActionTokens).set({ usedAt: now }).where(eq(authActionTokens.tokenHash, tokenHash(issued.rawToken)));
    await recordAuthSecurityEvent({ eventType: "password_reset_requested", outcome: "delivery_failed", userId: user.id, identifier: email, clientIp: context.clientIp });
  }
  return { accepted: true, deliveryAvailable: true };
}

export async function resetPasswordWithToken(
  rawToken: string,
  newPassword: string,
  context: RequestContext = {},
  now = new Date(),
): Promise<boolean> {
  const parsedPassword = passwordSchema.safeParse(newPassword);
  if (!parsedPassword.success) return false;
  const hash = tokenHash(rawToken);
  const passwordHash = await hashPassword(parsedPassword.data);
  const userId = await getDatabase().transaction(async (tx) => {
    const [claimed] = await tx.update(authActionTokens).set({ usedAt: now }).where(and(
      eq(authActionTokens.tokenHash, hash),
      eq(authActionTokens.purpose, "password_reset"),
      isNull(authActionTokens.usedAt),
      gt(authActionTokens.expiresAt, now),
    )).returning({ userId: authActionTokens.userId });
    if (!claimed) return null;
    await tx.update(users).set({
      passwordHash,
      authVersion: sql`${users.authVersion} + 1`,
      passwordChangedAt: now,
      updatedAt: now,
    }).where(eq(users.id, claimed.userId));
    await tx.delete(sessions).where(eq(sessions.userId, claimed.userId));
    await tx.update(authActionTokens).set({ usedAt: now }).where(and(
      eq(authActionTokens.userId, claimed.userId),
      isNull(authActionTokens.usedAt),
    ));
    return claimed.userId;
  });
  await recordAuthSecurityEvent({ eventType: "password_reset_completed", outcome: userId ? "success" : "invalid_or_expired", userId, identifier: hash, clientIp: context.clientIp });
  return Boolean(userId);
}
