import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { ObsidianOverview } from "@/components/app/obsidian-overview";
import { Card } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { dashboardLeadStatuses, dashboardProposalStatuses, getClientAcquisitionDashboard, parseDashboardFilters, type ClientAcquisitionDashboard } from "@/server/dashboard/queries";
import { getOverviewPipeline } from "@/server/dashboard/overview";
import { listOpportunityFeed } from "@/server/opportunities/queries";
import { getWorkspaceContext } from "@/server/workspaces/context";

export const metadata: Metadata = { title: "Client acquisition dashboard" };
const rangeLabels = { "7d": "Last 7 days", "30d": "Last 30 days", "90d": "Last 90 days", ytd: "Year to date", all: "All time" } as const;
const statusLabel = (value: string) => value === "all" ? "All statuses" : value.charAt(0).toUpperCase() + value.slice(1);

function DashboardFilters({ filters }: { filters: ClientAcquisitionDashboard["filters"] }) {
  return <form aria-label="Dashboard filters" className="obsidian-filter-form" method="get">
    <label>Date range<select defaultValue={filters.range} name="range">{Object.entries(rangeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    <label>Lead status<select defaultValue={filters.leadStatus} name="leadStatus">{dashboardLeadStatuses.map(value => <option key={value} value={value}>{value === "active" ? "Active only" : statusLabel(value)}</option>)}</select></label>
    <label>Proposal status<select defaultValue={filters.proposalStatus} name="proposalStatus">{dashboardProposalStatuses.map(value => <option key={value} value={value}>{statusLabel(value)}</option>)}</select></label>
    <button className={buttonVariants({ variant: "secondary" })} type="submit">Apply filters</button>
  </form>;
}

export default async function DashboardPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ workspace, scope }, params] = await Promise.all([getWorkspaceContext(), searchParams]);
  if (!workspace.onboardingCompleted) return <main className="mx-auto max-w-6xl px-5 py-10 sm:px-6 lg:px-8"><Card className="p-7 sm:p-10"><p className="font-mono text-xs uppercase tracking-[0.18em] text-cyan">Setup required</p><h1 className="mt-3 text-3xl font-semibold">Shape your first opportunity search.</h1><p className="mt-3 max-w-2xl text-muted-foreground">Tell HOAX1G.DEV STUDIOS what you sell, where you work, and which businesses fit. This creates workspace-owned services and your first ICP.</p><Link className={cn(buttonVariants(), "mt-7")} href="/app/onboarding">Continue onboarding <ArrowRight className="ml-2 size-4" /></Link></Card></main>;
  const filters = parseDashboardFilters(params);
  const asOf = new Date();
  const [dashboard, pipeline, opportunities] = await Promise.all([
    getClientAcquisitionDashboard(scope, filters, asOf),
    getOverviewPipeline(scope, filters, asOf),
    listOpportunityFeed(scope),
  ]);
  return <ObsidianOverview dashboard={dashboard} pipeline={pipeline} opportunities={opportunities} filters={<DashboardFilters filters={filters} />} />;
}
