import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { summarizeRecommendation } from "@/modules/opportunities/feed";
import { OpportunityRecommendationBlock } from "./opportunity-recommendation-block";

afterEach(cleanup);

describe("OpportunityRecommendationBlock", () => {
  it("presents an explicitly preferred snapshot service, with its recorded price state", () => {
    const recommendation = summarizeRecommendation({ recordedCount: 3, preferred: { serviceName: "Ongoing Maintenance & Technical Support", priceStatus: "not_configured", startingPriceMinor: null, averagePriceMinor: null, currency: null } });
    render(<OpportunityRecommendationBlock currentlyMappedCount={3} recommendation={recommendation} />);
    expect(screen.getByText("Ongoing Maintenance & Technical Support")).toBeTruthy();
    expect(screen.getByText("Preferred")).toBeTruthy();
    expect(screen.getByText("Price not configured")).toBeTruthy();
    expect(screen.queryByText("No service recommendation confirmed")).toBeNull();
  });

  it("confirms nothing when a snapshot exists without a preferred service, and keeps pricing neutral", () => {
    const recommendation = summarizeRecommendation({ recordedCount: 2, preferred: null });
    const { container } = render(<OpportunityRecommendationBlock currentlyMappedCount={2} recommendation={recommendation} />);
    expect(screen.getByText("No service recommendation confirmed")).toBeTruthy();
    expect(screen.getByText("No price shown")).toBeTruthy();
    expect(screen.queryByText("Preferred")).toBeNull();
    expect(container.textContent).not.toMatch(/Redesign|Maintenance/);
    expect(container.textContent).not.toMatch(/Service mappings exist now/);
  });

  it("explains a historical opportunity with no snapshot, without naming a service or resolving today's mappings", () => {
    const recommendation = summarizeRecommendation({ recordedCount: 0, preferred: null });
    const { container, rerender } = render(<OpportunityRecommendationBlock currentlyMappedCount={0} recommendation={recommendation} />);
    expect(screen.getByText("No service recommendation confirmed")).toBeTruthy();
    expect(screen.getByText("Price not recorded")).toBeTruthy();
    expect(container.textContent).toContain("No recommendation snapshot");
    expect(container.textContent).toContain("No services are currently mapped to this opportunity type.");
    rerender(<OpportunityRecommendationBlock currentlyMappedCount={4} recommendation={recommendation} />);
    expect(container.textContent).toContain("start a new audit to apply them");
    expect(container.textContent).not.toMatch(/Redesign|Maintenance|Website Design/);
    expect(screen.getByRole("link", { name: "Manage service mapping" }).getAttribute("href")).toBe("/app/settings/services");
  });
});
