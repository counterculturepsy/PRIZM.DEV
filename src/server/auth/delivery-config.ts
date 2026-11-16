import { getAuthEmailDelivery, type AuthEmailDelivery } from "./email-delivery";

/**
 * Resolves the configured transactional email delivery, or null when email is unconfigured or
 * misconfigured. A misconfiguration must never turn a public authentication request into a 500, but it
 * must stay visible, so it is logged by error category only (never the message, which may name settings).
 */
export function getConfiguredAuthEmailDelivery(): AuthEmailDelivery | null {
  try {
    return getAuthEmailDelivery();
  } catch (error) {
    console.error("auth_email_delivery_unconfigured", { category: error instanceof Error ? error.name : "unknown" });
    return null;
  }
}
