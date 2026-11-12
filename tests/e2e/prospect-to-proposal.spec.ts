import { randomUUID } from "node:crypto";
import pg from "pg";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

const databaseUrl = process.env.E2E_DATABASE_URL;
if (!databaseUrl) throw new Error("E2E_DATABASE_URL is required for the prospect-to-proposal journey.");
const origin = `http://127.0.0.1:${Number(process.env.PLAYWRIGHT_PORT ?? 3100)}`;
const password = "PlaywrightPassword123";
const runId = randomUUID();
const email = `journey-${runId}@example.test`;
const workspaceName = "HOAX1G.DEV";
const companyName = `Evidence Prospect ${runId.slice(0, 8)}`;
const companyDomain = `prospect-${runId.slice(0, 8)}.example`;
let userId: string | null = null;
let workspaceId: string | null = null;

test.describe.configure({ mode: "serial" });

async function withDatabase<T>(run: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try { return await run(client); } finally { await client.end(); }
}

async function register(request: APIRequestContext) {
  const response = await request.post("/api/auth/register", {
    data: { name: "Journey Owner", email, password },
    headers: { origin },
  });
  expect(response.status()).toBe(202);
  await withDatabase((client) => client.query("update users set account_status = 'approved', email_verified = now() where email = $1", [email]));
}

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/workspaces\/new$/);
}

test.afterAll(async () => {
  await withDatabase(async (client) => {
    const resolvedUserId = userId ?? (await client.query<{ id: string }>("select id from users where email = $1", [email])).rows[0]?.id ?? null;
    const resolvedWorkspaceIds = workspaceId ? [workspaceId] : resolvedUserId ? (await client.query<{ id: string }>(
      "select w.id from workspaces w join workspace_members wm on wm.workspace_id = w.id where wm.user_id = $1 and w.name = $2",
      [resolvedUserId, workspaceName],
    )).rows.map((row) => row.id) : [];
    for (const resolvedWorkspaceId of resolvedWorkspaceIds) {
      await client.query("delete from audit_logs where workspace_id = $1", [resolvedWorkspaceId]);
      await client.query("delete from workspaces where id = $1", [resolvedWorkspaceId]);
    }
    if (resolvedUserId) await client.query("delete from users where id = $1", [resolvedUserId]);
  });
});

test("authenticated evidence-backed prospect becomes a human-approved proposal without outbound side effects", async ({ page, request }, testInfo) => {
  test.setTimeout(60_000);
  test.skip(testInfo.project.name !== "chromium", "The stateful vertical slice runs once in desktop Chromium.");
  await register(request);
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Sign in to your workspace" })).toBeVisible();
  await expect(page.getByRole("img", { name: /HOAX1G DEV geometric prism artwork/i })).toBeVisible();
  await page.screenshot({ fullPage: true, path: testInfo.outputPath("login-desktop.png") });
  await page.setViewportSize({ width: 412, height: 915 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ fullPage: true, path: testInfo.outputPath("login-mobile.png") });
  await page.setViewportSize({ width: 1280, height: 720 });
  await signIn(page);

  await page.getByLabel("Workspace name").fill(workspaceName);
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page).toHaveURL(/\/app\/onboarding$/);
  await page.getByLabel("Services").fill("Accessibility remediation\nWebsite development");
  await page.getByLabel("Target cities").fill("Stellenbosch");
  await page.getByLabel("Target industries").fill("Professional services");
  await page.getByLabel("Minimum project value").fill("10000");
  await page.getByLabel("Maximum project value").fill("100000");
  await page.getByRole("button", { name: "Complete onboarding" }).click();
  await expect(page).toHaveURL(/\/app$/);

  const identity = await withDatabase(async (client) => {
    const user = await client.query<{ id: string }>("select id from users where email = $1", [email]);
    const workspace = await client.query<{ id: string }>("select w.id from workspaces w join workspace_members wm on wm.workspace_id = w.id where wm.user_id = $1 and w.name = $2 and wm.role = 'owner' and wm.status = 'active'", [user.rows[0]?.id, workspaceName]);
    return { userId: user.rows[0]!.id, workspaceId: workspace.rows[0]!.id };
  });
  userId = identity.userId; workspaceId = identity.workspaceId;

  await page.goto("/app/discover/search");
  await page.getByLabel("Company CSV").setInputFiles({
    name: "journey-prospect.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(`name,website,industry,city,province,source_url\n${companyName},https://${companyDomain},Professional services,Stellenbosch,Western Cape,https://source.example.test/${runId}\n`),
  });
  await page.getByRole("button", { name: "Import companies" }).click();
  await expect(page.getByRole("status")).toContainText("1 created");
  await page.getByRole("link", { name: companyName, exact: true }).click();
  await expect(page.getByRole("heading", { name: companyName })).toBeVisible();

  const fixtureIds = await withDatabase(async (client) => {
    const company = await client.query<{ id: string }>("select id from companies where workspace_id = $1 and name = $2", [workspaceId, companyName]);
    const companyId = company.rows[0]!.id;
    await client.query("begin");
    try {
      const website = await client.query<{ id: string }>("insert into websites (workspace_id, company_id, url, normalized_origin) values ($1, $2, $3, $3) returning id", [workspaceId, companyId, `https://${companyDomain}`]);
      const audit = await client.query<{ id: string }>("insert into website_audits (workspace_id, website_id, requested_by_user_id, status, authorization_basis, robots_allowed, score, completed_at) values ($1, $2, $3, 'completed', 'isolated_e2e_fixture', true, 58, now()) returning id", [workspaceId, website.rows[0]!.id, userId]);
      const pageRow = await client.query<{ id: string }>("insert into audit_pages (workspace_id, audit_id, url, status, http_status, content_type, response_bytes, duration_ms, title, fetched_at) values ($1, $2, $3, 'completed', 200, 'text/html', 1024, 25, $4, now()) returning id", [workspaceId, audit.rows[0]!.id, `https://${companyDomain}`, companyName]);
      const finding = await client.query<{ id: string }>("insert into audit_findings (workspace_id, audit_id, page_id, category, code, severity, title, summary, evidence, source_url, confidence, score_impact, observed_at) values ($1, $2, $3, 'accessibility', 'a11y.form_label_missing', 'high', 'Form label missing', 'A public form control has no accessible label.', 'The newsletter input has no associated label.', $4, 'high', 12, now()) returning id", [workspaceId, audit.rows[0]!.id, pageRow.rows[0]!.id, `https://${companyDomain}`]);
      await client.query("insert into lead_scores (workspace_id, company_id, audit_id, total_score, priority, components, scoring_version, is_current, source_completed_at) values ($1, $2, $3, 72, 'high', $4::jsonb, 'lead-v1', true, now())", [workspaceId, companyId, audit.rows[0]!.id, JSON.stringify([{ key: "evidence", label: "Observed need", points: 72, maxPoints: 100, reason: "High-confidence accessibility finding", evidenceFindingIds: [finding.rows[0]!.id] }])]);
      const opportunity = await client.query<{ id: string }>("insert into opportunities (workspace_id, company_id, audit_id, type, title, summary, business_impact, recommended_solution, estimated_value_min_minor, estimated_value_max_minor, currency, confidence) values ($1, $2, $3, 'accessibility_remediation', 'Accessible form remediation', 'Observed form controls need accessible labels.', 'Customers using assistive technology may be unable to complete the form.', 'Add programmatic labels and verify keyboard and screen-reader behavior.', 15000, 25000, 'ZAR', 'high') returning id", [workspaceId, companyId, audit.rows[0]!.id]);
      await client.query("insert into opportunity_evidence (workspace_id, audit_id, opportunity_id, finding_id) values ($1, $2, $3, $4)", [workspaceId, audit.rows[0]!.id, opportunity.rows[0]!.id, finding.rows[0]!.id]);
      await client.query("insert into opportunity_service_recommendations (workspace_id, audit_id, opportunity_id, service_name, is_preferred, rank, price_status, starting_price_minor, average_price_minor, currency) values ($1, $2, $3, 'Accessibility remediation', true, 1, 'configured', 15000, 20000, 'ZAR')", [workspaceId, audit.rows[0]!.id, opportunity.rows[0]!.id]);
      await client.query("commit");
      return { companyId, auditId: audit.rows[0]!.id };
    } catch (error) { await client.query("rollback"); throw error; }
  });

  await page.goto(`/app/audits/${fixtureIds.auditId}`);
  await expect(page.getByRole("heading", { name: companyName })).toBeVisible();
  await expect(page.getByText("The newsletter input has no associated label.")).toBeVisible();
  await page.getByRole("link", { name: "Open current analysis" }).click();
  await expect(page).toHaveURL(new RegExp(`/app/companies/${fixtureIds.companyId}/opportunities$`));
  await expect(page.getByRole("heading", { name: "Accessible form remediation" })).toBeVisible();
  await page.getByRole("button", { name: "Create CRM lead" }).click();
  await expect(page).toHaveURL(/\/app\/leads\/[0-9a-f-]+$/, { timeout: 15_000 });
  await page.getByRole("link", { name: "Create or continue proposal" }).click();

  await expect(page.getByLabel("CRM lead")).toHaveValue(/^[0-9a-f-]{36}$/);
  await page.getByLabel("Proposal title").fill("Evidence-backed accessibility proposal");
  await page.getByLabel("Executive summary").fill("Remediate the observed accessibility issue using the captured audit evidence.");
  await page.getByLabel("Scope", { exact: true }).fill("Accessible form remediation and verification.");
  await page.getByLabel("Deliverables").fill("Programmatic labels, keyboard verification, and review notes.");
  await page.getByLabel("Assumptions").fill("The public form remains available for implementation review.");
  await page.getByLabel("Exclusions").fill("No external crawling or outbound communication.");
  await page.getByLabel("Timeline guidance").fill("Two weeks after content access.");
  await page.getByLabel("Description").fill("Accessibility remediation");
  await page.getByLabel("Quantity").fill("1");
  await page.getByLabel("Unit amount").fill("20000");
  await page.getByLabel("Discount").fill("0");
  await page.getByRole("button", { name: "Create proposal" }).click();
  await expect(page).toHaveURL(/\/app\/proposals\/[0-9a-f-]+$/);
  const proposalUrl = page.url();
  await expect(page.getByRole("heading", { name: "Immutable source-evidence snapshot" })).toBeVisible();
  await expect(page.getByText("The newsletter input has no associated label.")).toBeVisible();

  await page.goto("/app");
  await expect(page.getByRole("heading", { name: workspaceName })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Sales funnel" })).toBeVisible();
  await expect(page.getByText("Total prospects", { exact: true })).toBeVisible();
  await expect(page.getByText("Audited businesses", { exact: true })).toBeVisible();
  await expect(page.getByText("Awaiting approval", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Import prospects" })).toHaveAttribute("href", "/app/discover/search");
  await expect(page.getByRole("link", { name: "View opportunities" })).toHaveAttribute("href", "/app/discover/opportunities");
  await expect(page.getByLabel("Date range")).toHaveValue("30d");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ fullPage: true, path: testInfo.outputPath("dashboard-desktop.png") });
  await page.setViewportSize({ width: 412, height: 915 });
  await expect(page.getByRole("heading", { name: "Priority actions" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ fullPage: true, path: testInfo.outputPath("dashboard-mobile.png") });
  await page.setViewportSize({ width: 1280, height: 720 });

  await page.goto(proposalUrl);
  await page.getByLabel("Approval note").fill("Evidence, scope, and pricing reviewed by the workspace owner.");
  await page.getByRole("button", { name: "Approve current version" }).click();
  await expect(page.getByText(/approved/i).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Lifecycle history" })).toBeVisible();
  await expect(page.getByText(/Proposal approved/)).toBeVisible();

  const stored = await withDatabase(async (client) => {
    const proposal = await client.query<{ status: string; current_version: number; source_title: string }>("select p.status, p.current_version, pv.snapshot->'sourceEvidence'->'opportunity'->>'title' as source_title from proposals p join proposal_versions pv on pv.workspace_id=p.workspace_id and pv.proposal_id=p.id and pv.version=p.current_version where p.workspace_id=$1", [workspaceId]);
    const events = await client.query<{ action: string; actor_user_id: string | null }>("select action, actor_user_id from audit_logs where workspace_id=$1 and target_type='proposal' order by created_at", [workspaceId]);
    const sideEffects = await client.query<{ campaigns: number; messages: number }>("select (select count(*)::int from campaigns where workspace_id=$1) as campaigns, (select count(*)::int from campaign_messages where workspace_id=$1) as messages", [workspaceId]);
    return { proposal: proposal.rows[0], events: events.rows, sideEffects: sideEffects.rows[0] };
  });
  expect(stored.proposal).toMatchObject({ status: "approved", current_version: 1, source_title: "Accessible form remediation" });
  expect(stored.events).toEqual([
    expect.objectContaining({ action: "proposal.created", actor_user_id: userId }),
    expect.objectContaining({ action: "proposal.approved", actor_user_id: userId }),
  ]);
  expect(stored.sideEffects).toEqual({ campaigns: 0, messages: 0 });
});
