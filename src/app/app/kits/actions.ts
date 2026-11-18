"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { FormState } from "@/app/app/actions";
import { getServerEnv } from "@/config/env";
import { MAX_PDF_BYTES } from "@/modules/kits/files";
import { KitError } from "@/server/kits/common";
import {
  archiveKitAsset, createCapabilityKit, createCaseStudy, restoreKitAsset, saveCapabilityKitVersion, setCaseStudyScreenshots, setCaseStudyStatus,
  purgeArchivedKitAssets, setKitStatus, updateCaseStudy, uploadKitAsset,
} from "@/server/kits/library";
import { approveKitPack, attachKitPack, createKitPack, createKitShareLink, detachKitPack, revokeKitShareLink, updateKitPack } from "@/server/kits/packs";
import { getWorkspaceContext } from "@/server/workspaces/context";

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}
function optional(formData: FormData, key: string): string | undefined {
  return text(formData, key).trim() || undefined;
}
function many(formData: FormData, key: string): string[] {
  return formData.getAll(key).filter((value): value is string => typeof value === "string" && value !== "");
}
function lines(value: string): string[] {
  return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

/** Runs one service call and turns a KitError into a form message. Anything else is a real fault and propagates. */
async function run(work: () => Promise<string>): Promise<FormState> {
  try {
    return { status: "success", message: await work() };
  } catch (error) {
    if (error instanceof KitError) return { status: "error", message: error.message };
    throw error;
  }
}

function refresh(...extra: string[]) {
  for (const path of ["/app/kits", ...extra]) revalidatePath(path);
}

function parseCapabilities(value: string) {
  return lines(value).flatMap((line) => {
    const [group, ...rest] = line.split(":");
    const items = rest.join(":").split(",").map((item) => item.trim()).filter(Boolean);
    return group?.trim() && items.length > 0 ? [{ group: group.trim(), items }] : [];
  });
}

function kitContentFromForm(formData: FormData) {
  return {
    profile: { displayName: text(formData, "displayName"), headline: text(formData, "headline") },
    introduction: text(formData, "introduction"),
    capabilities: parseCapabilities(text(formData, "capabilities")),
    featuredCaseStudyIds: many(formData, "featuredCaseStudyIds"),
    approach: text(formData, "approach"),
    services: lines(text(formData, "services")),
    contact: { email: text(formData, "email"), website: text(formData, "website"), phone: text(formData, "phone"), location: text(formData, "location") },
    // A blank branding field falls back to the HOAX1G.DEV defaults.
    branding: { wordmark: optional(formData, "wordmark"), accentPrimary: optional(formData, "accentPrimary"), accentSecondary: optional(formData, "accentSecondary") },
    attachmentAssetIds: many(formData, "attachmentAssetIds"),
  };
}

function caseStudyFromForm(formData: FormData) {
  return {
    projectName: text(formData, "projectName"), problem: text(formData, "problem"), solution: text(formData, "solution"),
    techStack: text(formData, "techStack").split(/[\n,]/).map((item) => item.trim()).filter(Boolean),
    responsibilities: text(formData, "responsibilities"), architectureSummary: text(formData, "architectureSummary"),
    repositoryUrl: text(formData, "repositoryUrl"), demoUrl: text(formData, "demoUrl"),
    results: text(formData, "results"), resultsVerified: formData.get("resultsVerified") === "on",
    developmentStatus: text(formData, "developmentStatus") as never,
  };
}

// --- Documents -------------------------------------------------------------------------------

export async function uploadKitAssetAction(_state: FormState, formData: FormData): Promise<FormState> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { status: "error", message: "Choose a PDF, PNG or JPEG file." };
  if (file.size > MAX_PDF_BYTES) return { status: "error", message: "Files are limited to 4 MB." };
  const { scope } = await getWorkspaceContext("read");
  return run(async () => {
    const result = await uploadKitAsset(scope, {
      assetId: optional(formData, "assetId"), title: optional(formData, "title"), filename: file.name, declaredType: file.type || undefined,
      bytes: new Uint8Array(await file.arrayBuffer()),
    });
    refresh();
    return `Saved ${result.filename} as version ${result.version}.`;
  });
}

export async function setAssetStatusAction(_state: FormState, formData: FormData): Promise<FormState> {
  const { scope } = await getWorkspaceContext("read");
  const assetId = text(formData, "assetId");
  return run(async () => {
    const result = text(formData, "status") === "archived" ? await archiveKitAsset(scope, assetId) : await restoreKitAsset(scope, assetId);
    refresh();
    return result.changed ? "Document updated." : "No change.";
  });
}

// --- Kits ------------------------------------------------------------------------------------

export async function createKitAction(_state: FormState, formData: FormData): Promise<FormState> {
  const { scope } = await getWorkspaceContext("read");
  const created: { id?: string } = {};
  const state = await run(async () => {
    created.id = (await createCapabilityKit(scope, { name: text(formData, "name"), content: kitContentFromForm(formData) })).kitId;
    refresh();
    return "Kit created.";
  });
  if (state.status === "error" || !created.id) return state;
  redirect(`/app/kits/${created.id}`);
}

export async function saveKitAction(_state: FormState, formData: FormData): Promise<FormState> {
  const { scope } = await getWorkspaceContext("read");
  const kitId = text(formData, "kitId");
  return run(async () => {
    const result = await saveCapabilityKitVersion(scope, {
      kitId, expectedVersion: Number(text(formData, "expectedVersion")), content: kitContentFromForm(formData),
      changeNote: optional(formData, "changeNote"), name: optional(formData, "name"),
    });
    refresh(`/app/kits/${kitId}`);
    return `Saved as version ${result.version}.`;
  });
}

export async function setKitStatusAction(_state: FormState, formData: FormData): Promise<FormState> {
  const { scope } = await getWorkspaceContext("read");
  const kitId = text(formData, "kitId");
  return run(async () => {
    await setKitStatus(scope, kitId, text(formData, "status") === "archived" ? "archived" : "active");
    refresh(`/app/kits/${kitId}`);
    return "Kit updated.";
  });
}

// --- Case studies ----------------------------------------------------------------------------

export async function createCaseStudyAction(_state: FormState, formData: FormData): Promise<FormState> {
  const { scope } = await getWorkspaceContext("read");
  return run(async () => {
    await createCaseStudy(scope, caseStudyFromForm(formData));
    refresh();
    return "Case study saved.";
  });
}

export async function updateCaseStudyAction(_state: FormState, formData: FormData): Promise<FormState> {
  const { scope } = await getWorkspaceContext("read");
  const caseStudyId = text(formData, "caseStudyId");
  return run(async () => {
    await updateCaseStudy(scope, caseStudyId, caseStudyFromForm(formData));
    await setCaseStudyScreenshots(scope, caseStudyId, many(formData, "screenshotAssetIds").map((assetId) => ({ assetId })));
    refresh(`/app/kits/case-studies/${caseStudyId}`);
    return "Case study updated.";
  });
}

export async function setCaseStudyStatusAction(_state: FormState, formData: FormData): Promise<FormState> {
  const { scope } = await getWorkspaceContext("read");
  const caseStudyId = text(formData, "caseStudyId");
  return run(async () => {
    await setCaseStudyStatus(scope, caseStudyId, text(formData, "status") === "archived" ? "archived" : "active");
    refresh(`/app/kits/case-studies/${caseStudyId}`);
    return "Case study updated.";
  });
}

// --- Packs, approval, attachments and links --------------------------------------------------

export async function createPackAction(_state: FormState, formData: FormData): Promise<FormState> {
  const { scope } = await getWorkspaceContext("read");
  const created: { id?: string } = {};
  const state = await run(async () => {
    created.id = (await createKitPack(scope, {
      kitId: text(formData, "kitId"), templateKey: text(formData, "templateKey"), title: text(formData, "title"),
      recipientName: text(formData, "recipientName"), recipientOrganisation: optional(formData, "recipientOrganisation"), purpose: optional(formData, "purpose"),
      leadId: optional(formData, "leadId"), caseStudyIds: many(formData, "caseStudyIds"), assetIds: many(formData, "assetIds"),
    })).packId;
    refresh();
    return "Pack created.";
  });
  if (state.status === "error" || !created.id) return state;
  redirect(`/app/kits/packs/${created.id}`);
}

export async function updatePackAction(_state: FormState, formData: FormData): Promise<FormState> {
  const { scope } = await getWorkspaceContext("read");
  const packId = text(formData, "packId");
  return run(async () => {
    const result = await updateKitPack(scope, {
      packId, expectedUpdatedAt: new Date(text(formData, "expectedUpdatedAt")), title: text(formData, "title"), recipientName: text(formData, "recipientName"),
      recipientOrganisation: text(formData, "recipientOrganisation"), message: text(formData, "message"),
      caseStudyIds: many(formData, "caseStudyIds"), assetIds: many(formData, "assetIds"), useLatestKitVersion: formData.get("useLatestKitVersion") === "on",
    });
    refresh(`/app/kits/packs/${packId}`);
    if (!result.changed) return "No changes to save.";
    return result.approvalReset ? "Saved. The pack was approved before, so it needs approval again and its share links were revoked." : "Saved.";
  });
}

export async function approvePackAction(_state: FormState, formData: FormData): Promise<FormState> {
  const { scope } = await getWorkspaceContext("read");
  const packId = text(formData, "packId");
  return run(async () => {
    const result = await approveKitPack(scope, packId);
    refresh(`/app/kits/packs/${packId}`);
    return result.changed ? "Approved: recipient, message, projects and documents are locked to what you reviewed." : "Already approved.";
  });
}

export async function attachPackAction(_state: FormState, formData: FormData): Promise<FormState> {
  const { scope } = await getWorkspaceContext("read");
  const packId = text(formData, "packId");
  const [type, id] = text(formData, "target").split(":");
  if (!id || (type !== "lead" && type !== "proposal" && type !== "campaign")) return { status: "error", message: "Choose where to attach this pack." };
  return run(async () => {
    const result = await attachKitPack(scope, { packId, target: { type, id } });
    refresh(`/app/kits/packs/${packId}`);
    return result.attached ? "Attached as a reference. Nothing was sent." : "Already attached.";
  });
}

export async function detachPackAction(_state: FormState, formData: FormData): Promise<FormState> {
  const { scope } = await getWorkspaceContext("read");
  const packId = text(formData, "packId");
  return run(async () => {
    await detachKitPack(scope, text(formData, "attachmentId"));
    refresh(`/app/kits/packs/${packId}`);
    return "Attachment removed.";
  });
}

export async function createShareLinkAction(_state: FormState, formData: FormData): Promise<FormState> {
  const { scope } = await getWorkspaceContext("read");
  const packId = text(formData, "packId");
  return run(async () => {
    const days = Number(text(formData, "days")) || undefined;
    const maxDownloads = Number(text(formData, "maxDownloads")) || undefined;
    const link = await createKitShareLink(scope, { packId, days, maxDownloads });
    refresh(`/app/kits/packs/${packId}`);
    const url = new URL(`/s/${link.token}`, getServerEnv().NEXTAUTH_URL).toString();
    return `Link created. Copy it now, it is not shown again (expires ${link.expiresAt.toISOString().slice(0, 10)}): ${url}`;
  });
}

export async function revokeShareLinkAction(_state: FormState, formData: FormData): Promise<FormState> {
  const { scope } = await getWorkspaceContext("read");
  const packId = text(formData, "packId");
  return run(async () => {
    const result = await revokeKitShareLink(scope, text(formData, "linkId"));
    refresh(`/app/kits/packs/${packId}`);
    return result.revoked ? "Link revoked." : "That link was already revoked.";
  });
}

export async function purgeArchivedAssetsAction(_state: FormState, formData: FormData): Promise<FormState> {
  if (text(formData, "confirm").trim() !== "PURGE") return { status: "error", message: "Type PURGE to confirm the permanent deletion." };
  const days = Number(text(formData, "days"));
  if (!Number.isInteger(days) || days < 0 || days > 365) return { status: "error", message: "Use a number of days between 0 and 365." };
  const { scope } = await getWorkspaceContext("read");
  return run(async () => {
    const result = await purgeArchivedKitAssets(scope, new Date(Date.now() - days * 86_400_000));
    refresh();
    return result.purged === 0
      ? "Nothing was deleted: no archived document is old enough and unused."
      : `Permanently deleted ${result.purged} document${result.purged === 1 ? "" : "s"} (${Math.max(1, Math.round(result.bytes / 1000))} KB). Documents still used by a pack or case study were kept.`;
  });
}