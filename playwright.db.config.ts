// Browser tests that need a database (#122): admin pages and flows that only
// exist with the PostgreSQL catalog. e2e-db/serve.ts creates a disposable
// database on the server in TEST_DATABASE_URL, loads demo and fictional data,
// starts the production build against it and drops the database on exit.
import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.E2E_DB_PORT ?? 3101);
const baseURL = `http://localhost:${port}`;

export default defineConfig({
  testDir: "e2e-db",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    locale: "bg-BG",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: `node --import tsx e2e-db/serve.ts ${port}`,
    url: `${baseURL}/api/health`,
    timeout: 300_000,
    // Always its own server: the fixtures belong to the database it created.
    reuseExistingServer: false,
    // Lets serve.ts stop the app and drop the database.
    gracefulShutdown: { signal: "SIGTERM", timeout: 20_000 },
    env: { NEXT_TELEMETRY_DISABLED: "1" },
  },
});
