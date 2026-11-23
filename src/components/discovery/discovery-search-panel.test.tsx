import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SearchState } from "@/app/app/discover/search-state";
import type { DiscoveryCandidate, DiscoveryPreview } from "@/server/prospecting/discovery-search";

const searchCompaniesAction = vi.fn<(formData: FormData) => Promise<SearchState>>();
const saveDiscoveredCompanyAction = vi.fn();

vi.mock("@/app/app/discover/actions", () => ({
  searchCompaniesAction: (formData: FormData) => searchCompaniesAction(formData),
  saveDiscoveredCompanyAction: (token: string) => saveDiscoveredCompanyAction(token),
}));
vi.mock("@/app/app/crm/actions", () => ({
  addCrmContactAction: vi.fn(), addCrmNoteAction: vi.fn(), addCrmTaskAction: vi.fn(), changeDealStageAction: vi.fn(),
  completeCrmTaskAction: vi.fn(), createCrmLeadAction: vi.fn(), suppressCrmContactAction: vi.fn(), updateLeadDetailsAction: vi.fn(),
}));

import { DiscoverySearchPanel } from "./discovery-search-panel";

const countries = [
  { code: "ZA", name: "South Africa", regionLabel: "Province", cities: ["Cape Town", "Johannesburg"] },
  { code: "VN", name: "Vietnam", regionLabel: "Province or city", cities: ["Hanoi"] },
] as const;
const sources = [
  { id: "osm_extract", name: "OpenStreetMap extract (local)", dataKind: "local_dataset", countries: ["ZA"], region: false, keyword: true },
  { id: "fixture", name: "Synthetic test fixtures", dataKind: "synthetic_fixture", countries: ["ZA", "VN"], region: false, keyword: true },
] as const;
const industries = ["Restaurants & Cafés", "IT & Software Companies"];
const initial = { country: "ZA", city: "", industry: "", keyword: "" };

const candidate = (id: number, extra: Partial<DiscoveryCandidate> = {}): DiscoveryCandidate => ({
  token: `token-${id}`, externalId: `fixture/${id}`, name: `Quán Phở ${id} [FIXTURE]`, website: null, domain: `site-${id}.example.test`, phone: null, email: null,
  address: null, city: "Hanoi", region: "Hanoi", industry: "Restaurants & Cafés", countryCode: "VN", sourceUrl: null, existingCompanyId: null, ...extra,
});
const preview = (candidates: DiscoveryCandidate[], extra: Partial<DiscoveryPreview> = {}): DiscoveryPreview => ({
  providerId: "fixture", providerName: "Synthetic test fixtures", dataKind: "synthetic_fixture", attribution: "are synthetic local test fixtures",
  licenseName: "Synthetic data, not real businesses", licenseUrl: "#fixture-data-notice", coverageBasis: "Synthetic fixture data (not live)",
  query: { countryCode: "VN", city: "Hanoi", industry: "Restaurants & Cafés" }, candidates, nextCursor: null, ignoredFilters: [], skipped: 0, ...extra,
});

function renderPanel() {
  render(<DiscoverySearchPanel countries={countries} industries={industries} initial={initial} sources={sources} />);
}

async function submitSearch(country = "VN", city = "Hanoi") {
  fireEvent.change(screen.getByLabelText("Country"), { target: { value: country } });
  fireEvent.change(screen.getByLabelText("City"), { target: { value: city } });
  fireEvent.change(screen.getByLabelText("Industry"), { target: { value: "Restaurants & Cafés" } });
  fireEvent.click(screen.getByRole("button", { name: "Search" }));
}

afterEach(cleanup);

beforeEach(() => {
  searchCompaniesAction.mockReset();
  saveDiscoveredCompanyAction.mockReset();
});

describe("DiscoverySearchPanel", () => {
  it("starts with a prompt, lists the configured sources and only offers filters the sources support", () => {
    renderPanel();
    expect(screen.getByText("Choose a country, enter a city and pick an industry to search.")).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Configured data sources" })).toHaveTextContent("Local dataset · South Africa");
    expect(screen.getByRole("list", { name: "Configured data sources" })).toHaveTextContent("Synthetic test data · South Africa, Vietnam");
    expect(screen.queryByLabelText(/Province/)).not.toBeInTheDocument();
    expect(screen.getByText(/filtering is not offered by the sources covering South Africa/)).toBeInTheDocument();
    expect(screen.getByLabelText("Business name keyword (optional)")).toBeInTheDocument();
  });

  it("shows results with a synthetic-data banner, the source, and honest paging", async () => {
    searchCompaniesAction.mockResolvedValueOnce({ status: "results", preview: preview([candidate(1), candidate(2)], { nextCursor: "next" }) });
    renderPanel();
    await submitSearch();
    expect(await screen.findByText("2 businesses shown · more available")).toBeInTheDocument();
    expect(screen.getByText("Synthetic test data", { selector: "strong" })).toBeInTheDocument();
    expect(screen.getByText(/Source: Synthetic test fixtures/)).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Search results" }).querySelectorAll("li")).toHaveLength(2);
    const form = searchCompaniesAction.mock.calls[0]?.[0];
    expect(form?.get("country")).toBe("VN");
    expect(form?.get("city")).toBe("Hanoi");
  });

  it("loads more with the cursor and appends without duplicates", async () => {
    searchCompaniesAction
      .mockResolvedValueOnce({ status: "results", preview: preview([candidate(1), candidate(2)], { nextCursor: "page-2" }) })
      .mockResolvedValueOnce({ status: "results", preview: preview([candidate(2), candidate(3)]) });
    renderPanel();
    await submitSearch();
    fireEvent.click(await screen.findByRole("button", { name: "Load more results" }));
    expect(await screen.findByText("3 businesses shown")).toBeInTheDocument();
    expect(searchCompaniesAction.mock.calls[1]?.[0].get("cursor")).toBe("page-2");
    expect(screen.queryByRole("button", { name: "Load more results" })).not.toBeInTheDocument();
  });

  it("saves a company, then offers the company profile and a direct lead", async () => {
    searchCompaniesAction.mockResolvedValueOnce({ status: "results", preview: preview([candidate(1), candidate(2, { existingCompanyId: "99999999-9999-4999-8999-999999999999" })]) });
    saveDiscoveredCompanyAction.mockResolvedValueOnce({ status: "saved", companyId: "11111111-1111-4111-8111-111111111111", name: "Quán Phở 1 [FIXTURE]", created: true });
    renderPanel();
    await submitSearch();
    const results = await screen.findByRole("list", { name: "Search results" });
    expect(within(results).getByText("Already in workspace")).toBeInTheDocument();
    fireEvent.click(within(results).getByRole("button", { name: "Save Quán Phở 1 [FIXTURE] to workspace" }));
    await waitFor(() => expect(within(results).getByText("Saved to workspace")).toBeInTheDocument());
    expect(saveDiscoveredCompanyAction).toHaveBeenCalledWith("token-1");
    expect(within(results).getAllByRole("link", { name: "Open company" }).map((link) => link.getAttribute("href"))).toContain("/app/companies/11111111-1111-4111-8111-111111111111");
    expect(within(results).getAllByRole("button", { name: "Create lead" })).toHaveLength(2);
  });

  it("shows a failed save on the row without losing the result", async () => {
    searchCompaniesAction.mockResolvedValueOnce({ status: "results", preview: preview([candidate(1)]) });
    saveDiscoveredCompanyAction.mockResolvedValueOnce({ status: "error", message: "This search result has expired. Search again to save it." });
    renderPanel();
    await submitSearch();
    fireEvent.click(await screen.findByRole("button", { name: /^Save Quán Phở 1/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("This search result has expired");
    expect(screen.getByRole("button", { name: /^Save Quán Phở 1/ })).toBeEnabled();
  });

  it("tells 'no matching businesses' apart from a coverage gap and from an unavailable source", async () => {
    searchCompaniesAction.mockResolvedValueOnce({ status: "results", preview: preview([]) });
    renderPanel();
    await submitSearch();
    expect(await screen.findByText("No matching businesses")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it.each([
    ["unsupported_location", "No data source covers this location", "coverage gap, not an empty result"],
    ["provider_unavailable", "The data source is unavailable", "not a “no results” answer"],
    ["rate_limited", "Search limit reached", "Try again in about 42 seconds"],
    ["invalid", "Check your search", "Choose a supported country."],
    ["not_enabled", "External discovery is not enabled", "Import a CSV"],
  ] as const)("renders the %s state distinctly and shows no results", async (kind, title, text) => {
    searchCompaniesAction.mockResolvedValueOnce({ status: "error", kind, message: kind === "invalid" ? "Choose a supported country." : "Source message.", ...(kind === "rate_limited" ? { retryAfterSeconds: 42 } : {}) });
    renderPanel();
    await submitSearch();
    expect(await screen.findByText(title)).toBeInTheDocument();
    expect(document.body.textContent).toContain(text);
    expect(screen.queryByRole("list", { name: "Search results" })).not.toBeInTheDocument();
    expect(screen.queryByText("No matching businesses")).not.toBeInTheDocument();
  });

  it("explains partial results and filters a source ignored", async () => {
    searchCompaniesAction.mockResolvedValueOnce({ status: "results", preview: preview([candidate(1)], { skipped: 2, ignoredFilters: ["Province is not supported by Synthetic test fixtures and was ignored."] }) });
    renderPanel();
    await submitSearch();
    expect(await screen.findByText(/Partial results: 2 results were skipped/)).toBeInTheDocument();
    expect(screen.getByText(/was ignored\./)).toBeInTheDocument();
  });

  it("resets the form and clears results", async () => {
    searchCompaniesAction.mockResolvedValueOnce({ status: "results", preview: preview([candidate(1)]) });
    renderPanel();
    await submitSearch();
    await screen.findByRole("list", { name: "Search results" });
    fireEvent.click(screen.getByRole("button", { name: "Reset filters" }));
    expect(screen.queryByRole("list", { name: "Search results" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("City")).toHaveValue("");
    expect(screen.getByLabelText("Country")).toHaveValue("ZA");
  });
});
