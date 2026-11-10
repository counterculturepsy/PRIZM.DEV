import type { Metadata } from "next";
import Link from "next/link";
import { Lightbulb } from "lucide-react";
import { OpportunityFeedCard } from "@/components/app/opportunity-feed-card";
import { Card } from "@/components/ui/card";
import { listOpportunityFeed } from "@/server/opportunities/queries";
import { getWorkspaceContext } from "@/server/workspaces/context";

export const metadata: Metadata = { title: "Opportunities" };

export default async function OpportunityFeedPage() {
  const { scope, workspace } = await getWorkspaceContext("read");
  const rows = await listOpportunityFeed(scope);
  return <main className="mx-auto max-w-7xl px-5 py-10 sm:px-6 lg:px-8">
    <div className="flex flex-wrap items-end justify-between gap-4"><div><p className="font-mono text-xs uppercase tracking-[0.18em] text-cyan">Opportunity intelligence</p><h1 className="mt-3 text-3xl font-semibold sm:text-4xl">Evidence-backed opportunities</h1><p className="mt-3 max-w-3xl text-muted-foreground">Ranked from completed audits and {workspace.name}&apos;s configured ICP. Scores support review; they do not predict a sale or trigger outreach.</p></div><span className="rounded-full border border-border px-3 py-1.5 font-mono text-xs text-muted-foreground">{rows.length} opportunities</span></div>
    {rows.length === 0 ? <Card className="mt-8 p-10 text-center"><Lightbulb className="mx-auto size-9 text-muted-foreground" /><h2 className="mt-4 font-semibold">No opportunities yet</h2><p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-muted-foreground">Opportunities appear here after a website audit completes for a company. An audit that has already been analysed is not recalculated; run a new audit to create a fresh analysis.</p><Link className="mt-6 inline-flex min-h-11 items-center rounded-lg border border-border px-4 text-sm font-medium hover:border-primary" href="/app/audits">Open audits</Link></Card> : <div className="mt-8 grid gap-4 lg:grid-cols-2">{rows.map((row) => <OpportunityFeedCard key={row.opportunityId} row={row} />)}</div>}
  </main>;
}
