export type SourceEvidenceState = "available" | "lead_without_source" | "no_snapshot";

/**
 * Decides what the proposal page may truthfully say about a saved version's source evidence.
 *
 * Only facts that are persisted or checkable now are used. Nothing here claims how old a version is:
 * versions carry no format marker and the release date of evidence capture is not stored, so "created
 * before snapshots existed" cannot be established (a revision of an older proposal is a brand-new version).
 * - available: the saved version embeds a snapshot. It is shown whatever the lead looks like today.
 * - lead_without_source: no snapshot, and the lead exists but currently has no source opportunity.
 * - no_snapshot: no snapshot and the lead is linked to a source opportunity or no longer exists.
 */
export function classifySourceEvidence(input: {
  hasEvidenceSnapshot: boolean;
  lead: Readonly<{ sourceOpportunityId: string | null }> | null;
}): SourceEvidenceState {
  if (input.hasEvidenceSnapshot) return "available";
  if (input.lead && input.lead.sourceOpportunityId === null) return "lead_without_source";
  return "no_snapshot";
}
