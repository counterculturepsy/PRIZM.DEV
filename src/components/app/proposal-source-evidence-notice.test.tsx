import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SourceEvidenceNotice } from "./proposal-source-evidence-notice";

describe("SourceEvidenceNotice", () => {
  afterEach(cleanup);

  it("says the lead currently has no linked source audit", () => {
    const { container } = render(<SourceEvidenceNotice state="lead_without_source" />);
    expect(screen.getByRole("heading", { name: "Source evidence" })).toBeInTheDocument();
    expect(screen.getByText("This lead currently has no linked source audit.")).toBeInTheDocument();
    expect(container.querySelector('[data-evidence-state="lead_without_source"]')).not.toBeNull();
  });

  it("says no evidence snapshot is available without claiming how old the version is", () => {
    const { container } = render(<SourceEvidenceNotice state="no_snapshot" />);
    expect(screen.getByText("No evidence snapshot is available for this version.")).toBeInTheDocument();
    expect(container.querySelector('[data-evidence-state="no_snapshot"]')).not.toBeNull();
  });

  it("never uses age or legacy wording in either state", () => {
    for (const state of ["lead_without_source", "no_snapshot"] as const) {
      const { container, unmount } = render(<SourceEvidenceNotice state={state} />);
      expect(container.textContent).not.toMatch(/legacy|predates|created before|older|snapshots were recorded/i);
      unmount();
    }
  });
});
