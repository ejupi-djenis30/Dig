import { defineConfig } from "@playwright/test";

const isCI = Boolean(process.env.CI);

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.mjs",
  fullyParallel: false,
  forbidOnly: isCI,
  retries: 0,
  workers: 1,
  reporter: isCI ? "line" : "list",
  timeout: 15_000,
  expect: {
    timeout: 5_000,
  },
  outputDir: "test-results/playwright",
  use: {
    baseURL: "http://127.0.0.1:4175/Dig/",
    viewport: { width: 1280, height: 900 },
    colorScheme: "light",
    reducedMotion: "reduce",
    locale: "en-US",
    serviceWorkers: "block",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" },
    },
  ],
  webServer: {
    command: "node scripts/serve-site.mjs",
    url: "http://127.0.0.1:4175/Dig/",
    timeout: 10_000,
    reuseExistingServer: !isCI,
    stdout: "pipe",
    stderr: "pipe",
  },
});
