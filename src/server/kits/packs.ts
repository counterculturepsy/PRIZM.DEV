import { createHash } from "node:crypto";
import { and, asc, desc, eq, gt, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { redactEvidence, type SalesEvidence } from "@/modules/ai/sales";
import { developmentStatusLabels, type DevelopmentStatus, type KitContent } from "@/modules/kits/content";
import { sanitizeFilename } from "@/modules/kits/files";
import { generateKitPdf, type PdfCaseStudy } from "@/modules/kits/pdf";
import { buildCoverNote, getPackTemplate } from "@/modules/kits/templates";
import { DEFAULT_SHARE_LIFETIME_DAYS, generateShareToken, hashShareToken, isWellFormedShareToken, shareExpiry } from "@/modules/kits/tokens";
import type { WorkspaceScope } from "@/modules/workspaces/scope";
import { getDatabase } from "@/server/db";
import {
  campaigns, capabilityKits, capabilityKitVersions, caseStudies, caseStudyAssets, kitAccessEvents, kitAssets, kitAssetVersions,
  kitAttachments, kitPackAssets, kitPackCaseStudies, kitPacks, kitShareLinks, leads, proposals, users,
} from "@/server/db/schema";
import { KitError, recordKitAudit, requireManage, requireWrite, type Executor } from "./common";
import { loadPdfFonts } from "./fonts";

export const MAX_ACTIVE_LINKS_PER_PACK = 5;
export const MAX_PACK_ASSETS = 10;

// ---------------------------------------------------------------------------------------------
// Loading and the approval digest
// ---------------------------------------------------------------------------------------------

async function loadBundle(executor: Executor, workspaceId: string, packId: string) {
  const [pack] = await executor.select().from(kitPacks).where(and(eq(kitPacks.workspaceId, workspaceId), eq(kitPacks.id, packId))).limit(1);
  if (!pack) return null;
  const [version] = await executor.select({ content: capabilityKitVersions.content }).from(capabilityKitVersions).where(and(
    eq(capabilityKitVersions.workspaceId, workspaceId), eq(capabilityKitVersions.kitId, pack.kitId), eq(capabilityKitVersions.version, pack.kitVersion))).limit(1);
  if (!version) return null;
  const [kit] = await executor.select({ name: capabilityKits.name, currentVersion: capabilityKits.currentVersion }).from(capabilityKits)
    .where(and(eq(capabilityKits.workspaceId, workspaceId), eq(capabilityKits.id, pack.kitId))).limit(1);
  const studies = await executor.select({ position: kitPackCaseStudies.position, study: caseStudies }).from(kitPackCaseStudies)
    .innerJoin(caseStudies, and(eq(caseStudies.workspaceId, kitPackCaseStudies.workspaceId), eq(caseStudies.id, kitPackCaseStudies.caseStudyId)))
    .where(and(eq(kitPackCaseStudies.workspaceId, workspaceId), eq(kitPackCaseStudies.packId, packId))).orderBy(asc(kitPackCaseStudies.position));
  const assets = await executor.select({
    assetId: kitPackAssets.assetId, assetVersion: kitPackAssets.assetVersion, position: kitPackAssets.position,
    title: kitAssets.title, status: kitAssets.status, filename: kitAssetVersions.filename, sha256: kitAssetVersions.sha256,
  }).from(kitPackAssets)
    .innerJoin(kitAssets, and(eq(kitAssets.workspaceId, kitPackAssets.workspaceId), eq(kitAssets.id, kitPackAssets.assetId)))
    .innerJoin(kitAssetVersions, and(eq(kitAssetVersions.workspaceId, kitPackAssets.workspaceId), eq(kitAssetVersions.assetId, kitPackAssets.assetId), eq(kitAssetVersions.version, kitPackAssets.assetVersion)))
    .where(and(eq(kitPackAssets.workspaceId, workspaceId), eq(kitPackAssets.packId, packId))).orderBy(asc(kitPackAssets.position));
  return { pack, content: version.content, kitName: kit?.name ?? "", kitCurrentVersion: kit?.currentVersion ?? pack.kitVersion, studies: studies.map((entry) => entry.study), assets };
}
type Bundle = NonNullable<Awaited<ReturnType<typeof loadBundle>>>;

/**
 * Fingerprint of everything a reviewer approved: the pinned kit version, template, recipient, message and the exact
 * case studies and document versions. If any of it changes after approval, the digest stops matching.
 */
export function packDigest(bundle: Bundle): string {
  const { pack } = bundle;
  return createHash("sha256").update(JSON.stringify({
    kit: [pack.kitId, pack.kitVersion], template: pack.templateKey, title: pack.title, recipient: [pack.recipientName, pack.recipientOrganisation ?? ""],
    message: pack.message, lead: pack.leadId ?? "",
    studies: bundle.studies.map((study) => [study.id, study.updatedAt.getTime(), study.status]),
    assets: bundle.assets.map((asset) => [asset.assetId, asset.assetVersion, asset.sha256, asset.status]),
  })).digest("hex");
}

export function isApprovedAndCurrent(bundle: Bundle): boolean {
  return bundle.pack.status === "approved" && bundle.pack.approvedDigest === packDigest(bundle);
}

function assertApproved(bundle: Bundle): void {
  if (bundle.pack.status !== "approved") throw new KitError("not_approved", "A workspace owner or administrator must approve this pack first.");
  if (!isApprovedAndCurrent(bundle)) throw new KitError("not_approved", "The pack changed after it was approved. Review it and approve it again.");
}

// ---------------------------------------------------------------------------------------------
// Packs: recipient-specific selections of a kit, case studies and documents
// ---------------------------------------------------------------------------------------------

type PackInput = Readonly<{
  title: string; recipientName: string; recipientOrganisation?: string | undefined; purpose?: string | undefined;
  message?: string | undefined; leadId?: string | undefined; caseStudyIds: readonly string[]; assetIds: readonly string[];
}>;

function checkPackText(input: { title: string; recipientName: string; recipientOrganisation?: string | undefined; message?: string | undefined }) {
  if (input.title.trim().length < 2 || input.title.trim().length > 160) throw new KitError("invalid", "Use a pack title of 2 to 160 characters.");
  if (input.recipientName.trim().length < 2 || input.recipientName.trim().length > 120) throw new KitError("invalid", "Use a recipient name of 2 to 120 characters.");
  if ((input.recipientOrganisation?.trim().length ?? 0) > 120) throw new KitError("invalid", "Use an organisation name of at most 120 characters.");
  if ((input.message?.length ?? 0) > 5000) throw new KitError("invalid", "Use a message of at most 5000 characters.");
}

async function validateSelection(executor: Executor, scope: WorkspaceScope, template: NonNullable<ReturnType<typeof getPackTemplate>>, caseStudyIds: readonly string[], assetIds: readonly string[], leadId?: string | undefined) {
  const studyIds = [...new Set(caseStudyIds)];
  const documentIds = [...new Set(assetIds)];
  if (studyIds.length !== caseStudyIds.length || documentIds.length !== assetIds.length) throw new KitError("invalid", "Each case study and document can be selected once.");
  if (studyIds.length < template.minCaseStudies || studyIds.length > template.maxCaseStudies) {
    throw new KitError("invalid", `${template.label} needs ${template.minCaseStudies === template.maxCaseStudies ? template.minCaseStudies : `${template.minCaseStudies} to ${template.maxCaseStudies}`} case ${template.maxCaseStudies === 1 ? "study" : "studies"}.`);
  }
  if (documentIds.length > MAX_PACK_ASSETS) throw new KitError("invalid", `Select at most ${MAX_PACK_ASSETS} documents.`);
  if (studyIds.length > 0) {
    const found = await executor.select({ id: caseStudies.id }).from(caseStudies).where(and(eq(caseStudies.workspaceId, scope.workspaceId), eq(caseStudies.status, "active"), inArray(caseStudies.id, studyIds)));
    if (found.length !== studyIds.length) throw new KitError("invalid", "Choose case studies from this workspace's active case studies.");
  }
  let assetRows: { id: string; currentVersion: number }[] = [];
  if (documentIds.length > 0) {
    assetRows = await executor.select({ id: kitAssets.id, currentVersion: kitAssets.currentVersion }).from(kitAssets)
      .where(and(eq(kitAssets.workspaceId, scope.workspaceId), eq(kitAssets.status, "active"), inArray(kitAssets.id, documentIds)));
    if (assetRows.length !== documentIds.length) throw new KitError("invalid", "Choose documents from this workspace's active documents.");
  }
  if (leadId) {
    const [lead] = await executor.select({ id: leads.id }).from(leads).where(and(eq(leads.workspaceId, scope.workspaceId), eq(leads.id, leadId))).limit(1);
    if (!lead) throw new KitError("invalid", "Choose a lead in this workspace.");
  }
  return { studyIds, documentIds, assetRows };
}

export async function createKitPack(scope: WorkspaceScope, input: PackInput & { kitId: string; templateKey: string }) {
  requireWrite(scope);
  const template = getPackTemplate(input.templateKey);
  if (!template) throw new KitError("invalid", "Choose one of the available pack templates.");
  checkPackText(input);
  return getDatabase().transaction(async (tx) => {
    const [kit] = await tx.select().from(capabilityKits).where(and(eq(capabilityKits.workspaceId, scope.workspaceId), eq(capabilityKits.id, input.kitId), eq(capabilityKits.status, "active"))).limit(1);
    if (!kit) throw new KitError("not_found", "Choose an active kit in this workspace.");
    const { studyIds, documentIds, assetRows } = await validateSelection(tx, scope, template, input.caseStudyIds, input.assetIds, input.leadId);
    const [author] = await tx.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, scope.userId)).limit(1);
    const studyRows = studyIds.length === 0 ? [] : await tx.select().from(caseStudies).where(and(eq(caseStudies.workspaceId, scope.workspaceId), inArray(caseStudies.id, studyIds)));
    const byId = new Map(studyRows.map((study) => [study.id, study]));
    const message = input.message ?? buildCoverNote({
      template, senderName: author?.name ?? author?.email ?? "", recipientName: input.recipientName, recipientOrganisation: input.recipientOrganisation, purpose: input.purpose,
      caseStudies: studyIds.flatMap((id) => { const study = byId.get(id); return study ? [{ projectName: study.projectName, developmentStatus: study.developmentStatus as never, techStack: study.techStack }] : []; }),
    });
    const [pack] = await tx.insert(kitPacks).values({
      workspaceId: scope.workspaceId, kitId: kit.id, kitVersion: kit.currentVersion, templateKey: template.key, title: input.title.trim(),
      recipientName: input.recipientName.trim(), recipientOrganisation: input.recipientOrganisation?.trim() || null, message, leadId: input.leadId ?? null, createdByUserId: scope.userId,
    }).returning({ id: kitPacks.id });
    if (!pack) throw new Error("Pack was not created");
    if (studyIds.length > 0) await tx.insert(kitPackCaseStudies).values(studyIds.map((caseStudyId, position) => ({ workspaceId: scope.workspaceId, packId: pack.id, caseStudyId, position })));
    if (documentIds.length > 0) {
      const versions = new Map(assetRows.map((row) => [row.id, row.currentVersion]));
      await tx.insert(kitPackAssets).values(documentIds.map((assetId, position) => ({ workspaceId: scope.workspaceId, packId: pack.id, assetId, assetVersion: versions.get(assetId) ?? 1, position })));
    }
    await recordKitAudit(tx, scope, "pack_created", "kit_pack", pack.id, { template: template.key, caseStudies: studyIds.length, documents: documentIds.length });
    return { packId: pack.id };
  });
}

export type PackUpdate = Readonly<{
  packId: string;
  /** The pack's updated_at as the editor loaded it; a mismatch means someone else changed the pack. */
  expectedUpdatedAt: Date;
  title?: string | undefined; recipientName?: string | undefined; recipientOrganisation?: string | undefined; message?: string | undefined;
  caseStudyIds?: readonly string[] | undefined; assetIds?: readonly string[] | undefined; useLatestKitVersion?: boolean | undefined;
}>;

/** Any real change to an approved pack drops it back to draft and revokes its share links. */
export async function updateKitPack(scope: WorkspaceScope, input: PackUpdate) {
  requireWrite(scope);
  return getDatabase().transaction(async (tx) => {
    const [pack] = await tx.select().from(kitPacks).where(and(eq(kitPacks.workspaceId, scope.workspaceId), eq(kitPacks.id, input.packId))).limit(1).for("update");
    if (!pack) throw new KitError("not_found", "Choose a pack in this workspace.");
    if (pack.updatedAt.getTime() !== input.expectedUpdatedAt.getTime()) throw new KitError("conflict", "This pack was changed by someone else. Reload it to see the latest version.");
    const template = getPackTemplate(pack.templateKey);
    if (!template) throw new KitError("invalid", "This pack uses a template that is no longer available.");
    const current = await loadBundle(tx, scope.workspaceId, pack.id);
    if (!current) throw new KitError("not_found", "Choose a pack in this workspace.");

    const next = {
      title: input.title?.trim() ?? pack.title, recipientName: input.recipientName?.trim() ?? pack.recipientName,
      recipientOrganisation: input.recipientOrganisation === undefined ? pack.recipientOrganisation : input.recipientOrganisation.trim() || null,
      message: input.message ?? pack.message,
    };
    checkPackText({ ...next, recipientOrganisation: next.recipientOrganisation ?? undefined });
    const studyIds = input.caseStudyIds ?? current.studies.map((study) => study.id);
    const documentIds = input.assetIds ?? current.assets.map((asset) => asset.assetId);
    const selection = await validateSelection(tx, scope, template, studyIds, documentIds, pack.leadId ?? undefined);
    const [kit] = await tx.select({ currentVersion: capabilityKits.currentVersion }).from(capabilityKits).where(and(eq(capabilityKits.workspaceId, scope.workspaceId), eq(capabilityKits.id, pack.kitId))).limit(1);
    const kitVersion = input.useLatestKitVersion && kit ? kit.currentVersion : pack.kitVersion;

    const changed: string[] = [];
    if (next.title !== pack.title) changed.push("title");
    if (next.recipientName !== pack.recipientName || next.recipientOrganisation !== pack.recipientOrganisation) changed.push("recipient");
    if (next.message !== pack.message) changed.push("message");
    if (kitVersion !== pack.kitVersion) changed.push("kit version");
    if (JSON.stringify(selection.studyIds) !== JSON.stringify(current.studies.map((study) => study.id))) changed.push("case studies");
    if (JSON.stringify(selection.documentIds) !== JSON.stringify(current.assets.map((asset) => asset.assetId))) changed.push("documents");
    if (changed.length === 0) return { changed: false } as const;

    const now = new Date();
    const wasApproved = pack.status === "approved";
    await tx.update(kitPacks).set({
      ...next, kitVersion, updatedAt: now,
      ...(wasApproved ? { status: "draft", approvedAt: null, approvedByUserId: null, approvedDigest: null } : {}),
    }).where(and(eq(kitPacks.workspaceId, scope.workspaceId), eq(kitPacks.id, pack.id)));
    if (changed.includes("case studies")) {
      await tx.delete(kitPackCaseStudies).where(and(eq(kitPackCaseStudies.workspaceId, scope.workspaceId), eq(kitPackCaseStudies.packId, pack.id)));
      if (selection.studyIds.length > 0) await tx.insert(kitPackCaseStudies).values(selection.studyIds.map((caseStudyId, position) => ({ workspaceId: scope.workspaceId, packId: pack.id, caseStudyId, position })));
    }
    if (changed.includes("documents")) {
      await tx.delete(kitPackAssets).where(and(eq(kitPackAssets.workspaceId, scope.workspaceId), eq(kitPackAssets.packId, pack.id)));
      const versions = new Map(selection.assetRows.map((row) => [row.id, row.currentVersion]));
      if (selection.documentIds.length > 0) await tx.insert(kitPackAssets).values(selection.documentIds.map((assetId, position) => ({ workspaceId: scope.workspaceId, packId: pack.id, assetId, assetVersion: versions.get(assetId) ?? 1, position })));
    }
    let revoked = 0;
    if (wasApproved) {
      const links = await tx.update(kitShareLinks).set({ revokedAt: now, revokedByUserId: scope.userId })
        .where(and(eq(kitShareLinks.workspaceId, scope.workspaceId), eq(kitShareLinks.packId, pack.id), isNull(kitShareLinks.revokedAt))).returning({ id: kitShareLinks.id });
      revoked = links.length;
    }
    await recordKitAudit(tx, scope, "pack_updated", "kit_pack", pack.id, { fields: changed.join(", "), approvalReset: wasApproved, linksRevoked: revoked });
    return { changed: true, fields: changed, approvalReset: wasApproved, linksRevoked: revoked } as const;
  });
}

export function listKitPacks(scope: WorkspaceScope) {
  return getDatabase().select({
    id: kitPacks.id, title: kitPacks.title, recipientName: kitPacks.recipientName, recipientOrganisation: kitPacks.recipientOrganisation,
    templateKey: kitPacks.templateKey, status: kitPacks.status, updatedAt: kitPacks.updatedAt, leadId: kitPacks.leadId,
  }).from(kitPacks).where(eq(kitPacks.workspaceId, scope.workspaceId)).orderBy(desc(kitPacks.updatedAt)).limit(100);
}

export async function getKitPack(scope: WorkspaceScope, packId: string) {
  const bundle = await loadBundle(getDatabase(), scope.workspaceId, packId);
  if (!bundle) return null;
  return {
    pack: bundle.pack, kitName: bundle.kitName, kitContent: bundle.content, kitIsBehind: bundle.kitCurrentVersion > bundle.pack.kitVersion,
    caseStudies: bundle.studies, documents: bundle.assets, approvalCurrent: isApprovedAndCurrent(bundle),
  };
}

/** Records the explicit human approval of recipient, message, case studies and documents as they stand now. */
export async function approveKitPack(scope: WorkspaceScope, packId: string) {
  requireManage(scope);
  return getDatabase().transaction(async (tx) => {
    const [locked] = await tx.select({ id: kitPacks.id }).from(kitPacks).where(and(eq(kitPacks.workspaceId, scope.workspaceId), eq(kitPacks.id, packId))).limit(1).for("update");
    if (!locked) throw new KitError("not_found", "Choose a pack in this workspace.");
    const bundle = await loadBundle(tx, scope.workspaceId, packId);
    if (!bundle) throw new KitError("not_found", "Choose a pack in this workspace.");
    if (bundle.pack.message.trim().length < 10) throw new KitError("invalid", "Write the message before approving the pack.");
    const template = getPackTemplate(bundle.pack.templateKey);
    if (!template || bundle.studies.length < template.minCaseStudies || bundle.studies.length > template.maxCaseStudies) throw new KitError("invalid", "The case study selection no longer fits this template.");
    if (bundle.studies.some((study) => study.status !== "active") || bundle.assets.some((asset) => asset.status !== "active")) throw new KitError("invalid", "Restore or remove archived case studies and documents first.");
    if (isApprovedAndCurrent(bundle)) return { changed: false, digest: bundle.pack.approvedDigest ?? "" } as const;
    const digest = packDigest(bundle);
    await tx.update(kitPacks).set({ status: "approved", approvedAt: new Date(), approvedByUserId: scope.userId, approvedDigest: digest })
      .where(and(eq(kitPacks.workspaceId, scope.workspaceId), eq(kitPacks.id, packId)));
    await recordKitAudit(tx, scope, "pack_approved", "kit_pack", packId, { digest: digest.slice(0, 16) });
    return { changed: true, digest } as const;
  });
}

// ---------------------------------------------------------------------------------------------
// PDF rendering
// ---------------------------------------------------------------------------------------------

async function renderBundlePdf(executor: Executor, workspaceId: string, bundle: Bundle) {
  const studyIds = bundle.studies.map((study) => study.id);
  const shots = studyIds.length === 0 ? [] : await executor.select({
    caseStudyId: caseStudyAssets.caseStudyId, caption: caseStudyAssets.caption, position: caseStudyAssets.position,
    contentType: kitAssetVersions.contentType, data: kitAssetVersions.data,
  }).from(caseStudyAssets)
    .innerJoin(kitAssets, and(eq(kitAssets.workspaceId, caseStudyAssets.workspaceId), eq(kitAssets.id, caseStudyAssets.assetId), eq(kitAssets.status, "active")))
    .innerJoin(kitAssetVersions, and(eq(kitAssetVersions.workspaceId, kitAssets.workspaceId), eq(kitAssetVersions.assetId, kitAssets.id), eq(kitAssetVersions.version, kitAssets.currentVersion)))
    .where(and(eq(caseStudyAssets.workspaceId, workspaceId), inArray(caseStudyAssets.caseStudyId, studyIds))).orderBy(asc(caseStudyAssets.position));
  const pdfStudies: PdfCaseStudy[] = bundle.studies.map((study) => ({
    projectName: study.projectName, problem: study.problem, solution: study.solution, techStack: study.techStack, responsibilities: study.responsibilities,
    architectureSummary: study.architectureSummary, repositoryUrl: study.repositoryUrl, demoUrl: study.demoUrl, results: study.results,
    resultsVerified: study.resultsVerified, developmentStatus: study.developmentStatus as PdfCaseStudy["developmentStatus"],
    screenshots: shots.filter((shot) => shot.caseStudyId === study.id && (shot.contentType === "image/png" || shot.contentType === "image/jpeg"))
      .map((shot) => ({ bytes: shot.data, contentType: shot.contentType as "image/png" | "image/jpeg", caption: shot.caption })),
  }));
  const content: KitContent = bundle.content;
  const recipient = bundle.pack.recipientOrganisation ? `${bundle.pack.recipientName}, ${bundle.pack.recipientOrganisation}` : bundle.pack.recipientName;
  const bytes = await generateKitPdf({
    content, caseStudies: pdfStudies, attachments: bundle.assets.map((asset) => ({ title: asset.title })), fonts: (await loadPdfFonts()) ?? undefined,
    meta: { title: bundle.pack.title, author: content.profile.displayName, subject: `Capability kit for ${recipient}`, createdAt: bundle.pack.approvedAt ?? bundle.pack.updatedAt, recipientLabel: recipient },
  });
  return { bytes, filename: sanitizeFilename(bundle.pack.title, "pdf") };
}

/** Signed-in review/download of a pack's PDF; drafts are allowed here so authors can review before approving. */
export async function getKitPackPdf(scope: WorkspaceScope, packId: string) {
  const db = getDatabase();
  const bundle = await loadBundle(db, scope.workspaceId, packId);
  if (!bundle) throw new KitError("not_found", "Choose a pack in this workspace.");
  const result = await renderBundlePdf(db, scope.workspaceId, bundle);
  await db.insert(kitAccessEvents).values({ workspaceId: scope.workspaceId, packId, eventType: "pack_download", actorUserId: scope.userId });
  return { ...result, approved: isApprovedAndCurrent(bundle) };
}

// ---------------------------------------------------------------------------------------------
// Attachments: references only. Nothing here sends anything; delivery stays a separate, human-approved step.
// ---------------------------------------------------------------------------------------------

export type AttachmentTarget = Readonly<{ type: "proposal" | "lead" | "campaign"; id: string }>;

export async function attachKitPack(scope: WorkspaceScope, input: { packId: string; target: AttachmentTarget }) {
  requireWrite(scope);
  return getDatabase().transaction(async (tx) => {
    const bundle = await loadBundle(tx, scope.workspaceId, input.packId);
    if (!bundle) throw new KitError("not_found", "Choose a pack in this workspace.");
    assertApproved(bundle);
    const { type, id } = input.target;
    if (type === "proposal") {
      const [row] = await tx.select({ status: proposals.status }).from(proposals).where(and(eq(proposals.workspaceId, scope.workspaceId), eq(proposals.id, id))).limit(1);
      if (!row) throw new KitError("not_found", "Choose a proposal in this workspace.");
      if (row.status !== "approved") throw new KitError("not_approved", "Attach packs only to an approved proposal.");
    } else if (type === "campaign") {
      const [row] = await tx.select({ status: campaigns.status }).from(campaigns).where(and(eq(campaigns.workspaceId, scope.workspaceId), eq(campaigns.id, id))).limit(1);
      if (!row) throw new KitError("not_found", "Choose a campaign in this workspace.");
      if (row.status !== "reviewed") throw new KitError("not_approved", "Attach packs only to a reviewed (approved) campaign.");
    } else {
      const [row] = await tx.select({ id: leads.id }).from(leads).where(and(eq(leads.workspaceId, scope.workspaceId), eq(leads.id, id))).limit(1);
      if (!row) throw new KitError("not_found", "Choose a lead in this workspace.");
    }
    const [created] = await tx.insert(kitAttachments).values({
      workspaceId: scope.workspaceId, packId: input.packId, targetType: type, attachedByUserId: scope.userId,
      proposalId: type === "proposal" ? id : null, leadId: type === "lead" ? id : null, campaignId: type === "campaign" ? id : null,
    }).onConflictDoNothing().returning({ id: kitAttachments.id });
    if (created) await recordKitAudit(tx, scope, "pack_attached", "kit_pack", input.packId, { targetType: type, targetId: id });
    return { attached: Boolean(created) };
  });
}

export async function detachKitPack(scope: WorkspaceScope, attachmentId: string) {
  requireWrite(scope);
  const [removed] = await getDatabase().delete(kitAttachments).where(and(eq(kitAttachments.workspaceId, scope.workspaceId), eq(kitAttachments.id, attachmentId)))
    .returning({ id: kitAttachments.id, packId: kitAttachments.packId });
  if (removed) await recordKitAudit(getDatabase(), scope, "pack_detached", "kit_pack", removed.packId);
  return { detached: Boolean(removed) };
}

export function listAttachmentsForTarget(scope: WorkspaceScope, target: AttachmentTarget) {
  const column = target.type === "proposal" ? kitAttachments.proposalId : target.type === "lead" ? kitAttachments.leadId : kitAttachments.campaignId;
  return getDatabase().select({ id: kitAttachments.id, packId: kitAttachments.packId, title: kitPacks.title, recipientName: kitPacks.recipientName, createdAt: kitAttachments.createdAt })
    .from(kitAttachments).innerJoin(kitPacks, and(eq(kitPacks.workspaceId, kitAttachments.workspaceId), eq(kitPacks.id, kitAttachments.packId)))
    .where(and(eq(kitAttachments.workspaceId, scope.workspaceId), eq(kitAttachments.targetType, target.type), eq(column, target.id))).orderBy(desc(kitAttachments.createdAt));
}

// ---------------------------------------------------------------------------------------------
// Share links: unguessable, expiring, revocable, download-limited. Only the token's hash is stored.
// ---------------------------------------------------------------------------------------------

export async function createKitShareLink(scope: WorkspaceScope, input: { packId: string; days?: number | undefined; maxDownloads?: number | undefined }) {
  requireManage(scope);
  if (input.maxDownloads !== undefined && (!Number.isInteger(input.maxDownloads) || input.maxDownloads < 1 || input.maxDownloads > 100)) throw new KitError("invalid", "Use a download limit between 1 and 100.");
  return getDatabase().transaction(async (tx) => {
    const [locked] = await tx.select({ id: kitPacks.id }).from(kitPacks).where(and(eq(kitPacks.workspaceId, scope.workspaceId), eq(kitPacks.id, input.packId))).limit(1).for("update");
    if (!locked) throw new KitError("not_found", "Choose a pack in this workspace.");
    const bundle = await loadBundle(tx, scope.workspaceId, input.packId);
    if (!bundle) throw new KitError("not_found", "Choose a pack in this workspace.");
    assertApproved(bundle);
    const [active] = await tx.select({ total: sql<number>`count(*)::int` }).from(kitShareLinks).where(and(
      eq(kitShareLinks.workspaceId, scope.workspaceId), eq(kitShareLinks.packId, input.packId), isNull(kitShareLinks.revokedAt), gt(kitShareLinks.expiresAt, sql`now()`)));
    if ((active?.total ?? 0) >= MAX_ACTIVE_LINKS_PER_PACK) throw new KitError("quota", `A pack can have at most ${MAX_ACTIVE_LINKS_PER_PACK} active links. Revoke one first.`);
    const token = generateShareToken();
    const expiresAt = shareExpiry(input.days ?? DEFAULT_SHARE_LIFETIME_DAYS);
    const [link] = await tx.insert(kitShareLinks).values({
      workspaceId: scope.workspaceId, packId: input.packId, tokenHash: hashShareToken(token), expiresAt, maxDownloads: input.maxDownloads ?? null, createdByUserId: scope.userId,
    }).returning({ id: kitShareLinks.id });
    if (!link) throw new Error("Share link was not created");
    await recordKitAudit(tx, scope, "share_link_created", "kit_share_link", link.id, { packId: input.packId, expiresAt: expiresAt.toISOString(), maxDownloads: input.maxDownloads ?? null });
    return { linkId: link.id, token, expiresAt };
  });
}

export async function revokeKitShareLink(scope: WorkspaceScope, linkId: string) {
  requireWrite(scope);
  const [revoked] = await getDatabase().update(kitShareLinks).set({ revokedAt: new Date(), revokedByUserId: scope.userId })
    .where(and(eq(kitShareLinks.workspaceId, scope.workspaceId), eq(kitShareLinks.id, linkId), isNull(kitShareLinks.revokedAt))).returning({ id: kitShareLinks.id, packId: kitShareLinks.packId });
  if (revoked) await recordKitAudit(getDatabase(), scope, "share_link_revoked", "kit_share_link", linkId, { packId: revoked.packId });
  return { revoked: Boolean(revoked) };
}

export function listKitShareLinks(scope: WorkspaceScope, packId: string) {
  return getDatabase().select({
    id: kitShareLinks.id, expiresAt: kitShareLinks.expiresAt, revokedAt: kitShareLinks.revokedAt, maxDownloads: kitShareLinks.maxDownloads,
    downloadCount: kitShareLinks.downloadCount, createdAt: kitShareLinks.createdAt,
    // Evaluated by the database clock so the page and the download route agree on what "expired" means.
    state: sql<"active" | "revoked" | "expired" | "limit reached">`case
      when ${kitShareLinks.revokedAt} is not null then 'revoked'
      when ${kitShareLinks.expiresAt} <= now() then 'expired'
      when ${kitShareLinks.maxDownloads} is not null and ${kitShareLinks.downloadCount} >= ${kitShareLinks.maxDownloads} then 'limit reached'
      else 'active' end`,
  }).from(kitShareLinks).where(and(eq(kitShareLinks.workspaceId, scope.workspaceId), eq(kitShareLinks.packId, packId))).orderBy(desc(kitShareLinks.createdAt)).limit(50);
}

export function listKitAccessEvents(scope: WorkspaceScope, packId: string) {
  return getDatabase().select({ id: kitAccessEvents.id, eventType: kitAccessEvents.eventType, createdAt: kitAccessEvents.createdAt, linkId: kitAccessEvents.linkId, actorUserId: kitAccessEvents.actorUserId })
    .from(kitAccessEvents).where(and(eq(kitAccessEvents.workspaceId, scope.workspaceId), eq(kitAccessEvents.packId, packId))).orderBy(desc(kitAccessEvents.createdAt)).limit(100);
}

export type ShareDownload = Readonly<{ ok: true; bytes: Uint8Array; filename: string }> | Readonly<{ ok: false }>;

/**
 * Public, token-only download. Every failure looks identical to the caller; the specific reason is recorded in the
 * access log. A malformed or unknown token records nothing because it cannot be tied to a workspace.
 */
export async function resolveShareDownload(token: unknown, context: { ipHash: string | null }): Promise<ShareDownload> {
  if (!isWellFormedShareToken(token)) return { ok: false };
  const db = getDatabase();
  const [link] = await db.select().from(kitShareLinks).where(eq(kitShareLinks.tokenHash, hashShareToken(token))).limit(1);
  if (!link) return { ok: false };
  const deny = async (eventType: "link_denied_expired" | "link_denied_revoked" | "link_denied_limit"): Promise<ShareDownload> => {
    await db.insert(kitAccessEvents).values({ workspaceId: link.workspaceId, linkId: link.id, packId: link.packId, eventType, ipHash: context.ipHash });
    return { ok: false };
  };
  if (link.revokedAt) return deny("link_denied_revoked");
  if (link.expiresAt.getTime() <= Date.now()) return deny("link_denied_expired");
  const bundle = await loadBundle(db, link.workspaceId, link.packId);
  // Content that changed or lost its approval after the link was issued is no longer shareable.
  if (!bundle || !isApprovedAndCurrent(bundle)) return deny("link_denied_revoked");
  const claimed = await db.update(kitShareLinks).set({ downloadCount: sql`${kitShareLinks.downloadCount} + 1` }).where(and(
    eq(kitShareLinks.id, link.id), isNull(kitShareLinks.revokedAt), gt(kitShareLinks.expiresAt, sql`now()`),
    or(isNull(kitShareLinks.maxDownloads), lt(kitShareLinks.downloadCount, kitShareLinks.maxDownloads)),
  )).returning({ id: kitShareLinks.id });
  if (claimed.length === 0) return deny("link_denied_limit");
  const result = await renderBundlePdf(db, link.workspaceId, bundle);
  await db.insert(kitAccessEvents).values({ workspaceId: link.workspaceId, linkId: link.id, packId: link.packId, eventType: "link_download", ipHash: context.ipHash });
  return { ok: true, bytes: result.bytes, filename: result.filename };
}

// ---------------------------------------------------------------------------------------------
// Read helpers for the pack page
// ---------------------------------------------------------------------------------------------

export function listPackAttachments(scope: WorkspaceScope, packId: string) {
  return getDatabase().select({
    id: kitAttachments.id, targetType: kitAttachments.targetType, createdAt: kitAttachments.createdAt,
    leadTitle: leads.title, proposalTitle: proposals.title, campaignName: campaigns.name,
  }).from(kitAttachments)
    .leftJoin(leads, and(eq(leads.workspaceId, kitAttachments.workspaceId), eq(leads.id, kitAttachments.leadId)))
    .leftJoin(proposals, and(eq(proposals.workspaceId, kitAttachments.workspaceId), eq(proposals.id, kitAttachments.proposalId)))
    .leftJoin(campaigns, and(eq(campaigns.workspaceId, kitAttachments.workspaceId), eq(campaigns.id, kitAttachments.campaignId)))
    .where(and(eq(kitAttachments.workspaceId, scope.workspaceId), eq(kitAttachments.packId, packId))).orderBy(desc(kitAttachments.createdAt));
}

/** Targets a pack may be attached to: any lead, approved proposals, and reviewed (approved) campaigns. */
export async function listAttachmentTargets(scope: WorkspaceScope) {
  const db = getDatabase();
  const [leadRows, proposalRows, campaignRows] = await Promise.all([
    db.select({ id: leads.id, label: leads.title }).from(leads).where(eq(leads.workspaceId, scope.workspaceId)).orderBy(desc(leads.updatedAt)).limit(100),
    db.select({ id: proposals.id, label: proposals.title }).from(proposals).where(and(eq(proposals.workspaceId, scope.workspaceId), eq(proposals.status, "approved"))).orderBy(desc(proposals.updatedAt)).limit(100),
    db.select({ id: campaigns.id, label: campaigns.name }).from(campaigns).where(and(eq(campaigns.workspaceId, scope.workspaceId), eq(campaigns.status, "reviewed"))).orderBy(desc(campaigns.updatedAt)).limit(100),
  ]);
  return { leads: leadRows, proposals: proposalRows, campaigns: campaignRows };
}
// ---------------------------------------------------------------------------------------------
// Integration with CRM, proposals, campaigns and AI drafting
// ---------------------------------------------------------------------------------------------

export type AttachmentState = "approved" | "changed_since_approval" | "draft";

/** What a CRM lead, proposal or campaign page shows for each attached pack: approval state and link expiry. */
export async function listTargetAttachments(scope: WorkspaceScope, target: AttachmentTarget) {
  const rows = await listAttachmentsForTarget(scope, target);
  const db = getDatabase();
  return Promise.all(rows.map(async (row) => {
    const bundle = await loadBundle(db, scope.workspaceId, row.packId);
    const links = await db.select({ expiresAt: kitShareLinks.expiresAt }).from(kitShareLinks).where(and(
      eq(kitShareLinks.workspaceId, scope.workspaceId), eq(kitShareLinks.packId, row.packId), isNull(kitShareLinks.revokedAt), gt(kitShareLinks.expiresAt, sql`now()`),
    )).orderBy(desc(kitShareLinks.expiresAt)).limit(50);
    const state: AttachmentState = !bundle || bundle.pack.status !== "approved" ? "draft" : isApprovedAndCurrent(bundle) ? "approved" : "changed_since_approval";
    return {
      attachmentId: row.id, packId: row.packId, title: row.title, recipientName: row.recipientName, state,
      approvedAt: bundle?.pack.approvedAt ?? null, linkExpiresAt: links[0]?.expiresAt ?? null, activeLinks: links.length, attachedAt: row.createdAt,
    };
  }));
}

/**
 * The send gate for campaigns: every pack attached to the campaign must still be approved exactly as reviewed.
 * A pack whose recipient, message, case studies or documents changed after approval is stale and blocks sending.
 */
export async function campaignAttachmentsAreCurrent(executor: Executor, workspaceId: string, campaignId: string) {
  const refs = await executor.select({ packId: kitAttachments.packId }).from(kitAttachments)
    .where(and(eq(kitAttachments.workspaceId, workspaceId), eq(kitAttachments.campaignId, campaignId)));
  const stale: string[] = [];
  for (const ref of refs) {
    const bundle = await loadBundle(executor, workspaceId, ref.packId);
    if (!bundle || !isApprovedAndCurrent(bundle)) stale.push(bundle?.pack.title ?? ref.packId);
  }
  return { ok: stale.length === 0, stale } as const;
}

/** Approved packs that are still current, for the recipient-specific selector in outreach drafting. */
export async function listApprovedPacks(scope: WorkspaceScope) {
  const db = getDatabase();
  const candidates = await db.select({ id: kitPacks.id }).from(kitPacks)
    .where(and(eq(kitPacks.workspaceId, scope.workspaceId), eq(kitPacks.status, "approved"))).orderBy(desc(kitPacks.updatedAt)).limit(50);
  const result: { id: string; title: string; recipientName: string; recipientOrganisation: string | null }[] = [];
  for (const candidate of candidates) {
    const bundle = await loadBundle(db, scope.workspaceId, candidate.id);
    if (bundle && isApprovedAndCurrent(bundle)) result.push({ id: bundle.pack.id, title: bundle.pack.title, recipientName: bundle.pack.recipientName, recipientOrganisation: bundle.pack.recipientOrganisation });
  }
  return result;
}

/**
 * The sender's own approved capabilities, as grounded evidence for AI drafting. Ids are the case study and document ids, so
 * a draft may cite them; unverified results are never included, and only approved, current packs can be used.
 */
export async function buildPackCapabilityEvidence(executor: Executor, workspaceId: string, packId: string): Promise<SalesEvidence[]> {
  const bundle = await loadBundle(executor, workspaceId, packId);
  if (!bundle) throw new KitError("not_found", "Choose a capability pack in this workspace.");
  assertApproved(bundle);
  const studies = bundle.studies.map((study): SalesEvidence => ({
    id: study.id, category: "capability", confidence: study.resultsVerified && study.results ? "high" : "medium", observedAt: study.updatedAt.toISOString(),
    excerpt: redactEvidence([
      `Sender capability (case study): ${study.projectName}. Status: ${developmentStatusLabels[study.developmentStatus as DevelopmentStatus]}.`,
      study.techStack.length ? `Stack: ${study.techStack.join(", ")}.` : "",
      study.solution ? `Solution: ${study.solution}` : "",
      study.resultsVerified && study.results ? `Verified results: ${study.results}` : "",
    ].filter(Boolean).join(" ")),
  }));
  const documents = bundle.assets.map((asset): SalesEvidence => ({
    id: asset.assetId, category: "capability_document", confidence: "high", observedAt: bundle.pack.approvedAt?.toISOString() ?? bundle.pack.updatedAt.toISOString(),
    excerpt: redactEvidence(`Approved supporting document available to share on request: ${asset.title}.`),
  }));
  return [...studies, ...documents];
}