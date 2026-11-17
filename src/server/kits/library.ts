import { and, asc, desc, eq, inArray, lt, sql } from "drizzle-orm";
import { ZodError } from "zod";
import { caseStudySchema, kitContentSchema, type CaseStudyInput, type KitContent, type KitContentInput } from "@/modules/kits/content";
import { UploadValidationError, validateUpload } from "@/modules/kits/files";
import type { WorkspaceScope } from "@/modules/workspaces/scope";
import { getDatabase } from "@/server/db";
import {
  capabilityKits, capabilityKitVersions, caseStudies, caseStudyAssets, kitAccessEvents, kitAssets, kitAssetVersions, kitPackAssets,
} from "@/server/db/schema";
import { KitError, recordKitAudit, requireManage, requireWrite, type Executor } from "./common";

export const MAX_ASSETS_PER_WORKSPACE = 200;
export const MAX_VERSIONS_PER_ASSET = 20;
export const MAX_WORKSPACE_STORAGE_BYTES = 50_000_000;

function invalid(error: unknown): never {
  if (error instanceof ZodError) throw new KitError("invalid", error.issues[0]?.message ?? "Check the details.");
  if (error instanceof UploadValidationError) throw new KitError("invalid", error.message);
  throw error;
}

// ---------------------------------------------------------------------------------------------
// Documents (private assets)
// ---------------------------------------------------------------------------------------------

/** Creates a document, or a new version of one, after validating the bytes themselves. */
export async function uploadKitAsset(scope: WorkspaceScope, input: { assetId?: string | undefined; title?: string | undefined; filename: string; declaredType?: string | undefined; bytes: Uint8Array }) {
  requireWrite(scope);
  const file = await validateUpload({ filename: input.filename, declaredType: input.declaredType, bytes: input.bytes }).catch(invalid);
  const title = (input.title?.trim() || file.filename.replace(/\.[^.]+$/, "")).slice(0, 160) || "Document";
  return getDatabase().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`kit-assets:${scope.workspaceId}`}))`);
    const [usage] = await tx.select({ bytes: sql<number>`coalesce(sum(${kitAssetVersions.byteSize}), 0)::int` })
      .from(kitAssetVersions).where(eq(kitAssetVersions.workspaceId, scope.workspaceId));
    if ((usage?.bytes ?? 0) + file.byteSize > MAX_WORKSPACE_STORAGE_BYTES) throw new KitError("quota", "This workspace has reached its document storage limit. Archive and purge unused documents first.");

    let assetId: string;
    let version: number;
    if (input.assetId) {
      const [asset] = await tx.select().from(kitAssets).where(and(eq(kitAssets.workspaceId, scope.workspaceId), eq(kitAssets.id, input.assetId))).limit(1).for("update");
      if (!asset) throw new KitError("not_found", "Choose a document in this workspace.");
      if (asset.status !== "active") throw new KitError("conflict", "Restore the document before uploading a new version.");
      if (asset.kind !== file.kind) throw new KitError("invalid", "A new version must be the same kind of file as the document.");
      if (asset.currentVersion >= MAX_VERSIONS_PER_ASSET) throw new KitError("quota", `A document can have at most ${MAX_VERSIONS_PER_ASSET} versions.`);
      assetId = asset.id;
      version = asset.currentVersion + 1;
      await tx.update(kitAssets).set({ currentVersion: version, updatedAt: new Date() }).where(and(eq(kitAssets.workspaceId, scope.workspaceId), eq(kitAssets.id, assetId)));
    } else {
      const [count] = await tx.select({ total: sql<number>`count(*)::int` }).from(kitAssets).where(eq(kitAssets.workspaceId, scope.workspaceId));
      if ((count?.total ?? 0) >= MAX_ASSETS_PER_WORKSPACE) throw new KitError("quota", `A workspace can hold at most ${MAX_ASSETS_PER_WORKSPACE} documents.`);
      const [created] = await tx.insert(kitAssets).values({ workspaceId: scope.workspaceId, title, kind: file.kind, createdByUserId: scope.userId }).returning({ id: kitAssets.id });
      if (!created) throw new Error("Document was not created");
      assetId = created.id;
      version = 1;
    }
    await tx.insert(kitAssetVersions).values({
      workspaceId: scope.workspaceId, assetId, version, filename: file.filename, contentType: file.contentType, byteSize: file.byteSize,
      sha256: file.sha256, pageCount: file.pageCount, width: file.width, height: file.height, data: Buffer.from(input.bytes), uploadedByUserId: scope.userId,
    });
    await recordKitAudit(tx, scope, "asset_uploaded", "kit_asset", assetId, { kind: file.kind, version, bytes: file.byteSize });
    return { assetId, version, filename: file.filename, kind: file.kind, byteSize: file.byteSize, pageCount: file.pageCount };
  });
}

export function listKitAssets(scope: WorkspaceScope, options: { includeArchived?: boolean } = {}) {
  return getDatabase().select({
    id: kitAssets.id, title: kitAssets.title, kind: kitAssets.kind, status: kitAssets.status, currentVersion: kitAssets.currentVersion,
    updatedAt: kitAssets.updatedAt, filename: kitAssetVersions.filename, contentType: kitAssetVersions.contentType,
    byteSize: kitAssetVersions.byteSize, pageCount: kitAssetVersions.pageCount, sha256: kitAssetVersions.sha256,
    // True when a pack or case study still references the document; purge keeps those.
    inUse: sql<boolean>`(exists (select 1 from ${kitPackAssets} p where p.workspace_id = ${kitAssets.workspaceId} and p.asset_id = ${kitAssets.id}) or exists (select 1 from ${caseStudyAssets} c where c.workspace_id = ${kitAssets.workspaceId} and c.asset_id = ${kitAssets.id}))`,
  }).from(kitAssets)
    .innerJoin(kitAssetVersions, and(eq(kitAssetVersions.workspaceId, kitAssets.workspaceId), eq(kitAssetVersions.assetId, kitAssets.id), eq(kitAssetVersions.version, kitAssets.currentVersion)))
    .where(and(eq(kitAssets.workspaceId, scope.workspaceId), options.includeArchived ? undefined : eq(kitAssets.status, "active")))
    .orderBy(desc(kitAssets.updatedAt)).limit(200);
}

export async function getKitAsset(scope: WorkspaceScope, assetId: string) {
  const [asset] = await getDatabase().select({
    id: kitAssets.id, title: kitAssets.title, kind: kitAssets.kind, status: kitAssets.status, currentVersion: kitAssets.currentVersion, updatedAt: kitAssets.updatedAt,
  }).from(kitAssets).where(and(eq(kitAssets.workspaceId, scope.workspaceId), eq(kitAssets.id, assetId))).limit(1);
  return asset ?? null;
}
export async function listKitAssetVersions(scope: WorkspaceScope, assetId: string) {
  return getDatabase().select({
    version: kitAssetVersions.version, filename: kitAssetVersions.filename, contentType: kitAssetVersions.contentType, byteSize: kitAssetVersions.byteSize,
    pageCount: kitAssetVersions.pageCount, sha256: kitAssetVersions.sha256, createdAt: kitAssetVersions.createdAt,
  }).from(kitAssetVersions).where(and(eq(kitAssetVersions.workspaceId, scope.workspaceId), eq(kitAssetVersions.assetId, assetId)))
    .orderBy(desc(kitAssetVersions.version));
}

/** The only path that reads file bytes for a signed-in user. Every read is scoped to the caller's workspace and logged. */
export async function getKitAssetFile(scope: WorkspaceScope, assetId: string, options: { version?: number | undefined } = {}) {
  const db = getDatabase();
  const [asset] = await db.select({ id: kitAssets.id, title: kitAssets.title, currentVersion: kitAssets.currentVersion })
    .from(kitAssets).where(and(eq(kitAssets.workspaceId, scope.workspaceId), eq(kitAssets.id, assetId))).limit(1);
  if (!asset) throw new KitError("not_found", "Choose a document in this workspace.");
  const [file] = await db.select().from(kitAssetVersions).where(and(
    eq(kitAssetVersions.workspaceId, scope.workspaceId), eq(kitAssetVersions.assetId, assetId), eq(kitAssetVersions.version, options.version ?? asset.currentVersion),
  )).limit(1);
  if (!file) throw new KitError("not_found", "That version does not exist.");
  await db.insert(kitAccessEvents).values({ workspaceId: scope.workspaceId, assetId, eventType: "asset_download", actorUserId: scope.userId });
  return { filename: file.filename, contentType: file.contentType, byteSize: file.byteSize, sha256: file.sha256, data: file.data, title: asset.title };
}

async function setAssetStatus(scope: WorkspaceScope, assetId: string, status: "active" | "archived") {
  requireWrite(scope);
  const [updated] = await getDatabase().update(kitAssets).set({ status, archivedAt: status === "archived" ? new Date() : null, updatedAt: new Date() })
    .where(and(eq(kitAssets.workspaceId, scope.workspaceId), eq(kitAssets.id, assetId), eq(kitAssets.status, status === "archived" ? "active" : "archived")))
    .returning({ id: kitAssets.id });
  if (updated) await recordKitAudit(getDatabase(), scope, status === "archived" ? "asset_archived" : "asset_restored", "kit_asset", assetId);
  return { changed: Boolean(updated) };
}
export const archiveKitAsset = (scope: WorkspaceScope, assetId: string) => setAssetStatus(scope, assetId, "archived");
export const restoreKitAsset = (scope: WorkspaceScope, assetId: string) => setAssetStatus(scope, assetId, "active");

/**
 * Deletes archived documents older than `olderThan` that no pack or case study still references (foreign keys
 * would refuse the rest anyway). Returns what was removed so the caller can report it.
 */
export async function purgeArchivedKitAssets(scope: WorkspaceScope, olderThan: Date) {
  requireManage(scope);
  return getDatabase().transaction(async (tx) => {
    const candidates = await tx.select({ id: kitAssets.id }).from(kitAssets).where(and(
      eq(kitAssets.workspaceId, scope.workspaceId), eq(kitAssets.status, "archived"), lt(kitAssets.archivedAt, olderThan),
      sql`not exists (select 1 from ${kitPackAssets} p where p.workspace_id = ${kitAssets.workspaceId} and p.asset_id = ${kitAssets.id})`,
      sql`not exists (select 1 from ${caseStudyAssets} c where c.workspace_id = ${kitAssets.workspaceId} and c.asset_id = ${kitAssets.id})`,
    ));
    if (candidates.length === 0) return { purged: 0, bytes: 0 };
    const ids = candidates.map((row) => row.id);
    const [size] = await tx.select({ bytes: sql<number>`coalesce(sum(${kitAssetVersions.byteSize}), 0)::int` }).from(kitAssetVersions)
      .where(and(eq(kitAssetVersions.workspaceId, scope.workspaceId), inArray(kitAssetVersions.assetId, ids)));
    await tx.delete(kitAssets).where(and(eq(kitAssets.workspaceId, scope.workspaceId), inArray(kitAssets.id, ids)));
    await recordKitAudit(tx, scope, "assets_purged", "kit_asset", ids[0] ?? "", { count: ids.length, bytes: size?.bytes ?? 0 });
    return { purged: ids.length, bytes: size?.bytes ?? 0 };
  });
}

// ---------------------------------------------------------------------------------------------
// Capability kits (versioned)
// ---------------------------------------------------------------------------------------------

async function assertKitReferences(executor: Executor, workspaceId: string, content: KitContent) {
  if (content.featuredCaseStudyIds.length > 0) {
    const found = await executor.select({ id: caseStudies.id }).from(caseStudies).where(and(
      eq(caseStudies.workspaceId, workspaceId), eq(caseStudies.status, "active"), inArray(caseStudies.id, content.featuredCaseStudyIds)));
    if (found.length !== new Set(content.featuredCaseStudyIds).size) throw new KitError("invalid", "Choose featured projects from this workspace's active case studies.");
  }
  if (content.attachmentAssetIds.length > 0) {
    const found = await executor.select({ id: kitAssets.id }).from(kitAssets).where(and(
      eq(kitAssets.workspaceId, workspaceId), eq(kitAssets.status, "active"), inArray(kitAssets.id, content.attachmentAssetIds)));
    if (found.length !== new Set(content.attachmentAssetIds).size) throw new KitError("invalid", "Choose supporting documents from this workspace's active documents.");
  }
}

function parseContent(input: KitContentInput): KitContent {
  try { return kitContentSchema.parse(input); } catch (error) { return invalid(error); }
}

export async function createCapabilityKit(scope: WorkspaceScope, input: { name: string; content: KitContentInput }) {
  requireWrite(scope);
  const name = input.name.trim();
  if (name.length < 2 || name.length > 120) throw new KitError("invalid", "Use a kit name of 2 to 120 characters.");
  const content = parseContent(input.content);
  return getDatabase().transaction(async (tx) => {
    await assertKitReferences(tx, scope.workspaceId, content);
    const [kit] = await tx.insert(capabilityKits).values({ workspaceId: scope.workspaceId, name, createdByUserId: scope.userId }).returning({ id: capabilityKits.id });
    if (!kit) throw new Error("Kit was not created");
    await tx.insert(capabilityKitVersions).values({ workspaceId: scope.workspaceId, kitId: kit.id, version: 1, content, createdByUserId: scope.userId });
    await recordKitAudit(tx, scope, "kit_created", "capability_kit", kit.id, { version: 1 });
    return { kitId: kit.id, version: 1 };
  });
}

/** Saves a new immutable version. `expectedVersion` is what the editor loaded; a mismatch means someone saved first. */
export async function saveCapabilityKitVersion(scope: WorkspaceScope, input: { kitId: string; expectedVersion: number; content: KitContentInput; changeNote?: string | undefined; name?: string | undefined }) {
  requireWrite(scope);
  const content = parseContent(input.content);
  const note = input.changeNote?.trim().slice(0, 300) || null;
  return getDatabase().transaction(async (tx) => {
    const [kit] = await tx.select().from(capabilityKits).where(and(eq(capabilityKits.workspaceId, scope.workspaceId), eq(capabilityKits.id, input.kitId))).limit(1).for("update");
    if (!kit) throw new KitError("not_found", "Choose a kit in this workspace.");
    if (kit.status !== "active") throw new KitError("conflict", "Restore the kit before editing it.");
    if (kit.currentVersion !== input.expectedVersion) throw new KitError("conflict", "This kit was saved by someone else. Reload it to see the latest version, then reapply your changes.");
    await assertKitReferences(tx, scope.workspaceId, content);
    const version = kit.currentVersion + 1;
    const name = input.name?.trim() || kit.name;
    if (name.length < 2 || name.length > 120) throw new KitError("invalid", "Use a kit name of 2 to 120 characters.");
    await tx.insert(capabilityKitVersions).values({ workspaceId: scope.workspaceId, kitId: kit.id, version, content, changeNote: note, createdByUserId: scope.userId });
    await tx.update(capabilityKits).set({ currentVersion: version, name, updatedAt: new Date() }).where(and(eq(capabilityKits.workspaceId, scope.workspaceId), eq(capabilityKits.id, kit.id)));
    await recordKitAudit(tx, scope, "kit_version_saved", "capability_kit", kit.id, { version });
    return { kitId: kit.id, version };
  });
}

export function listCapabilityKits(scope: WorkspaceScope, options: { includeArchived?: boolean } = {}) {
  return getDatabase().select({ id: capabilityKits.id, name: capabilityKits.name, status: capabilityKits.status, currentVersion: capabilityKits.currentVersion, updatedAt: capabilityKits.updatedAt })
    .from(capabilityKits).where(and(eq(capabilityKits.workspaceId, scope.workspaceId), options.includeArchived ? undefined : eq(capabilityKits.status, "active")))
    .orderBy(desc(capabilityKits.updatedAt)).limit(100);
}

export async function getCapabilityKit(scope: WorkspaceScope, kitId: string) {
  const db = getDatabase();
  const [kit] = await db.select().from(capabilityKits).where(and(eq(capabilityKits.workspaceId, scope.workspaceId), eq(capabilityKits.id, kitId))).limit(1);
  if (!kit) return null;
  const versions = await db.select({ version: capabilityKitVersions.version, content: capabilityKitVersions.content, changeNote: capabilityKitVersions.changeNote, createdAt: capabilityKitVersions.createdAt })
    .from(capabilityKitVersions).where(and(eq(capabilityKitVersions.workspaceId, scope.workspaceId), eq(capabilityKitVersions.kitId, kitId)))
    .orderBy(desc(capabilityKitVersions.version)).limit(50);
  const current = versions.find((entry) => entry.version === kit.currentVersion);
  return { kit, content: current?.content ?? null, versions: versions.map((entry) => ({ version: entry.version, changeNote: entry.changeNote, createdAt: entry.createdAt })) };
}

export async function setKitStatus(scope: WorkspaceScope, kitId: string, status: "active" | "archived") {
  requireWrite(scope);
  const [updated] = await getDatabase().update(capabilityKits).set({ status, archivedAt: status === "archived" ? new Date() : null, updatedAt: new Date() })
    .where(and(eq(capabilityKits.workspaceId, scope.workspaceId), eq(capabilityKits.id, kitId), eq(capabilityKits.status, status === "archived" ? "active" : "archived")))
    .returning({ id: capabilityKits.id });
  if (updated) await recordKitAudit(getDatabase(), scope, status === "archived" ? "kit_archived" : "kit_restored", "capability_kit", kitId);
  return { changed: Boolean(updated) };
}

// ---------------------------------------------------------------------------------------------
// Case studies
// ---------------------------------------------------------------------------------------------

function parseCaseStudy(input: CaseStudyInput) {
  try { return caseStudySchema.parse(input); } catch (error) { return invalid(error); }
}

function caseStudyRow(values: ReturnType<typeof parseCaseStudy>) {
  return {
    projectName: values.projectName, problem: values.problem, solution: values.solution, techStack: values.techStack,
    responsibilities: values.responsibilities, architectureSummary: values.architectureSummary,
    repositoryUrl: values.repositoryUrl || null, demoUrl: values.demoUrl || null,
    // Results are stored only as the author typed them and shown only when the author marks them verified.
    results: values.results || null, resultsVerified: values.resultsVerified && Boolean(values.results), developmentStatus: values.developmentStatus,
  };
}

export async function createCaseStudy(scope: WorkspaceScope, input: CaseStudyInput) {
  requireWrite(scope);
  const [created] = await getDatabase().insert(caseStudies).values({ workspaceId: scope.workspaceId, createdByUserId: scope.userId, ...caseStudyRow(parseCaseStudy(input)) }).returning({ id: caseStudies.id });
  if (!created) throw new Error("Case study was not created");
  await recordKitAudit(getDatabase(), scope, "case_study_created", "case_study", created.id);
  return { caseStudyId: created.id };
}

export async function updateCaseStudy(scope: WorkspaceScope, caseStudyId: string, input: CaseStudyInput) {
  requireWrite(scope);
  const [updated] = await getDatabase().update(caseStudies).set({ ...caseStudyRow(parseCaseStudy(input)), updatedAt: new Date() })
    .where(and(eq(caseStudies.workspaceId, scope.workspaceId), eq(caseStudies.id, caseStudyId), eq(caseStudies.status, "active"))).returning({ id: caseStudies.id });
  if (!updated) throw new KitError("not_found", "Choose an active case study in this workspace.");
  await recordKitAudit(getDatabase(), scope, "case_study_updated", "case_study", caseStudyId);
  return { caseStudyId };
}

export function listCaseStudies(scope: WorkspaceScope, options: { includeArchived?: boolean } = {}) {
  return getDatabase().select().from(caseStudies)
    .where(and(eq(caseStudies.workspaceId, scope.workspaceId), options.includeArchived ? undefined : eq(caseStudies.status, "active")))
    .orderBy(desc(caseStudies.updatedAt)).limit(200);
}

export async function setCaseStudyStatus(scope: WorkspaceScope, caseStudyId: string, status: "active" | "archived") {
  requireWrite(scope);
  const [updated] = await getDatabase().update(caseStudies).set({ status, archivedAt: status === "archived" ? new Date() : null, updatedAt: new Date() })
    .where(and(eq(caseStudies.workspaceId, scope.workspaceId), eq(caseStudies.id, caseStudyId), eq(caseStudies.status, status === "archived" ? "active" : "archived")))
    .returning({ id: caseStudies.id });
  if (updated) await recordKitAudit(getDatabase(), scope, status === "archived" ? "case_study_archived" : "case_study_restored", "case_study", caseStudyId);
  return { changed: Boolean(updated) };
}

/** Replaces a case study's screenshots. Only active image documents from the same workspace are accepted. */
export async function setCaseStudyScreenshots(scope: WorkspaceScope, caseStudyId: string, screenshots: readonly { assetId: string; caption?: string | undefined }[]) {
  requireWrite(scope);
  if (screenshots.length > 6) throw new KitError("invalid", "Use at most 6 screenshots per case study.");
  return getDatabase().transaction(async (tx) => {
    const [study] = await tx.select({ id: caseStudies.id }).from(caseStudies).where(and(eq(caseStudies.workspaceId, scope.workspaceId), eq(caseStudies.id, caseStudyId), eq(caseStudies.status, "active"))).limit(1).for("update");
    if (!study) throw new KitError("not_found", "Choose an active case study in this workspace.");
    const ids = [...new Set(screenshots.map((shot) => shot.assetId))];
    if (ids.length !== screenshots.length) throw new KitError("invalid", "Each screenshot can be used once.");
    if (ids.length > 0) {
      const images = await tx.select({ id: kitAssets.id }).from(kitAssets).where(and(eq(kitAssets.workspaceId, scope.workspaceId), eq(kitAssets.status, "active"), eq(kitAssets.kind, "image"), inArray(kitAssets.id, ids)));
      if (images.length !== ids.length) throw new KitError("invalid", "Choose active image documents from this workspace.");
    }
    await tx.delete(caseStudyAssets).where(and(eq(caseStudyAssets.workspaceId, scope.workspaceId), eq(caseStudyAssets.caseStudyId, caseStudyId)));
    if (screenshots.length > 0) {
      await tx.insert(caseStudyAssets).values(screenshots.map((shot, position) => ({ workspaceId: scope.workspaceId, caseStudyId, assetId: shot.assetId, position, caption: shot.caption?.trim().slice(0, 200) || null })));
    }
    await tx.update(caseStudies).set({ updatedAt: new Date() }).where(and(eq(caseStudies.workspaceId, scope.workspaceId), eq(caseStudies.id, caseStudyId)));
    await recordKitAudit(tx, scope, "case_study_screenshots_set", "case_study", caseStudyId, { count: screenshots.length });
    return { count: screenshots.length };
  });
}

export function listCaseStudyScreenshots(scope: WorkspaceScope, caseStudyId: string) {
  return getDatabase().select({ assetId: caseStudyAssets.assetId, caption: caseStudyAssets.caption, position: caseStudyAssets.position })
    .from(caseStudyAssets).where(and(eq(caseStudyAssets.workspaceId, scope.workspaceId), eq(caseStudyAssets.caseStudyId, caseStudyId))).orderBy(asc(caseStudyAssets.position));
}
