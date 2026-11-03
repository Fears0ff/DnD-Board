import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";

const systemChromium = ["/usr/bin/chromium", "/usr/bin/chromium-browser"].find((path) =>
  existsSync(path),
);

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: "list",
  use: {
    baseURL: process.env.E2E_BASE_URL,
    headless: true,
    viewport: { width: 1440, height: 900 },
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ?? systemChromium,
      args: ["--no-sandbox"],
    },
    screenshot: "only-on-failure",
  },
});
