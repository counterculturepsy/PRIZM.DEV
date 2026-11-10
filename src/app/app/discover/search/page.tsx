import type { Metadata } from "next";
import Link from "next/link";
import { Building2, ExternalLink, MapPin, Search } from "lucide-react";
import { CompanyCsvImportForm } from "@/components/forms/company-csv-import-form";
import { CompanyDiscoveryForm } from "@/components/forms/company-discovery-form";
import { SaveSearchForm } from "@/components/forms/save-search-form";
import { Card } from "@/components/ui/card";
import { Input, Label, selectClassName } from "@/components/ui/form-controls";
import { hasCapability } from "@/modules/workspaces/scope";
import { getDiscoveryStatus } from "@/server/prospecting/discovery";
import { COMPANY_PAGE_SIZE, countCompanyMatches, getCompanyFilterOptions, listCompanies, type CompanyFilters } from "@/server/prospecting/queries";
import { getWorkspaceContext } from "@/server/workspaces/context";

export const metadata: Metadata = { title: "Discover companies" };

function first(value: string | string[] | undefined): string | undefined { return typeof value === "string" && value.trim() ? value.trim().slice(0, 120) : undefined; }

export default async function CompanySearchPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { scope } = await getWorkspaceContext("read");
  const params = await searchParams;
  const filters = Object.fromEntries(Object.entries({ q: first(params.q), industry: first(params.industry), city: first(params.city), province: first(params.province) }).filter((entry): entry is [string, string] => Boolean(entry[1]))) as CompanyFilters;
  const [total, options] = await Promise.all([countCompanyMatches(scope, filters), getCompanyFilterOptions(scope)]);
  const totalPages = Math.max(1, Math.ceil(total / COMPANY_PAGE_SIZE));
  const requestedPage = Number.parseInt(first(params.page) ?? "1", 10);
  const page = Number.isFinite(requestedPage) && requestedPage > 0 ? Math.min(requestedPage, totalPages) : 1;
  const rows = await listCompanies(scope, filters, page);
  const canWrite = hasCapability(scope, "write");
  const discovery = getDiscoveryStatus();
  const pageHref = (target: number) => {
    const search = new URLSearchParams(filters as Record<string, string>);
    if (target > 1) search.set("page", String(target));
    const query = search.toString();
    return `/app/discover/search${query ? `?${query}` : ""}`;
  };

  return <main className="mx-auto max-w-7xl px-5 py-10 sm:px-6 lg:px-8">
    <div className="flex flex-wrap items-end justify-between gap-4"><div><p className="font-mono text-xs uppercase tracking-[0.18em] text-cyan">Prospect database</p><h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">Discover companies</h1><p className="mt-3 max-w-2xl text-muted-foreground">Search workspace-owned records. Add companies by CSV import{discovery.enabled ? ` or by external discovery through ${discovery.providerName}` : "; external discovery is switched off until a provider is configured and its terms are verified"}.</p></div><Link className="text-sm text-primary hover:underline" href="/app/discover/saved">View saved searches</Link></div>
    <Card className="mt-8 p-5 sm:p-6"><form className="grid gap-4 md:grid-cols-2 xl:grid-cols-5" method="get">
      <div className="grid gap-2 xl:col-span-2"><Label htmlFor="q">Company or domain</Label><Input defaultValue={filters.q} id="q" name="q" placeholder="Search records" /></div>
      {([['industry','Industry',options.industries],['province','Province',options.provinces],['city','City',options.cities]] as const).map(([name,label,values]) => <div className="grid gap-2" key={name}><Label htmlFor={name}>{label}</Label><select className={selectClassName} defaultValue={filters[name]} id={name} name={name}><option value="">All</option>{values.map((value) => <option key={value} value={value}>{value}</option>)}</select></div>)}
      <button className="min-h-11 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground xl:col-start-5" type="submit"><Search className="mr-2 inline size-4" />Search</button>
    </form></Card>
    {canWrite ? <Card className="mt-4 p-5 sm:p-6"><SaveSearchForm filters={filters} /></Card> : null}
    {canWrite ? (discovery.enabled
      ? <Card className="mt-4 p-5 sm:p-6"><p className="font-mono text-xs uppercase tracking-[0.18em] text-cyan">External discovery</p><h2 className="mt-3 text-lg font-semibold">Find companies with {discovery.providerName}</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">Results are saved to this workspace with source attribution. Companies already here are matched by domain or name and city, and your existing details are never overwritten. Data {discovery.license.attribution}, under the <a className="text-primary hover:underline" href={discovery.license.url} rel="noreferrer" target="_blank">{discovery.license.name}</a>.</p><div className="mt-5"><CompanyDiscoveryForm industries={discovery.industries} /></div></Card>
      : <Card className="mt-4 p-5 sm:p-6"><p className="font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground">External discovery</p><p className="mt-2 text-sm text-muted-foreground">{discovery.reason}</p></Card>) : null}
    <div className="mt-8 flex items-center justify-between"><h2 className="text-xl font-semibold">{total} {total === 1 ? "company" : "companies"}</h2><span className="text-xs text-muted-foreground">{total > COMPANY_PAGE_SIZE ? `Page ${page} of ${totalPages}` : "Workspace records"}</span></div>
    {rows.length === 0 ? <Card className="mt-4 p-8 text-center"><Building2 className="mx-auto size-8 text-muted-foreground" /><h2 className="mt-4 font-semibold">No companies match</h2><p className="mt-2 text-sm text-muted-foreground">Change the filters or import an approved CSV below.</p></Card> : <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">{rows.map((company) => <Card className="p-5" key={company.id}><div className="flex items-start justify-between gap-3"><div><h2 className="font-semibold"><Link className="hover:text-primary" href={`/app/companies/${company.id}`}>{company.name}</Link></h2><p className="mt-1 text-sm text-muted-foreground">{company.industry ?? "Industry not supplied"}</p></div><Link aria-label={`Open ${company.name}`} href={`/app/companies/${company.id}`}><ExternalLink className="size-4 text-muted-foreground" /></Link></div><p className="mt-5 flex items-center gap-2 text-sm text-muted-foreground"><MapPin className="size-4" />{[company.city, company.province, company.countryCode].filter(Boolean).join(", ")}</p>{company.domain ? <p className="mt-2 font-mono text-xs text-cyan">{company.domain}</p> : null}</Card>)}</div>}
    {totalPages > 1 ? <nav aria-label="Pagination" className="mt-6 flex items-center justify-between text-sm">{page > 1 ? <Link className="text-primary hover:underline" href={pageHref(page - 1)}>Previous page</Link> : <span />}<span className="text-muted-foreground">Page {page} of {totalPages}</span>{page < totalPages ? <Link className="text-primary hover:underline" href={pageHref(page + 1)}>Next page</Link> : <span />}</nav> : null}
    {canWrite ? <Card className="mt-10 grid gap-8 p-6 lg:grid-cols-[1fr_1.2fr]"><div><p className="font-mono text-xs uppercase tracking-[0.18em] text-primary">Controlled ingestion</p><h2 className="mt-3 text-xl font-semibold">Import an approved CSV</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">Records are tenant-scoped, deduplicated by domain or normalized identity, and retain a user-supplied source record. PRIZM.DEV does not crawl the listed sites.</p></div><CompanyCsvImportForm /></Card> : null}
  </main>;
}
