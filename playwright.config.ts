import { defineConfig, devices } from "@playwright/test";
import { newRunPassword } from "./tests/e2e/support";

const port = Number(process.env.PLAYWRIGHT_PORT ?? 3100);
const e2eDatabaseUrl = process.env.E2E_DATABASE_URL;

if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error("PLAYWRIGHT_PORT must be a valid TCP port.");
}
if (!e2eDatabaseUrl) throw new Error("E2E_DATABASE_URL must identify the isolated local test database.");
const parsedDatabaseUrl = new URL(e2eDatabaseUrl);
const loopbackDatabase = ["127.0.0.1", "localhost", "[::1]"].includes(parsedDatabaseUrl.hostname);
// A non-loopback database must be named exactly in an allowlist variable; a boolean flag or a hostname suffix is not enough.
const allowlistedDisposableHost = Boolean(process.env.E2E_DISPOSABLE_DATABASE_HOST)
  && parsedDatabaseUrl.hostname === process.env.E2E_DISPOSABLE_DATABASE_HOST;
if (!["postgres:", "postgresql:"].includes(parsedDatabaseUrl.protocol)
  || (!loopbackDatabase && !allowlistedDisposableHost)
  || parsedDatabaseUrl.pathname !== "/prizm_e2e") {
  throw new Error("E2E_DATABASE_URL must identify prizm_e2e on loopback, or on the exact host named in E2E_DISPOSABLE_DATABASE_HOST. global-setup also refuses any database that holds non-fixture users.");
}
// A fresh credential per run: workers inherit it through the environment, and nothing is committed.
process.env.E2E_RUN_PASSWORD ??= newRunPassword();

export default defineConfig({
  testDir: "./tests/e2e",
  // The stateful journeys do real server work (approvals, PDF rendering, uploads); the 5 s default is too tight when projects run in parallel.
  expect: { timeout: 15_000 },
  globalSetup: "./tests/e2e/global-setup.ts",
  fullyParallel: true,
  // Locally, half the CPU count means 10 browsers beside the app and database; that exhausts memory and makes timing tests flaky.
  ...(process.env.CI ? {} : { workers: 4 }),
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL: `http://127.0.0.1:${port}`, trace: "on-first-retry" },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-chromium", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: `pnpm start --port ${port}`,
    url: `http://127.0.0.1:${port}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      NEXTAUTH_URL: `http://127.0.0.1:${port}`,
      AUTH_SECRET: "e2e-only-secret-that-is-at-least-32-characters",
      DATABASE_URL: e2eDatabaseUrl,
      PASSWORD_AUTH_ENABLED: "true",
      DEV_AUTH_BYPASS: "false",
    },
  },
});
