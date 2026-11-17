import { describe, expect, it } from "vitest";
import {
  createContactSchema,
  dealLifecycle,
  normalizeEmail,
  normalizePhone,
  parseMoneyMinor,
  updateDealStageSchema,
  updateLeadDetailsSchema,
} from "./validation";

const leadId = "00000000-0000-4000-8000-000000000001";

describe("CRM validation", () => {
  it("normalizes contact identifiers without inventing data", () => {
    expect(normalizeEmail(" Sales@Example.COM ")).toBe("sales@example.com");
    expect(normalizePhone("+27 (82) 123-4567")).toBe("+27821234567");
    expect(normalizePhone("123")).toBeNull();
  });

  it("requires an attributed contact method", () => {
    const base = { leadId, firstName: "Ari", sourceKind: "user_supplied", sourceLabel: "Client referral", confidence: "medium" };
    expect(createContactSchema.safeParse(base).success).toBe(false);
    expect(createContactSchema.safeParse({ ...base, email: "ari@example.com" }).success).toBe(true);
    expect(createContactSchema.safeParse({ ...base, email: "not-an-email" }).success).toBe(false);
  });

  it("requires a loss reason and controls closed timestamps", () => {
    expect(updateDealStageSchema.safeParse({ leadId, stage: "lost" }).success).toBe(false);
    expect(updateDealStageSchema.safeParse({ leadId, stage: "lost", lostReason: "Budget paused" }).success).toBe(true);
    const now = new Date("2026-10-17T12:00:00Z");
    expect(dealLifecycle("won", now).closedAt).toEqual(now);
    expect(dealLifecycle("discovery", now).closedAt).toBeNull();
  });

  it("parses money to minor units exactly and rejects ambiguous input", () => {
    expect(parseMoneyMinor("")).toBeNull();
    expect(parseMoneyMinor("0")).toBe(0);
    expect(parseMoneyMinor("12500")).toBe(1_250_000);
    expect(parseMoneyMinor("12 500,5")).toBe(1_250_050);
    expect(parseMoneyMinor("0.07")).toBe(7);
    expect(parseMoneyMinor("1.005")).toBeUndefined();
    expect(parseMoneyMinor("-5")).toBeUndefined();
    expect(parseMoneyMinor("12345678")).toBeUndefined();
    expect(parseMoneyMinor("1e5")).toBeUndefined();
    expect(parseMoneyMinor("R100")).toBeUndefined();
  });

  it("validates and normalizes lead detail edits", () => {
    const valid = { leadId, expectedUpdatedAt: "2026-11-17T08:00:00.000Z", title: "  Brand platform  ", ownerUserId: "", dealValue: "12 500,50", currency: "zar", expectedCloseDate: "2026-12-31" };
    const parsed = updateLeadDetailsSchema.safeParse(valid);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).toMatchObject({ title: "Brand platform", ownerUserId: null, dealValueMinor: 1_250_050, currency: "ZAR" });
      expect(parsed.data.expectedCloseAt?.toISOString()).toBe("2026-12-31T00:00:00.000Z");
    }
    const cleared = updateLeadDetailsSchema.safeParse({ ...valid, dealValue: "", expectedCloseDate: "" });
    expect(cleared.success && cleared.data.dealValueMinor === null && cleared.data.expectedCloseAt === null).toBe(true);
    for (const bad of [{ currency: "ZA" }, { currency: "ZAR1" }, { dealValue: "abc" }, { title: "x" }, { expectedCloseDate: "31/12/2026" }, { expectedUpdatedAt: "yesterday" }, { leadId: "nope" }, { ownerUserId: "not-a-uuid" }]) {
      expect(updateLeadDetailsSchema.safeParse({ ...valid, ...bad }).success).toBe(false);
    }
  });
});
