import { getServerEnv } from "@/config/env";

/**
 * Whether website auditing is enabled for this deployment.
 * Fails closed: an unreadable or invalid server environment is treated as disabled, and the reason is never exposed to users.
 */
export function isWebsiteAuditingEnabled(): boolean {
  try {
    return getServerEnv().WEBSITE_AUDIT_ENABLED;
  } catch {
    return false;
  }
}
