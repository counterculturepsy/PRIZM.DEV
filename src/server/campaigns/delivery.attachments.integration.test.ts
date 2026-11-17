// @vitest-environment node

import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { describe, expect, it, vi } from "vitest";
import type { CampaignEmailProvider, CampaignDeliveryMessage } from "@/modules/campaigns/delivery";
import { createWorkspaceScope } from "@/modules/workspaces/scope";
import { campaignMessages, companies, contacts, users, workspaceMembers, workspaces } from "@/server/db/schema";

const SECRET = "campaign-unsubscribe-test-secret-with-more-than-32-bytes";

async function setup() {
  const client = new PGlite();
  const db = drizzle(client);
  await migrate(db, { migrationsFolder: "drizzle" });
  const [owner] = await db.insert(users).values([{ email: "attach-owner@example.com", name: "Olivia Owner" }]).returning();
  const [alpha] = await db.insert(workspaces).values([{ name: "Alpha", slug: "attach-alpha" }]).returning();
  if (!owner || !alpha) throw new Error("fixtures");
  await db.insert(workspaceMembers).values({ workspaceId: alpha.id, userId: owner.id, role: "owner", status: "active" });
  const [company] = await db.insert(companies).values({ workspaceId: alpha.id, name: "Client", dedupeKey: "attach-client" }).returning();
  if (!company) throw new Error("company");
  const [contact] = await db.insert(contacts).values({
    workspaceId: alpha.id, companyId: company.id, firstName: "First", email: "first@example.com", normalizedEmail: "first@example.com",
    sourceLabel: "Existing client", observedAt: new Date(), createdByUserId: owner.id,
  }).returning();
  if (!contact) throw new Error("contact");

  vi.resetModules();
  vi.doMock("@/server/db", () => ({ getDatabase: () => db }));
  const preparation = await import("./service");
  const delivery = await import("./delivery");
  const library = await import("@/server/kits/library");
  const packs = await import("@/server/kits/packs");
  const scope = createWorkspaceScope({ workspaceId: alpha.id, userId: owner.id, role: "owner" });

  const campaignId = await preparation.createCampaign(scope, { name: "Attached pack campaign", dailyRecipientCap: 5, requestKey: randomUUID() });
  const templateId = await preparation.createCampaignTemplate(scope, { name: "Introduction", subject: "A relevant introduction", body: "Would you be open to reviewing our capability overview?" });
  await preparation.saveCampaignStep(scope, { campaignId, templateId, position: 1, delayDays: 0 });
  await preparation.enrollCampaignRecipient(scope, { campaignId, contactId: contact.id, contactBasis: "Documented existing client relationship" });
  await preparation.reviewCampaign(scope, { campaignId, note: "Owner reviewed the content, audience and contact basis" });

  const kit = await library.createCapabilityKit(scope, { name: "Kit", content: { profile: { displayName: "Ada Developer" } } });
  const pack = await packs.createKitPack(scope, { kitId: kit.kitId, templateKey: "partnership_introduction", title: "Partner pack", recipientName: "Sam Partner", caseStudyIds: [], assetIds: [] });
  await packs.approveKitPack(scope, pack.packId);
  await packs.attachKitPack(scope, { packId: pack.packId, target: { type: "campaign", id: campaignId } });
  const edit = async (message: string) => {
    const current = (await packs.getKitPack(scope, pack.packId))!.pack;
    return packs.updateKitPack(scope, { packId: pack.packId, expectedUpdatedAt: current.updatedAt, message });
  };
  return { client, db, delivery, packs, scope, campaignId, packId: pack.packId, edit };
}

describe("capability pack attachments and campaign delivery", () => {
  it("refuses to stage delivery while an attached pack has changed since approval", async () => {
    const t = await setup();
    await t.edit("Hello Sam, here is an updated introduction after approval.");
    await expect(t.delivery.materializeCampaignMessages(t.scope, t.campaignId, SECRET, new Date("2026-11-17T08:00:00Z"))).rejects.toThrow("attached capability pack changed");
    expect(await t.db.select().from(campaignMessages)).toHaveLength(0);

    await t.packs.approveKitPack(t.scope, t.packId);
    await expect(t.delivery.materializeCampaignMessages(t.scope, t.campaignId, SECRET, new Date("2026-11-17T08:00:00Z"))).resolves.toEqual({ created: 1, total: 1 });
    await t.client.close();
  });

  it("stops a staged message at the last check before sending when the pack changes after approval", async () => {
    const t = await setup();
    await t.delivery.materializeCampaignMessages(t.scope, t.campaignId, SECRET, new Date("2026-11-17T08:00:00Z"));
    const sent: CampaignDeliveryMessage[] = [];
    const provider: CampaignEmailProvider = { id: "test-provider", async send(message) { sent.push(message); return { providerMessageId: `provider-${sent.length}` }; } };
    const options = (minute: number) => ({ enabled: true, unsubscribeBaseUrl: "http://127.0.0.1:3000", tokenSecret: SECRET, now: new Date(`2026-11-17T08:0${minute}:00Z`) });

    // The pack is edited after approval but before the worker reaches the message: nothing may leave.
    await t.edit("Hello Sam, this message was edited after it was approved.");
    await expect(t.delivery.processNextCampaignMessage(provider, "worker-1", options(1))).resolves.toMatchObject({ status: "suppressed" });
    expect(sent).toHaveLength(0);
    const [message] = await t.db.select().from(campaignMessages).where(eq(campaignMessages.campaignId, t.campaignId));
    expect(message).toMatchObject({ status: "suppressed", lastErrorCode: "attachment_changed_after_approval" });
    await t.client.close();
  });

  it("still sends when every attached pack is approved exactly as reviewed", async () => {
    const t = await setup();
    await t.delivery.materializeCampaignMessages(t.scope, t.campaignId, SECRET, new Date("2026-11-17T08:00:00Z"));
    const sent: CampaignDeliveryMessage[] = [];
    const provider: CampaignEmailProvider = { id: "test-provider", async send(message) { sent.push(message); return { providerMessageId: `provider-${sent.length}` }; } };
    await expect(t.delivery.processNextCampaignMessage(provider, "worker-1", { enabled: true, unsubscribeBaseUrl: "http://127.0.0.1:3000", tokenSecret: SECRET, now: new Date("2026-11-17T08:01:00Z") })).resolves.toMatchObject({ status: "sent" });
    expect(sent).toHaveLength(1);
    // The pack is a reference only: the delivered message carries no attachment of any kind.
    expect(Object.keys(sent[0] ?? {}).sort()).toEqual(["body", "idempotencyKey", "subject", "to", "unsubscribeUrl"]);
    await t.client.close();
  });
});
