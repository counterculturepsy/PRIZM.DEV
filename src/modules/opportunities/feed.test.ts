import { describe, expect, it } from "vitest";
import { severityLabel, summarizeCrmStatus, summarizeRecommendation } from "./feed";

describe("summarizeRecommendation", () => {
  it("never confirms a recommendation without a snapshot", () => {
    expect(summarizeRecommendation({ recordedCount: 0, preferred: null })).toEqual({ kind: "none", serviceLabel: "No service recommendation confirmed", note: "No recommendation snapshot", priceLabel: "Price not recorded" });
  });

  it("shows the recorded preferred service with 'Price not configured' when the snapshot has no price", () => {
    const result = summarizeRecommendation({ recordedCount: 1, preferred: { serviceName: "Ongoing Maintenance", priceStatus: "not_configured", startingPriceMinor: null, averagePriceMinor: null, currency: null } });
    expect(result).toEqual({ kind: "preferred", serviceLabel: "Ongoing Maintenance", note: null, priceLabel: "Price not configured" });
  });

  it("shows recorded price guidance only when the snapshot recorded a valid price", () => {
    const result = summarizeRecommendation({ recordedCount: 2, preferred: { serviceName: "Redesign", priceStatus: "configured", startingPriceMinor: 15_000, averagePriceMinor: 25_000, currency: "ZAR" } });
    expect(result.kind).toBe("preferred");
    expect(result.priceLabel).toMatch(/150.*250/);
    const invalid = summarizeRecommendation({ recordedCount: 1, preferred: { serviceName: "Redesign", priceStatus: "invalid", startingPriceMinor: null, averagePriceMinor: null, currency: null } });
    expect(invalid.priceLabel).toBe("Price unavailable");
  });

  it("confirms nothing and keeps pricing neutral when a snapshot has no preferred service", () => {
    const expected = { kind: "no_preferred", serviceLabel: "No service recommendation confirmed", note: null, priceLabel: "No price shown" };
    expect(summarizeRecommendation({ recordedCount: 1, preferred: null })).toEqual(expected);
    // The number of non-preferred snapshot services is never disclosed.
    expect(summarizeRecommendation({ recordedCount: 3, preferred: null })).toEqual(expected);
  });
});

describe("summarizeCrmStatus", () => {
  it("never calls a missing lead a review status", () => {
    expect(summarizeCrmStatus(null, "opp")).toEqual({ kind: "none", label: "No lead created" });
  });

  it("distinguishes a lead created from this opportunity from another source's company lead", () => {
    expect(summarizeCrmStatus({ status: "qualified", sourceOpportunityId: "opp" }, "opp")).toMatchObject({ kind: "linked", status: "qualified", label: "Lead qualified" });
    expect(summarizeCrmStatus({ status: "new", sourceOpportunityId: "other" }, "opp")).toMatchObject({ kind: "company", status: "new" });
    expect(summarizeCrmStatus({ status: "new", sourceOpportunityId: null }, "opp").kind).toBe("company");
  });
});

describe("severityLabel", () => {
  it("labels each severity and the absence of findings", () => {
    expect(["info", "low", "medium", "high"].map((value) => severityLabel(value as "info"))).toEqual(["Info", "Low", "Medium", "High"]);
    expect(severityLabel(null)).toBe("No linked findings");
  });
});
