import { and, eq, gte, lte, notInArray, sql } from "drizzle-orm";
import { canViewRevenueReport } from "@/modules/analytics/metrics";
import type { WorkspaceScope } from "@/modules/workspaces/scope";
import { getDatabase } from "@/server/db";
import { deals, leads } from "@/server/db/schema";
import { tenantWhere } from "@/server/db/tenant";
import { dashboardRangeStart, type DashboardFilters } from "./queries";

/** Current open pipeline by creation date, not reconstructed historical deal values. */
export async function getOverviewPipeline(scope: WorkspaceScope, filters: DashboardFilters, asOf: Date) {
  const start = dashboardRangeStart(filters.range, asOf);
  const leadFilter = filters.leadStatus === "all" ? undefined : filters.leadStatus === "active"
    ? notInArray(leads.status, ["unqualified", "archived"]) : eq(leads.status, filters.leadStatus);
  const db = getDatabase();
  const [qualified, rows] = await Promise.all([
    db.select({ count: sql<number>`count(*)::int` }).from(leads).where(and(
      tenantWhere(leads.workspaceId, scope), eq(leads.status, "qualified"), leadFilter,
      start ? gte(leads.createdAt, start) : undefined, lte(leads.createdAt, asOf),
    )),
    canViewRevenueReport(scope.role) ? db.select({ createdAt: deals.createdAt, currency: deals.currency, valueMinor: deals.valueMinor })
      .from(deals).innerJoin(leads, and(eq(leads.workspaceId, deals.workspaceId), eq(leads.id, deals.leadId)))
      .where(and(tenantWhere(deals.workspaceId, scope), notInArray(deals.stage, ["won", "lost"]), leadFilter,
        start ? gte(deals.createdAt, start) : undefined, lte(deals.createdAt, asOf)))
      .orderBy(deals.createdAt) : Promise.resolve(null),
  ]);
  return { qualifiedLeads: qualified[0]?.count ?? 0, deals: rows };
}
