import Link from "next/link";
import { ArrowRight, Building2, CalendarDays, ChevronRight, Database, FileText, Info, Laptop, Layers, Search, Users } from "lucide-react";
import { formatMinorAmount } from "@/modules/analytics/metrics";
import { dashboardRangeStart, type ClientAcquisitionDashboard } from "@/server/dashboard/queries";
import type { getOverviewPipeline } from "@/server/dashboard/overview";
import type { listOpportunityFeed } from "@/server/opportunities/queries";

type Props = {
  dashboard: ClientAcquisitionDashboard;
  pipeline: Awaited<ReturnType<typeof getOverviewPipeline>>;
  opportunities: Awaited<ReturnType<typeof listOpportunityFeed>>;
  filters: React.ReactNode;
};

function PipelineChart({ dashboard, pipeline }: Pick<Props, "dashboard" | "pipeline">) {
  const currency = dashboard.metrics.pipeline?.find(row => row.currency === "ZAR")?.currency ?? dashboard.metrics.pipeline?.[0]?.currency ?? "ZAR";
  const symbol = currency === "ZAR" ? "R" : currency;
  const rows = pipeline.deals?.filter(row => row.currency === currency && row.valueMinor !== null) ?? [];
  const end = dashboard.asOf.getTime();
  const start = dashboardRangeStart(dashboard.filters.range, dashboard.asOf)?.getTime() ?? end - Math.max(30, Math.ceil((end - (rows[0]?.createdAt.getTime() ?? end)) / 86_400_000)) * 86_400_000;
  const total = rows.reduce((sum, row) => sum + (row.valueMinor ?? 0), 0);
  const max = Math.max(10000, Math.ceil(total / 10000) * 10000);
  let cumulative = 0;
  const points = [{ x: 76, y: 164 }];
  for (const row of rows) {
    cumulative += row.valueMinor ?? 0;
    points.push({ x: 76 + Math.max(0, Math.min(1, (row.createdAt.getTime() - start) / (end - start))) * 754, y: 164 - cumulative / max * 128 });
  }
  points.push({ x: 830, y: 164 - cumulative / max * 128 });
  const path = points.map((point, index) => {
    const previous = points[index - 1];
    if (!previous) return `M${point.x},${point.y}`;
    const middle = (previous.x + point.x) / 2;
    return `C${middle},${previous.y} ${middle},${point.y} ${point.x},${point.y}`;
  }).join(" ");
  return <section className="obsidian-panel obsidian-chart" aria-labelledby="pipeline-heading">
    <div className="obsidian-panel-heading"><h2 id="pipeline-heading">Pipeline value ({symbol})</h2><nav className="obsidian-ranges" aria-label="Pipeline date range">{([['7d', '7D'], ['30d', '30D'], ['90d', '90D'], ['ytd', 'YTD']] as const).map(([value, label]) => <Link key={value} aria-current={dashboard.filters.range === value ? "page" : undefined} href={`?${new URLSearchParams({ ...dashboard.filters, range: value })}`}>{label}</Link>)}</nav></div>
    <svg viewBox="0 0 860 190" role="img" aria-labelledby="pipeline-chart-title" className="obsidian-chart-svg"><title id="pipeline-chart-title">{`Current open ${currency} pipeline, accumulated by deal creation date`}</title><defs><linearGradient id="obsidian-line"><stop stopColor="#18dce9" /><stop offset=".46" stopColor="#28c4ee" /><stop offset=".7" stopColor="#9146fa" /><stop offset="1" stopColor="#b72dff" /></linearGradient><linearGradient id="obsidian-area" x1="0" y1="0" x2="0" y2="1"><stop stopColor="#9026f6" stopOpacity=".55" /><stop offset="1" stopColor="#9026f6" stopOpacity=".02" /></linearGradient></defs>
      {[0, 1, 2, 3, 4, 5].map(i => <g key={i}><line x1="76" x2="830" y1={36 + i * 25.6} y2={36 + i * 25.6} stroke="#ffffff" strokeOpacity=".075" /><text x="63" y={40 + i * 25.6} textAnchor="end">{symbol}{Math.round(max * (1 - i / 5) / 100).toLocaleString("en-ZA")}</text></g>)}
      {Array.from({ length: 11 }, (_, i) => <g key={i}><line x1={76 + i * 75.4} x2={76 + i * 75.4} y1="36" y2="164" stroke="#ffffff" strokeOpacity=".045" /><text x={76 + i * 75.4} y="184" textAnchor="middle">{new Date(start + (end - start) * i / 10).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Africa/Johannesburg" })}</text></g>)}
      {rows.length > 0 && <><path d={`${path} L830,164 L76,164 Z`} fill="url(#obsidian-area)" /><path d={path} fill="none" stroke="url(#obsidian-line)" strokeWidth="2.7" strokeLinejoin="round" /><circle cx="830" cy={164 - total / max * 128} r="4" fill="white" stroke="#af40ff" strokeWidth="3" className="obsidian-chart-dot" /></>}
      {!rows.length && <text x="455" y="101" textAnchor="middle" className="obsidian-chart-empty">{pipeline.deals === null ? "Revenue is restricted to owners and admins" : "No valued open deals in this period"}</text>}
    </svg><p className="obsidian-chart-note">Current open deals by creation date · {currency}</p>
  </section>;
}

export function ObsidianOverview({ dashboard, pipeline, opportunities, filters }: Props) {
  const metrics = dashboard.metrics;
  const pipelineValue = metrics.pipeline === null ? "Restricted" : !metrics.pipeline.length ? "R0" : metrics.pipeline.map(row => row.count === row.unvaluedCount ? `${row.currency} unvalued` : formatMinorAmount(row.valueMinor, row.currency)).join(" · ");
  const cards = [
    { label: "Qualified leads", value: pipeline.qualifiedLeads, icon: Users, tone: "purple", detail: "Qualified in selected period" },
    { label: "Audits ready", value: metrics.auditedBusinesses, icon: Layers, tone: "cyan", detail: "Completed website audits" },
    { label: "Proposals", value: dashboard.funnel.find(row => row.key === "proposals")?.count ?? 0, icon: FileText, tone: "purple", detail: "Leads with proposals" },
    { label: "Pipeline", value: pipelineValue, icon: Database, tone: "cyan", detail: "Open deals · selected period" },
  ];
  const review = [
    { count: dashboard.priorities.unreviewedOpportunities.length, label: "businesses to qualify", detail: "High-fit matches from your target markets", icon: Layers, tone: "purple", href: "/app/discover/opportunities" },
    { count: metrics.auditedBusinesses, label: "audits completed", detail: "Review and select for proposal", icon: Laptop, tone: "cyan", href: "/app/audits" },
    { count: metrics.pendingProposals, label: "proposals to review", detail: "Drafts ready for final review", icon: FileText, tone: "purple", href: "/app/proposals?status=draft" },
    { count: metrics.activeLeads, label: "active opportunities", detail: "Keep your client conversations moving", icon: Users, tone: "cyan", href: "/app/crm/pipeline" },
    { count: dashboard.priorities.overdueFollowUps.length, label: "follow-ups due", detail: "Keep your pipeline moving", icon: CalendarDays, tone: "purple", href: "/app/crm/tasks" },
  ];
  return <main className="obsidian-overview">
    <header className="obsidian-welcome"><div><h1>Your acquisition workspace</h1><p>Discover, qualify and win the right clients for your development business.</p></div><Link href="/app/discover/search" className="obsidian-discover"><Search size={23} />Discover businesses</Link></header>
    <section aria-label="Workspace overview" className="obsidian-metrics">{cards.map(({ label, value, icon: Icon, tone, detail }) => <article className="obsidian-panel obsidian-metric" key={label}><span className={`obsidian-icon ${tone}`}><Icon /></span><div><h2>{label}</h2><p className="obsidian-metric-value">{value}</p><p className="obsidian-metric-detail">{detail}</p></div></article>)}</section>
    <div className="obsidian-overview-grid"><div className="obsidian-primary-column"><PipelineChart dashboard={dashboard} pipeline={pipeline} /><section className="obsidian-panel obsidian-opportunities" aria-labelledby="opportunities-heading"><div className="obsidian-panel-heading"><h2 id="opportunities-heading">Opportunities</h2><Link href="/app/discover/opportunities">View all opportunities <ArrowRight size={16} /></Link></div><div className="obsidian-table-scroll"><table><thead><tr><th>Company</th><th>Score <Info size={14} /></th><th>Stage</th><th>Next action</th><th><span className="sr-only">Open</span></th></tr></thead><tbody>{opportunities.slice(0, 5).map(row => <tr key={row.opportunityId}><td><Link className="obsidian-company" href={`/app/companies/${row.companyId}`}><span className="obsidian-company-icon"><Building2 size={18} /></span><span><strong>{row.companyName}</strong><small>{row.industry || "Industry not supplied"}</small></span></Link></td><td><span className="obsidian-score">{row.totalScore}</span></td><td><span className={`obsidian-stage ${row.crm.kind === "none" ? "purple" : "cyan"}`}>{row.crm.kind === "none" ? "Discovery" : row.crm.status.charAt(0).toUpperCase() + row.crm.status.slice(1)}</span></td><td><Link className="obsidian-next-action" href={`/app/discover/opportunities?selected=${row.opportunityId}`}><CalendarDays size={16} />{row.crm.kind === "none" ? "Qualify and schedule audit" : "Review opportunity and next steps"}</Link></td><td><Link aria-label={`Review ${row.companyName}`} href={`/app/discover/opportunities?selected=${row.opportunityId}`}><ChevronRight size={17} /></Link></td></tr>)}</tbody></table></div>{!opportunities.length && <div className="obsidian-empty"><Building2 size={27} /><h3>Your next opportunity starts here</h3><p>Discover businesses and complete an audit to build your pipeline.</p><Link href="/app/discover/search">Discover businesses <ArrowRight size={15} /></Link></div>}</section></div>
      <aside className="obsidian-panel obsidian-review" aria-labelledby="review-heading"><h2 id="review-heading">Needs your review <span>{review.filter(row => row.count > 0).length}</span></h2><div className="obsidian-review-list">{review.map(({ count, label, detail, icon: Icon, tone, href }) => <Link href={href} key={label} className="obsidian-review-item"><span className={`obsidian-icon ${tone}`}><Icon /></span><span><strong>{count} {label}</strong><small>{detail}</small></span><ChevronRight size={20} /></Link>)}</div></aside>
    </div><details className="obsidian-tools"><summary>Workspace filters & activity</summary><div className="obsidian-tools-content">{filters}<h2>Recent activity</h2>{dashboard.recentActivity.length ? dashboard.recentActivity.slice(0, 5).map(row => <Link key={row.id} href={row.href}>{row.title} <span>{row.detail}</span></Link>) : <p>No activity in this period.</p>}<div className="obsidian-secondary-links"><Link href="/app/kits">Capability kits</Link><Link href="/app/companies">All companies</Link><Link href="/app/leads">Leads & contacts</Link></div></div></details>
  </main>;
}
