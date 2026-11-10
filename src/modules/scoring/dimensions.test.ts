import { describe, expect, it } from "vitest";
import { calculateLeadScore } from "./engine";
import { buildAssessment, type AssessmentInput } from "./dimensions";

function assess(overrides: { industry?: string | null; city?: string | null; email?: string | null; phone?: string | null; icp?: { industries: string[]; cities: string[] } | null; auditScore?: number | null; status?: string }) {
  const company = { industry: "Hospitality", city: "Stellenbosch", email: null, phone: null, ...overrides };
  const icp = overrides.icp === undefined ? { industries: ["Hospitality"], cities: ["Stellenbosch"] } : overrides.icp;
  const findings = [{ id: "f1", category: "security", scoreImpact: 6 }];
  const score = calculateLeadScore({ findings, company, icp });
  const input: AssessmentInput = {
    components: score.components,
    company: { industry: company.industry, city: company.city, hasEmail: Boolean(company.email), hasPhone: Boolean(company.phone) },
    icp: icp ? { industryCount: icp.industries.length, cityCount: icp.cities.length } : null,
    audit: { score: overrides.auditScore === undefined ? 88 : overrides.auditScore, status: overrides.status ?? "completed" },
    findingConfidence: { high: 1, medium: 2, low: 0 },
  };
  return { score, assessment: buildAssessment(input) };
}

const check = (result: ReturnType<typeof assess>, key: "industry" | "city" | "contact") =>
  result.assessment.prospectSuitability.checks.find((item) => item.key === key);

describe("buildAssessment", () => {
  it("keeps website health, observed need, suitability and evidence quality separate", () => {
    const result = assess({ email: "hello@example.test" });
    expect(result.assessment.websiteHealth.score).toBe(88);
    expect(result.assessment.observedNeed).toMatchObject({ points: 8, maxPoints: 70 });
    expect(result.assessment.prospectSuitability).toMatchObject({ points: 30, maxPoints: 30 });
    expect(result.assessment.evidenceQuality).toMatchObject({ high: 1, medium: 2, low: 0, total: 3 });
  });

  it("does not change the lead-v1 total: need plus suitability equals the stored score", () => {
    const result = assess({ email: "hello@example.test" });
    expect(result.assessment.observedNeed.points + result.assessment.prospectSuitability.points).toBe(result.score.totalScore);
  });

  it("separates a verified negative match from missing data", () => {
    const mismatch = assess({ industry: "Mining", city: "Durban" });
    expect(check(mismatch, "industry")?.assessment).toBe("negative");
    expect(check(mismatch, "city")?.assessment).toBe("negative");

    const absent = assess({ industry: null, city: null });
    expect(check(absent, "industry")?.assessment).toBe("missing");
    expect(check(absent, "city")?.assessment).toBe("missing");

    const noIcp = assess({ icp: null });
    expect(check(noIcp, "industry")?.assessment).toBe("missing");
    const emptyIcp = assess({ icp: { industries: [], cities: [] } });
    expect(check(emptyIcp, "city")?.assessment).toBe("missing");
  });

  it("treats absent contact details as missing data, never as a negative result", () => {
    expect(check(assess({}), "contact")?.assessment).toBe("missing");
    expect(check(assess({ phone: "+27 21 555 0100" }), "contact")?.assessment).toBe("positive");
  });

  it("reports an unscored audit and a partial audit honestly", () => {
    expect(assess({ auditScore: null }).assessment.websiteHealth.score).toBeNull();
    expect(assess({ status: "partial" }).assessment.evidenceQuality.detail).toMatch(/partial/i);
  });
});
