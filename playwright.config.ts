import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.PLAYWRIGHT_PORT ?? 3100);
const e2eDatabaseUrl = process.env.E2E_DATABASE_URL;

if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error("PLAYWRIGHT_PORT must be a valid TCP port.");
}
if (!e2eDatabaseUrl) throw new Error("E2E_DATABASE_URL must identify the isolated local test database.");
const parsedDatabaseUrl = new URL(e2eDatabaseUrl);
if (!["127.0.0.1", "localhost"].includes(parsedDatabaseUrl.hostname) || parsedDatabaseUrl.pathname !== "/prizm_e2e") {
  throw new Error("E2E_DATABASE_URL must identify the isolated loopback prizm_e2e database.");
}

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
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
