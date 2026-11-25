import { Card } from "@/components/ui/card";
import type { SourceEvidenceState } from "@/modules/proposals/source-evidence";

const copy = {
  lead_without_source: "This lead currently has no linked source audit.",
  no_snapshot: "No evidence snapshot is available for this version.",
} as const;

export function SourceEvidenceNotice({ state }: { state: Exclude<SourceEvidenceState, "available"> }) {
  return <Card id="proposal-section-8" className="p-6">
    <h2 className="font-semibold">Source evidence</h2>
    <p className="mt-2 text-sm text-muted-foreground" data-evidence-state={state}>{copy[state]}</p>
  </Card>;
}
