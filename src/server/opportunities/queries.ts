import { and, desc, eq, sql } from "drizzle-orm";
import type { OpportunityType } from "@/modules/opportunities/generator";
import type { PriceStatus } from "@/modules/opportunities/mapping";
import { summarizeCrmStatus, summarizeRecommendation, type FindingSeverity, type LeadStatus } from "@/modules/opportunities/feed";
import { buildAssessment, buildSuitability, type StoredScoreComponent } from "@/modules/scoring/dimensions";
import type { WorkspaceScope } from "@/modules/workspaces/scope";
import { getDatabase } from "@/server/db";
import {
  auditFindings,
  companies,
  idealCustomerProfiles,
  leads,
  leadScores,
  opportunities,
  opportunityEvidence,
  opportunityServiceRecommendations,
  websiteAudits,
} from "@/server/db/schema";
import { tenantWhere } from "@/server/db/tenant";
import { getMappingOverview } from "./mappings";

/**
 * Feed rows: one main query plus one ICP lookup (no per-card queries). Recommendations come only from the
 * stored snapshot, never from current mappings. Opportunities without a current lead score stay excluded,
 * exactly as before.
 */
export async function listOpportunityFeed(scope: WorkspaceScope) {
  const db = getDatabase();
  const [rows, [icp]] = await Promise.all([
    db.select({
      opportunityId: opportunities.id,
      companyId: companies.id,
      companyName: companies.name,
      industry: companies.industry,
      city: companies.city,
      type: opportunities.type,
      title: opportunities.title,
      summary: opportunities.summary,
      confidence: opportunities.confidence,
      totalScore: leadScores.totalScore,
      priority: leadScores.priority,
      calculatedAt: leadScores.calculatedAt,
      components: leadScores.components,
      hasEmail: sql<boolean>`(${companies.email} is not null and btrim(${companies.email}) <> '')`,
      hasPhone: sql<boolean>`(${companies.phone} is not null and btrim(${companies.phone}) <> '')`,
      evidenceCount: sql<number>`(
        select count(*)::int from opportunity_evidence evidence
        where evidence.workspace_id = ${opportunities.workspaceId}
          and evidence.opportunity_id = ${opportunities.id}
      )`,
      highestSeverity: sql<FindingSeverity | null>`(
        select max(finding.severity) from opportunity_evidence evidence
        join audit_findings finding
          on finding.workspace_id = evidence.workspace_id and finding.audit_id = evidence.audit_id and finding.id = evidence.finding_id
        where evidence.workspace_id = ${opportunities.workspaceId}
          and evidence.opportunity_id = ${opportunities.id}
      )`,
      recordedCount: sql<number>`(
        select count(*)::int from opportunity_service_recommendations recorded
        where recorded.workspace_id = ${opportunities.workspaceId}
          and recorded.opportunity_id = ${opportunities.id}
      )`,
      preferredName: opportunityServiceRecommendations.serviceName,
      preferredPriceStatus: opportunityServiceRecommendations.priceStatus,
      preferredStartingPriceMinor: opportunityServiceRecommendations.startingPriceMinor,
      preferredAveragePriceMinor: opportunityServiceRecommendations.averagePriceMinor,
      preferredCurrency: opportunityServiceRecommendations.currency,
      leadStatus: leads.status,
      leadSourceOpportunityId: leads.sourceOpportunityId,
    }).from(opportunities)
      .innerJoin(leadScores, and(
        eq(leadScores.workspaceId, opportunities.workspaceId),
        eq(leadScores.companyId, opportunities.companyId),
        eq(leadScores.auditId, opportunities.auditId),
        eq(leadScores.isCurrent, true),
      ))
      .innerJoin(companies, and(eq(companies.workspaceId, opportunities.workspaceId), eq(companies.id, opportunities.companyId)))
      // At most one preferred snapshot row per opportunity (partial unique index).
      .leftJoin(opportunityServiceRecommendations, and(
        eq(opportunityServiceRecommendations.workspaceId, opportunities.workspaceId),
        eq(opportunityServiceRecommendations.opportunityId, opportunities.id),
        eq(opportunityServiceRecommendations.isPreferred, true),
      ))
      // At most one lead per company (unique index), so this join cannot duplicate rows.
      .leftJoin(leads, and(eq(leads.workspaceId, opportunities.workspaceId), eq(leads.companyId, opportunities.companyId)))
      .where(tenantWhere(opportunities.workspaceId, scope))
      .orderBy(desc(leadScores.totalScore), desc(leadScores.calculatedAt), companies.name)
      .limit(100),
    db.select({ industries: idealCustomerProfiles.industries, cities: idealCustomerProfiles.cities }).from(idealCustomerProfiles)
      .where(tenantWhere(idealCustomerProfiles.workspaceId, scope)).limit(1),
  ]);
  const icpCounts = icp ? { industryCount: icp.industries.length, cityCount: icp.cities.length } : null;
  return rows.map((row) => ({
    opportunityId: row.opportunityId,
    companyId: row.companyId,
    companyName: row.companyName,
    industry: row.industry,
    city: row.city,
    type: row.type,
    title: row.title,
    summary: row.summary,
    confidence: row.confidence,
    totalScore: row.totalScore,
    priority: row.priority,
    calculatedAt: row.calculatedAt,
    evidenceCount: row.evidenceCount,
    highestSeverity: row.highestSeverity,
    suitability: buildSuitability({
      components: row.components as readonly StoredScoreComponent[],
      company: { industry: row.industry, city: row.city, hasEmail: row.hasEmail, hasPhone: row.hasPhone },
      icp: icpCounts,
    }),
    recommendation: summarizeRecommendation({
      recordedCount: row.recordedCount,
      preferred: row.preferredName === null ? null : {
        serviceName: row.preferredName,
        priceStatus: row.preferredPriceStatus as PriceStatus,
        startingPriceMinor: row.preferredStartingPriceMinor,
        averagePriceMinor: row.preferredAveragePriceMinor,
        currency: row.preferredCurrency,
      },
    }),
    crm: summarizeCrmStatus(
      row.leadStatus === null ? null : { status: row.leadStatus as LeadStatus, sourceOpportunityId: row.leadSourceOpportunityId },
      row.opportunityId,
    ),
  }));
}

export async function getCompanyOpportunityIntelligence(scope: WorkspaceScope, companyId: string) {
  const [header] = await getDatabase().select({
    companyId: companies.id,
    companyName: companies.name,
    industry: companies.industry,
    city: companies.city,
    email: companies.email,
    phone: companies.phone,
    totalScore: leadScores.totalScore,
    priority: leadScores.priority,
    components: leadScores.components,
    scoringVersion: leadScores.scoringVersion,
    calculatedAt: leadScores.calculatedAt,
    auditId: leadScores.auditId,
  }).from(companies)
    .innerJoin(leadScores, and(
      eq(leadScores.workspaceId, companies.workspaceId),
      eq(leadScores.companyId, companies.id),
      eq(leadScores.isCurrent, true),
    ))
    .where(and(tenantWhere(companies.workspaceId, scope), eq(companies.id, companyId)))
    .limit(1);
  if (!header) return null;

  const rows = await getDatabase().select({
    opportunityId: opportunities.id,
    type: opportunities.type,
    title: opportunities.title,
    summary: opportunities.summary,
    businessImpact: opportunities.businessImpact,
    recommendedSolution: opportunities.recommendedSolution,
    confidence: opportunities.confidence,
    estimatedValueMinMinor: opportunities.estimatedValueMinMinor,
    estimatedValueMaxMinor: opportunities.estimatedValueMaxMinor,
    currency: opportunities.currency,
    generationVersion: opportunities.generationVersion,
    findingId: auditFindings.id,
    findingTitle: auditFindings.title,
    findingEvidence: auditFindings.evidence,
    findingCategory: auditFindings.category,
    findingObservedAt: auditFindings.observedAt,
  }).from(opportunities)
    .innerJoin(opportunityEvidence, and(
      eq(opportunityEvidence.workspaceId, opportunities.workspaceId),
      eq(opportunityEvidence.auditId, opportunities.auditId),
      eq(opportunityEvidence.opportunityId, opportunities.id),
    ))
    .innerJoin(auditFindings, and(
      eq(auditFindings.workspaceId, opportunityEvidence.workspaceId),
      eq(auditFindings.auditId, opportunityEvidence.auditId),
      eq(auditFindings.id, opportunityEvidence.findingId),
    ))
    .where(and(
      tenantWhere(opportunities.workspaceId, scope),
      eq(opportunities.companyId, companyId),
      eq(opportunities.auditId, header.auditId),
    ))
    .orderBy(opportunities.type, desc(auditFindings.scoreImpact));

  const grouped = new Map<string, {
    opportunity: Omit<(typeof rows)[number], "findingId" | "findingTitle" | "findingEvidence" | "findingCategory" | "findingObservedAt">;
    evidence: Array<Pick<(typeof rows)[number], "findingId" | "findingTitle" | "findingEvidence" | "findingCategory" | "findingObservedAt">>;
  }>();
  for (const row of rows) {
    const { findingId, findingTitle, findingEvidence, findingCategory, findingObservedAt, ...opportunity } = row;
    const existing = grouped.get(row.opportunityId) ?? { opportunity, evidence: [] };
    existing.evidence.push({ findingId, findingTitle, findingEvidence, findingCategory, findingObservedAt });
    grouped.set(row.opportunityId, existing);
  }

  const db = getDatabase();
  const [[audit], [icp], confidenceRows, recommendationRows, mappingOverview] = await Promise.all([
    db.select({ score: websiteAudits.score, status: websiteAudits.status }).from(websiteAudits)
      .where(and(tenantWhere(websiteAudits.workspaceId, scope), eq(websiteAudits.id, header.auditId))).limit(1),
    db.select({ industries: idealCustomerProfiles.industries, cities: idealCustomerProfiles.cities }).from(idealCustomerProfiles)
      .where(tenantWhere(idealCustomerProfiles.workspaceId, scope)).limit(1),
    db.select({ confidence: auditFindings.confidence, total: sql<number>`count(*)::int` }).from(auditFindings)
      .where(and(tenantWhere(auditFindings.workspaceId, scope), eq(auditFindings.auditId, header.auditId)))
      .groupBy(auditFindings.confidence),
    db.select({
      opportunityId: opportunityServiceRecommendations.opportunityId,
      serviceId: opportunityServiceRecommendations.serviceId,
      serviceName: opportunityServiceRecommendations.serviceName,
      isPreferred: opportunityServiceRecommendations.isPreferred,
      rank: opportunityServiceRecommendations.rank,
      priceStatus: opportunityServiceRecommendations.priceStatus,
      startingPriceMinor: opportunityServiceRecommendations.startingPriceMinor,
      averagePriceMinor: opportunityServiceRecommendations.averagePriceMinor,
      currency: opportunityServiceRecommendations.currency,
    }).from(opportunityServiceRecommendations)
      .where(and(tenantWhere(opportunityServiceRecommendations.workspaceId, scope), eq(opportunityServiceRecommendations.auditId, header.auditId)))
      .orderBy(opportunityServiceRecommendations.opportunityId, opportunityServiceRecommendations.rank),
    getMappingOverview(scope),
  ]);
  const confidence = { high: 0, medium: 0, low: 0 };
  for (const row of confidenceRows) confidence[row.confidence] += row.total;
  const assessment = buildAssessment({
    components: header.components as readonly StoredScoreComponent[],
    company: { industry: header.industry, city: header.city, hasEmail: Boolean(header.email), hasPhone: Boolean(header.phone) },
    icp: icp ? { industryCount: icp.industries.length, cityCount: icp.cities.length } : null,
    audit: { score: audit?.score ?? null, status: audit?.status ?? "unknown" },
    findingConfidence: confidence,
  });
  // Only an explicitly preferred snapshot service can be presented as recommended; other snapshot rows are
  // counted for provenance but never leave this query.
  const snapshotFor = (opportunityId: string) => {
    const rows = recommendationRows.filter((row) => row.opportunityId === opportunityId);
    const preferred = rows.find((row) => row.isPreferred);
    return {
      recordedCount: rows.length,
      preferred: preferred ? {
        serviceName: preferred.serviceName,
        priceStatus: preferred.priceStatus as PriceStatus,
        startingPriceMinor: preferred.startingPriceMinor,
        averagePriceMinor: preferred.averagePriceMinor,
        currency: preferred.currency,
      } : null,
    };
  };
  const currentlyMapped = new Map<OpportunityType, number>(mappingOverview.types.map((entry) => [entry.type, entry.effectiveCount]));
  return {
    companyId: header.companyId,
    companyName: header.companyName,
    industry: header.industry,
    city: header.city,
    totalScore: header.totalScore,
    priority: header.priority,
    components: header.components,
    scoringVersion: header.scoringVersion,
    calculatedAt: header.calculatedAt,
    auditId: header.auditId,
    assessment,
    opportunities: [...grouped.values()].map((entry) => ({
      ...entry,
      recommendation: summarizeRecommendation(snapshotFor(entry.opportunity.opportunityId)),
      /** Live mapping state, shown separately from the snapshot recorded at generation time. */
      currentlyMappedCount: currentlyMapped.get(entry.opportunity.type) ?? 0,
    })),
  } as const;
}
