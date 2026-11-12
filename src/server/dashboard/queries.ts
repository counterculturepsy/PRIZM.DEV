import {
  and,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lte,
  notInArray,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { canViewRevenueReport } from "@/modules/analytics/metrics";
import type { WorkspaceScope } from "@/modules/workspaces/scope";
import { getDatabase } from "@/server/db";
import {
  auditLogs,
  companies,
  crmActivities,
  crmTasks,
  deals,
  discoveryRuns,
  leads,
  opportunities,
  proposals,
  websiteAudits,
  websites,
} from "@/server/db/schema";
import { tenantWhere } from "@/server/db/tenant";

export const dashboardRanges = ["7d", "30d", "90d", "all"] as const;
export const dashboardLeadStatuses = ["active", "all", "new", "qualified", "unqualified", "converted", "archived"] as const;
export const dashboardProposalStatuses = ["all", "draft", "approved", "declined", "expired", "superseded"] as const;

export type DashboardRange = (typeof dashboardRanges)[number];
export type DashboardLeadStatus = (typeof dashboardLeadStatuses)[number];
export type DashboardProposalStatus = (typeof dashboardProposalStatuses)[number];
export type DashboardFilters = Readonly<{
  range: DashboardRange;
  leadStatus: DashboardLeadStatus;
  proposalStatus: DashboardProposalStatus;
}>;

export type DashboardActivity = Readonly<{
  id: string;
  kind: "import" | "audit" | "opportunity" | "crm" | "proposal";
  title: string;
  detail: string;
  occurredAt: Date;
  href: string;
}>;

type CurrencyValue = Readonly<{ currency: string; count: number; valueMinor: number; unvaluedCount: number }>;

export type ClientAcquisitionDashboard = Readonly<{
  asOf: Date;
  filters: DashboardFilters;
  metrics: Readonly<{
    prospects: number;
    auditedBusinesses: number;
    opportunities: number;
    activeLeads: number;
    pipeline: readonly CurrencyValue[] | null;
    pendingProposals: number;
  }>;
  funnel: readonly Readonly<{ key: string; label: string; count: number; href: string }>[];
  recentActivity: readonly DashboardActivity[];
  priorities: Readonly<{
    overdueFollowUps: readonly Readonly<{ id: string; label: string; dueAt: Date | null; href: string }>[];
    unreviewedOpportunities: readonly Readonly<{ id: string; label: string; href: string }>[];
    pendingApprovals: readonly Readonly<{ id: string; label: string; href: string }>[];
  }>;
}>;

const DAY_MS = 24 * 60 * 60 * 1000;

function numeric(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  if (!Number.isFinite(parsed) || !Number.isSafeInteger(Math.trunc(parsed))) throw new Error("Dashboard aggregate is outside the supported numeric range");
  return parsed;
}

function rangeStart(range: DashboardRange, asOf: Date): Date | null {
  if (range === "all") return null;
  return new Date(asOf.getTime() - Number.parseInt(range, 10) * DAY_MS);
}

function withinRange(column: Parameters<typeof gte>[0], start: Date | null, asOf: Date): SQL {
  return start ? and(gte(column, start), lte(column, asOf))! : lte(column, asOf);
}

function selectedLeadStatus(status: DashboardLeadStatus): SQL | undefined {
  if (status === "all") return undefined;
  if (status === "active") return notInArray(leads.status, ["unqualified", "archived"]);
  return eq(leads.status, status);
}

function selectedProposalStatus(status: DashboardProposalStatus): SQL | undefined {
  return status === "all" ? undefined : eq(proposals.status, status);
}

export function parseDashboardFilters(input: Record<string, string | string[] | undefined>): DashboardFilters {
  const value = (key: string) => {
    const raw = input[key];
    return Array.isArray(raw) ? raw[0] : raw;
  };
  const rangeValue = value("range");
  const leadValue = value("leadStatus");
  const proposalValue = value("proposalStatus");
  return {
    range: dashboardRanges.includes(rangeValue as DashboardRange) ? rangeValue as DashboardRange : "30d",
    leadStatus: dashboardLeadStatuses.includes(leadValue as DashboardLeadStatus) ? leadValue as DashboardLeadStatus : "active",
    proposalStatus: dashboardProposalStatuses.includes(proposalValue as DashboardProposalStatus) ? proposalValue as DashboardProposalStatus : "all",
  };
}

export async function getClientAcquisitionDashboard(
  scope: WorkspaceScope,
  filters: DashboardFilters,
  asOf = new Date(),
): Promise<ClientAcquisitionDashboard> {
  if (!Number.isFinite(asOf.getTime())) throw new Error("Dashboard as-of time is invalid");
  const db = getDatabase();
  const start = rangeStart(filters.range, asOf);
  const leadStatus = selectedLeadStatus(filters.leadStatus);
  const proposalStatus = selectedProposalStatus(filters.proposalStatus);

  const [
    prospectRows,
    auditRows,
    opportunityRows,
    leadRows,
    proposalRows,
    approvedRows,
    importActivity,
    auditActivity,
    opportunityActivity,
    crmActivity,
    proposalActivity,
    followUps,
    unreviewed,
    pendingCountRows,
    pending,
  ] = await Promise.all([
    db.select({ count: sql<number>`count(*)::int` }).from(companies)
      .where(and(tenantWhere(companies.workspaceId, scope), withinRange(companies.createdAt, start, asOf))),
    db.select({ count: sql<number>`count(distinct ${websites.companyId})::int` }).from(websiteAudits)
      .innerJoin(websites, and(eq(websites.workspaceId, websiteAudits.workspaceId), eq(websites.id, websiteAudits.websiteId)))
      .where(and(tenantWhere(websiteAudits.workspaceId, scope), eq(websiteAudits.status, "completed"), withinRange(websiteAudits.completedAt, start, asOf))),
    db.select({ count: sql<number>`count(*)::int`, companies: sql<number>`count(distinct ${opportunities.companyId})::int` }).from(opportunities)
      .where(and(tenantWhere(opportunities.workspaceId, scope), withinRange(opportunities.createdAt, start, asOf))),
    db.select({ count: sql<number>`count(*)::int` }).from(leads)
      .leftJoin(deals, and(eq(deals.workspaceId, leads.workspaceId), eq(deals.leadId, leads.id)))
      .where(and(
        tenantWhere(leads.workspaceId, scope),
        withinRange(leads.createdAt, start, asOf),
        leadStatus,
        or(isNull(deals.stage), notInArray(deals.stage, ["won", "lost"])),
      )),
    db.select({ count: sql<number>`count(*)::int`, leads: sql<number>`count(distinct ${proposals.leadId})::int` }).from(proposals)
      .where(and(tenantWhere(proposals.workspaceId, scope), withinRange(proposals.createdAt, start, asOf), proposalStatus)),
    db.select({ count: sql<number>`count(distinct ${proposals.leadId})::int` }).from(proposals)
      .where(and(tenantWhere(proposals.workspaceId, scope), eq(proposals.status, "approved"), withinRange(proposals.approvedAt, start, asOf))),
    db.select({ id: discoveryRuns.id, provider: discoveryRuns.provider, status: discoveryRuns.status, resultCount: discoveryRuns.resultCount, occurredAt: discoveryRuns.startedAt })
      .from(discoveryRuns).where(and(tenantWhere(discoveryRuns.workspaceId, scope), withinRange(discoveryRuns.startedAt, start, asOf)))
      .orderBy(desc(discoveryRuns.startedAt)).limit(5),
    db.select({ id: websiteAudits.id, status: websiteAudits.status, company: companies.name, occurredAt: websiteAudits.completedAt })
      .from(websiteAudits)
      .innerJoin(websites, and(eq(websites.workspaceId, websiteAudits.workspaceId), eq(websites.id, websiteAudits.websiteId)))
      .innerJoin(companies, and(eq(companies.workspaceId, websites.workspaceId), eq(companies.id, websites.companyId)))
      .where(and(tenantWhere(websiteAudits.workspaceId, scope), inArray(websiteAudits.status, ["completed", "partial"]), withinRange(websiteAudits.completedAt, start, asOf)))
      .orderBy(desc(websiteAudits.completedAt)).limit(5),
    db.select({ id: opportunities.id, title: opportunities.title, company: companies.name, occurredAt: opportunities.createdAt })
      .from(opportunities).innerJoin(companies, and(eq(companies.workspaceId, opportunities.workspaceId), eq(companies.id, opportunities.companyId)))
      .where(and(tenantWhere(opportunities.workspaceId, scope), withinRange(opportunities.createdAt, start, asOf)))
      .orderBy(desc(opportunities.createdAt)).limit(5),
    db.select({ id: crmActivities.id, summary: crmActivities.summary, leadId: crmActivities.leadId, occurredAt: crmActivities.occurredAt })
      .from(crmActivities).where(and(tenantWhere(crmActivities.workspaceId, scope), withinRange(crmActivities.occurredAt, start, asOf)))
      .orderBy(desc(crmActivities.occurredAt)).limit(5),
    db.select({ id: auditLogs.id, action: auditLogs.action, targetId: auditLogs.targetId, occurredAt: auditLogs.createdAt })
      .from(auditLogs).where(and(tenantWhere(auditLogs.workspaceId, scope), eq(auditLogs.targetType, "proposal"), withinRange(auditLogs.createdAt, start, asOf)))
      .orderBy(desc(auditLogs.createdAt)).limit(5),
    db.select({ id: crmTasks.id, title: crmTasks.title, leadId: crmTasks.leadId, dueAt: crmTasks.dueAt })
      .from(crmTasks).where(and(tenantWhere(crmTasks.workspaceId, scope), eq(crmTasks.status, "open"), lte(crmTasks.dueAt, asOf)))
      .orderBy(crmTasks.dueAt).limit(5),
    db.select({ id: opportunities.id, title: opportunities.title }).from(opportunities)
      .leftJoin(leads, and(eq(leads.workspaceId, opportunities.workspaceId), eq(leads.sourceOpportunityId, opportunities.id)))
      .where(and(tenantWhere(opportunities.workspaceId, scope), isNull(leads.id), withinRange(opportunities.createdAt, start, asOf)))
      .orderBy(desc(opportunities.createdAt)).limit(5),
    db.select({ count: sql<number>`count(*)::int` }).from(proposals)
      .where(and(tenantWhere(proposals.workspaceId, scope), eq(proposals.status, "draft"), withinRange(proposals.createdAt, start, asOf))),
    db.select({ id: proposals.id, title: proposals.title }).from(proposals)
      .where(and(tenantWhere(proposals.workspaceId, scope), eq(proposals.status, "draft"), withinRange(proposals.createdAt, start, asOf)))
      .orderBy(desc(proposals.updatedAt)).limit(5),
  ]);

  const pipeline = canViewRevenueReport(scope.role) ? await db.select({
    currency: deals.currency,
    count: sql<number>`count(*)::int`,
    valueMinor: sql<string>`coalesce(sum(${deals.valueMinor}), 0)`,
    unvaluedCount: sql<number>`count(*) filter (where ${deals.valueMinor} is null)::int`,
  }).from(deals)
    .innerJoin(leads, and(eq(leads.workspaceId, deals.workspaceId), eq(leads.id, deals.leadId)))
    .where(and(
      tenantWhere(deals.workspaceId, scope),
      notInArray(deals.stage, ["won", "lost"]),
      withinRange(deals.createdAt, start, asOf),
      leadStatus,
    )).groupBy(deals.currency).orderBy(deals.currency) : null;

  const prospects = numeric(prospectRows[0]?.count);
  const auditedBusinesses = numeric(auditRows[0]?.count);
  const opportunityCount = numeric(opportunityRows[0]?.count);
  const opportunityCompanies = numeric(opportunityRows[0]?.companies);
  const activeLeads = numeric(leadRows[0]?.count);
  const proposedLeads = numeric(proposalRows[0]?.leads);
  const approvedProposals = numeric(approvedRows[0]?.count);

  const recentActivity: DashboardActivity[] = [
    ...importActivity.map((row) => ({ id: `import-${row.id}`, kind: "import" as const, title: `${row.provider.replaceAll("_", " ")} discovery`, detail: `${row.status} · ${row.resultCount} result${row.resultCount === 1 ? "" : "s"}`, occurredAt: row.occurredAt, href: "/app/discover/search" })),
    ...auditActivity.filter((row): row is typeof row & { occurredAt: Date } => Boolean(row.occurredAt)).map((row) => ({ id: `audit-${row.id}`, kind: "audit" as const, title: `${row.company} audit`, detail: row.status === "partial" ? "Audit completed with partial evidence" : "Audit completed", occurredAt: row.occurredAt, href: `/app/audits/${row.id}` })),
    ...opportunityActivity.map((row) => ({ id: `opportunity-${row.id}`, kind: "opportunity" as const, title: row.title, detail: `Opportunity identified for ${row.company}`, occurredAt: row.occurredAt, href: "/app/discover/opportunities" })),
    ...crmActivity.map((row) => ({ id: `crm-${row.id}`, kind: "crm" as const, title: "CRM activity", detail: row.summary, occurredAt: row.occurredAt, href: `/app/leads/${row.leadId}` })),
    ...proposalActivity.map((row) => ({ id: `proposal-${row.id}`, kind: "proposal" as const, title: row.action.replaceAll(".", " ").replaceAll("_", " "), detail: "Proposal lifecycle event", occurredAt: row.occurredAt, href: row.targetId ? `/app/proposals/${row.targetId}` : "/app/proposals" })),
  ].sort((left, right) => right.occurredAt.getTime() - left.occurredAt.getTime()).slice(0, 10);

  return {
    asOf: new Date(asOf),
    filters,
    metrics: {
      prospects,
      auditedBusinesses,
      opportunities: opportunityCount,
      activeLeads,
      pipeline: pipeline?.map((row) => ({ currency: row.currency, count: numeric(row.count), valueMinor: numeric(row.valueMinor), unvaluedCount: numeric(row.unvaluedCount) })) ?? null,
      pendingProposals: numeric(pendingCountRows[0]?.count),
    },
    funnel: [
      { key: "prospects", label: "Prospects", count: prospects, href: "/app/companies" },
      { key: "audited", label: "Audited businesses", count: auditedBusinesses, href: "/app/audits" },
      { key: "opportunities", label: "Businesses with opportunities", count: opportunityCompanies, href: "/app/discover/opportunities" },
      { key: "leads", label: "Active CRM leads", count: activeLeads, href: "/app/leads" },
      { key: "proposals", label: "Leads with proposals", count: proposedLeads, href: "/app/proposals" },
      { key: "approved", label: "Approved proposals", count: approvedProposals, href: "/app/proposals?status=approved" },
    ],
    recentActivity,
    priorities: {
      overdueFollowUps: followUps.map((row) => ({ id: row.id, label: row.title, dueAt: row.dueAt, href: `/app/leads/${row.leadId}` })),
      unreviewedOpportunities: unreviewed.map((row) => ({ id: row.id, label: row.title, href: "/app/discover/opportunities" })),
      pendingApprovals: pending.map((row) => ({ id: row.id, label: row.title, href: `/app/proposals/${row.id}` })),
    },
  };
}
