import { createHash, randomBytes } from "node:crypto";

export const SHARE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
export const MAX_SHARE_LIFETIME_DAYS = 30;
export const DEFAULT_SHARE_LIFETIME_DAYS = 7;

/** A 256-bit URL-safe secret. Only its hash is stored, so a database read cannot recreate a link. */
export function generateShareToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashShareToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function isWellFormedShareToken(value: unknown): value is string {
  return typeof value === "string" && SHARE_TOKEN_PATTERN.test(value);
}

export function shareExpiry(days: number, now = new Date()): Date {
  const bounded = Math.min(MAX_SHARE_LIFETIME_DAYS, Math.max(1, Math.floor(days)));
  return new Date(now.getTime() + bounded * 24 * 60 * 60 * 1000);
}
