import pg from "pg";

/**
 * Last line of defence for the E2E database: the suite creates, promotes and deletes accounts, so it must
 * never run against a database that holds anyone other than @example.test fixtures. Nothing is printed
 * about the offending rows.
 */
export default async function globalSetup(): Promise<() => Promise<void>> {
  const databaseUrl = process.env.E2E_DATABASE_URL;
  if (!databaseUrl) throw new Error("E2E_DATABASE_URL is required.");
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const database = await client.query<{ name: string }>("select current_database() as name");
    if (database.rows[0]?.name !== "prizm_e2e") throw new Error("E2E_DATABASE_REFUSED: the connected database is not prizm_e2e.");
    const users = await client.query<{ real: string }>("select count(*)::text as real from users where email not ilike '%@example.test'");
    const real = Number(users.rows[0]?.real ?? "0");
    if (real !== 0) throw new Error(`E2E_DATABASE_REFUSED: the database holds ${real} non-fixture user(s); E2E tests only run on disposable databases.`);
    // Safe only because the guards above passed: counters and security events left by earlier runs must not influence this one.
    await clearRunResidue(client);
  } finally {
    await client.end();
  }
  // Teardown: the same tables are cleared again so a finished run leaves the disposable database empty.
  return async () => {
    const cleanup = new pg.Client({ connectionString: databaseUrl });
    await cleanup.connect();
    try { await clearRunResidue(cleanup); } finally { await cleanup.end(); }
  };
}

/** Rate-limit counters and security events hold only hashed identifiers, but they accumulate across runs. */
async function clearRunResidue(client: pg.Client): Promise<void> {
  await client.query("delete from auth_rate_limit_windows");
  await client.query("delete from auth_security_events");
}
