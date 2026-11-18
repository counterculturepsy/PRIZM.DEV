import { randomUUID } from "node:crypto";
import { request as playwrightRequest, expect, test, type APIRequestContext, type Browser, type Page } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { cleanupFixtureUsers, createdFixtureEmails, createdFixtureWorkspaceIds, e2ePassword, fixtureEmail, withE2eDatabase } from "./support";

const port = Number(process.env.PLAYWRIGHT_PORT ?? 3100);
const origin = `http://127.0.0.1:${port}`;
const password = e2ePassword();

test.describe.configure({ mode: "serial" });

test.afterAll(async () => {
  await withE2eDatabase((client) => cleanupFixtureUsers(client, createdFixtureEmails(), createdFixtureWorkspaceIds()));
});

async function pdf(): Promise<Buffer> {
  const document = await PDFDocument.create();
  document.addPage([300, 300]);
  return Buffer.from(await document.save({ useObjectStreams: false }));
}

async function account(request: APIRequestContext, prefix: string): Promise<string> {
  const email = fixtureEmail(prefix);
  const response = await request.post("/api/auth/register", { data: { name: "Kit Tester", email, password }, headers: { origin } });
  expect(response.status()).toBe(202);
  await withE2eDatabase((client) => client.query("update users set account_status = 'approved', email_verified = now() where email = $1", [email]));
  return email;
}

async function signInAndCreateWorkspace(page: Page, email: string, workspaceName: string) {
  await page.goto("/login");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/workspaces\/new$/);
  await page.getByLabel("Workspace name").fill(workspaceName);
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page).toHaveURL(/\/app\/onboarding$/);
}

async function isolatedClient(browser: Browser): Promise<APIRequestContext> {
  void browser;
  return playwrightRequest.newContext({ baseURL: origin });
}

test("a workspace builds a kit, approves a pack, shares it by revocable link, and other users cannot reach its files", async ({ page, request, browser }, testInfo) => {
  test.setTimeout(120_000);
  test.skip(testInfo.project.name !== "chromium", "The stateful kit journey runs once in desktop Chromium.");
  const owner = await account(request, "kit-owner");
  await signInAndCreateWorkspace(page, owner, "Kit Journey Workspace");

  // Documents: hostile content is refused, a real PDF is stored privately.
  await page.goto("/app/kits");
  await expect(page.getByRole("heading", { name: "Capability kits" })).toBeVisible();
  await page.getByText("Upload a document").click();
  await page.locator("#upload-new-title").fill("Hostile file");
  await page.locator("#upload-new-file").setInputFiles({ name: "resume.pdf", mimeType: "application/pdf", buffer: Buffer.from("MZ this is not a pdf") });
  await page.getByRole("button", { name: "Upload document" }).click();
  await expect(page.locator("p[role='alert']")).toContainText("Upload a PDF, PNG or JPEG file.");
  await page.locator("#upload-new-title").fill("Reference letter");
  await page.locator("#upload-new-file").setInputFiles({ name: "../reference letter.pdf", mimeType: "application/pdf", buffer: await pdf() });
  await page.getByRole("button", { name: "Upload document" }).click();
  await expect(page.locator("p[role='status']")).toContainText("as version 1");
  await page.reload();
  await expect(page.getByText("reference letter.pdf")).toBeVisible();
  const assetHref = await page.getByRole("link", { name: "Download", exact: true }).first().getAttribute("href");
  expect(assetHref).toMatch(/^\/api\/kits\/assets\/[0-9a-f-]{36}$/);

  // Case study: results are only honoured when verified.
  await page.getByText("Add a case study").click();
  await page.locator("#cs-name").fill("Tenant-isolated CRM");
  await page.locator("#cs-problem").fill("Agencies lost track of leads.");
  await page.locator("#cs-solution").fill("A multi-tenant CRM.");
  await page.locator("#cs-stack").fill("Next.js, PostgreSQL");
  await page.locator("#cs-results").fill("Cut triage time by 40%.");
  await page.getByRole("button", { name: "Add case study" }).click();
  await expect(page.locator("p[role='status']")).toContainText("Case study saved.");
  await page.reload();
  await expect(page.getByRole("link", { name: /Tenant-isolated CRM/ })).toBeVisible();

  // Kit.
  await page.getByText("Create a kit").click();
  await page.locator("#kit-name").fill("Main kit");
  await page.locator("#kit-display-name").fill("Ada Developer");
  await page.locator("#kit-headline").fill("Full-stack engineer");
  await page.locator("#kit-intro").fill("I build secure SaaS products.");
  await page.getByRole("button", { name: "Create kit" }).click();
  await expect(page).toHaveURL(/\/app\/kits\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name: "Main kit" })).toBeVisible();

  // Pack: the cover note is drafted from selections and a human approves it.
  await page.goto("/app/kits");
  await page.getByText("Create a pack").click();
  await page.locator("#pack-kit").selectOption({ label: "Main kit" });
  await page.locator("#pack-title").fill("Acme application");
  await page.locator("#pack-recipient").fill("Sam Recruiter");
  await page.locator("#pack-org").fill("Acme");
  // A rejected submit (no case study chosen yet) must keep what the person typed.
  await page.getByRole("button", { name: "Create pack" }).click();
  await expect(page.locator("p[role='alert']")).toContainText(/case stud/i);
  await expect(page.locator("#pack-title")).toHaveValue("Acme application");
  await expect(page.locator("#pack-recipient")).toHaveValue("Sam Recruiter");
  await expect(page.locator("#pack-org")).toHaveValue("Acme");
  await page.getByRole("checkbox", { name: /Tenant-isolated CRM/ }).check();
  await page.getByRole("button", { name: "Create pack" }).click();
  await expect(page).toHaveURL(/\/app\/kits\/packs\/[0-9a-f-]{36}$/);
  await expect(page.locator("#up-message")).toHaveValue(/Hello Sam Recruiter,/);
  await expect(page.locator("#up-message")).not.toHaveValue(/40%/);
  const packUrl = new URL(page.url());
  const packId = packUrl.pathname.split("/").pop();

  // Draft packs cannot be shared; approval unlocks sharing.
  await expect(page.getByText("Only an owner or administrator can create links, and only for an approved pack.")).toBeVisible();
  await page.getByRole("button", { name: "Approve this pack" }).click();
  // The approve form is replaced by the approved state, so assert the page state rather than a one-shot message.
  await expect(page.getByText(/Approved \d/)).toBeVisible();
  await page.reload();
  await expect(page.getByText(/Approved \d/)).toBeVisible();

  // Document page: immutable version history with preview and download per version.
  const assetId = assetHref!.split("/").pop();
  await page.goto(`/app/kits/documents/${assetId}`);
  await expect(page.getByRole("heading", { name: "Reference letter" })).toBeVisible();
  const versionRow = page.locator("article").filter({ hasText: "Version 1" });
  await expect(versionRow).toHaveCount(1);
  await expect(versionRow.getByText("Current", { exact: true })).toBeVisible();
  await page.goto(packUrl.pathname);

  // Integration: attach the approved pack to a CRM lead and see its approval state on the lead page.
  const leadId = await withE2eDatabase(async (client) => {
    const workspace = await client.query<{ id: string }>(
      "select m.workspace_id as id from workspace_members m join users u on u.id = m.user_id where u.email = $1", [owner]);
    const company = await client.query<{ id: string }>("insert into companies (workspace_id, name, dedupe_key) values ($1, 'Acme', $2) returning id", [workspace.rows[0]!.id, `acme-${randomUUID()}`]);
    const lead = await client.query<{ id: string }>("insert into leads (workspace_id, company_id, title) values ($1, $2, 'Acme lead') returning id", [workspace.rows[0]!.id, company.rows[0]!.id]);
    await client.query("insert into deals (workspace_id, lead_id, currency) values ($1, $2, 'ZAR')", [workspace.rows[0]!.id, lead.rows[0]!.id]);
    return lead.rows[0]!.id;
  });
  await page.reload();
  await page.locator("#attach-target").selectOption({ label: "Acme lead" });
  await page.getByRole("button", { name: "Attach pack" }).click();
  await expect(page.locator("p[role='status']").filter({ hasText: "Nothing was sent" })).toBeVisible();
  await page.goto(`/app/leads/${leadId}`);
  await expect(page.getByRole("heading", { name: "Capability packs" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Acme application" })).toBeVisible();
  await expect(page.getByText("Approved", { exact: true })).toBeVisible();
  await page.goto(packUrl.pathname);
  // The PDF is real, private and carries only verified content.
  const pdfResponse = await page.request.get(`/api/kits/packs/${packId}/pdf`);
  expect(pdfResponse.status()).toBe(200);
  expect(pdfResponse.headers()["content-type"]).toBe("application/pdf");
  expect(pdfResponse.headers()["cache-control"]).toContain("no-store");
  expect(pdfResponse.headers()["x-content-type-options"]).toBe("nosniff");
  expect((await pdfResponse.body()).subarray(0, 5).toString()).toBe("%PDF-");

  // Share link: public with the token alone, then revoked.
  await page.getByRole("button", { name: "Create share link" }).click();
  const message = await page.locator("p[role='status']").filter({ hasText: "Link created" }).innerText();
  const link = /https?:\/\/[^\s]+\/s\/[A-Za-z0-9_-]{43}/.exec(message)?.[0];
  expect(link).toBeTruthy();
  const sharePath = new URL(link!).pathname;
  const anonymous = await isolatedClient(browser);
  const shared = await anonymous.get(sharePath);
  expect(shared.status()).toBe(200);
  expect(shared.headers()["content-type"]).toBe("application/pdf");
  expect((await shared.body()).subarray(0, 5).toString()).toBe("%PDF-");
  expect((await anonymous.get(`/s/${"A".repeat(43)}`)).status()).toBe(404);
  expect((await anonymous.get("/s/not-a-token")).status()).toBe(404);

  await page.reload();
  await page.getByRole("button", { name: "Revoke" }).click();
  await expect(page.getByText("revoked", { exact: true })).toBeVisible();
  const afterRevoke = await anonymous.get(sharePath);
  expect(afterRevoke.status()).toBe(404);
  expect(await afterRevoke.text()).toBe("This item is unavailable.");

  // Unauthenticated access to private files is refused.
  const assetPath = assetHref!;
  const unauthenticated = await anonymous.get(assetPath, { maxRedirects: 0 });
  expect([301, 302, 303, 307, 308, 401, 403, 404]).toContain(unauthenticated.status());
  expect((await unauthenticated.body()).subarray(0, 5).toString()).not.toBe("%PDF-");

  // Another workspace's user cannot read this workspace's file or pack.
  const outsider = await account(request, "kit-outsider");
  const outsiderContext = await browser.newContext({ baseURL: origin });
  const outsiderPage = await outsiderContext.newPage();
  await signInAndCreateWorkspace(outsiderPage, outsider, "Outsider Workspace");
  const crossAsset = await outsiderPage.request.get(assetPath);
  expect(crossAsset.status()).toBe(404);
  expect(await crossAsset.text()).toBe("This item is unavailable.");
  expect((await outsiderPage.request.get(`/api/kits/packs/${packId}/pdf`)).status()).toBe(404);
  // Next streams not-found pages with a 200 status, so assert that nothing from the other workspace is rendered.
  await outsiderPage.goto(`/app/kits/packs/${packId}`);
  await expect(outsiderPage.getByRole("heading", { name: "This workspace resource could not be found." })).toBeVisible();
  await expect(outsiderPage.getByText("Acme application")).toHaveCount(0);
  await outsiderContext.close();
  await anonymous.dispose();

  // Owner purge: archive the unreferenced document, then delete it permanently behind a typed confirmation.
  await page.goto("/app/kits");
  await page.locator("summary", { hasText: "Manage" }).first().click();
  await page.getByRole("button", { name: "Archive", exact: true }).click();
  // The action revalidates the page; wait for the archived document to appear rather than reloading mid-action.
  await expect(page.getByRole("heading", { name: "Archived documents" })).toBeVisible();
  await expect(page.getByText("Nothing archived.")).toHaveCount(0);
  await page.locator("summary", { hasText: "Permanently delete archived documents" }).click();
  await page.locator("#purge-days").fill("0");
  await page.locator("#purge-confirm").fill("purge");
  await page.getByRole("button", { name: "Permanently delete archived documents" }).click();
  await expect(page.locator("p[role='alert']")).toContainText("Type PURGE");
  // A rejected attempt resets the form (React resets uncontrolled fields after an action), so a destructive request must be re-entered in full.
  await expect(page.locator("#purge-confirm")).toHaveValue("");
  await page.locator("#purge-days").fill("0");
  await page.locator("#purge-confirm").fill("PURGE");
  await page.getByRole("button", { name: "Permanently delete archived documents" }).click();
  // The purge form disappears with the last archived document, so assert the resulting state.
  await expect(page.getByText("Nothing archived.")).toBeVisible();
  const gone = await page.request.get(assetPath);
  expect(gone.status()).toBe(404);
});
