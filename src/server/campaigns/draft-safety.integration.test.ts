// @vitest-environment node
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createWorkspaceScope } from "@/modules/workspaces/scope";
import { campaignDeliveryUsage, campaignMessages, campaignProviderEvents, campaignRecipients, campaignSteps, campaignUnsubscribeTokens, campaigns, users, workspaceMembers, workspaces } from "@/server/db/schema";

describe("campaign draft creation safety", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.doUnmock("@/server/db");
    vi.doUnmock("@/server/campaigns/delivery");
    vi.doUnmock("@/server/auth/email-delivery");
    vi.resetModules();
  });

  it("stores an internal draft only: no delivery, scheduling, provider call or outbound message", async () => {
    const client = new PGlite();
    const db = drizzle(client);
    await migrate(db, { migrationsFolder: "drizzle" });
    const [user] = await db.insert(users).values({ email: "draft-owner@example.test" }).returning({ id: users.id });
    const [workspace] = await db.insert(workspaces).values({ name: "Drafts", slug: "campaign-drafts" }).returning({ id: workspaces.id });
    if (!user || !workspace) throw new Error("fixtures");
    await db.insert(workspaceMembers).values({ workspaceId: workspace.id, userId: user.id, role: "owner", status: "active" });
    const scope = createWorkspaceScope({ workspaceId: workspace.id, userId: user.id, role: "owner" });

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("no network access is allowed while drafting"));
    const delivery = {
      materializeCampaignMessages: vi.fn(),
      claimNextCampaignMessage: vi.fn(),
      processNextCampaignMessage: vi.fn(),
      consumeUnsubscribeToken: vi.fn(),
      ingestVerifiedCampaignEvent: vi.fn(),
    };
    const authDelivery = { getAuthEmailDelivery: vi.fn(), getConfiguredAuthEmailDelivery: vi.fn() };
    vi.resetModules();
    vi.doMock("@/server/db", () => ({ getDatabase: () => db }));
    vi.doMock("@/server/campaigns/delivery", () => delivery);
    vi.doMock("@/server/auth/email-delivery", () => authDelivery);
    const service = await import("./service");

    const input = { name: "Internal draft", dailyRecipientCap: 10, requestKey: randomUUID() };
    const id = await service.createCampaign(scope, input);
    expect(await service.createCampaign(scope, input)).toBe(id);

    const [draft] = await db.select().from(campaigns).where(eq(campaigns.id, id));
    expect(draft).toMatchObject({ status: "draft", reviewedAt: null, reviewedByUserId: null });
    expect(await db.select().from(campaigns)).toHaveLength(1);

    for (const table of [campaignMessages, campaignRecipients, campaignSteps, campaignDeliveryUsage, campaignUnsubscribeTokens, campaignProviderEvents]) {
      expect(await db.select().from(table)).toHaveLength(0);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
    for (const fn of Object.values({ ...delivery, ...authDelivery })) expect(fn).not.toHaveBeenCalled();
    await client.close();
  });
});
