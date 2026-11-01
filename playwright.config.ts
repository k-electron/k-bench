import { defineConfig, devices } from "@playwright/test";

/**
 * Seam 2: the browser. Each test boots its own isolated server in-process (see
 * `e2e/harness.ts`) and serves the production build from `dist/web`, which
 * `e2e/global-setup.ts` builds once per run.
 */
export default defineConfig({
  testDir: "e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: [["list"]],
  timeout: 30_000,
  expect: { timeout: 10_000 },
  outputDir: "test-results",
  projects: [
    // Later tickets add a phone project here.
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
    },
  ],
});
