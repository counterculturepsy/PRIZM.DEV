import { describe, expect, it } from "vitest";
import { generateOpportunities, opportunityTypes } from "./generator";
import { resolveRecommendations } from "./mapping";

const accessibility = [{ id: "a", category: "accessibility", confidence: "high" }] as const;

describe("generateOpportunities", () => {
  it("groups findings, preserves weakest confidence, and links evidence", () => {
    const result = generateOpportunities([
      { id: "a", category: "seo", confidence: "high" },
      { id: "b", category: "content", confidence: "medium" },
      { id: "c", category: "security", confidence: "high" },
    ]);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ type: "seo_improvement", confidence: "medium", sourceFindingIds: ["a", "b"] });
    expect(result[1]).toMatchObject({ type: "security_hardening", sourceFindingIds: ["c"] });
  });

  it("keeps an unmapped opportunity valid, with no service, price or recommendations", () => {
    expect(generateOpportunities(accessibility)[0]).toMatchObject({
      type: "accessibility_remediation",
      recommendations: [],
      serviceId: null,
      estimatedValueMinMinor: null,
      estimatedValueMaxMinor: null,
    });
  });

  it("recommends and links a preferred service even when it has no configured price", () => {
    const recommendations = resolveRecommendations(
      [{ serviceId: "s1", isPreferred: true }],
      [{ id: "s1", name: "Website Redesign", active: true, startingPriceMinor: null, averagePriceMinor: null }],
      "ZAR",
    );
    const [result] = generateOpportunities(accessibility, { accessibility_remediation: recommendations });
    expect(result).toMatchObject({ serviceId: "s1", estimatedValueMinMinor: null, estimatedValueMaxMinor: null });
    expect(result?.recommendations).toEqual([expect.objectContaining({ serviceId: "s1", priceStatus: "not_configured", currency: null })]);
  });

  it("takes price guidance only from the preferred service and never aggregates", () => {
    const recommendations = resolveRecommendations(
      [{ serviceId: "cheap", isPreferred: false }, { serviceId: "pref", isPreferred: true }],
      [
        { id: "cheap", name: "A service", active: true, startingPriceMinor: 1_000, averagePriceMinor: 2_000 },
        { id: "pref", name: "B service", active: true, startingPriceMinor: 15_000, averagePriceMinor: 25_000 },
      ],
      "ZAR",
    );
    const [result] = generateOpportunities(accessibility, { accessibility_remediation: recommendations });
    expect(result).toMatchObject({ serviceId: "pref", estimatedValueMinMinor: 15_000, estimatedValueMaxMinor: 25_000 });
    const withoutPreferred = resolveRecommendations([{ serviceId: "cheap", isPreferred: false }], [
      { id: "cheap", name: "A service", active: true, startingPriceMinor: 1_000, averagePriceMinor: 2_000 },
    ], "ZAR");
    expect(generateOpportunities(accessibility, { accessibility_remediation: withoutPreferred })[0])
      .toMatchObject({ serviceId: null, estimatedValueMinMinor: null, estimatedValueMaxMinor: null });
  });

  it("does not let recommendations change evidence or confidence", () => {
    const findings = [{ id: "a", category: "security", confidence: "low" }] as const;
    const recommendations = resolveRecommendations([{ serviceId: "s", isPreferred: true }], [
      { id: "s", name: "Maintenance", active: true, startingPriceMinor: 5_000, averagePriceMinor: 9_000 },
    ], "ZAR");
    const [bare] = generateOpportunities(findings);
    const [mapped] = generateOpportunities(findings, { security_hardening: recommendations });
    expect(mapped).toMatchObject({ confidence: bare?.confidence, sourceFindingIds: bare?.sourceFindingIds, summary: bare?.summary });
  });

  it("defines every opportunity type", () => {
    expect(opportunityTypes).toHaveLength(6);
  });
});
