import { defineConfig, devices } from "@playwright/test";

const port = 3100;
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./tests",
  // Only *.spec.js is Playwright; *.test.js files use the Node test runner.
  testMatch: "**/*.spec.js",
  globalSetup: "./tests/global-setup.js",
  fullyParallel: false,
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    browserName: "chromium",
    channel: process.env.PW_CHANNEL,
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node server.js",
    url: `${baseURL}/api/health`,
    reuseExistingServer: false,
    timeout: 20_000,
    env: {
      PORT: String(port),
      DATA_DIR: ".tmp/smokebomb-data",
      OPENAI_API_KEY: "",
      ADMIN_TOKEN: "playwright-admin-token-0123456789",
      // The suite runs 4 viewport projects sequentially against one server from
      // a single IP; raise rate limits so the shared in-memory limiter doesn't
      // throttle later projects. (Rate limiting itself is verified separately.)
      RATE_LIMIT_MAX: "100000",
      CHAT_RATE_LIMIT_MAX: "100000",
    },
  },
  projects: [
    {
      name: "desktop-1440",
      use: { viewport: { width: 1440, height: 900 } },
    },
    {
      name: "laptop-1280",
      use: { viewport: { width: 1280, height: 720 } },
    },
    {
      name: "tablet-768",
      use: {
        ...devices["iPad (gen 7)"],
        browserName: "chromium",
        viewport: { width: 768, height: 1024 },
      },
    },
    {
      name: "mobile-390",
      use: {
        ...devices["Pixel 5"],
        browserName: "chromium",
        viewport: { width: 390, height: 844 },
      },
    },
  ],
});
