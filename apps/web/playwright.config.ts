import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env["E2E_PORT"] ?? 3000);

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env["CI"] ? 1 : 0,
  reporter: process.env["CI"] ? [["github"], ["html", { open: "never" }]] : "list",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: `http://localhost:${port}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: process.env["PW_CHROMIUM"] ? { executablePath: process.env["PW_CHROMIUM"] } : {},
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] }, testMatch: /landing\.spec\.ts/ },
  ],
  webServer: process.env["E2E_NO_SERVER"]
    ? undefined
    : { command: "pnpm start", url: `http://localhost:${port}/api/health`, reuseExistingServer: !process.env["CI"], timeout: 120_000 },
});
