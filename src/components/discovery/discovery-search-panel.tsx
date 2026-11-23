"use client";

import "./discovery.css";
import Link from "next/link";
import { useRef, useState, useTransition, type FormEvent } from "react";
import { Building2, Loader2, MapPin, Search } from "lucide-react";
import { saveDiscoveredCompanyAction, searchCompaniesAction } from "@/app/app/discover/actions";
import type { SearchFailureKind } from "@/app/app/discover/search-state";
import { CreateLeadFromCompanyForm } from "@/components/forms/crm-forms";
import { Input, Label, selectClassName } from "@/components/ui/form-controls";
import type { DiscoveryCandidate, DiscoveryPreview } from "@/server/prospecting/discovery-search";

export type CountryOption = Readonly<{ code: string; name: string; regionLabel: string; cities: readonly string[] }>;
export type SourceOption = Readonly<{
  id: string;
  name: string;
  dataKind: "local_dataset" | "live_api" | "synthetic_fixture" | null;
  countries: readonly string[] | "any";
  region: boolean;
  keyword: boolean;
}>;
type Initial = Readonly<{ country: string; city: string; industry: string; keyword: string }>;
type Props = Readonly<{ countries: readonly CountryOption[]; sources: readonly SourceOption[]; industries: readonly string[]; initial: Initial }>;
type RowState =
  | Readonly<{ status: "saving" }>
  | Readonly<{ status: "saved"; companyId: string; created: boolean }>
  | Readonly<{ status: "error"; message: string }>;
type Failure = Readonly<{ kind: SearchFailureKind; message: string; retryAfterSeconds?: number }>;

const KIND_LABEL = { local_dataset: "Local dataset", live_api: "Live API", synthetic_fixture: "Synthetic test data" } as const;
const URL_KEYS = { country: "dcountry", city: "dcity", industry: "dindustry", keyword: "dkeyword" } as const;

const FAILURE_COPY: Readonly<Record<SearchFailureKind, { title: string; tone: "info" | "warn" | "error"; hint: string }>> = {
  not_enabled: { title: "External discovery is not enabled", tone: "info", hint: "Import a CSV to add companies, or ask an administrator to enable a data source." },
  invalid: { title: "Check your search", tone: "warn", hint: "" },
  unsupported_location: { title: "No data source covers this location", tone: "warn", hint: "Nothing was searched or shown. This is a coverage gap, not an empty result." },
  rate_limited: { title: "Search limit reached", tone: "warn", hint: "Nothing was lost. Wait a moment, then search again." },
  provider_unavailable: { title: "The data source is unavailable", tone: "error", hint: "The search could not finish, so this is not a “no results” answer. Try again shortly." },
};

/** Keeps the search in the address bar, so going back from a company profile restores the form. */
function syncUrl(values: Initial | null): void {
  const params = new URLSearchParams(window.location.search);
  for (const [field, key] of Object.entries(URL_KEYS)) {
    const value = values ? values[field as keyof Initial] : "";
    if (value) params.set(key, value);
    else params.delete(key);
  }
  const query = params.toString();
  window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
}

function CandidateActions({ candidate, row, onSave }: Readonly<{ candidate: DiscoveryCandidate; row: RowState | undefined; onSave: () => void }>) {
  const companyId = row?.status === "saved" ? row.companyId : candidate.existingCompanyId;
  if (companyId) {
    return <div className="discovery-row-actions">
      <span className="discovery-badge">{row?.status === "saved" ? "Saved to workspace" : "Already in workspace"}</span>
      <div className="discovery-links"><Link href={`/app/companies/${companyId}`}>Open company</Link></div>
      <CreateLeadFromCompanyForm companyId={companyId} companyName={candidate.name} />
    </div>;
  }
  return <div className="discovery-row-actions">
    <button aria-label={`Save ${candidate.name} to workspace`} className="discovery-secondary" disabled={row?.status === "saving"} onClick={onSave} type="button">
      {row?.status === "saving" ? "Saving…" : "Save company"}
    </button>
    {row?.status === "error" ? <p className="discovery-error" role="alert">{row.message}</p> : null}
  </div>;
}

export function DiscoverySearchPanel({ countries, sources, industries, initial }: Props) {
  const [values, setValues] = useState<Initial>(initial);
  const [region, setRegion] = useState("");
  const [candidates, setCandidates] = useState<readonly DiscoveryCandidate[]>([]);
  const [meta, setMeta] = useState<Omit<DiscoveryPreview, "candidates"> | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [rows, setRows] = useState<Readonly<Record<string, RowState>>>({});
  const [searched, setSearched] = useState(false);
  const [pending, startTransition] = useTransition();
  const lastSubmitted = useRef<FormData | null>(null);

  const country = countries.find((option) => option.code === values.country) ?? countries[0];
  const covering = sources.filter((source) => source.countries === "any" || source.countries.includes(values.country));
  const regionSupported = covering.some((source) => source.region);
  const keywordSupported = covering.length === 0 || covering.some((source) => source.keyword);
  const countryName = (code: string) => countries.find((option) => option.code === code)?.name ?? code;

  function run(formData: FormData, append: boolean) {
    startTransition(async () => {
      const state = await searchCompaniesAction(formData);
      if (state.status === "results") {
        const { candidates: next, ...rest } = state.preview;
        setMeta(rest);
        setFailure(null);
        setCandidates((previous) => append ? [...previous, ...next.filter((item) => !previous.some((known) => known.externalId === item.externalId))] : next);
      } else if (state.status === "error") {
        setFailure({ kind: state.kind, message: state.message, ...(state.retryAfterSeconds ? { retryAfterSeconds: state.retryAfterSeconds } : {}) });
        if (!append) { setCandidates([]); setMeta(null); }
      }
    });
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    lastSubmitted.current = formData;
    setRows({});
    setFailure(null);
    setSearched(true);
    syncUrl(values);
    run(formData, false);
  }

  function loadMore() {
    const base = lastSubmitted.current;
    if (!base || !meta?.nextCursor) return;
    const formData = new FormData();
    for (const [key, value] of base.entries()) if (typeof value === "string") formData.set(key, value);
    formData.set("cursor", meta.nextCursor);
    run(formData, true);
  }

  async function save(candidate: DiscoveryCandidate) {
    setRows((previous) => ({ ...previous, [candidate.externalId]: { status: "saving" } }));
    const result = await saveDiscoveredCompanyAction(candidate.token);
    setRows((previous) => ({
      ...previous,
      [candidate.externalId]: result.status === "saved" ? { status: "saved", companyId: result.companyId, created: result.created } : { status: "error", message: result.message },
    }));
  }

  function reset() {
    setValues({ country: countries[0]?.code ?? "ZA", city: "", industry: "", keyword: "" });
    setRegion("");
    setCandidates([]);
    setMeta(null);
    setFailure(null);
    setRows({});
    setSearched(false);
    lastSubmitted.current = null;
    syncUrl(null);
  }

  const copy = failure ? FAILURE_COPY[failure.kind] : null;
  const isEmpty = searched && !pending && !failure && meta !== null && candidates.length === 0;

  return <section aria-labelledby="discovery-heading" className="discovery-panel">
    <p className="discovery-eyebrow">External discovery</p>
    <h2 className="discovery-title" id="discovery-heading">Find businesses by country and city</h2>
    <p className="discovery-lead">Search business listings for a place, review what comes back, then save only the companies you want. Nothing is saved until you choose to, and every result keeps its source.</p>

    <ul aria-label="Configured data sources" className="discovery-sources">
      {sources.map((source) => <li className={`discovery-chip ${source.dataKind === "synthetic_fixture" ? "synthetic" : "live"}`} key={source.id}>
        <strong>{source.name}</strong>
        <span>{source.dataKind ? KIND_LABEL[source.dataKind] : "Data source"} · {source.countries === "any" ? "any country, not verified" : source.countries.map(countryName).join(", ")}</span>
      </li>)}
    </ul>

    <form className="discovery-form" onSubmit={onSubmit}>
      <div className="discovery-field"><Label htmlFor="discovery-country">Country</Label>
        <select className={selectClassName} id="discovery-country" name="country" onChange={(event) => setValues({ ...values, country: event.target.value, city: "" })} value={values.country}>
          {countries.map((option) => <option key={option.code} value={option.code}>{option.name}</option>)}
        </select></div>
      <div className="discovery-field"><Label htmlFor="discovery-city">City</Label>
        <Input autoComplete="off" id="discovery-city" list="discovery-city-options" maxLength={80} name="city" onChange={(event) => setValues({ ...values, city: event.target.value })} placeholder={country?.cities[0] ?? "City"} required value={values.city} />
        <datalist id="discovery-city-options">{country?.cities.map((city) => <option key={city} value={city} />)}</datalist></div>
      <div className="discovery-field"><Label htmlFor="discovery-industry">Industry</Label>
        <select className={selectClassName} id="discovery-industry" name="industry" onChange={(event) => setValues({ ...values, industry: event.target.value })} required value={values.industry}>
          <option disabled value="">Choose an industry</option>
          {industries.map((industry) => <option key={industry} value={industry}>{industry}</option>)}
        </select></div>
      {regionSupported
        ? <div className="discovery-field"><Label htmlFor="discovery-region">{country?.regionLabel ?? "Region"} (optional)</Label>
            <Input id="discovery-region" maxLength={80} name="province" onChange={(event) => setRegion(event.target.value)} value={region} /></div>
        : <div className="discovery-field"><span className="discovery-hint">{country?.regionLabel ?? "Region"} filtering is not offered by the sources covering {country?.name ?? "this country"}. Search by city.</span></div>}
      {keywordSupported
        ? <div className="discovery-field wide"><Label htmlFor="discovery-keyword">Business name keyword (optional)</Label>
            <Input id="discovery-keyword" maxLength={60} name="keyword" onChange={(event) => setValues({ ...values, keyword: event.target.value })} placeholder="e.g. cloud" value={values.keyword} /></div>
        : <div className="discovery-field wide"><span className="discovery-hint">Keyword search is not available from the configured sources.</span></div>}
      <div className="discovery-actions">
        <button className="discovery-secondary" onClick={reset} type="button">Reset filters</button>
        <button className="discovery-primary" disabled={pending} type="submit">{pending && candidates.length === 0 ? <Loader2 aria-hidden className="size-4 animate-spin" /> : <Search aria-hidden className="size-4" />}Search</button>
      </div>
    </form>

    <div aria-live="polite">
      {pending ? <p className="discovery-hint" role="status">Searching{country ? ` ${values.city || country.name}` : ""}…</p> : null}
      {failure && copy ? <div className={`discovery-notice ${copy.tone}`} role={copy.tone === "error" ? "alert" : "status"}>
        <strong>{copy.title}</strong>
        <span>{failure.message}{failure.retryAfterSeconds && !failure.message.includes("Try again") ? ` Try again in about ${failure.retryAfterSeconds} seconds.` : ""}</span>
        {copy.hint ? <span>{copy.hint}</span> : null}
      </div> : null}
      {!searched && !failure ? <p className="discovery-hint" style={{ marginTop: 16 }}>Choose a country, enter a city and pick an industry to search.</p> : null}
    </div>

    {meta && candidates.length > 0 ? <>
      {meta.dataKind === "synthetic_fixture" ? <div className="discovery-notice warn" role="note"><strong>Synthetic test data</strong><span>These are not real businesses. They come from local test fixtures and must not be used for outreach.</span></div> : null}
      {meta.ignoredFilters.map((message) => <div className="discovery-notice" key={message} role="note"><span>{message}</span></div>)}
      {meta.skipped > 0 ? <div className="discovery-notice" role="note"><span>Partial results: {meta.skipped} {meta.skipped === 1 ? "result was" : "results were"} skipped because {meta.skipped === 1 ? "it lacked" : "they lacked"} valid data.</span></div> : null}
      <div className="discovery-results-head">
        <h3>{candidates.length} {candidates.length === 1 ? "business" : "businesses"} shown{meta.nextCursor ? " · more available" : ""}</h3>
        <p>Source: {meta.providerName} · {meta.coverageBasis}. Data {meta.attribution}{meta.licenseUrl.startsWith("http") ? <> · <a href={meta.licenseUrl} rel="noreferrer" target="_blank">{meta.licenseName}</a></> : null}.</p>
      </div>
      <ul aria-label="Search results" className="discovery-list">
        {candidates.map((candidate) => <li className="discovery-result" key={candidate.externalId}>
          <div><p className="discovery-name">{candidate.name}</p><p className="discovery-meta">{candidate.industry ?? "Industry not supplied"}</p></div>
          <div><p className="discovery-meta"><MapPin aria-hidden className="mr-1 inline size-3.5" />{[candidate.city, candidate.region, countryName(candidate.countryCode)].filter(Boolean).join(", ")}</p>{candidate.address ? <p className="discovery-meta">{candidate.address}</p> : null}</div>
          <div><p className="discovery-meta">{candidate.domain ?? "No website listed"}</p>{candidate.phone ? <p className="discovery-meta">{candidate.phone}</p> : null}</div>
          <CandidateActions candidate={candidate} onSave={() => void save(candidate)} row={rows[candidate.externalId]} />
        </li>)}
      </ul>
      {meta.nextCursor ? <div className="discovery-more"><button className="discovery-secondary" disabled={pending} onClick={loadMore} type="button">{pending ? "Loading…" : "Load more results"}</button></div> : null}
    </> : null}

    {isEmpty ? <div className="discovery-empty"><Building2 aria-hidden className="size-7" /><h3>No matching businesses</h3><p>{meta?.providerName} covers this place but returned nothing for these filters. Try another industry, clear the keyword, or search a nearby city.</p></div> : null}
  </section>;
}
