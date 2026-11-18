import type { Metadata } from "next";
import Link from "next/link";
import { Lightbulb } from "lucide-react";
import { OpportunityFeedCard } from "@/components/app/opportunity-feed-card";
import { Card } from "@/components/ui/card";
import { listOpportunityFeed } from "@/server/opportunities/queries";
import { getWorkspaceContext } from "@/server/workspaces/context";

export const metadata: Metadata = { title: "Opportunities" };

export default async function OpportunityFeedPage({ searchParams }: { searchParams: Promise<{ selected?: string | string[] }> }) {
  const { scope, workspace } = await getWorkspaceContext("read");
  const [rows, params] = await Promise.all([listOpportunityFeed(scope), searchParams]);
  const selected = rows.find(row=>row.opportunityId===params.selected) ?? rows[0];
  return <main className="mx-auto max-w-7xl px-5 py-10 sm:px-6 lg:px-8">
    <div className="flex flex-wrap items-end justify-between gap-4"><div><p className="font-mono text-xs uppercase tracking-[0.18em] text-cyan">Opportunity intelligence</p><h1 className="mt-3 text-3xl font-semibold sm:text-4xl">Evidence-backed opportunities</h1><p className="mt-3 max-w-3xl text-muted-foreground">Ranked from completed audits and {workspace.name}&apos;s configured ICP. Scores support review; they do not predict a sale or trigger outreach.</p></div><span className="rounded-full border border-border px-3 py-1.5 font-mono text-xs text-muted-foreground">{rows.length} opportunities</span></div>
    {rows.length === 0 ? <Card className="mt-8 p-10 text-center"><Lightbulb className="mx-auto size-9 text-muted-foreground" /><h2 className="mt-4 font-semibold">No opportunities yet</h2><p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-muted-foreground">Opportunities appear here after a website audit completes for a company. An audit that has already been analysed is not recalculated; run a new audit to create a fresh analysis.</p><Link className="mt-6 inline-flex min-h-11 items-center rounded-lg border border-border px-4 text-sm font-medium hover:border-primary" href="/app/audits">Open audits</Link></Card> : <div className="mt-6 grid min-w-0 gap-5 2xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]"><Card className="min-w-0 self-start overflow-hidden"><div className="border-b border-border px-5 py-4"><h2 className="text-sm font-semibold">Opportunities <span className="text-muted-foreground">({rows.length})</span></h2></div><div className="overflow-x-auto"><table><thead><tr><th>Business</th><th>Industry</th><th>Lead priority</th><th>Evidence</th><th>CRM</th></tr></thead><tbody>{rows.map(row=><tr className={row.opportunityId===selected?.opportunityId ? "bg-primary/10" : "hover:bg-white/5"} key={row.opportunityId}><td><Link aria-current={row.opportunityId===selected?.opportunityId ? "true" : undefined} className="font-medium hover:text-primary" href={"?selected="+row.opportunityId}>{row.companyName}</Link><p className="mt-1 text-[11px] text-muted-foreground">{row.city || "Location not supplied"}</p></td><td className="text-xs text-muted-foreground">{row.industry || "Not supplied"}</td><td><span className="rounded-full border border-cyan/40 px-2 py-1 text-xs text-cyan">{row.totalScore}/100</span></td><td className="text-xs">{row.evidenceCount} · {row.confidence}</td><td className="text-xs text-muted-foreground">{row.crm.label}</td></tr>)}</tbody></table></div></Card><aside aria-label="Selected opportunity evidence" className="min-w-0">{selected ? <OpportunityFeedCard row={selected} /> : null}</aside></div>}
  </main>;
}
