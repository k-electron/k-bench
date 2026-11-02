import { defineConfig, devices } from "@playwright/test";

/**
 * `pnpm screenshots`: not part of any test run. It reuses the e2e harness (an isolated
 * instance per test, the production build, the tmux socket leak check) to take the images
 * the README and guide show. See `scripts/screenshots/`.
 */
export default defineConfig({
  testDir: "scripts/screenshots",
  testMatch: /\.shots\.ts$/,
  globalSetup: "./scripts/screenshots/global-setup.ts",
  // One browser at a time: the images should not depend on how busy the machine is.
  workers: 1,
  reporter: [["list"]],
  timeout: 60_000,
  expect: { timeout: 15_000 },
  outputDir: "test-results/screenshots",
  projects: [
    {
      name: "desktop",
      testIgnore: /phone\.shots\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 640 },
        deviceScaleFactor: 2,
      },
    },
    {
      name: "phone",
      testMatch: /phone\.shots\.ts/,
      use: { ...devices["Pixel 7"] },
    },
  ],
});
