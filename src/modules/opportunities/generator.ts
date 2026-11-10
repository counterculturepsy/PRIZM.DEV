import { preferredOutcome, type ServiceRecommendation } from "./mapping";

export const OPPORTUNITY_GENERATION_VERSION = "opportunity-v1";

export const opportunityTypes = [
  "website_improvement",
  "accessibility_remediation",
  "seo_improvement",
  "security_hardening",
  "performance_optimization",
  "mobile_experience",
] as const;

export type OpportunityType = (typeof opportunityTypes)[number];
type Confidence = "high" | "medium" | "low";

export type OpportunityFinding = Readonly<{
  id: string;
  category: string;
  confidence: Confidence;
}>;

export type GeneratedOpportunity = Readonly<{
  type: OpportunityType;
  title: string;
  summary: string;
  businessImpact: string;
  recommendedSolution: string;
  confidence: Confidence;
  sourceFindingIds: string[];
  /** Resolved from workspace mappings; recommendations never alter evidence or confidence. */
  recommendations: ServiceRecommendation[];
  serviceId: string | null;
  estimatedValueMinMinor: number | null;
  estimatedValueMaxMinor: number | null;
  generationVersion: typeof OPPORTUNITY_GENERATION_VERSION;
}>;

export const opportunityTypeLabels: Readonly<Record<OpportunityType, string>> = {
  website_improvement: "Website improvement",
  accessibility_remediation: "Accessibility remediation",
  seo_improvement: "Search and content improvement",
  security_hardening: "Website security hardening",
  performance_optimization: "Website performance",
  mobile_experience: "Mobile experience",
};

const definitions: Record<OpportunityType, Readonly<{
  title: string;
  businessImpact: string;
  recommendedSolution: string;
}>> = {
  accessibility_remediation: {
    title: "Accessibility remediation opportunity",
    businessImpact: "Observed accessibility barriers may make important website content or controls harder for some visitors to use.",
    recommendedSolution: "Review the cited elements against WCAG 2.2 AA and remediate confirmed barriers with keyboard and assistive-technology testing.",
  },
  seo_improvement: {
    title: "Search and content improvement opportunity",
    businessImpact: "Observed page metadata or content structure may limit how clearly the page is interpreted in search and browser surfaces.",
    recommendedSolution: "Validate search intent, then improve the cited metadata and document structure without making ranking guarantees.",
  },
  security_hardening: {
    title: "Website security-hardening opportunity",
    businessImpact: "Observed transport or response-header gaps may leave the public website with fewer browser-enforced protections.",
    recommendedSolution: "Confirm the hosting stack and apply the cited transport and response-header controls with regression testing.",
  },
  performance_optimization: {
    title: "Website performance opportunity",
    businessImpact: "The bounded observation identified response or document-size signals that may affect visitor experience.",
    recommendedSolution: "Measure the page under controlled lab and field conditions, then optimize confirmed server or document bottlenecks.",
  },
  mobile_experience: {
    title: "Mobile experience opportunity",
    businessImpact: "Observed mobile configuration gaps may produce an unsuitable layout or interaction experience on smaller screens.",
    recommendedSolution: "Validate representative mobile journeys and implement responsive improvements for confirmed issues.",
  },
  website_improvement: {
    title: "Website improvement opportunity",
    businessImpact: "The audit contains supported website findings that warrant a focused technical and content review.",
    recommendedSolution: "Review the cited evidence, confirm the issue in context, and scope only the remediation the business needs.",
  },
};

function typeForCategory(category: string): OpportunityType {
  if (category === "accessibility") return "accessibility_remediation";
  if (category === "seo" || category === "content") return "seo_improvement";
  if (category === "security") return "security_hardening";
  if (category === "performance") return "performance_optimization";
  if (category === "mobile") return "mobile_experience";
  return "website_improvement";
}

function lowestConfidence(findings: readonly OpportunityFinding[]): Confidence {
  const rank: Record<Confidence, number> = { low: 0, medium: 1, high: 2 };
  return findings.reduce<Confidence>((lowest, finding) => rank[finding.confidence] < rank[lowest] ? finding.confidence : lowest, "high");
}

/**
 * Evidence and confidence come only from the findings. Service recommendations are supplied by the
 * caller (resolved from workspace mappings) and are attached without influencing either.
 * An unmapped type yields a valid opportunity with no recommendations.
 */
export function generateOpportunities(
  findings: readonly OpportunityFinding[],
  recommendationsByType: Readonly<Partial<Record<OpportunityType, readonly ServiceRecommendation[]>>> = {},
): GeneratedOpportunity[] {
  const grouped = new Map<OpportunityType, OpportunityFinding[]>();
  for (const finding of findings) {
    const type = typeForCategory(finding.category);
    grouped.set(type, [...(grouped.get(type) ?? []), finding]);
  }
  return [...grouped.entries()].map(([type, source]) => {
    const definition = definitions[type];
    const recommendations = [...(recommendationsByType[type] ?? [])];
    return {
      type,
      title: definition.title,
      summary: `${source.length} observed audit ${source.length === 1 ? "finding supports" : "findings support"} this opportunity.`,
      businessImpact: definition.businessImpact,
      recommendedSolution: definition.recommendedSolution,
      confidence: lowestConfidence(source),
      sourceFindingIds: source.map((finding) => finding.id),
      recommendations,
      ...preferredOutcome(recommendations),
      generationVersion: OPPORTUNITY_GENERATION_VERSION,
    };
  });
}
