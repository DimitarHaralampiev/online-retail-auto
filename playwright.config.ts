import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.E2E_PORT ?? 3100);
// E2E_BASE_URL targets an already running app; otherwise build and start one.
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${port}`;

export default defineConfig({
  testDir: "e2e",
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
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: `npm run build && npx next start -p ${port}`,
        url: baseURL,
        timeout: 240_000,
        reuseExistingServer: !process.env.CI,
        env: {
          NEXT_TELEMETRY_DISABLED: "1",
          // Deterministic, offline checkout: fictional courier offices and a
          // fixed test shipping price. No database: order creation is covered
          // by the PostgreSQL integration tests.
          COURIER_OFFICES_MODE: "demo",
          ORDERS_MODE: "test",
          TEST_SHIPPING_CENTS: "500",
          FREE_SHIPPING_ABOVE_CENTS: "3000",
          DATABASE_URL: "",
        },
      },
});
