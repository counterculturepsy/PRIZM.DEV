import { describeRecommendationPrice, type PriceStatus } from "./mapping";

export const severityRank = ["info", "low", "medium", "high"] as const;
export type FindingSeverity = (typeof severityRank)[number];

const severityLabels: Readonly<Record<FindingSeverity, string>> = { info: "Info", low: "Low", medium: "Medium", high: "High" };

/** Highest severity among an opportunity's linked findings; null when no evidence is linked. */
export function severityLabel(severity: FindingSeverity | null): string {
  return severity === null ? "No linked findings" : severityLabels[severity];
}

export type PreferredSnapshot = Readonly<{
  serviceName: string;
  priceStatus: PriceStatus;
  startingPriceMinor: number | null;
  averagePriceMinor: number | null;
  currency: string | null;
}>;

/**
 * What a user may be told is recommended. Resolved only from the opportunity's stored recommendation
 * snapshot, never from today's mappings, and only an explicitly preferred snapshot service is ever
 * presented as recommended. Non-preferred services recorded in the snapshot are never surfaced here.
 * - `preferred`: the recorded preferred service and its recorded price state.
 * - `no_preferred`: a snapshot exists but confirms no preferred service; pricing stays neutral.
 * - `none`: no snapshot exists (for example the opportunity predates service mapping).
 */
export type FeedRecommendation = Readonly<{
  kind: "preferred" | "no_preferred" | "none";
  serviceLabel: string;
  /** Provenance note shown beside an unconfirmed recommendation; null when nothing needs saying. */
  note: string | null;
  priceLabel: string;
}>;

export const NO_RECOMMENDATION_CONFIRMED = "No service recommendation confirmed";

export function summarizeRecommendation(input: Readonly<{ recordedCount: number; preferred: PreferredSnapshot | null }>): FeedRecommendation {
  if (input.preferred) {
    const { serviceName, priceStatus, startingPriceMinor, averagePriceMinor, currency } = input.preferred;
    return { kind: "preferred", serviceLabel: serviceName, note: null, priceLabel: describeRecommendationPrice(priceStatus, startingPriceMinor, averagePriceMinor, currency) };
  }
  if (input.recordedCount > 0) {
    return { kind: "no_preferred", serviceLabel: NO_RECOMMENDATION_CONFIRMED, note: null, priceLabel: "No price shown" };
  }
  return { kind: "none", serviceLabel: NO_RECOMMENDATION_CONFIRMED, note: "No recommendation snapshot", priceLabel: "Price not recorded" };
}

export type LeadStatus = "new" | "qualified" | "unqualified" | "converted" | "archived";

/**
 * CRM status from existing leads only (not a review status).
 * `linked`: the lead was created from this opportunity.
 * `company`: the company has a lead that came from another source; shown so the feed never claims
 * "no lead" for a company that already has one.
 */
export type FeedCrmStatus =
  | Readonly<{ kind: "none"; label: string }>
  | Readonly<{ kind: "linked" | "company"; status: LeadStatus; label: string }>;

export function summarizeCrmStatus(
  lead: Readonly<{ status: LeadStatus; sourceOpportunityId: string | null }> | null,
  opportunityId: string,
): FeedCrmStatus {
  if (!lead) return { kind: "none", label: "No lead created" };
  if (lead.sourceOpportunityId === opportunityId) return { kind: "linked", status: lead.status, label: `Lead ${lead.status}` };
  return { kind: "company", status: lead.status, label: `Company lead ${lead.status} (created from another opportunity)` };
}
