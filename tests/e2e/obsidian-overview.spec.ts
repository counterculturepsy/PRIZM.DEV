import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { hashPassword } from "@/modules/auth/password";
import { cleanupFixtureUsers, createdFixtureEmails, e2ePassword, fixtureEmail, withE2eDatabase } from "./support";

test.afterAll(async () => {
  await withE2eDatabase(client => cleanupFixtureUsers(client, createdFixtureEmails()));
});

test("Obsidian dashboard shows workspace data, functional controls and responsive layouts", async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  const email = fixtureEmail("obsidian-overview");
  const password = e2ePassword();
  const passwordHash = await hashPassword(password);
  const workspaceId = randomUUID();
  await withE2eDatabase(async client => {
    await client.query("begin");
    try {
      const user = await client.query<{ id: string }>("insert into users (name,email,password_hash,account_status,email_verified) values ('Jordan Dev',$1,$2,'approved',now()) returning id", [email, passwordHash]);
      const userId = user.rows[0]!.id;
      await client.query("insert into workspaces (id,name,slug,currency) values ($1,'Obsidian visual fixture',$2,'ZAR')", [workspaceId, `obsidian-${workspaceId}`]);
      await client.query("insert into workspace_members (workspace_id,user_id,role,status,joined_at) values ($1,$2,'owner','active',now())", [workspaceId, userId]);
      await client.query("insert into onboarding_progress (workspace_id,completed_at) values ($1,now())", [workspaceId]);
      const companies = [
        ["Apex Logistics", "Logistics & Transport", 92, 6400000],
        ["BrightPath Consulting", "Business Consulting", 88, 1900000],
        ["Greenridge Properties", "Real Estate", 84, 1600000],
        ["Nova Health Tech", "Health & Wellness", 81, 2700000],
        ["Summit Retail Group", "Retail Operations", 76, 2200000],
      ] as const;
      for (const [index, [name, industry, score, valueMinor]] of companies.entries()) {
        const companyId = randomUUID(), websiteId = randomUUID(), auditId = randomUUID(), opportunityId = randomUUID(), leadId = randomUUID();
        const createdAt = new Date(Date.now() - (29 - index * 6) * 86_400_000);
        await client.query("insert into companies (id,workspace_id,name,industry,dedupe_key) values ($1::uuid,$2,$3,$4,$1::text)", [companyId, workspaceId, name, industry]);
        await client.query("insert into websites (id,workspace_id,company_id,url,normalized_origin) values ($1,$2,$3,$4,$4)", [websiteId, workspaceId, companyId, `https://obsidian-${index}.example.test`]);
        await client.query("insert into website_audits (id,workspace_id,website_id,requested_by_user_id,status,authorization_basis,completed_at) values ($1,$2,$3,$4,'completed','isolated_e2e_fixture',now())", [auditId, workspaceId, websiteId, userId]);
        await client.query("insert into opportunities (id,workspace_id,company_id,audit_id,type,title,summary,business_impact,recommended_solution) values ($1,$2,$3,$4,'website_improvement','Review website','Fixture evidence','Improve conversion','Website improvements')", [opportunityId, workspaceId, companyId, auditId]);
        await client.query("insert into lead_scores (workspace_id,company_id,audit_id,total_score,priority,components,scoring_version,is_current,source_completed_at) values ($1,$2,$3,$4,'high','[]','lead-v1',true,now())", [workspaceId, companyId, auditId, score]);
        await client.query("insert into leads (id,workspace_id,company_id,title,status,source_opportunity_id) values ($1,$2,$3,$4,'qualified',$5)", [leadId, workspaceId, companyId, name, opportunityId]);
        await client.query("insert into deals (workspace_id,lead_id,stage,value_minor,currency,created_at) values ($1,$2,'proposal',$3,'ZAR',$4)", [workspaceId, leadId, valueMinor, createdAt]);
      }
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    }
  });
  await page.goto("/login", { timeout: 90_000 });
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your acquisition workspace" })).toBeVisible({ timeout: 90_000 });
  await expect(page.getByRole("link", { name: /Apex Logistics/ })).toBeVisible();
  await expect(page.getByRole("img", { name: /Current open ZAR pipeline/ })).toBeVisible();
  for (const [width, height] of [[1600, 900], [1280, 800], [1024, 768], [768, 1024], [390, 844]] as const) {
    await page.setViewportSize({ width, height });
    await page.evaluate(() => document.fonts.ready);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `horizontal overflow at ${width}`).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`obsidian-${width}.png`), fullPage: true });
  }
  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(page.getByRole("dialog", { name: "Navigation and workspace" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.getByRole("link", { name: "7D", exact: true }).click();
  await expect(page).toHaveURL(/range=7d/);
  await expect(page.getByRole("link", { name: "7D", exact: true })).toHaveAttribute("aria-current", "page");
  await page.getByLabel("Search businesses", { exact: true }).fill("Apex");
  await page.getByLabel("Search businesses", { exact: true }).press("Enter");
  await expect(page).toHaveURL(/\/app\/discover\/search\?q=Apex/);
});
