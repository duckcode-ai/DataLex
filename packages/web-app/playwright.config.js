/* Playwright config for the DataLex web-app E2E suite.
 *
 * Tests drive the real user journey — clone jaffle-shop from GitHub,
 * import it via the dbt dialog, rename an entity, edit a field, verify
 * autosave + auto-commit + apply-to-warehouse dry run. A global-setup
 * clones jaffle-shop once into `test-results/jaffle-shop` and reuses
 * that checkout across tests so we don't pound GitHub on every run.
 *
 * Both the api-server (port 3006) and the Vite dev server (port 5173)
 * are started by Playwright's `webServer` block. The Vite proxy at
 * `/api -> localhost:3006` matches what developers use locally.
 */
import { defineConfig, devices } from "@playwright/test";

const CI = !!process.env.CI;
// Opt-out for fully offline environments — set OFFLINE=1 to skip.
const SKIP = process.env.OFFLINE === "1";

export default defineConfig({
  testDir: "./e2e",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  // E2E setup + state (repo cache) is shared; run specs serially.
  fullyParallel: false,
  workers: 1,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  reporter: CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  globalSetup: SKIP ? undefined : "./e2e/global-setup.js",
  use: {
    baseURL: "http://localhost:5173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: CI ? "retain-on-failure" : "off",
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: [
    {
      command: "node index.js",
      cwd: "../api-server",
      port: 3006,
      reuseExistingServer: !CI,
      timeout: 60_000,
      env: {
        // Enable the "Apply to warehouse" endpoint so the dry-run test
        // doesn't hit the 403 gate. Safe for tests — we only run the
        // DuckDB dialect against a throwaway project.
        DM_ENABLE_DIRECT_APPLY: "1",
      },
    },
    {
      command: "npm run dev",
      port: 5173,
      reuseExistingServer: !CI,
      timeout: 60_000,
    },
  ],
});
