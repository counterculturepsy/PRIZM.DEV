import { createHash, createHmac, randomUUID } from "node:crypto";
import pg from "pg";
import { encode } from "next-auth/jwt";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

const databaseUrl = process.env.E2E_DATABASE_URL;
if (!databaseUrl) throw new Error("E2E_DATABASE_URL is required for authentication E2E tests.");
const origin = "http://127.0.0.1:3100";
const password = "PlaywrightPassword123";
const authSecret = "e2e-only-secret-that-is-at-least-32-characters";

test.describe.configure({ mode: "serial" });

async function withDatabase<T>(run: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try { return await run(client); } finally { await client.end(); }
}

async function register(request: APIRequestContext, email: string, name = "Playwright User") {
  return request.post("/api/auth/register", {
    data: { name, email, password },
    headers: { origin },
  });
}

async function approveAndVerify(email: string, isPlatformAdmin = false) {
  const updated = await withDatabase((client) => client.query(
    "update users set account_status = 'approved', email_verified = now(), is_platform_admin = $2 where email = $1",
    [email, isPlatformAdmin],
  ));
  expect(updated.rowCount).toBe(1);
}

async function signIn(page: Page, email: string, candidatePassword = password) {
  await page.goto("/login");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(candidatePassword);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

function authenticationError(page: Page) {
  return page.locator("p[role='alert']");
}

function rateLimitHash(kind: "login" | "registration", identifier: string) {
  return createHmac("sha256", authSecret).update(`${kind}:${identifier.trim().toLowerCase()}`).digest("hex");
}

async function createTransitionUser(input: { status?: "pending" | "approved" | "suspended"; oauth?: boolean; passwordHash?: string | null }) {
  const email = `transition-${randomUUID()}@example.test`;
  return withDatabase(async (client) => {
    const result = await client.query<{ id: string }>(
      "insert into users (name, email, email_verified, account_status, password_hash) values ('Transition User', $1, now(), $2, $3) returning id",
      [email, input.status ?? "approved", input.passwordHash ?? null],
    );
    const id = result.rows[0]!.id;
    if (input.oauth) await client.query("insert into accounts (user_id, type, provider, provider_account_id) values ($1, 'oauth', 'github', $2)", [id, randomUUID()]);
    return { id, email };
  });
}

async function setTransitionSession(page: Page, user: { id: string; email: string }) {
  const token = await encode({
    secret: authSecret,
    maxAge: 12 * 60 * 60,
    token: { sub: user.id, email: user.email, name: "Transition User", authVersion: 0, accountStatus: "approved", isPlatformAdmin: false },
  });
  await page.context().addCookies([{ name: "next-auth.session-token", value: token, url: origin, httpOnly: true, sameSite: "Lax" }]);
}

test("registration accepts a new account without exposing whether an account already exists", async ({ request }) => {
  const email = `register-${randomUUID()}@example.test`;
  const created = await register(request, email);
  expect(created.status()).toBe(202);
  await expect(created.json()).resolves.toMatchObject({ accepted: true, verificationRequired: true, deliveryAvailable: false });
  const duplicate = await register(request, email);
  expect(duplicate.status()).toBe(202);
  await expect(duplicate.json()).resolves.toMatchObject({ accepted: true, verificationRequired: true, deliveryAvailable: false });
  const state = await withDatabase((client) => client.query("select account_status from users where email = $1", [email]));
  expect(state.rows[0]).toMatchObject({ account_status: "pending" });
});

test("registration rejects cross-origin mutations", async ({ request }) => {
  const response = await request.post("/api/auth/register", {
    data: { name: "Cross Origin", email: `origin-${randomUUID()}@example.test`, password },
    headers: { origin: "https://attacker.example" },
  });
  expect(response.status()).toBe(403);
});

test("pending accounts cannot authenticate and email verification does not approve them", async ({ page, request }) => {
  const email = `pending-${randomUUID()}@example.test`;
  expect((await register(request, email)).status()).toBe(202);
  await signIn(page, email);
  await expect(authenticationError(page)).toContainText("incorrect");
  await expect(page).toHaveURL(/\/login$/);
  const state = await withDatabase((client) => client.query("select account_status from users where email = $1", [email]));
  expect(state.rows[0]).toMatchObject({ account_status: "pending" });
});

test("a platform administrator can approve an account and a normal user cannot open the approval queue", async ({ page, request }) => {
  const adminEmail = `admin-${randomUUID()}@example.test`;
  const memberEmail = `member-${randomUUID()}@example.test`;
  expect((await register(request, adminEmail, "Platform Admin")).status()).toBe(202);
  expect((await register(request, memberEmail, "Pending Member")).status()).toBe(202);
  await approveAndVerify(adminEmail, true);
  await signIn(page, adminEmail);
  await expect(page).toHaveURL(/\/app\/workspaces\/new$/);
  await page.goto(`/app/admin/users?q=${encodeURIComponent(memberEmail)}&status=pending`);
  await expect(page.getByText(memberEmail)).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByText(memberEmail)).toHaveCount(0);
  await withDatabase((client) => client.query("update users set email_verified = now() where email = $1", [memberEmail]));
  await page.goto("/api/auth/signout");
  await signIn(page, memberEmail);
  await expect(page).toHaveURL(/\/app\/workspaces\/new$/);
  await page.goto("/app/admin/users");
  await expect(page).toHaveURL(/\/app\/admin\/users$/);
  await expect(page.getByRole("heading", { name: "This workspace resource could not be found." })).toBeVisible();
});

test("rejected and suspended accounts are denied and an active session is invalidated", async ({ page, request }) => {
  const rejectedEmail = `rejected-${randomUUID()}@example.test`;
  const suspendedEmail = `suspended-${randomUUID()}@example.test`;
  expect((await register(request, rejectedEmail)).status()).toBe(202);
  expect((await register(request, suspendedEmail)).status()).toBe(202);
  await withDatabase((client) => client.query("update users set email_verified = now(), account_status = 'rejected' where email = $1", [rejectedEmail]));
  await signIn(page, rejectedEmail);
  await expect(authenticationError(page)).toContainText("incorrect");
  await approveAndVerify(suspendedEmail);
  await signIn(page, suspendedEmail);
  await expect(page).toHaveURL(/\/app\/workspaces\/new$/);
  await withDatabase((client) => client.query("update users set account_status = 'suspended', auth_version = auth_version + 1 where email = $1", [suspendedEmail]));
  await page.goto("/app");
  await expect(page).toHaveURL(/\/login$/);
});

test("OAuth-linked approved users can establish password access once and ineligible accounts are rejected", async ({ page }) => {
  const unauthenticated = await page.request.post("/api/auth/password/setup", { data: { password, confirmation: password }, headers: { origin } });
  expect(unauthenticated.status()).toBe(401);

  for (const status of ["pending", "suspended"] as const) {
    const user = await createTransitionUser({ status, oauth: true });
    await setTransitionSession(page, user);
    const response = await page.request.post("/api/auth/password/setup", { data: { password, confirmation: password }, headers: { origin } });
    expect(response.status()).toBe(401);
    await page.context().clearCookies();
  }

  const credentialsOnly = await createTransitionUser({ oauth: false });
  await setTransitionSession(page, credentialsOnly);
  expect((await page.request.post("/api/auth/password/setup", { data: { password, confirmation: password }, headers: { origin } })).status()).toBe(409);
  await page.context().clearCookies();

  const alreadyEnabled = await createTransitionUser({ oauth: true, passwordHash: "existing-password-hash" });
  await setTransitionSession(page, alreadyEnabled);
  expect((await page.request.post("/api/auth/password/setup", { data: { password, confirmation: password }, headers: { origin } })).status()).toBe(409);
  await page.context().clearCookies();

  const user = await createTransitionUser({ oauth: true });
  await setTransitionSession(page, user);
  await page.goto("/app/settings/security");
  await page.getByLabel("New password").fill(password);
  await page.getByLabel("Confirm password").fill(password);
  await page.getByRole("button", { name: "Establish password login" }).click();
  await expect(page).toHaveURL(/\/login\?password=created$/);
  await page.goto("/app");
  await expect(page).toHaveURL(/\/login$/);
  await signIn(page, user.email);
  await expect(page).toHaveURL(/\/app\/workspaces\/new$/);
  const state = await withDatabase((client) => client.query("select password_hash is not null as password_set, email_verified is not null as verified, password_changed_at is not null as changed, auth_version from users where id = $1", [user.id]));
  expect(state.rows[0]).toMatchObject({ password_set: true, verified: true, changed: true, auth_version: 1 });
  await page.context().clearCookies();

  const concurrent = await createTransitionUser({ oauth: true });
  await setTransitionSession(page, concurrent);
  const responses = await Promise.all([
    page.request.post("/api/auth/password/setup", { data: { password, confirmation: password }, headers: { origin } }),
    page.request.post("/api/auth/password/setup", { data: { password, confirmation: password }, headers: { origin } }),
  ]);
  expect(responses.filter((response) => response.status() === 200)).toHaveLength(1);
  expect(responses.filter((response) => [401, 409].includes(response.status()))).toHaveLength(1);
});

test("registration returns 429 with Retry-After and recovers after the isolated bucket is cleared", async ({ request }) => {
  const email = `limited-${randomUUID()}@example.test`;
  for (let attempt = 0; attempt < 5; attempt += 1) expect((await register(request, email)).status()).toBe(202);
  const blocked = await register(request, email);
  expect(blocked.status()).toBe(429);
  expect(Number(blocked.headers()["retry-after"])).toBeGreaterThan(0);
  await withDatabase((client) => client.query(
    "delete from auth_rate_limit_windows where kind = 'registration' and identifier_hash = $1",
    [rateLimitHash("registration", email)],
  ));
  expect((await register(request, email)).status()).toBe(202);
});

test("valid credentials authenticate and invalid credentials remain generic", async ({ page, request }) => {
  const email = `login-${randomUUID()}@example.test`;
  expect((await register(request, email)).status()).toBe(202);
  await approveAndVerify(email);
  await signIn(page, email, "WrongPassword123");
  await expect(authenticationError(page)).toContainText("incorrect");
  await signIn(page, email);
  await expect(page).toHaveURL(/\/app\/workspaces\/new$/);
});

test("login blocks repeated failures and recovers after its window state is cleared", async ({ page, request }) => {
  const email = `login-limit-${randomUUID()}@example.test`;
  expect((await register(request, email)).status()).toBe(202);
  await approveAndVerify(email);
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await signIn(page, email, "WrongPassword123");
    await expect(authenticationError(page)).toContainText("incorrect");
  }
  const blockedResponsePromise = page.waitForResponse((response) =>
    response.request().method() === "POST" && response.url().includes("/api/auth/callback/credentials"),
  );
  await signIn(page, email);
  const blockedResponse = await blockedResponsePromise;
  expect(blockedResponse.status()).toBe(429);
  expect(Number(blockedResponse.headers()["retry-after"])).toBeGreaterThan(0);
  await expect(authenticationError(page)).toContainText("incorrect");
  await withDatabase((client) => client.query(
    "delete from auth_rate_limit_windows where kind = 'login' and identifier_hash = $1",
    [rateLimitHash("login", email)],
  ));
  await signIn(page, email);
  await expect(page).toHaveURL(/\/app\/workspaces\/new$/);
});

test("email verification links are single use", async ({ page, request }) => {
  const email = `verify-${randomUUID()}@example.test`;
  expect((await register(request, email)).status()).toBe(202);
  const rawToken = Buffer.from(randomUUID().replaceAll("-", "").padEnd(32, "0")).toString("base64url").slice(0, 43).padEnd(43, "a");
  const hash = createHash("sha256").update(rawToken).digest("hex");
  await withDatabase(async (client) => {
    const user = await client.query<{ id: string }>("select id from users where email = $1", [email]);
    await client.query("insert into auth_action_tokens (user_id, purpose, token_hash, expires_at) values ($1, 'email_verification', $2, now() + interval '1 hour')", [user.rows[0]?.id, hash]);
  });
  await page.goto(`/verify-email?token=${rawToken}`);
  await page.getByRole("button", { name: "Verify email" }).click();
  await expect(page.getByRole("status")).toContainText("Email verified");
  await page.getByRole("button", { name: "Verify email" }).click();
  await expect(page.getByRole("status")).toContainText("invalid or expired");
  const verified = await withDatabase((client) => client.query("select email_verified is not null as verified from users where email = $1", [email]));
  expect(verified.rows[0]).toMatchObject({ verified: true });
  const approval = await withDatabase((client) => client.query("select account_status from users where email = $1", [email]));
  expect(approval.rows[0]).toMatchObject({ account_status: "pending" });
});

test("password reset is single use, changes credentials and invalidates session state", async ({ page, request }) => {
  const email = `reset-${randomUUID()}@example.test`;
  expect((await register(request, email)).status()).toBe(202);
  await approveAndVerify(email);
  const rawToken = Buffer.from(randomUUID().replaceAll("-", "").padEnd(32, "0")).toString("base64url").slice(0, 43).padEnd(43, "b");
  const hash = createHash("sha256").update(rawToken).digest("hex");
  await withDatabase(async (client) => {
    const user = await client.query<{ id: string }>("select id from users where email = $1", [email]);
    await client.query("insert into auth_action_tokens (user_id, purpose, token_hash, expires_at) values ($1, 'password_reset', $2, now() + interval '30 minutes')", [user.rows[0]?.id, hash]);
  });
  const replacement = "ReplacementPassword456";
  await signIn(page, email);
  await expect(page).toHaveURL(/\/app\/workspaces\/new$/);
  await page.waitForLoadState("load");
  await page.goto(`/reset-password?token=${rawToken}`);
  await page.getByLabel("New password").fill(replacement);
  await page.getByRole("button", { name: "Reset password" }).click();
  await expect(page.getByRole("status")).toContainText("Password reset");
  await page.goto("/app");
  await expect(page).toHaveURL(/\/login$/);
  await signIn(page, email, password);
  await expect(authenticationError(page)).toContainText("incorrect");
  await signIn(page, email, replacement);
  await expect(page).toHaveURL(/\/app\/workspaces\/new$/);
  const state = await withDatabase((client) => client.query("select auth_version, password_changed_at is not null as changed from users where email = $1", [email]));
  expect(state.rows[0]).toMatchObject({ auth_version: 1, changed: true });
});

test("password reset never bypasses pending approval", async ({ page, request }) => {
  const email = `pending-reset-${randomUUID()}@example.test`;
  expect((await register(request, email)).status()).toBe(202);
  const rawToken = Buffer.from(randomUUID().replaceAll("-", "").padEnd(32, "0")).toString("base64url").slice(0, 43).padEnd(43, "c");
  const hash = createHash("sha256").update(rawToken).digest("hex");
  await withDatabase(async (client) => {
    const user = await client.query<{ id: string }>("select id from users where email = $1", [email]);
    await client.query("insert into auth_action_tokens (user_id, purpose, token_hash, expires_at) values ($1, 'password_reset', $2, now() + interval '30 minutes')", [user.rows[0]?.id, hash]);
  });
  await page.goto(`/reset-password?token=${rawToken}`);
  await page.getByLabel("New password").fill("ReplacementPassword456");
  await page.getByRole("button", { name: "Reset password" }).click();
  await expect(page.getByRole("status")).toContainText("Password reset");
  await signIn(page, email, "ReplacementPassword456");
  await expect(authenticationError(page)).toContainText("incorrect");
  const state = await withDatabase((client) => client.query("select account_status from users where email = $1", [email]));
  expect(state.rows[0]).toMatchObject({ account_status: "pending" });
});

test("an authenticated user cannot open another workspace company", async ({ page, request }) => {
  const email = `tenant-${randomUUID()}@example.test`;
  expect((await register(request, email)).status()).toBe(202);
  await approveAndVerify(email);
  const betaCompanyId = await withDatabase(async (client) => {
    const user = await client.query<{ id: string }>("select id from users where email = $1", [email]);
    const alpha = await client.query<{ id: string }>("insert into workspaces (name, slug) values ($1, $2) returning id", ["Alpha E2E", `alpha-${randomUUID()}`]);
    const beta = await client.query<{ id: string }>("insert into workspaces (name, slug) values ($1, $2) returning id", ["Beta E2E", `beta-${randomUUID()}`]);
    await client.query("insert into workspace_members (workspace_id, user_id, role, status, joined_at) values ($1, $2, 'owner', 'active', now())", [alpha.rows[0]?.id, user.rows[0]?.id]);
    const company = await client.query<{ id: string }>("insert into companies (workspace_id, name, dedupe_key) values ($1, 'Beta Secret', $2) returning id", [beta.rows[0]?.id, `beta-secret-${randomUUID()}`]);
    return company.rows[0]!.id;
  });
  await signIn(page, email);
  await expect(page).toHaveURL(/\/app/);
  await page.goto(`/app/companies/${betaCompanyId}`);
  await expect(page.getByRole("heading", { name: "This workspace resource could not be found." })).toBeVisible();
  await expect(page.getByText("Beta Secret")).toHaveCount(0);
});
