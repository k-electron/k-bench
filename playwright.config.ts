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
    // A spec runs on the desktop project, except `phone.spec.ts`, which runs only on the
    // phone project (a touch device narrower than the layout breakpoint), and
    // `smart-typing.spec.ts`, which runs only on the iPhone project.
    {
      name: "desktop",
      testIgnore: /(phone|smart-typing)\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
    },
    {
      name: "phone",
      testMatch: /phone\.spec\.ts/,
      use: { ...devices["Pixel 7"] },
    },
    // An iPhone, on WebKit: Smart typing is offered only there (see `web/src/mirroredField.ts`).
    {
      name: "iphone",
      testMatch: /smart-typing\.spec\.ts/,
      use: { ...devices["iPhone 15"] },
    },
  ],
});
