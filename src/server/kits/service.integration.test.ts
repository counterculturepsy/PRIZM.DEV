// @vitest-environment node

import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it, vi } from "vitest";
import { createWorkspaceScope } from "@/modules/workspaces/scope";
import {
  auditLogs, campaigns, companies, kitAccessEvents, kitAssets, kitAssetVersions, kitAttachments, kitPacks, kitShareLinks, leads, proposals,
  users, workspaceMembers, workspaces,
} from "@/server/db/schema";

const PNG_1X1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
async function pdfBytes(pages = 1): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  for (let index = 0; index < pages; index += 1) document.addPage([300, 300]);
  return document.save({ useObjectStreams: false });
}

async function setup() {
  const client = new PGlite();
  const db = drizzle(client);
  await migrate(db, { migrationsFolder: "drizzle" });
  const [owner, writer, viewer, outsider] = await db.insert(users).values([
    { email: "owner@example.com", name: "Olivia Owner" }, { email: "writer@example.com", name: "Wes Writer" },
    { email: "viewer@example.com", name: "Vic Viewer" }, { email: "outsider@example.com", name: "Otto Outsider" },
  ]).returning({ id: users.id });
  const [alpha, beta] = await db.insert(workspaces).values([
    { name: "Alpha", slug: "kit-alpha", currency: "ZAR" }, { name: "Beta", slug: "kit-beta", currency: "ZAR" },
  ]).returning({ id: workspaces.id });
  if (!owner || !writer || !viewer || !outsider || !alpha || !beta) throw new Error("fixtures were not created");
  await db.insert(workspaceMembers).values([
    { workspaceId: alpha.id, userId: owner.id, role: "owner", status: "active", joinedAt: new Date() },
    { workspaceId: alpha.id, userId: writer.id, role: "sales", status: "active", joinedAt: new Date() },
    { workspaceId: alpha.id, userId: viewer.id, role: "viewer", status: "active", joinedAt: new Date() },
    { workspaceId: beta.id, userId: outsider.id, role: "owner", status: "active", joinedAt: new Date() },
  ]);
  vi.resetModules();
  vi.doMock("@/server/db", () => ({ getDatabase: () => db }));
  const library = await import("./library");
  const packs = await import("./packs");
  const scope = (workspaceId: string, userId: string, role: "owner" | "sales" | "viewer") => createWorkspaceScope({ workspaceId, userId, role });
  return {
    client, db, library, packs, alpha: alpha.id, beta: beta.id,
    ownerScope: scope(alpha.id, owner.id, "owner"), writerScope: scope(alpha.id, writer.id, "sales"), viewerScope: scope(alpha.id, viewer.id, "viewer"),
    outsiderScope: scope(beta.id, outsider.id, "owner"), owner, writer,
  };
}

const kitContent = { profile: { displayName: "Ada Developer", headline: "Full-stack engineer" }, introduction: "I build secure SaaS products." };
const studyInput = (name: string) => ({ projectName: name, problem: "A problem.", solution: "A solution.", techStack: ["TypeScript"], developmentStatus: "prototype" as const });

describe("capability kit documents", () => {
  it("stores validated files privately, versions them, enforces roles, tenancy and quotas, and cleans up safely", async () => {
    const t = await setup();
    const { library, db } = t;
    const first = await library.uploadKitAsset(t.writerScope, { filename: "../CV (final).pdf", declaredType: "application/pdf", bytes: await pdfBytes(2) });
    expect(first).toMatchObject({ version: 1, kind: "pdf", pageCount: 2, filename: "CV -final.pdf" });

    // Role and tenant gates.
    await expect(library.uploadKitAsset(t.viewerScope, { filename: "x.pdf", bytes: await pdfBytes() })).rejects.toMatchObject({ code: "forbidden" });
    await expect(library.getKitAssetFile(t.outsiderScope, first.assetId)).rejects.toMatchObject({ code: "not_found" });
    await expect(library.uploadKitAsset(t.outsiderScope, { assetId: first.assetId, filename: "x.pdf", bytes: await pdfBytes() })).rejects.toMatchObject({ code: "not_found" });
    expect(await library.listKitAssets(t.outsiderScope)).toHaveLength(0);
    expect(await library.listKitAssets(t.viewerScope)).toHaveLength(1);

    // Content decides the type; hostile or oversized input is refused before it reaches storage.
    await expect(library.uploadKitAsset(t.writerScope, { filename: "resume.pdf", declaredType: "application/pdf", bytes: Buffer.from("MZ not a pdf") })).rejects.toMatchObject({ code: "invalid" });
    await expect(library.uploadKitAsset(t.writerScope, { filename: "x.png", declaredType: "image/png", bytes: await pdfBytes() })).rejects.toMatchObject({ code: "invalid" });
    expect(await db.select().from(kitAssets)).toHaveLength(1);

    // New version of the same document; kind must match.
    const second = await library.uploadKitAsset(t.writerScope, { assetId: first.assetId, filename: "CV v2.pdf", bytes: await pdfBytes(3) });
    expect(second).toMatchObject({ assetId: first.assetId, version: 2, pageCount: 3 });
    await expect(library.uploadKitAsset(t.writerScope, { assetId: first.assetId, filename: "pic.png", bytes: PNG_1X1 })).rejects.toMatchObject({ code: "invalid" });
    expect((await library.listKitAssetVersions(t.writerScope, first.assetId)).map((row) => row.version)).toEqual([2, 1]);
    const latest = await library.getKitAssetFile(t.viewerScope, first.assetId);
    expect(latest).toMatchObject({ filename: "CV v2.pdf", contentType: "application/pdf" });
    expect(Buffer.from(latest.data).subarray(0, 5).toString()).toBe("%PDF-");
    expect((await library.getKitAssetFile(t.viewerScope, first.assetId, { version: 1 })).filename).toBe("CV -final.pdf");
    expect((await db.select().from(kitAccessEvents).where(eq(kitAccessEvents.eventType, "asset_download"))).length).toBe(2);

    // Private by construction: the list view never carries bytes.
    expect(JSON.stringify(await library.listKitAssets(t.writerScope))).not.toContain("data");

    // Archive, restore, and purge only what is old and unreferenced.
    expect(await library.archiveKitAsset(t.writerScope, first.assetId)).toEqual({ changed: true });
    expect(await library.archiveKitAsset(t.writerScope, first.assetId)).toEqual({ changed: false });
    await expect(library.uploadKitAsset(t.writerScope, { assetId: first.assetId, filename: "v3.pdf", bytes: await pdfBytes() })).rejects.toMatchObject({ code: "conflict" });
    expect(await library.listKitAssets(t.writerScope)).toHaveLength(0);
    expect(await library.listKitAssets(t.writerScope, { includeArchived: true })).toHaveLength(1);
    await expect(library.purgeArchivedKitAssets(t.writerScope, new Date(Date.now() + 1000))).rejects.toMatchObject({ code: "forbidden" });
    expect(await library.purgeArchivedKitAssets(t.ownerScope, new Date(Date.now() - 86_400_000))).toEqual({ purged: 0, bytes: 0 });
    expect((await library.purgeArchivedKitAssets(t.ownerScope, new Date(Date.now() + 1000))).purged).toBe(1);
    expect(await db.select().from(kitAssetVersions)).toHaveLength(0);

    const audit = await db.select().from(auditLogs).where(eq(auditLogs.workspaceId, t.alpha));
    expect(audit.map((row) => row.action)).toEqual(expect.arrayContaining(["kit.asset_uploaded", "kit.asset_archived", "kit.assets_purged"]));
    await t.client.close();
  });

  it("enforces the workspace storage quota", async () => {
    const t = await setup();
    const big = Uint8Array.from(await pdfBytes());
    // Fill the quota with rows that satisfy the table checks (13 x 3.9 MB, just over 50 MB), then confirm the service refuses the next upload.
    // The bytes are generated inside the database so 50 MB never crosses the JavaScript boundary.
    const [asset] = await t.db.insert(kitAssets).values({ workspaceId: t.alpha, title: "Filler", kind: "pdf", createdByUserId: t.owner.id }).returning({ id: kitAssets.id });
    if (!asset) throw new Error("filler asset");
    await t.db.execute(sql`insert into kit_asset_versions (workspace_id, asset_id, version, filename, content_type, byte_size, sha256, data, uploaded_by_user_id)
      select ${t.alpha}::uuid, ${asset.id}::uuid, v, 'f.pdf', 'application/pdf', 3900000, repeat('a', 64), decode(repeat('00', 3900000), 'hex'), ${t.owner.id}::uuid
      from generate_series(1, 13) as v`);
    await expect(t.library.uploadKitAsset(t.writerScope, { filename: "one-more.pdf", bytes: big })).rejects.toMatchObject({ code: "quota" });
    await t.client.close();
  }, 60_000);
});

describe("capability kits and case studies", () => {
  it("versions kits with optimistic concurrency and keeps references inside the workspace", async () => {
    const t = await setup();
    const { library } = t;
    const study = await library.createCaseStudy(t.writerScope, { ...studyInput("Tenant CRM"), results: "Cut triage time by 40%.", resultsVerified: true, repositoryUrl: "https://github.com/example/crm" });
    const otherStudy = await library.createCaseStudy(t.outsiderScope, studyInput("Beta project"));
    const doc = await library.uploadKitAsset(t.writerScope, { filename: "reference.pdf", bytes: await pdfBytes() });

    await expect(library.createCapabilityKit(t.viewerScope, { name: "Kit", content: kitContent })).rejects.toMatchObject({ code: "forbidden" });
    await expect(library.createCapabilityKit(t.writerScope, { name: "K", content: kitContent })).rejects.toMatchObject({ code: "invalid" });
    await expect(library.createCapabilityKit(t.writerScope, { name: "Kit", content: { ...kitContent, featuredCaseStudyIds: [otherStudy.caseStudyId] } })).rejects.toMatchObject({ code: "invalid" });
    await expect(library.createCapabilityKit(t.writerScope, { name: "Kit", content: { ...kitContent, contact: { website: "http://insecure.example" } } })).rejects.toMatchObject({ code: "invalid" });

    const kit = await library.createCapabilityKit(t.writerScope, { name: "Main kit", content: { ...kitContent, featuredCaseStudyIds: [study.caseStudyId], attachmentAssetIds: [doc.assetId] } });
    expect(kit.version).toBe(1);
    const saved = await library.saveCapabilityKitVersion(t.writerScope, { kitId: kit.kitId, expectedVersion: 1, content: { ...kitContent, introduction: "Updated." }, changeNote: "Tighten intro" });
    expect(saved.version).toBe(2);
    await expect(library.saveCapabilityKitVersion(t.ownerScope, { kitId: kit.kitId, expectedVersion: 1, content: kitContent })).rejects.toMatchObject({ code: "conflict" });
    await expect(library.saveCapabilityKitVersion(t.outsiderScope, { kitId: kit.kitId, expectedVersion: 2, content: kitContent })).rejects.toMatchObject({ code: "not_found" });
    const loaded = await library.getCapabilityKit(t.viewerScope, kit.kitId);
    expect(loaded?.content?.introduction).toBe("Updated.");
    expect(loaded?.versions.map((entry) => entry.version)).toEqual([2, 1]);
    expect(await library.getCapabilityKit(t.outsiderScope, kit.kitId)).toBeNull();
    expect(await library.listCapabilityKits(t.outsiderScope)).toHaveLength(0);

    expect(await library.setKitStatus(t.writerScope, kit.kitId, "archived")).toEqual({ changed: true });
    await expect(library.saveCapabilityKitVersion(t.writerScope, { kitId: kit.kitId, expectedVersion: 2, content: kitContent })).rejects.toMatchObject({ code: "conflict" });
    await t.client.close();
  });

  it("stores case studies without inventing results and validates screenshots", async () => {
    const t = await setup();
    const { library } = t;
    // Results can only be marked verified when the author supplied some.
    const noResults = await library.createCaseStudy(t.writerScope, { ...studyInput("No metrics"), resultsVerified: true });
    const [row] = (await library.listCaseStudies(t.writerScope)).filter((study) => study.id === noResults.caseStudyId);
    expect(row).toMatchObject({ results: null, resultsVerified: false });
    await expect(library.createCaseStudy(t.writerScope, { ...studyInput("Bad link"), demoUrl: "javascript:alert(1)" })).rejects.toMatchObject({ code: "invalid" });
    await expect(library.createCaseStudy(t.writerScope, { ...studyInput("Bad status"), developmentStatus: "shipped" as never })).rejects.toMatchObject({ code: "invalid" });

    const image = await library.uploadKitAsset(t.writerScope, { filename: "shot.png", bytes: PNG_1X1 });
    const pdf = await library.uploadKitAsset(t.writerScope, { filename: "doc.pdf", bytes: await pdfBytes() });
    await expect(library.setCaseStudyScreenshots(t.writerScope, noResults.caseStudyId, [{ assetId: pdf.assetId }])).rejects.toMatchObject({ code: "invalid" });
    await expect(library.setCaseStudyScreenshots(t.outsiderScope, noResults.caseStudyId, [{ assetId: image.assetId }])).rejects.toMatchObject({ code: "not_found" });
    expect(await library.setCaseStudyScreenshots(t.writerScope, noResults.caseStudyId, [{ assetId: image.assetId, caption: "Dashboard" }])).toEqual({ count: 1 });
    expect(await library.listCaseStudyScreenshots(t.viewerScope, noResults.caseStudyId)).toMatchObject([{ assetId: image.assetId, caption: "Dashboard" }]);
    await expect(library.updateCaseStudy(t.outsiderScope, noResults.caseStudyId, studyInput("Hijack"))).rejects.toMatchObject({ code: "not_found" });
    await t.client.close();
  });
});

describe("application packs, approval, attachments and share links", () => {
  async function approvedPack() {
    const t = await setup();
    const { library, packs } = t;
    const study = await library.createCaseStudy(t.writerScope, { ...studyInput("Tenant CRM"), results: "Cut triage time by 40%.", resultsVerified: true });
    const image = await library.uploadKitAsset(t.writerScope, { filename: "shot.png", bytes: PNG_1X1 });
    await library.setCaseStudyScreenshots(t.writerScope, study.caseStudyId, [{ assetId: image.assetId, caption: "Dashboard" }]);
    const doc = await library.uploadKitAsset(t.writerScope, { title: "Reference letter", filename: "reference.pdf", bytes: await pdfBytes() });
    const kit = await library.createCapabilityKit(t.writerScope, { name: "Main kit", content: { ...kitContent, featuredCaseStudyIds: [study.caseStudyId] } });
    const pack = await packs.createKitPack(t.writerScope, {
      kitId: kit.kitId, templateKey: "senior_developer_application", title: "Acme application", recipientName: "Sam Recruiter", recipientOrganisation: "Acme",
      caseStudyIds: [study.caseStudyId], assetIds: [doc.assetId],
    });
    return { ...t, study, doc, image, kit, packId: pack.packId };
  }

  it("builds a pack from selected facts, and only an owner or administrator can approve it", async () => {
    const t = await approvedPack();
    const { packs, db } = t;
    const view = await packs.getKitPack(t.viewerScope, t.packId);
    expect(view?.pack).toMatchObject({ status: "draft", templateKey: "senior_developer_application", kitVersion: 1 });
    expect(view?.pack.message).toContain("Hello Sam Recruiter,");
    expect(view?.pack.message).toContain("Tenant CRM (Prototype; TypeScript)");
    expect(view?.pack.message).not.toMatch(/\d+%/);
    expect(view?.documents.map((doc) => doc.title)).toEqual(["Reference letter"]);

    expect(await packs.getKitPack(t.outsiderScope, t.packId)).toBeNull();
    await expect(packs.createKitPack(t.writerScope, { kitId: t.kit.kitId, templateKey: "made_up", title: "x pack", recipientName: "Sam", caseStudyIds: [], assetIds: [] })).rejects.toMatchObject({ code: "invalid" });
    await expect(packs.createKitPack(t.writerScope, { kitId: t.kit.kitId, templateKey: "senior_developer_application", title: "No studies", recipientName: "Sam", caseStudyIds: [], assetIds: [] })).rejects.toMatchObject({ code: "invalid" });
    await expect(packs.createKitPack(t.outsiderScope, { kitId: t.kit.kitId, templateKey: "partnership_introduction", title: "Cross tenant", recipientName: "Sam", caseStudyIds: [], assetIds: [] })).rejects.toMatchObject({ code: "not_found" });
    await expect(packs.createKitPack(t.viewerScope, { kitId: t.kit.kitId, templateKey: "partnership_introduction", title: "Viewer pack", recipientName: "Sam", caseStudyIds: [], assetIds: [] })).rejects.toMatchObject({ code: "forbidden" });

    await expect(packs.approveKitPack(t.writerScope, t.packId)).rejects.toMatchObject({ code: "forbidden" });
    const approved = await packs.approveKitPack(t.ownerScope, t.packId);
    expect(approved.changed).toBe(true);
    expect((await packs.approveKitPack(t.ownerScope, t.packId)).changed).toBe(false);
    expect((await db.select().from(kitPacks).where(eq(kitPacks.id, t.packId)))[0]).toMatchObject({ status: "approved", approvedByUserId: t.owner.id });
    expect((await packs.getKitPack(t.viewerScope, t.packId))?.approvalCurrent).toBe(true);
    await t.client.close();
  });

  it("drops approval and revokes links when an approved pack changes, and detects drift in referenced content", async () => {
    const t = await approvedPack();
    const { packs, library } = t;
    await packs.approveKitPack(t.ownerScope, t.packId);
    const link = await packs.createKitShareLink(t.ownerScope, { packId: t.packId, days: 3 });
    const current = (await packs.getKitPack(t.writerScope, t.packId))!.pack;

    // Stale edit is refused; a real edit resets approval and revokes the link; an identical edit is a no-op.
    await expect(packs.updateKitPack(t.writerScope, { packId: t.packId, expectedUpdatedAt: new Date(current.updatedAt.getTime() - 5), title: "Stale" })).rejects.toMatchObject({ code: "conflict" });
    expect(await packs.updateKitPack(t.writerScope, { packId: t.packId, expectedUpdatedAt: current.updatedAt, title: current.title })).toEqual({ changed: false });
    const result = await packs.updateKitPack(t.writerScope, { packId: t.packId, expectedUpdatedAt: current.updatedAt, message: `${current.message}\n\nP.S. Available from January.` });
    expect(result).toMatchObject({ changed: true, approvalReset: true, linksRevoked: 1 });
    expect((await packs.getKitPack(t.writerScope, t.packId))?.pack).toMatchObject({ status: "draft", approvedDigest: null });
    expect(await packs.resolveShareDownload(link.token, { ipHash: null })).toEqual({ ok: false });

    // Re-approve, then change a referenced case study: the stored digest no longer matches.
    await packs.approveKitPack(t.ownerScope, t.packId);
    expect((await packs.getKitPack(t.viewerScope, t.packId))?.approvalCurrent).toBe(true);
    await library.updateCaseStudy(t.writerScope, t.study.caseStudyId, { ...studyInput("Tenant CRM"), solution: "A different solution." });
    expect((await packs.getKitPack(t.viewerScope, t.packId))?.approvalCurrent).toBe(false);
    await expect(packs.createKitShareLink(t.ownerScope, { packId: t.packId })).rejects.toMatchObject({ code: "not_approved" });
    await t.client.close();
  });

  it("attaches only approved packs to approved communications, and never sends anything", async () => {
    const t = await approvedPack();
    const { packs, db } = t;
    const [company] = await db.insert(companies).values({ workspaceId: t.alpha, name: "Acme", dedupeKey: "domain:acme.example" }).returning({ id: companies.id });
    const [lead] = await db.insert(leads).values({ workspaceId: t.alpha, companyId: company!.id, title: "Acme lead" }).returning({ id: leads.id });
    const [draftProposal] = await db.insert(proposals).values({ workspaceId: t.alpha, leadId: lead!.id, requestKey: randomUUID(), title: "Draft", createdByUserId: t.owner.id }).returning({ id: proposals.id });
    const now = new Date();
    const [approvedProposal] = await db.insert(proposals).values({
      workspaceId: t.alpha, leadId: lead!.id, requestKey: randomUUID(), title: "Approved", status: "approved", createdByUserId: t.owner.id, approvedByUserId: t.owner.id, approvedAt: now, approvalNote: "ok",
    }).returning({ id: proposals.id });
    const [draftCampaign] = await db.insert(campaigns).values({ workspaceId: t.alpha, name: "Draft campaign", requestKey: randomUUID(), dailyRecipientCap: 5, createdByUserId: t.owner.id }).returning({ id: campaigns.id });
    const [reviewedCampaign] = await db.insert(campaigns).values({
      workspaceId: t.alpha, name: "Reviewed", requestKey: randomUUID(), dailyRecipientCap: 5, createdByUserId: t.owner.id, status: "reviewed", reviewedByUserId: t.owner.id, reviewedAt: now, reviewNote: "ok",
    }).returning({ id: campaigns.id });

    // A draft pack cannot be attached anywhere.
    await expect(packs.attachKitPack(t.writerScope, { packId: t.packId, target: { type: "lead", id: lead!.id } })).rejects.toMatchObject({ code: "not_approved" });
    await packs.approveKitPack(t.ownerScope, t.packId);
    await expect(packs.attachKitPack(t.viewerScope, { packId: t.packId, target: { type: "lead", id: lead!.id } })).rejects.toMatchObject({ code: "forbidden" });
    await expect(packs.attachKitPack(t.outsiderScope, { packId: t.packId, target: { type: "lead", id: lead!.id } })).rejects.toMatchObject({ code: "not_found" });
    await expect(packs.attachKitPack(t.writerScope, { packId: t.packId, target: { type: "proposal", id: draftProposal!.id } })).rejects.toMatchObject({ code: "not_approved" });
    await expect(packs.attachKitPack(t.writerScope, { packId: t.packId, target: { type: "campaign", id: draftCampaign!.id } })).rejects.toMatchObject({ code: "not_approved" });
    await expect(packs.attachKitPack(t.writerScope, { packId: t.packId, target: { type: "lead", id: randomUUID() } })).rejects.toMatchObject({ code: "not_found" });

    expect(await packs.attachKitPack(t.writerScope, { packId: t.packId, target: { type: "lead", id: lead!.id } })).toEqual({ attached: true });
    expect(await packs.attachKitPack(t.writerScope, { packId: t.packId, target: { type: "lead", id: lead!.id } })).toEqual({ attached: false });
    expect(await packs.attachKitPack(t.writerScope, { packId: t.packId, target: { type: "proposal", id: approvedProposal!.id } })).toEqual({ attached: true });
    expect(await packs.attachKitPack(t.writerScope, { packId: t.packId, target: { type: "campaign", id: reviewedCampaign!.id } })).toEqual({ attached: true });
    const onLead = await packs.listAttachmentsForTarget(t.viewerScope, { type: "lead", id: lead!.id });
    expect(onLead).toMatchObject([{ packId: t.packId, title: "Acme application" }]);
    expect(await packs.listAttachmentsForTarget(t.outsiderScope, { type: "lead", id: lead!.id })).toHaveLength(0);
    expect(await packs.detachKitPack(t.outsiderScope, onLead[0]!.id)).toEqual({ detached: false });
    expect(await packs.detachKitPack(t.writerScope, onLead[0]!.id)).toEqual({ detached: true });
    expect(await db.select().from(kitAttachments)).toHaveLength(2);
    await t.client.close();
  });

  it("renders a real PDF for review and for share links, and enforces expiry, revocation, limits and logging", async () => {
    const t = await approvedPack();
    const { packs, db } = t;
    const draft = await packs.getKitPackPdf(t.viewerScope, t.packId);
    expect(draft.approved).toBe(false);
    const loaded = await PDFDocument.load(draft.bytes);
    expect(loaded.getTitle()).toBe("Acme application");
    expect(loaded.getPageCount()).toBeGreaterThanOrEqual(2);
    await expect(packs.getKitPackPdf(t.outsiderScope, t.packId)).rejects.toMatchObject({ code: "not_found" });

    await expect(packs.createKitShareLink(t.ownerScope, { packId: t.packId })).rejects.toMatchObject({ code: "not_approved" });
    await packs.approveKitPack(t.ownerScope, t.packId);
    await expect(packs.createKitShareLink(t.writerScope, { packId: t.packId })).rejects.toMatchObject({ code: "forbidden" });
    await expect(packs.createKitShareLink(t.ownerScope, { packId: t.packId, maxDownloads: 0 })).rejects.toMatchObject({ code: "invalid" });
    await expect(packs.createKitShareLink(t.outsiderScope, { packId: t.packId })).rejects.toMatchObject({ code: "not_found" });

    const limited = await packs.createKitShareLink(t.ownerScope, { packId: t.packId, days: 2, maxDownloads: 2 });
    const stored = (await db.select().from(kitShareLinks).where(eq(kitShareLinks.id, limited.linkId)))[0]!;
    expect(stored.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(stored)).not.toContain(limited.token);
    expect(JSON.stringify(await packs.listKitShareLinks(t.writerScope, t.packId))).not.toContain(limited.token);

    // Unknown and malformed tokens fail identically and leave no trace they could be tied to a workspace.
    expect(await packs.resolveShareDownload("not-a-token", { ipHash: null })).toEqual({ ok: false });
    expect(await packs.resolveShareDownload(`${limited.token.slice(0, 42)}A`, { ipHash: null })).toEqual({ ok: false });
    expect(await packs.resolveShareDownload(undefined, { ipHash: null })).toEqual({ ok: false });

    const ipHash = "b".repeat(64);
    const first = await packs.resolveShareDownload(limited.token, { ipHash });
    expect(first.ok).toBe(true);
    if (first.ok) {
      expect(Buffer.from(first.bytes).subarray(0, 5).toString()).toBe("%PDF-");
      expect(first.filename).toBe("Acme application.pdf");
      expect((await PDFDocument.load(first.bytes)).getTitle()).toBe("Acme application");
    }
    expect((await packs.resolveShareDownload(limited.token, { ipHash })).ok).toBe(true);
    expect(await packs.resolveShareDownload(limited.token, { ipHash })).toEqual({ ok: false });
    const events = await db.select().from(kitAccessEvents).where(eq(kitAccessEvents.linkId, limited.linkId));
    expect(events.map((event) => event.eventType).sort()).toEqual(["link_denied_limit", "link_download", "link_download"]);
    expect(events.every((event) => event.ipHash === ipHash)).toBe(true);
    expect((await db.select().from(kitShareLinks).where(eq(kitShareLinks.id, limited.linkId)))[0]?.downloadCount).toBe(2);

    // Revocation and expiry.
    const revocable = await packs.createKitShareLink(t.ownerScope, { packId: t.packId });
    await expect(packs.revokeKitShareLink(t.viewerScope, revocable.linkId)).rejects.toMatchObject({ code: "forbidden" });
    expect(await packs.revokeKitShareLink(t.outsiderScope, revocable.linkId)).toEqual({ revoked: false });
    expect(await packs.revokeKitShareLink(t.writerScope, revocable.linkId)).toEqual({ revoked: true });
    expect(await packs.resolveShareDownload(revocable.token, { ipHash: null })).toEqual({ ok: false });
    const expiring = await packs.createKitShareLink(t.ownerScope, { packId: t.packId });
    await db.update(kitShareLinks).set({ createdAt: new Date(Date.now() - 3 * 86_400_000), expiresAt: new Date(Date.now() - 86_400_000) }).where(eq(kitShareLinks.id, expiring.linkId));
    expect(await packs.resolveShareDownload(expiring.token, { ipHash: null })).toEqual({ ok: false });
    const reasons = (await db.select().from(kitAccessEvents).where(and(eq(kitAccessEvents.workspaceId, t.alpha)))).map((event) => event.eventType);
    expect(reasons).toEqual(expect.arrayContaining(["link_denied_revoked", "link_denied_expired", "pack_download"]));

    // At most five active links per pack. One (the download-limited link) is still active, so four more fill the cap.
    for (let index = 0; index < 4; index += 1) await packs.createKitShareLink(t.ownerScope, { packId: t.packId });
    await expect(packs.createKitShareLink(t.ownerScope, { packId: t.packId })).rejects.toMatchObject({ code: "quota" });
    const audit = (await db.select().from(auditLogs).where(eq(auditLogs.workspaceId, t.alpha))).map((row) => row.action);
    expect(audit).toEqual(expect.arrayContaining(["kit.pack_created", "kit.pack_approved", "kit.share_link_created", "kit.share_link_revoked"]));
    await t.client.close();
  });
  it("limits concurrent downloads exactly and never writes tokens or file bytes to logs, audit rows or events", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((method) => vi.spyOn(console, method).mockImplementation(() => undefined));
    const t = await approvedPack();
    const { packs, db } = t;
    await packs.approveKitPack(t.ownerScope, t.packId);
    const link = await packs.createKitShareLink(t.ownerScope, { packId: t.packId, maxDownloads: 3 });
    const results = await Promise.all(Array.from({ length: 10 }, () => packs.resolveShareDownload(link.token, { ipHash: null })));
    expect(results.filter((result) => result.ok)).toHaveLength(3);
    expect((await db.select().from(kitShareLinks).where(eq(kitShareLinks.id, link.linkId)))[0]?.downloadCount).toBe(3);
    expect(await db.select().from(kitAccessEvents).where(eq(kitAccessEvents.eventType, "link_denied_limit"))).toHaveLength(7);

    const logged = JSON.stringify(spies.flatMap((spy) => spy.mock.calls));
    expect(logged).not.toContain(link.token);
    expect(logged).not.toContain("%PDF");
    const stored = JSON.stringify([await db.select().from(auditLogs), await db.select().from(kitAccessEvents), await db.select().from(kitShareLinks)]);
    expect(stored).not.toContain(link.token);
    expect(stored).not.toContain("JVBERi"); // base64 of "%PDF"
    for (const spy of spies) spy.mockRestore();
    await t.client.close();
  });

  it("keeps referenced documents when purging, and purges only the unreferenced archived ones", async () => {
    const t = await approvedPack();
    const { library, db } = t;
    await library.archiveKitAsset(t.writerScope, t.doc.assetId);
    await library.archiveKitAsset(t.writerScope, t.image.assetId);
    expect(await library.purgeArchivedKitAssets(t.ownerScope, new Date(Date.now() + 1000))).toEqual({ purged: 0, bytes: 0 });
    const archived = (await library.listKitAssets(t.ownerScope, { includeArchived: true })).filter((asset) => asset.status === "archived");
    expect(archived).toHaveLength(2);
    expect(archived.every((asset) => asset.inUse)).toBe(true);
    expect(await db.select().from(kitAssetVersions)).toHaveLength(2);

    const loose = await library.uploadKitAsset(t.writerScope, { filename: "loose.pdf", bytes: await pdfBytes() });
    await library.archiveKitAsset(t.writerScope, loose.assetId);
    expect((await library.listKitAssets(t.ownerScope, { includeArchived: true })).find((asset) => asset.id === loose.assetId)?.inUse).toBe(false);
    expect((await library.purgeArchivedKitAssets(t.ownerScope, new Date(Date.now() + 1000))).purged).toBe(1);
    expect(await db.select().from(kitAssetVersions)).toHaveLength(2);
    await t.client.close();
  });

  it("shows attachment approval and expiry, and attachment references cannot bypass the approval or send gates", async () => {
    const t = await approvedPack();
    const { packs, db } = t;
    const [company] = await db.insert(companies).values({ workspaceId: t.alpha, name: "Acme", dedupeKey: "domain:acme.example" }).returning({ id: companies.id });
    const [lead] = await db.insert(leads).values({ workspaceId: t.alpha, companyId: company!.id, title: "Acme lead" }).returning({ id: leads.id });
    const [campaign] = await db.insert(campaigns).values({
      workspaceId: t.alpha, name: "Reviewed", requestKey: randomUUID(), dailyRecipientCap: 5, createdByUserId: t.owner.id, status: "reviewed", reviewedByUserId: t.owner.id, reviewedAt: new Date(), reviewNote: "ok",
    }).returning({ id: campaigns.id });
    await packs.approveKitPack(t.ownerScope, t.packId);
    await packs.attachKitPack(t.writerScope, { packId: t.packId, target: { type: "lead", id: lead!.id } });
    await packs.attachKitPack(t.writerScope, { packId: t.packId, target: { type: "campaign", id: campaign!.id } });

    const initial = await packs.listTargetAttachments(t.viewerScope, { type: "lead", id: lead!.id });
    expect(initial).toMatchObject([{ packId: t.packId, state: "approved", activeLinks: 0, linkExpiresAt: null }]);
    expect(await packs.listTargetAttachments(t.outsiderScope, { type: "lead", id: lead!.id })).toHaveLength(0);
    const link = await packs.createKitShareLink(t.ownerScope, { packId: t.packId, days: 5 });
    const withLink = (await packs.listTargetAttachments(t.viewerScope, { type: "campaign", id: campaign!.id }))[0];
    expect(withLink?.activeLinks).toBe(1);
    expect(withLink?.linkExpiresAt?.getTime()).toBe(link.expiresAt.getTime());
    expect(await packs.campaignAttachmentsAreCurrent(db as never, t.alpha, campaign!.id)).toEqual({ ok: true, stale: [] });

    // Editing the message after approval: the send gate closes, the state reads "not approved", and re-attaching is refused.
    const current = (await packs.getKitPack(t.writerScope, t.packId))!.pack;
    await packs.updateKitPack(t.writerScope, { packId: t.packId, expectedUpdatedAt: current.updatedAt, message: `${current.message}\n\nP.S. Edited after approval.` });
    expect(await packs.campaignAttachmentsAreCurrent(db as never, t.alpha, campaign!.id)).toEqual({ ok: false, stale: ["Acme application"] });
    expect((await packs.listTargetAttachments(t.viewerScope, { type: "campaign", id: campaign!.id }))[0]).toMatchObject({ state: "draft", activeLinks: 0 });
    await expect(packs.attachKitPack(t.writerScope, { packId: t.packId, target: { type: "campaign", id: campaign!.id } })).rejects.toMatchObject({ code: "not_approved" });

    // Approving again reopens the gate; a later change to a referenced case study closes it again without re-approval.
    await packs.approveKitPack(t.ownerScope, t.packId);
    expect((await packs.campaignAttachmentsAreCurrent(db as never, t.alpha, campaign!.id)).ok).toBe(true);
    await t.library.updateCaseStudy(t.writerScope, t.study.caseStudyId, { ...studyInput("Tenant CRM"), solution: "Changed after approval." });
    expect((await packs.campaignAttachmentsAreCurrent(db as never, t.alpha, campaign!.id)).ok).toBe(false);
    expect((await packs.listTargetAttachments(t.viewerScope, { type: "lead", id: lead!.id }))[0]?.state).toBe("changed_since_approval");
    await t.client.close();
  });

  it("provides grounded capability evidence only from an approved, current pack, and never unverified results", async () => {
    const t = await approvedPack();
    const { packs, library, db } = t;
    await expect(packs.buildPackCapabilityEvidence(db as never, t.alpha, t.packId)).rejects.toMatchObject({ code: "not_approved" });
    await packs.approveKitPack(t.ownerScope, t.packId);
    const evidence = await packs.buildPackCapabilityEvidence(db as never, t.alpha, t.packId);
    expect(evidence.map((item) => item.id).sort()).toEqual([t.study.caseStudyId, t.doc.assetId].sort());
    expect(evidence.find((item) => item.id === t.study.caseStudyId)).toMatchObject({ category: "capability", confidence: "high" });
    expect(evidence.find((item) => item.id === t.study.caseStudyId)?.excerpt).toContain("Verified results: Cut triage time by 40%.");
    expect(evidence.find((item) => item.id === t.doc.assetId)).toMatchObject({ category: "capability_document" });
    await expect(packs.buildPackCapabilityEvidence(db as never, t.beta, t.packId)).rejects.toMatchObject({ code: "not_found" });

    // Un-verifying the results changes the case study, so the pack must be approved again; the excerpt then omits them.
    await library.updateCaseStudy(t.writerScope, t.study.caseStudyId, { ...studyInput("Tenant CRM"), results: "Cut triage time by 40%.", resultsVerified: false });
    await expect(packs.buildPackCapabilityEvidence(db as never, t.alpha, t.packId)).rejects.toMatchObject({ code: "not_approved" });
    await packs.approveKitPack(t.ownerScope, t.packId);
    const after = await packs.buildPackCapabilityEvidence(db as never, t.alpha, t.packId);
    expect(after.find((item) => item.id === t.study.caseStudyId)?.excerpt).not.toContain("40%");
    expect(after.find((item) => item.id === t.study.caseStudyId)?.confidence).toBe("medium");
    await t.client.close();
  });
});
