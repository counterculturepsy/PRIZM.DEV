import { randomBytes, randomUUID } from "node:crypto";
import pg from "pg";

/** Generated once per Playwright run by playwright.config.ts. It is never a committed constant. */
export function newRunPassword(): string {
  return `${randomBytes(24).toString("base64url")}aA1`;
}

export function e2ePassword(): string {
  const value = process.env.E2E_RUN_PASSWORD;
  if (!value || value.length < 24) throw new Error("E2E_RUN_PASSWORD is created by playwright.config.ts; run these tests through Playwright.");
  return value;
}

const FIXTURE_SUFFIX = "@example.test";
const createdEmails = new Set<string>();

/** Every fixture account is created through here so the spec's afterAll can remove exactly what it made. */
export function fixtureEmail(prefix: string): string {
  const email = `${prefix}-${randomUUID()}${FIXTURE_SUFFIX}`;
  createdEmails.add(email);
  return email;
}

export function createdFixtureEmails(): readonly string[] {
  return [...createdEmails];
}

const createdWorkspaceIds = new Set<string>();

/** For workspaces a test inserts directly, including ones with no member that membership-based cleanup cannot find. */
export function trackFixtureWorkspace(id: string): string {
  createdWorkspaceIds.add(id);
  return id;
}

export function createdFixtureWorkspaceIds(): readonly string[] {
  return [...createdWorkspaceIds];
}

export async function withE2eDatabase<T>(run: (client: pg.Client) => Promise<T>): Promise<T> {
  const databaseUrl = process.env.E2E_DATABASE_URL;
  if (!databaseUrl) throw new Error("E2E_DATABASE_URL is required.");
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try { return await run(client); } finally { await client.end(); }
}

/**
 * Removes only the fixture users named in `emails` (and only @example.test ones), the workspaces that
 * every member of which is one of those users, and the audit rows that would otherwise block deletion.
 */
export async function cleanupFixtureUsers(client: pg.Client, emails: readonly string[], workspaceIds: readonly string[] = []): Promise<number> {
  const users = emails.length === 0 ? [] : (await client.query<{ id: string }>(
    "select id from users where email = any($1::text[]) and email ilike '%@example.test'",
    [emails],
  )).rows.map((row) => row.id);
  const owned = users.length === 0 ? [] : (await client.query<{ id: string }>(
    `select distinct m.workspace_id as id from workspace_members m
      where m.user_id = any($1::uuid[])
        and not exists (select 1 from workspace_members o where o.workspace_id = m.workspace_id and o.user_id <> all($1::uuid[]))`,
    [users],
  )).rows.map((row) => row.id);
  // Explicitly tracked workspaces were inserted by the test itself, so they are safe to remove even without members.
  const workspaces = [...new Set([...owned, ...workspaceIds])];
  if (users.length === 0 && workspaces.length === 0) return 0;
  for (const workspaceId of workspaces) {
    await client.query("delete from audit_logs where workspace_id = $1", [workspaceId]);
    await client.query("delete from workspaces where id = $1", [workspaceId]);
  }
  if (users.length === 0) return 0;
  await client.query("delete from account_approval_audits where actor_user_id = any($1::uuid[]) or target_user_id = any($1::uuid[])", [users]);
  const deleted = await client.query("delete from users where id = any($1::uuid[])", [users]);
  return deleted.rowCount ?? 0;
}
