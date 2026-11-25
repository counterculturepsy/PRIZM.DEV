import { describe, expect, it } from "vitest";
import { classifySourceEvidence } from "./source-evidence";

const linked = { sourceOpportunityId: "11111111-1111-4111-8111-111111111111" };
const unlinked = { sourceOpportunityId: null };

describe("classifySourceEvidence", () => {
  it("is available whenever the version embeds a snapshot, whatever the lead looks like now", () => {
    expect(classifySourceEvidence({ hasEvidenceSnapshot: true, lead: linked })).toBe("available");
    expect(classifySourceEvidence({ hasEvidenceSnapshot: true, lead: unlinked })).toBe("available");
    expect(classifySourceEvidence({ hasEvidenceSnapshot: true, lead: null })).toBe("available");
  });

  it("reports a lead without a source audit only when the lead exists and is unlinked", () => {
    expect(classifySourceEvidence({ hasEvidenceSnapshot: false, lead: unlinked })).toBe("lead_without_source");
  });

  it("reports an unavailable snapshot for a linked lead without making any claim about age", () => {
    expect(classifySourceEvidence({ hasEvidenceSnapshot: false, lead: linked })).toBe("no_snapshot");
  });

  it("reports an unavailable snapshot, not an unlinked lead, when the lead record is missing", () => {
    expect(classifySourceEvidence({ hasEvidenceSnapshot: false, lead: null })).toBe("no_snapshot");
  });
});
