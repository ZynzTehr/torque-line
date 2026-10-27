import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.E2E_PORT ?? 3123);
// Set E2E_BASE_URL to run against a deployed site instead of a local production build.
const remote = process.env.E2E_BASE_URL;

export default defineConfig({
  testDir: "./tests/e2e",
  outputDir: "./test-results",
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  // Uses the installed Google Chrome; set PW_CHANNEL=chromium to use Playwright's bundled build instead.
  use: { baseURL: remote ?? `http://localhost:${port}`, trace: "retain-on-failure", channel: process.env.PW_CHANNEL ?? "chrome" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], channel: process.env.PW_CHANNEL ?? "chrome", viewport: { width: 1440, height: 900 } } },
    { name: "phone", use: { ...devices["Pixel 7"], channel: process.env.PW_CHANNEL ?? "chrome" } },
  ],
  webServer: remote ? undefined : {
    command: `npm run build && npx next start -p ${port}`,
    url: `http://localhost:${port}`,
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
