/** Per-workspace caps on website audit requests, so a click-happy session cannot queue hundreds of third-party requests. */
export const AUDIT_QUEUE_LIMITS = { maxActive: 10, maxPerDay: 50 };

export type AuditQueueLimits = Readonly<typeof AUDIT_QUEUE_LIMITS>;
export type AuditQueueUsage = Readonly<{ active: number; requestedLast24h: number }>;

/** Returns a user-facing reason when another audit may not be queued, or null when it may. */
export function evaluateAuditQueueLimit(usage: AuditQueueUsage, limits: AuditQueueLimits = AUDIT_QUEUE_LIMITS): string | null {
  if (usage.active >= limits.maxActive) {
    return `${limits.maxActive} audits are already waiting or running. Let some finish before requesting more.`;
  }
  if (usage.requestedLast24h >= limits.maxPerDay) {
    return `This workspace reached its limit of ${limits.maxPerDay} audit requests in 24 hours. Try again later.`;
  }
  return null;
}
