import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { hasCapability, type WorkspaceCapability, type WorkspaceScope } from "@/modules/workspaces/scope";
import { calculateProposal, proposalApprovalSchema, proposalDraftSchema, proposalRevisionSchema, type ProposalSourceEvidence } from "@/modules/proposals/validation";
import { getDatabase, type Database } from "@/server/db";
import {
  auditFindings, auditLogs, companies, leads, opportunities, opportunityEvidence,
  opportunityServiceRecommendations, proposals, proposalVersions, users, workspaceMembers, workspaces,
} from "@/server/db/schema";

export class ProposalError extends Error {}

type AuthorizationExecutor = Pick<Database, "select">;
type ProposalCapability = Extract<WorkspaceCapability, "read" | "write" | "manage_workspace">;

async function authorize(executor: AuthorizationExecutor, scope: WorkspaceScope, capability: ProposalCapability, lock = false) {
  if (!hasCapability(scope, capability)) throw new ProposalError("Your role cannot perform this proposal action.");
  const query = executor.select({ role: workspaceMembers.role }).from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(and(
      eq(workspaceMembers.workspaceId, scope.workspaceId),
      eq(workspaceMembers.userId, scope.userId),
      eq(workspaceMembers.status, "active"),
      eq(workspaces.status, "active"),
    )).limit(1);
  const [member] = lock ? await query.for("update") : await query;
  if (!member || member.role !== scope.role) throw new ProposalError("Workspace membership changed. Refresh and try again.");
}

async function captureSourceEvidence(
  tx: Parameters<Parameters<Database["transaction"]>[0]>[0],
  scope: WorkspaceScope,
  companyId: string,
  sourceOpportunityId: string | null,
): Promise<ProposalSourceEvidence | undefined> {
  if (!sourceOpportunityId) return undefined;
  const [opportunity] = await tx.select({
    id: opportunities.id, auditId: opportunities.auditId, type: opportunities.type, title: opportunities.title,
    summary: opportunities.summary, businessImpact: opportunities.businessImpact,
    recommendedSolution: opportunities.recommendedSolution, confidence: opportunities.confidence,
    estimatedValueMinMinor: opportunities.estimatedValueMinMinor, estimatedValueMaxMinor: opportunities.estimatedValueMaxMinor,
    currency: opportunities.currency, generationVersion: opportunities.generationVersion,
  }).from(opportunities).where(and(
    eq(opportunities.workspaceId, scope.workspaceId),
    eq(opportunities.companyId, companyId),
    eq(opportunities.id, sourceOpportunityId),
  )).limit(1);
  if (!opportunity) throw new ProposalError("The lead source opportunity is unavailable in the active workspace.");

  const [findings, recommendations] = await Promise.all([
    tx.select({
      id: auditFindings.id, title: auditFindings.title, category: auditFindings.category,
      severity: auditFindings.severity, summary: auditFindings.summary, evidence: auditFindings.evidence,
      sourceUrl: auditFindings.sourceUrl, confidence: auditFindings.confidence, observedAt: auditFindings.observedAt,
    }).from(opportunityEvidence).innerJoin(auditFindings, and(
      eq(auditFindings.workspaceId, opportunityEvidence.workspaceId),
      eq(auditFindings.auditId, opportunityEvidence.auditId),
      eq(auditFindings.id, opportunityEvidence.findingId),
    )).where(and(
      eq(opportunityEvidence.workspaceId, scope.workspaceId),
      eq(opportunityEvidence.auditId, opportunity.auditId),
      eq(opportunityEvidence.opportunityId, opportunity.id),
    )).orderBy(auditFindings.category, auditFindings.code),
    tx.select({
      serviceId: opportunityServiceRecommendations.serviceId,
      serviceName: opportunityServiceRecommendations.serviceName,
      isPreferred: opportunityServiceRecommendations.isPreferred,
      rank: opportunityServiceRecommendations.rank,
      priceStatus: opportunityServiceRecommendations.priceStatus,
      startingPriceMinor: opportunityServiceRecommendations.startingPriceMinor,
      averagePriceMinor: opportunityServiceRecommendations.averagePriceMinor,
      currency: opportunityServiceRecommendations.currency,
    }).from(opportunityServiceRecommendations).where(and(
      eq(opportunityServiceRecommendations.workspaceId, scope.workspaceId),
      eq(opportunityServiceRecommendations.auditId, opportunity.auditId),
      eq(opportunityServiceRecommendations.opportunityId, opportunity.id),
    )).orderBy(opportunityServiceRecommendations.rank),
  ]);
  return {
    opportunity,
    findings: findings.map((finding) => ({ ...finding, observedAt: finding.observedAt.toISOString() })),
    recommendations,
  };
}

export async function createProposal(scope: WorkspaceScope, input: unknown) {
  const parsed = proposalDraftSchema.parse(input);
  return getDatabase().transaction(async (tx) => {
    await tx.execute(sql`select id from workspaces where id = ${scope.workspaceId} for update`);
    await authorize(tx, scope, "write", true);
    const [existing] = await tx.select({ id: proposals.id, leadId: proposals.leadId }).from(proposals)
      .where(and(eq(proposals.workspaceId, scope.workspaceId), eq(proposals.requestKey, parsed.requestKey))).limit(1);
    if (existing) {
      if (existing.leadId !== parsed.leadId) throw new ProposalError("This request key was already used for another lead.");
      return existing.id;
    }
    const [target] = await tx.select({
      leadId: leads.id, companyId: leads.companyId, sourceOpportunityId: leads.sourceOpportunityId, currency: workspaces.currency,
    }).from(leads).innerJoin(workspaces, eq(workspaces.id, leads.workspaceId))
      .where(and(eq(leads.workspaceId, scope.workspaceId), eq(leads.id, parsed.leadId))).limit(1);
    if (!target) throw new ProposalError("Choose a lead in the active workspace.");
    const sourceEvidence = await captureSourceEvidence(tx, scope, target.companyId, target.sourceOpportunityId);
    const calculated = calculateProposal(parsed, target.currency);
    const snapshot = sourceEvidence ? { ...calculated, sourceEvidence } : calculated;
    const [proposal] = await tx.insert(proposals).values({ workspaceId: scope.workspaceId, leadId: parsed.leadId, requestKey: parsed.requestKey, title: snapshot.title, createdByUserId: scope.userId }).returning({ id: proposals.id });
    if (!proposal) throw new ProposalError("The proposal could not be created.");
    await tx.insert(proposalVersions).values({ workspaceId: scope.workspaceId, proposalId: proposal.id, version: 1, snapshot, createdByUserId: scope.userId });
    await tx.insert(auditLogs).values({ workspaceId: scope.workspaceId, actorUserId: scope.userId, action: "proposal.created", targetType: "proposal", targetId: proposal.id, metadata: { leadId: parsed.leadId, version: 1, toStatus: "draft" } });
    return proposal.id;
  });
}

export async function reviseProposal(scope: WorkspaceScope, proposalId: string, input: unknown) {
  const parsed = proposalRevisionSchema.parse(input);
  return getDatabase().transaction(async (tx) => {
    await tx.execute(sql`select id from workspaces where id = ${scope.workspaceId} for update`);
    await authorize(tx, scope, "write", true);
    await tx.execute(sql`select id from proposals where workspace_id = ${scope.workspaceId} and id = ${proposalId} for update`);
    const [current] = await tx.select({ version: proposals.currentVersion, status: proposals.status, currency: workspaces.currency }).from(proposals)
      .innerJoin(workspaces, eq(workspaces.id, proposals.workspaceId))
      .where(and(eq(proposals.workspaceId, scope.workspaceId), eq(proposals.id, proposalId))).limit(1);
    if (!current) throw new ProposalError("Choose a proposal in the active workspace.");
    const [currentVersion] = await tx.select({ snapshot: proposalVersions.snapshot }).from(proposalVersions).where(and(
      eq(proposalVersions.workspaceId, scope.workspaceId), eq(proposalVersions.proposalId, proposalId), eq(proposalVersions.version, current.version),
    )).limit(1);
    if (!currentVersion) throw new ProposalError("The current proposal version is unavailable.");
    const nextVersion = current.version + 1;
    const calculated = calculateProposal(parsed, current.currency);
    const snapshot = currentVersion.snapshot.sourceEvidence ? { ...calculated, sourceEvidence: currentVersion.snapshot.sourceEvidence } : calculated;
    await tx.insert(proposalVersions).values({ workspaceId: scope.workspaceId, proposalId, version: nextVersion, snapshot, createdByUserId: scope.userId });
    const [updated] = await tx.update(proposals).set({ title: snapshot.title, currentVersion: nextVersion, status: "draft", approvedByUserId: null, approvalNote: null, approvedAt: null, updatedAt: new Date() })
      .where(and(eq(proposals.workspaceId, scope.workspaceId), eq(proposals.id, proposalId), eq(proposals.currentVersion, current.version))).returning({ id: proposals.id });
    if (!updated) throw new ProposalError("The proposal changed while the revision was being created.");
    await tx.insert(auditLogs).values({ workspaceId: scope.workspaceId, actorUserId: scope.userId, action: "proposal.revised", targetType: "proposal", targetId: proposalId, metadata: { version: nextVersion, fromStatus: current.status, toStatus: "draft", approvalReset: current.status === "approved" } });
    return nextVersion;
  });
}

export async function approveProposal(scope: WorkspaceScope, input: unknown) {
  const parsed = proposalApprovalSchema.parse(input);
  return getDatabase().transaction(async (tx) => {
    await tx.execute(sql`select id from workspaces where id = ${scope.workspaceId} for update`);
    await authorize(tx, scope, "manage_workspace", true);
    await tx.execute(sql`select id from proposals where workspace_id = ${scope.workspaceId} and id = ${parsed.proposalId} for update`);
    const [updated] = await tx.update(proposals).set({ status: "approved", approvedByUserId: scope.userId, approvalNote: parsed.note, approvedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(proposals.workspaceId, scope.workspaceId), eq(proposals.id, parsed.proposalId), eq(proposals.status, "draft"))).returning({ id: proposals.id, version: proposals.currentVersion });
    if (!updated) throw new ProposalError("This proposal is unavailable or is not a draft.");
    await tx.insert(auditLogs).values({ workspaceId: scope.workspaceId, actorUserId: scope.userId, action: "proposal.approved", targetType: "proposal", targetId: updated.id, metadata: { version: updated.version, fromStatus: "draft", toStatus: "approved", note: parsed.note } });
  });
}

export async function listProposals(scope: WorkspaceScope) {
  const db = getDatabase();
  return db.transaction(async (tx) => {
    await tx.execute(sql`select id from workspaces where id = ${scope.workspaceId} for update`);
    await authorize(tx, scope, "read", true);
    return tx.select({ id: proposals.id, title: proposals.title, status: proposals.status, currentVersion: proposals.currentVersion, updatedAt: proposals.updatedAt, companyName: companies.name })
      .from(proposals).innerJoin(leads, and(eq(leads.workspaceId, proposals.workspaceId), eq(leads.id, proposals.leadId)))
      .innerJoin(companies, and(eq(companies.workspaceId, leads.workspaceId), eq(companies.id, leads.companyId)))
      .where(eq(proposals.workspaceId, scope.workspaceId)).orderBy(desc(proposals.updatedAt)).limit(100);
  });
}

type Person = Readonly<{ id: string; name: string | null; email: string }>;

export async function getProposal(scope: WorkspaceScope, proposalId: string) {
  const db = getDatabase();
  return db.transaction(async (tx) => {
    await tx.execute(sql`select id from workspaces where id = ${scope.workspaceId} for update`);
    await authorize(tx, scope, "read", true);
    const [proposal] = await tx.select().from(proposals).where(and(eq(proposals.workspaceId, scope.workspaceId), eq(proposals.id, proposalId))).limit(1);
    if (!proposal) return null;
    const [versions, events] = await Promise.all([
      tx.select().from(proposalVersions).where(and(eq(proposalVersions.workspaceId, scope.workspaceId), eq(proposalVersions.proposalId, proposalId))).orderBy(desc(proposalVersions.version)),
      tx.select({ action: auditLogs.action, actorUserId: auditLogs.actorUserId, metadata: auditLogs.metadata, createdAt: auditLogs.createdAt })
        .from(auditLogs).where(and(eq(auditLogs.workspaceId, scope.workspaceId), eq(auditLogs.targetType, "proposal"), eq(auditLogs.targetId, proposalId))).orderBy(asc(auditLogs.createdAt)),
    ]);
    const actorIds = [...new Set([
      proposal.createdByUserId, proposal.approvedByUserId,
      ...versions.map((version) => version.createdByUserId), ...events.map((event) => event.actorUserId),
    ].filter((id): id is string => Boolean(id)))];
    const people = actorIds.length ? await tx.select({ id: users.id, name: users.name, email: users.email }).from(users).where(inArray(users.id, actorIds)) : [];
    const peopleById = new Map(people.map((person) => [person.id, person] as const));
    const person = (id: string | null): Person | null => id ? peopleById.get(id) ?? { id, name: null, email: "Unknown user" } : null;
    const attributedVersions = versions.map((version) => ({ ...version, createdBy: person(version.createdByUserId)! }));
    const current = attributedVersions.find((version) => version.version === proposal.currentVersion);
    if (!current) throw new ProposalError("The current proposal version is unavailable.");
    const text = (metadata: Record<string, unknown>, key: string) => typeof metadata[key] === "string" ? metadata[key] as string : null;
    const number = (metadata: Record<string, unknown>, key: string) => typeof metadata[key] === "number" ? metadata[key] as number : null;
    return {
      ...proposal,
      createdBy: person(proposal.createdByUserId)!,
      approvedBy: person(proposal.approvedByUserId),
      versions: attributedVersions,
      current,
      history: events.map((event) => ({
        action: event.action, actor: person(event.actorUserId), createdAt: event.createdAt,
        version: number(event.metadata, "version"), fromStatus: text(event.metadata, "fromStatus"),
        toStatus: text(event.metadata, "toStatus"), note: text(event.metadata, "note"),
      })),
    };
  });
}
