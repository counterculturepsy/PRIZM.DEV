import { describe, expect, it } from "vitest";
import { AUDIT_QUEUE_LIMITS, evaluateAuditQueueLimit } from "./queue-limits";

describe("audit queue limits", () => {
  it("allows requests under both caps", () => {
    expect(evaluateAuditQueueLimit({ active: 0, requestedLast24h: 0 })).toBeNull();
    expect(evaluateAuditQueueLimit({ active: AUDIT_QUEUE_LIMITS.maxActive - 1, requestedLast24h: AUDIT_QUEUE_LIMITS.maxPerDay - 1 })).toBeNull();
  });

  it("blocks at the waiting cap and at the daily cap with a clear reason", () => {
    expect(evaluateAuditQueueLimit({ active: AUDIT_QUEUE_LIMITS.maxActive, requestedLast24h: 0 })).toContain("already waiting or running");
    expect(evaluateAuditQueueLimit({ active: 0, requestedLast24h: AUDIT_QUEUE_LIMITS.maxPerDay })).toContain("in 24 hours");
    expect(evaluateAuditQueueLimit({ active: 3, requestedLast24h: 8 }, { maxActive: 3, maxPerDay: 100 })).toContain("3 audits");
  });
});
