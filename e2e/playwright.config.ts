import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  outputDir: "./artifacts/test-results",
  reporter: process.env.CI
    ? [["html", { outputFolder: "./artifacts/html-report", open: "never" }], ["list"]]
    : [["list"]],
  webServer: {
    command:
      "corepack pnpm --filter @brandblitz/config build && corepack pnpm --filter @brandblitz/web dev",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 120_000,
  },
  use: {
    baseURL: process.env.PLAYWRIGHT_TEST_BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
    video: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});
