import type { Metadata } from "next";
import Link from "next/link";
import { Activity, ArrowRight, BadgeDollarSign, Building2, CheckCircle2, ClipboardCheck, FileCheck2, FilePlus2, Import, ListTodo, SearchCheck, Target, Users } from "lucide-react";
import { formatMinorAmount } from "@/modules/analytics/metrics";
import { CreatorBrand, Hoax1gWordmark } from "@/components/brand/hoax1g-brand";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { dashboardLeadStatuses, dashboardProposalStatuses, getClientAcquisitionDashboard, parseDashboardFilters, type ClientAcquisitionDashboard } from "@/server/dashboard/queries";
import { getWorkspaceContext } from "@/server/workspaces/context";

export const metadata: Metadata = { title: "Client acquisition dashboard" };
const rangeLabels = { "7d": "Last 7 days", "30d": "Last 30 days", "90d": "Last 90 days", all: "All time" } as const;
const statusLabel = (value: string) => value === "all" ? "All statuses" : value.charAt(0).toUpperCase() + value.slice(1);

function DashboardFilters({ filters }: { filters: ClientAcquisitionDashboard["filters"] }) {
  return <form aria-label="Dashboard filters" className="grid gap-3 rounded-2xl border border-border bg-card p-4 sm:grid-cols-3 lg:flex lg:items-end" method="get">
    <label className="grid gap-1.5 text-sm font-medium">Date range<select className="min-h-11 rounded-lg border border-border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" defaultValue={filters.range} name="range">{Object.entries(rangeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    <label className="grid gap-1.5 text-sm font-medium">Lead status<select className="min-h-11 rounded-lg border border-border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" defaultValue={filters.leadStatus} name="leadStatus">{dashboardLeadStatuses.map((value) => <option key={value} value={value}>{value === "active" ? "Active only" : statusLabel(value)}</option>)}</select></label>
    <label className="grid gap-1.5 text-sm font-medium">Proposal status<select className="min-h-11 rounded-lg border border-border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" defaultValue={filters.proposalStatus} name="proposalStatus">{dashboardProposalStatuses.map((value) => <option key={value} value={value}>{statusLabel(value)}</option>)}</select></label>
    <button className={cn(buttonVariants({ variant: "secondary" }), "w-full lg:w-auto")} type="submit">Apply filters</button>
  </form>;
}

function MetricCard({ label, value, detail, icon: Icon }: { label: string; value: React.ReactNode; detail?: string; icon: typeof Building2 }) {
  return <Card className="relative overflow-hidden p-5 transition-[border-color,background-color] hover:border-primary/35 hover:bg-surface-elevated"><div aria-hidden="true" className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/70 to-cyan/60" /><div className="flex items-start justify-between gap-3"><p className="text-sm font-medium text-muted-foreground">{label}</p><span className="rounded-lg border border-primary/15 bg-primary/10 p-2 text-primary shadow-[var(--shadow-neon-soft)]"><Icon className="size-4" /></span></div><div className="mt-4 font-mono text-2xl font-semibold tracking-tight sm:text-3xl">{value}</div>{detail ? <p className="mt-2 text-xs leading-5 text-muted-foreground">{detail}</p> : null}</Card>;
}

function PipelineValue({ pipeline }: { pipeline: ClientAcquisitionDashboard["metrics"]["pipeline"] }) {
  if (pipeline === null) return <span className="text-base">Role restricted</span>;
  if (pipeline.length === 0) return <span className="text-base">No valued deals</span>;
  if (pipeline.every((row) => row.count === row.unvaluedCount)) return <span className="text-base">Not valued</span>;
  return <span className="flex flex-wrap gap-x-2 gap-y-1">{pipeline.map((row) => <span key={row.currency}>{formatMinorAmount(row.valueMinor, row.currency)}</span>)}</span>;
}

function Funnel({ rows }: { rows: ClientAcquisitionDashboard["funnel"] }) {
  const max = Math.max(1, ...rows.map((row) => row.count));
  return <Card className="p-5 sm:p-6"><div className="flex items-start justify-between gap-4"><div><h2 className="text-lg font-semibold">Sales funnel</h2><p className="mt-1 text-sm text-muted-foreground">Distinct businesses or leads at each acquisition stage.</p></div><Target className="size-5 text-primary" /></div><ol className="mt-6 space-y-4">{rows.map((row, index) => <li key={row.key}><div className="mb-1.5 flex items-center justify-between gap-4 text-sm"><Link className="font-medium hover:text-primary hover:underline" href={row.href}>{index + 1}. {row.label}</Link><span className="font-mono font-semibold">{row.count}</span></div><div aria-label={`${row.label}: ${row.count}`} className="h-2.5 overflow-hidden rounded-full bg-muted" role="img"><div className="h-full rounded-full bg-gradient-to-r from-primary to-cyan" style={{ width: row.count === 0 ? "0%" : `${Math.max(4, (row.count / max) * 100)}%` }} /></div></li>)}</ol></Card>;
}

function RecentActivity({ rows }: { rows: ClientAcquisitionDashboard["recentActivity"] }) {
  return <Card className="p-5 sm:p-6"><div className="flex items-start justify-between gap-4"><div><h2 className="text-lg font-semibold">Recent activity</h2><p className="mt-1 text-sm text-muted-foreground">Latest workspace events in the selected range.</p></div><Activity className="size-5 text-cyan" /></div>{rows.length === 0 ? <div className="mt-6 rounded-xl border border-dashed border-border p-6 text-center"><p className="font-medium">No activity in this period</p><p className="mt-1 text-sm text-muted-foreground">Choose a wider date range or import prospects to begin.</p></div> : <ul className="mt-5 divide-y divide-border">{rows.map((row) => <li className="py-3 first:pt-0 last:pb-0" key={row.id}><Link className="group block rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" href={row.href}><div className="flex items-start justify-between gap-4"><div className="min-w-0"><p className="truncate text-sm font-medium group-hover:text-primary">{row.title}</p><p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{row.detail}</p></div><time className="shrink-0 font-mono text-[11px] text-muted-foreground" dateTime={row.occurredAt.toISOString()}>{row.occurredAt.toLocaleDateString("en-ZA", { day: "2-digit", month: "short" })}</time></div></Link></li>)}</ul>}</Card>;
}

function PriorityGroup({ title, empty, rows }: { title: string; empty: string; rows: readonly { id: string; label: string; href: string }[] }) {
  const headingId = `priority-${title.replaceAll(" ", "-").toLowerCase()}`;
  return <section aria-labelledby={headingId}><div className="flex items-center justify-between gap-3"><h3 className="text-sm font-semibold" id={headingId}>{title}</h3><span className="rounded-full bg-muted px-2 py-0.5 font-mono text-xs">{rows.length}</span></div>{rows.length === 0 ? <p className="mt-2 text-xs text-muted-foreground">{empty}</p> : <ul className="mt-2 space-y-1">{rows.map((row) => <li key={row.id}><Link className="flex min-h-9 items-center justify-between gap-3 rounded-lg px-2 text-sm hover:bg-muted hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" href={row.href}><span className="truncate">{row.label}</span><ArrowRight className="size-3.5 shrink-0" /></Link></li>)}</ul>}</section>;
}

function QuickActions() {
  const actions = [{ label: "Import prospects", href: "/app/discover/search", icon: Import }, { label: "View opportunities", href: "/app/discover/opportunities", icon: SearchCheck }, { label: "Open CRM", href: "/app/leads", icon: Users }, { label: "Create proposal", href: "/app/proposals", icon: FilePlus2 }];
  return <section aria-labelledby="quick-actions-heading"><h2 className="text-lg font-semibold" id="quick-actions-heading">Quick actions</h2><div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{actions.map(({ label, href, icon: Icon }) => <Link className="flex min-h-14 items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 text-sm font-semibold transition-colors hover:border-primary/60 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" href={href} key={href}><span className="flex items-center gap-3"><Icon className="size-4 text-primary" />{label}</span><ArrowRight className="size-4 text-muted-foreground" /></Link>)}</div></section>;
}

export default async function DashboardPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ workspace, scope }, params] = await Promise.all([getWorkspaceContext(), searchParams]);
  if (!workspace.onboardingCompleted) return <main className="mx-auto max-w-6xl px-5 py-10 sm:px-6 lg:px-8"><Card className="p-7 sm:p-10"><p className="font-mono text-xs uppercase tracking-[0.18em] text-cyan">Setup required</p><h1 className="mt-3 text-3xl font-semibold">Shape your first opportunity search.</h1><p className="mt-3 max-w-2xl text-muted-foreground">Tell PRIZM.DEV what you sell, where you work, and which businesses fit. This creates workspace-owned services and your first ICP.</p><Link className={cn(buttonVariants(), "mt-7")} href="/app/onboarding">Continue onboarding <ArrowRight className="ml-2 size-4" /></Link></Card></main>;

  const filters = parseDashboardFilters(params);
  const dashboard = await getClientAcquisitionDashboard(scope, filters);
  const pipelineCount = dashboard.metrics.pipeline?.reduce((sum, row) => sum + row.count, 0);
  const unvaluedPipelineCount = dashboard.metrics.pipeline?.reduce((sum, row) => sum + row.unvaluedCount, 0);
  const metricCards = [
    { label: "Total prospects", value: dashboard.metrics.prospects, detail: rangeLabels[filters.range], icon: Building2 },
    { label: "Audited businesses", value: dashboard.metrics.auditedBusinesses, detail: "Completed website audits", icon: ClipboardCheck },
    { label: "Opportunities", value: dashboard.metrics.opportunities, detail: "Evidence-backed findings", icon: Target },
    { label: "Active CRM leads", value: dashboard.metrics.activeLeads, detail: `${statusLabel(filters.leadStatus)} lead filter`, icon: Users },
    { label: "Pipeline value", value: <PipelineValue pipeline={dashboard.metrics.pipeline} />, detail: pipelineCount === undefined ? "Owner and admin access only" : `${pipelineCount} open deal${pipelineCount === 1 ? "" : "s"}${unvaluedPipelineCount ? `; ${unvaluedPipelineCount} not valued` : "; currencies separated"}`, icon: BadgeDollarSign },
    { label: "Awaiting approval", value: dashboard.metrics.pendingProposals, detail: "Draft proposals requiring a person", icon: FileCheck2 },
  ];

  const usesHoax1gWordmark = workspace.name.trim().toUpperCase() === "HOAX1G.DEV";

  return <main className="relative mx-auto max-w-[1500px] px-4 py-8 sm:px-6 sm:py-10 lg:px-8"><section className="relative overflow-hidden rounded-3xl border border-border bg-[linear-gradient(125deg,rgba(20,16,37,0.96),rgba(7,4,15,0.92))] p-5 shadow-[var(--shadow-elevated)] sm:p-7" aria-labelledby="dashboard-heading"><div aria-hidden="true" className="absolute -right-24 -top-36 size-96 rounded-full bg-primary/15 blur-[100px]" /><div aria-hidden="true" className="absolute -bottom-24 right-1/3 size-60 rounded-full bg-cyan/5 blur-[90px]" /><div className="relative flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between"><div><div className="flex flex-wrap items-center gap-3"><p className="font-mono text-xs uppercase tracking-[0.18em] text-cyan">Client acquisition command centre</p><CreatorBrand className="hidden sm:inline-flex" showArtwork={false} /></div><h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl" id="dashboard-heading">{usesHoax1gWordmark ? <Hoax1gWordmark className="max-w-[30rem]" priority /> : workspace.name}</h1><p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">Live workspace data from prospect discovery through human-approved proposals.</p></div><DashboardFilters filters={filters} /></div></section>
    <section aria-labelledby="overview-heading" className="mt-8"><div className="flex items-center justify-between gap-4"><h2 className="text-lg font-semibold" id="overview-heading">Overview</h2><p className="text-xs text-muted-foreground">Updated <time dateTime={dashboard.asOf.toISOString()}>{dashboard.asOf.toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" })}</time></p></div><div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">{metricCards.map((card) => <MetricCard {...card} key={card.label} />)}</div></section>
    <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]"><Funnel rows={dashboard.funnel} /><RecentActivity rows={dashboard.recentActivity} /></div>
    <Card className="mt-6 p-5 sm:p-6"><div className="flex items-start justify-between gap-4"><div><h2 className="text-lg font-semibold">Priority actions</h2><p className="mt-1 text-sm text-muted-foreground">Work that needs a human decision or follow-up.</p></div><ListTodo className="size-5 text-primary" /></div><div className="mt-5 grid gap-6 md:grid-cols-3 md:divide-x md:divide-border"><PriorityGroup empty="No overdue follow-ups." rows={dashboard.priorities.overdueFollowUps} title="Leads needing follow-up" /><div className="md:pl-6"><PriorityGroup empty="Every opportunity is linked to a lead." rows={dashboard.priorities.unreviewedOpportunities} title="Unreviewed opportunities" /></div><div className="md:pl-6"><PriorityGroup empty="No proposals await approval." rows={dashboard.priorities.pendingApprovals} title="Pending approvals" /></div></div></Card>
    <div className="mt-6"><QuickActions /></div><div className="mt-6 flex items-center gap-2 text-xs text-muted-foreground"><CheckCircle2 className="size-4 text-cyan" /><span>All figures are server-aggregated and limited to your active workspace.</span></div></main>;
}
