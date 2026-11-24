/**
 * TEST-ONLY email mode.
 *
 * A temporary configuration for exercising the real Resend integration without a verified domain, using Resend's
 * shared test sender (`onboarding@resend.dev`). It is NOT production-ready email delivery: every message is sent only
 * to an explicit allowlist, is visibly marked, and the mode is refused in a Production environment.
 *
 * Pure functions only, so environment validation and the delivery layer can share the exact same rules.
 */

/** Resend's shared test sender may only deliver to the Resend account owner, so it is never a customer-facing sender. */
export const TEST_SENDER_DOMAIN = "resend.dev";
export const TEST_ONLY_SUBJECT_PREFIX = "[TEST-ONLY] ";
export const TEST_ONLY_BANNER_TEXT = "TEST-ONLY: sent by a temporary test configuration of PRIZM.DEV. This is not production email.";

export class TestModeRecipientBlockedError extends Error {
  constructor() {
    super("Email was not sent: the recipient is not on the test-mode allowlist.");
    this.name = "TestModeRecipientBlockedError";
  }
}

/** The bare address of `Name <user@host>` or `user@host`, lower-cased, or null when no address can be read. */
export function addressOf(identity: string | undefined | null): string | null {
  if (!identity) return null;
  const match = identity.trim().match(/^(?:[^<>]*<([^<>\s]+)>|([^<>\s]+))$/);
  const address = (match?.[1] ?? match?.[2])?.trim().toLowerCase();
  return address && address.includes("@") ? address : null;
}

/** Splits a comma, semicolon or whitespace separated list into unique lower-case addresses. */
export function parseTestAllowlist(raw: string | undefined | null): readonly string[] {
  if (!raw) return [];
  return [...new Set(raw.split(/[\s,;]+/).map((entry) => entry.trim().toLowerCase()).filter(Boolean))];
}

export function isSenderOnTestDomain(from: string | undefined | null): boolean {
  const address = addressOf(from);
  return address !== null && address.endsWith(`@${TEST_SENDER_DOMAIN}`);
}

/** Exact, case-insensitive match only: no wildcards, no domains, no plus-address expansion. */
export function isAllowlisted(allowlist: readonly string[], recipient: string): boolean {
  const address = addressOf(recipient);
  return address !== null && allowlist.includes(address);
}

export function guardTestRecipient(allowlist: readonly string[], recipient: string): void {
  if (!isAllowlisted(allowlist, recipient)) throw new TestModeRecipientBlockedError();
}

type Message = Readonly<{ subject: string; html: string; text: string }>;

/** Marks a message so a test email can never be mistaken for real delivery. */
export function markTestMessage<T extends Message>(message: T): T {
  const banner = `<p style="margin:0 0 16px;padding:10px 12px;border:1px solid #b45309;background:#fffbeb;color:#92400e;font:600 13px/1.4 sans-serif">${TEST_ONLY_BANNER_TEXT}</p>`;
  const html = /<body[^>]*>/i.test(message.html)
    ? message.html.replace(/<body[^>]*>/i, (tag) => `${tag}${banner}`)
    : `${banner}${message.html}`;
  return { ...message, subject: `${TEST_ONLY_SUBJECT_PREFIX}${message.subject}`, html, text: `${TEST_ONLY_BANNER_TEXT}\n\n${message.text}` };
}
