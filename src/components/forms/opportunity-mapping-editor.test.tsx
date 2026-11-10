import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/app/settings/services/mapping-actions", () => ({ updateMappingAction: vi.fn() }));

import { OpportunityMappingEditor } from "./opportunity-mapping-editor";

const overview = {
  currency: "ZAR",
  catalogue: [
    { id: "s1", name: "Ongoing Maintenance & Technical Support", active: true },
    { id: "s2", name: "Website Redesign & Modernisation", active: true },
  ],
  types: [
    {
      type: "security_hardening",
      label: "Website security hardening",
      effectiveCount: 1,
      services: [{ serviceId: "s1", serviceName: "Ongoing Maintenance & Technical Support", active: true, isPreferred: true, priceStatus: "not_configured", startingPriceMinor: null, averagePriceMinor: null }],
    },
    { type: "seo_improvement", label: "Search and content improvement", effectiveCount: 0, services: [] },
  ],
} as const;

afterEach(cleanup);

describe("OpportunityMappingEditor", () => {
  it("offers editing controls to workspace managers", () => {
    render(<OpportunityMappingEditor canManage overview={overview as never} />);
    expect(screen.getByText("Price not configured")).toBeTruthy();
    expect(screen.getByText("Preferred")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Clear preferred" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Remove" })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Add" })).toHaveLength(2);
    expect(screen.getByLabelText("Add a service to Search and content improvement")).toBeTruthy();
  });

  it("is read-only for everyone else, and still shows unmapped types", () => {
    render(<OpportunityMappingEditor canManage={false} overview={overview as never} />);
    expect(screen.getByText("Ongoing Maintenance & Technical Support")).toBeTruthy();
    expect(screen.getByText(/Unmapped/)).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
  });
});
