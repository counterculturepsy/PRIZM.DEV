import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { summarizeCrmStatus, summarizeRecommendation } from "@/modules/opportunities/feed";
import { OpportunityFeedCard, type OpportunityFeedRow } from "./opportunity-feed-card";

afterEach(cleanup);

const base: OpportunityFeedRow = {
  opportunityId: "opp-1",
  companyId: "company-1",
  companyName: "Synthetic Hotel",
  industry: "Hospitality",
  city: "Stellenbosch",
  type: "security_hardening",
  title: "Website security-hardening opportunity",
  summary: "3 observed audit findings support this opportunity.",
  confidence: "high",
  totalScore: 42,
  priority: "possible",
  evidenceCount: 3,
  highestSeverity: "medium",
  recommendation: summarizeRecommendation({ recordedCount: 0, preferred: null }),
  crm: summarizeCrmStatus(null, "opp-1"),
  suitability: {
    checks: [
      { key: "industry", label: "Target industry", assessment: "positive", detail: "" },
      { key: "city", label: "Target city", assessment: "negative", detail: "" },
      { key: "contact", label: "Public contact", assessment: "missing", detail: "" },
    ],
  },
};

describe("OpportunityFeedCard", () => {
  it("shows the approved fields with distinct severity, priority and confidence labels", () => {
    render(<OpportunityFeedCard row={base} />);
    expect(screen.getByText("Synthetic Hotel · Hospitality · Stellenbosch")).toBeTruthy();
    expect(screen.getByText("Website security hardening")).toBeTruthy();
    expect(screen.getByText(/Lead priority possible · 42\/100/)).toBeTruthy();
    expect(screen.getByText("Highest finding severity: Medium")).toBeTruthy();
    expect(screen.getByText("high evidence confidence")).toBeTruthy();
    expect(screen.getByText("3 evidence")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Review evidence/ }).getAttribute("href")).toBe("/app/companies/company-1/opportunities");
  });

  it("distinguishes matches, verified mismatches and missing data", () => {
    render(<OpportunityFeedCard row={base} />);
    expect(screen.getByText("Match")).toBeTruthy();
    expect(screen.getByText("Verified mismatch")).toBeTruthy();
    expect(screen.getByText("Missing data")).toBeTruthy();
  });

  it("shows a historical opportunity without claiming a service or a price state", () => {
    render(<OpportunityFeedCard row={base} />);
    expect(screen.getByText("No service recommendation confirmed")).toBeTruthy();
    expect(screen.getByText("No recommendation snapshot")).toBeTruthy();
    expect(screen.getByText("Price not recorded")).toBeTruthy();
    expect(screen.getByText("No lead created")).toBeTruthy();
    expect(screen.queryByText("Price not configured")).toBeNull();
  });

  it("shows a recorded service without a price as 'Price not configured'", () => {
    const row = { ...base, recommendation: summarizeRecommendation({ recordedCount: 1, preferred: { serviceName: "Ongoing Maintenance & Technical Support", priceStatus: "not_configured", startingPriceMinor: null, averagePriceMinor: null, currency: null } }) };
    render(<OpportunityFeedCard row={row} />);
    expect(screen.getByText("Ongoing Maintenance & Technical Support")).toBeTruthy();
    expect(screen.getByText("Price not configured")).toBeTruthy();
  });

  it("shows recorded price guidance and the CRM status for a priced, linked opportunity", () => {
    const row = {
      ...base,
      highestSeverity: null,
      recommendation: summarizeRecommendation({ recordedCount: 1, preferred: { serviceName: "Redesign", priceStatus: "configured", startingPriceMinor: 15_000, averagePriceMinor: 25_000, currency: "ZAR" } }),
      crm: summarizeCrmStatus({ status: "qualified", sourceOpportunityId: "opp-1" }, "opp-1"),
    };
    render(<OpportunityFeedCard row={row} />);
    expect(screen.getByText(/150.*250/)).toBeTruthy();
    expect(screen.getByText("Lead qualified")).toBeTruthy();
    expect(screen.getByText("Highest finding severity: No linked findings")).toBeTruthy();
  });
});
