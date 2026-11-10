/**
 * Presentation-only view of a stored lead score. It regroups the existing lead-v1 components into
 * four separate concepts and labels each fit check as positive, negative or missing. It never
 * recalculates or alters the score.
 */

/** `negative` is a verified mismatch; `missing` means the data needed to judge was not available. */
export type Assessment = "positive" | "negative" | "missing";

export type StoredScoreComponent = Readonly<{
  key: string;
  label: string;
  points: number;
  maxPoints: number;
  reason: string;
}>;

export type AssessmentInput = Readonly<{
  components: readonly StoredScoreComponent[];
  company: Readonly<{ industry: string | null; city: string | null; hasEmail: boolean; hasPhone: boolean }>;
  /** Counts of configured ICP entries; null when the workspace has no ICP record. */
  icp: Readonly<{ industryCount: number; cityCount: number }> | null;
  audit: Readonly<{ score: number | null; status: string }>;
  findingConfidence: Readonly<{ high: number; medium: number; low: number }>;
}>;

export type FitCheck = Readonly<{ key: "industry" | "city" | "contact"; label: string; assessment: Assessment; detail: string }>;

export type OpportunityAssessment = Readonly<{
  websiteHealth: Readonly<{ score: number | null; detail: string }>;
  observedNeed: Readonly<{ points: number; maxPoints: number; detail: string }>;
  prospectSuitability: Readonly<{ points: number; maxPoints: number; checks: FitCheck[] }>;
  evidenceQuality: Readonly<{ high: number; medium: number; low: number; total: number; detail: string }>;
}>;

function component(components: readonly StoredScoreComponent[], key: string) {
  return components.find((item) => item.key === key);
}

function fitCheck(
  key: "industry" | "city",
  label: string,
  value: string | null,
  configuredCount: number | null,
  matched: boolean,
): FitCheck {
  if (!value?.trim()) return { key, label, assessment: "missing", detail: `No ${key} is recorded for this company, so the fit could not be judged.` };
  if (configuredCount === null || configuredCount === 0) return { key, label, assessment: "missing", detail: `Your ideal customer profile lists no target ${key === "industry" ? "industries" : "cities"}, so the fit could not be judged.` };
  return matched
    ? { key, label, assessment: "positive", detail: `${value} is among your target ${key === "industry" ? "industries" : "cities"}.` }
    : { key, label, assessment: "negative", detail: `${value} is not among your target ${key === "industry" ? "industries" : "cities"}.` };
}

export function buildAssessment(input: AssessmentInput): OpportunityAssessment {
  const need = component(input.components, "audit_need");
  const breadth = component(input.components, "evidence_breadth");
  const industry = component(input.components, "industry_match");
  const city = component(input.components, "city_match");
  const contact = component(input.components, "contact_readiness");
  const hasContact = input.company.hasEmail || input.company.hasPhone;
  const total = input.findingConfidence.high + input.findingConfidence.medium + input.findingConfidence.low;

  return {
    websiteHealth: {
      score: input.audit.score,
      detail: input.audit.score === null
        ? "The audit did not produce a diagnostic score."
        : "Diagnostic score from the audited page; higher is healthier. It describes the site, not the prospect.",
    },
    observedNeed: {
      points: (need?.points ?? 0) + (breadth?.points ?? 0),
      maxPoints: (need?.maxPoints ?? 0) + (breadth?.maxPoints ?? 0),
      detail: "Points from what the audit observed; a larger number means more issues worth discussing.",
    },
    prospectSuitability: {
      points: (industry?.points ?? 0) + (city?.points ?? 0) + (contact?.points ?? 0),
      maxPoints: (industry?.maxPoints ?? 0) + (city?.maxPoints ?? 0) + (contact?.maxPoints ?? 0),
      checks: [
        fitCheck("industry", "Target industry", input.company.industry, input.icp?.industryCount ?? null, (industry?.points ?? 0) > 0),
        fitCheck("city", "Target city", input.company.city, input.icp?.cityCount ?? null, (city?.points ?? 0) > 0),
        hasContact
          ? { key: "contact", label: "Public contact", assessment: "positive", detail: "The imported record includes a public email or phone number." }
          : { key: "contact", label: "Public contact", assessment: "missing", detail: "No public contact was supplied in the imported record; this does not show that none exists." },
      ],
    },
    evidenceQuality: {
      high: input.findingConfidence.high,
      medium: input.findingConfidence.medium,
      low: input.findingConfidence.low,
      total,
      detail: input.audit.status === "partial"
        ? "The audit was partial, so some checks were not performed."
        : total === 0 ? "No findings were recorded, so there is no evidence to rate." : "Confidence of the findings behind these opportunities. It is independent of any service recommendation.",
    },
  };
}

/** Prospect-suitability view only (feed cards); reuses the same fit logic as the full assessment. */
export function buildSuitability(input: Pick<AssessmentInput, "components" | "company" | "icp">): OpportunityAssessment["prospectSuitability"] {
  return buildAssessment({ ...input, audit: { score: null, status: "unknown" }, findingConfidence: { high: 0, medium: 0, low: 0 } }).prospectSuitability;
}
