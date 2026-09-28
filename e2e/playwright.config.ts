import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests against the real stack: the API with its Postgres and
 * Redis, and the PWA — no mocks. Locally, start them as usual (see README)
 * and run `npm test` here. In CI, E2E_START_SERVERS=true makes Playwright
 * start both dev servers itself.
 */
const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:5173";
const apiHealthURL = process.env.E2E_API_HEALTH_URL ?? "http://localhost:4000/api/health";
const startServers = process.env.E2E_START_SERVERS === "true";
// e.g. "chrome" to use an installed Google Chrome instead of Playwright's Chromium.
const channel = process.env.E2E_BROWSER_CHANNEL;

export default defineConfig({
  testDir: "./tests",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  // One flow, run once: a retry would hide a flaky step rather than fix it.
  retries: 0,
  workers: 1,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], ...(channel ? { channel } : {}) } }],
  webServer: startServers
    ? [
        { command: "npm run dev", cwd: "../server", url: apiHealthURL, timeout: 120_000, reuseExistingServer: false },
        { command: "npm run dev", cwd: "../client", url: baseURL, timeout: 120_000, reuseExistingServer: false },
      ]
    : undefined,
});
