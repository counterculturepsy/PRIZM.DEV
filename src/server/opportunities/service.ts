import { and, eq, inArray, sql } from "drizzle-orm";
import { generateOpportunities, OPPORTUNITY_GENERATION_VERSION, opportunityTypes, type OpportunityType } from "@/modules/opportunities/generator";
import { resolveRecommendations, type ServiceRecommendation } from "@/modules/opportunities/mapping";
import { calculateLeadScore, LEAD_SCORING_VERSION } from "@/modules/scoring/engine";
import { getDatabase } from "@/server/db";
import {
  auditFindings,
  auditLogs,
  companies,
  idealCustomerProfiles,
  leads,
  leadScores,
  opportunities,
  opportunityEvidence,
  opportunityServiceRecommendations,
  services,
  websiteAudits,
  websites,
  workspaces,
} from "@/server/db/schema";
import { loadWorkspaceMappings } from "./mappings";

export class OpportunityMaterializationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpportunityMaterializationError";
  }
}

/** Raised when refreshed intelligence would materially change an opportunity referenced by a CRM lead. */
export class LeadLinkedOpportunitiesError extends OpportunityMaterializationError {
  readonly code = "lead_linked_opportunities";
  constructor() {
    super("Refreshed intelligence would change an opportunity linked to a CRM lead. Start a new audit instead.");
    this.name = "LeadLinkedOpportunitiesError";
  }
}

export async function materializeOpportunityIntelligence(input: {
  workspaceId: string;
  auditId: string;
  actorUserId?: string;
}) {
  const db = getDatabase();
  const [target] = await db.select({
    auditId: websiteAudits.id,
    companyId: companies.id,
    industry: companies.industry,
    city: companies.city,
    email: companies.email,
    phone: companies.phone,
    currency: workspaces.currency,
    completedAt: websiteAudits.completedAt,
  }).from(websiteAudits)
    .innerJoin(websites, and(eq(websites.workspaceId, websiteAudits.workspaceId), eq(websites.id, websiteAudits.websiteId)))
    .innerJoin(companies, and(eq(companies.workspaceId, websites.workspaceId), eq(companies.id, websites.companyId)))
    .innerJoin(workspaces, eq(workspaces.id, websiteAudits.workspaceId))
    .where(and(
      eq(websiteAudits.workspaceId, input.workspaceId),
      eq(websiteAudits.id, input.auditId),
      inArray(websiteAudits.status, ["completed", "partial"]),
    )).limit(1);
  if (!target?.completedAt) throw new OpportunityMaterializationError("Choose a completed tenant-owned audit.");
  const sourceCompletedAt = target.completedAt;

  const [findings, profiles] = await Promise.all([
    db.select({
      id: auditFindings.id,
      category: auditFindings.category,
      confidence: auditFindings.confidence,
      scoreImpact: auditFindings.scoreImpact,
    }).from(auditFindings).where(and(
      eq(auditFindings.workspaceId, input.workspaceId),
      eq(auditFindings.auditId, input.auditId),
    )),
    db.select({ industries: idealCustomerProfiles.industries, cities: idealCustomerProfiles.cities })
      .from(idealCustomerProfiles)
      .where(eq(idealCustomerProfiles.workspaceId, input.workspaceId))
      .limit(1),
  ]);

  const score = calculateLeadScore({
    findings,
    company: { industry: target.industry, city: target.city, email: target.email, phone: target.phone },
    icp: profiles[0] ?? null,
  });

  return db.transaction(async (tx) => {
    // Mappings and the catalogue are read inside the transaction so recommendations and snapshots agree.
    const [catalogue, mappingRows] = await Promise.all([
      tx.select({
        id: services.id,
        name: services.name,
        active: services.active,
        startingPriceMinor: services.startingPriceMinor,
        averagePriceMinor: services.averagePriceMinor,
      }).from(services).where(eq(services.workspaceId, input.workspaceId)),
      loadWorkspaceMappings(tx, input.workspaceId),
    ]);
    const recommendationsByType: Partial<Record<OpportunityType, ServiceRecommendation[]>> = {};
    for (const type of opportunityTypes) {
      recommendationsByType[type] = resolveRecommendations(mappingRows.filter((row) => row.opportunityType === type), catalogue, target.currency);
    }
    const generated = generateOpportunities(findings, recommendationsByType);

    await tx.execute(sql`select id from companies where workspace_id = ${input.workspaceId} and id = ${target.companyId} for update`);
    const existingOpportunities = await tx.select({
      id: opportunities.id,
      type: opportunities.type,
      serviceId: opportunities.serviceId,
      title: opportunities.title,
      summary: opportunities.summary,
      businessImpact: opportunities.businessImpact,
      recommendedSolution: opportunities.recommendedSolution,
      estimatedValueMinMinor: opportunities.estimatedValueMinMinor,
      estimatedValueMaxMinor: opportunities.estimatedValueMaxMinor,
      currency: opportunities.currency,
      confidence: opportunities.confidence,
    }).from(opportunities).where(and(
      eq(opportunities.workspaceId, input.workspaceId),
      eq(opportunities.auditId, input.auditId),
      eq(opportunities.generationVersion, OPPORTUNITY_GENERATION_VERSION),
    ));
    const existingIds = existingOpportunities.map((item) => item.id);
    const linkedOpportunityIds = new Set<string>();
    if (existingIds.length > 0) {
      const linkedRows = await tx.select({ opportunityId: leads.sourceOpportunityId }).from(leads).where(and(
        eq(leads.workspaceId, input.workspaceId),
        inArray(leads.sourceOpportunityId, existingIds),
      ));
      for (const row of linkedRows) if (row.opportunityId) linkedOpportunityIds.add(row.opportunityId);
    }
    const generatedTypes = new Set(generated.map((item) => item.type));
    const staleOpportunityIds = existingOpportunities.filter((item) => !generatedTypes.has(item.type)).map((item) => item.id);
    if (staleOpportunityIds.some((id) => linkedOpportunityIds.has(id))) throw new LeadLinkedOpportunitiesError();

    const linkedIds = [...linkedOpportunityIds];
    const [linkedEvidence, linkedRecommendations] = linkedIds.length === 0 ? [[], []] : await Promise.all([
      tx.select({ opportunityId: opportunityEvidence.opportunityId, findingId: opportunityEvidence.findingId })
        .from(opportunityEvidence)
        .where(and(eq(opportunityEvidence.workspaceId, input.workspaceId), inArray(opportunityEvidence.opportunityId, linkedIds))),
      tx.select({
        opportunityId: opportunityServiceRecommendations.opportunityId,
        serviceId: opportunityServiceRecommendations.serviceId,
        serviceName: opportunityServiceRecommendations.serviceName,
        isPreferred: opportunityServiceRecommendations.isPreferred,
        rank: opportunityServiceRecommendations.rank,
        priceStatus: opportunityServiceRecommendations.priceStatus,
        startingPriceMinor: opportunityServiceRecommendations.startingPriceMinor,
        averagePriceMinor: opportunityServiceRecommendations.averagePriceMinor,
        currency: opportunityServiceRecommendations.currency,
      }).from(opportunityServiceRecommendations).where(and(
        eq(opportunityServiceRecommendations.workspaceId, input.workspaceId),
        inArray(opportunityServiceRecommendations.opportunityId, linkedIds),
      )),
    ]);
    const existingByType = new Map(existingOpportunities.map((item) => [item.type, item]));
    for (const item of generated) {
      const existing = existingByType.get(item.type);
      if (!existing || !linkedOpportunityIds.has(existing.id)) continue;
      const hasPrice = item.estimatedValueMinMinor !== null || item.estimatedValueMaxMinor !== null;
      const existingCommercial = {
        serviceId: existing.serviceId,
        title: existing.title,
        summary: existing.summary,
        businessImpact: existing.businessImpact,
        recommendedSolution: existing.recommendedSolution,
        estimatedValueMinMinor: existing.estimatedValueMinMinor,
        estimatedValueMaxMinor: existing.estimatedValueMaxMinor,
        currency: existing.currency,
        confidence: existing.confidence,
      };
      const refreshedCommercial = {
        serviceId: item.serviceId,
        title: item.title,
        summary: item.summary,
        businessImpact: item.businessImpact,
        recommendedSolution: item.recommendedSolution,
        estimatedValueMinMinor: item.estimatedValueMinMinor,
        estimatedValueMaxMinor: item.estimatedValueMaxMinor,
        currency: hasPrice ? target.currency : null,
        confidence: item.confidence,
      };
      const existingFindingIds = linkedEvidence.filter((row) => row.opportunityId === existing.id).map((row) => row.findingId).sort();
      const refreshedFindingIds = [...item.sourceFindingIds].sort();
      const existingRecommendationSnapshots = linkedRecommendations.filter((row) => row.opportunityId === existing.id)
        .map((row) => ({
          serviceId: row.serviceId,
          serviceName: row.serviceName,
          isPreferred: row.isPreferred,
          rank: row.rank,
          priceStatus: row.priceStatus,
          startingPriceMinor: row.startingPriceMinor,
          averagePriceMinor: row.averagePriceMinor,
          currency: row.currency,
        }))
        .sort((a, b) => a.rank - b.rank);
      const refreshedRecommendationSnapshots = item.recommendations.map((recommendation) => ({
        serviceId: recommendation.serviceId,
        serviceName: recommendation.serviceName,
        isPreferred: recommendation.isPreferred,
        rank: recommendation.rank,
        priceStatus: recommendation.priceStatus,
        startingPriceMinor: recommendation.startingPriceMinor,
        averagePriceMinor: recommendation.averagePriceMinor,
        currency: recommendation.currency,
      })).sort((a, b) => a.rank - b.rank);
      if (
        JSON.stringify(existingCommercial) !== JSON.stringify(refreshedCommercial)
        || JSON.stringify(existingFindingIds) !== JSON.stringify(refreshedFindingIds)
        || JSON.stringify(existingRecommendationSnapshots) !== JSON.stringify(refreshedRecommendationSnapshots)
      ) throw new LeadLinkedOpportunitiesError();
    }

    if (staleOpportunityIds.length > 0) {
      // The database FK still protects a lead created concurrently after the check; the transaction then rolls back.
      await tx.delete(opportunities).where(and(
        eq(opportunities.workspaceId, input.workspaceId),
        inArray(opportunities.id, staleOpportunityIds),
      ));
    }

    const [current] = await tx.select({ sourceCompletedAt: leadScores.sourceCompletedAt }).from(leadScores).where(and(
      eq(leadScores.workspaceId, input.workspaceId), eq(leadScores.companyId, target.companyId), eq(leadScores.isCurrent, true),
    )).limit(1);
    const shouldBeCurrent = !current || sourceCompletedAt >= current.sourceCompletedAt;
    if (shouldBeCurrent) await tx.update(leadScores).set({ isCurrent: false }).where(and(
      eq(leadScores.workspaceId, input.workspaceId), eq(leadScores.companyId, target.companyId), eq(leadScores.isCurrent, true),
    ));
    const [storedScore] = await tx.insert(leadScores).values({
      workspaceId: input.workspaceId,
      companyId: target.companyId,
      auditId: target.auditId,
      totalScore: score.totalScore,
      priority: score.priority,
      components: score.components,
      scoringVersion: LEAD_SCORING_VERSION,
      isCurrent: shouldBeCurrent,
      sourceCompletedAt,
    }).onConflictDoUpdate({
      target: [leadScores.workspaceId, leadScores.auditId, leadScores.scoringVersion],
      set: {
        totalScore: score.totalScore,
        priority: score.priority,
        components: score.components,
        isCurrent: shouldBeCurrent,
        sourceCompletedAt,
        calculatedAt: new Date(),
      },
    }).returning({ id: leadScores.id });
    if (!storedScore) throw new Error("Lead score was not stored");

    for (const item of generated) {
      const hasPrice = item.estimatedValueMinMinor !== null || item.estimatedValueMaxMinor !== null;
      const existing = existingByType.get(item.type);
      if (existing && linkedOpportunityIds.has(existing.id)) continue;
      const [opportunity] = await tx.insert(opportunities).values({
        workspaceId: input.workspaceId,
        companyId: target.companyId,
        auditId: target.auditId,
        serviceId: item.serviceId,
        type: item.type,
        title: item.title,
        summary: item.summary,
        businessImpact: item.businessImpact,
        recommendedSolution: item.recommendedSolution,
        estimatedValueMinMinor: item.estimatedValueMinMinor,
        estimatedValueMaxMinor: item.estimatedValueMaxMinor,
        currency: hasPrice ? target.currency : null,
        confidence: item.confidence,
        generationVersion: item.generationVersion,
      }).onConflictDoUpdate({
        target: [opportunities.workspaceId, opportunities.auditId, opportunities.type, opportunities.generationVersion],
        set: {
          companyId: target.companyId,
          serviceId: item.serviceId,
          title: item.title,
          summary: item.summary,
          businessImpact: item.businessImpact,
          recommendedSolution: item.recommendedSolution,
          estimatedValueMinMinor: item.estimatedValueMinMinor,
          estimatedValueMaxMinor: item.estimatedValueMaxMinor,
          currency: hasPrice ? target.currency : null,
          confidence: item.confidence,
          updatedAt: new Date(),
        },
      }).returning({ id: opportunities.id });
      if (!opportunity) throw new Error("Opportunity was not stored");
      await tx.delete(opportunityEvidence).where(and(
        eq(opportunityEvidence.workspaceId, input.workspaceId),
        eq(opportunityEvidence.opportunityId, opportunity.id),
      ));
      await tx.delete(opportunityServiceRecommendations).where(and(
        eq(opportunityServiceRecommendations.workspaceId, input.workspaceId),
        eq(opportunityServiceRecommendations.opportunityId, opportunity.id),
      ));
      await tx.insert(opportunityEvidence).values(item.sourceFindingIds.map((findingId) => ({
        workspaceId: input.workspaceId,
        auditId: target.auditId,
        opportunityId: opportunity.id,
        findingId,
      })));
      if (item.recommendations.length > 0) {
        await tx.insert(opportunityServiceRecommendations).values(item.recommendations.map((recommendation) => ({
          workspaceId: input.workspaceId,
          auditId: target.auditId,
          opportunityId: opportunity.id,
          serviceId: recommendation.serviceId,
          serviceName: recommendation.serviceName,
          isPreferred: recommendation.isPreferred,
          rank: recommendation.rank,
          priceStatus: recommendation.priceStatus,
          startingPriceMinor: recommendation.startingPriceMinor,
          averagePriceMinor: recommendation.averagePriceMinor,
          currency: recommendation.currency,
        })));
      }
    }

    await tx.insert(auditLogs).values({
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      action: "opportunity_intelligence.materialized",
      targetType: "website_audit",
      targetId: target.auditId,
      metadata: {
        scoringVersion: LEAD_SCORING_VERSION,
        generationVersion: OPPORTUNITY_GENERATION_VERSION,
        totalScore: score.totalScore,
        opportunityCount: generated.length,
      },
    });
    return { scoreId: storedScore.id, totalScore: score.totalScore, opportunityCount: generated.length };
  });
}
