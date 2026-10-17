import { defineConfig, devices } from "@playwright/test";

/**
 * Smoke tests run against a production build served by `vite preview`, in
 * sample-data mode with the proxy unreachable (requests are refused in the
 * spec), which is exactly what a first-time user without API keys sees.
 *
 *   npm run test:e2e             # builds, serves on :4173, runs Chromium (desktop + 375px)
 *   E2E_BASE_URL=http://localhost:4001 npm run test:e2e   # against a running app, no build
 */
const PORT = Number(process.env.E2E_PORT ?? 4173);
const externalBaseUrl = process.env.E2E_BASE_URL;
const baseURL = externalBaseUrl ?? `http://127.0.0.1:${PORT}`;
const isCI = Boolean(process.env.CI);

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./test-results",
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  workers: isCI ? 2 : undefined,
  timeout: 45_000,
  expect: { timeout: 15_000 },
  reporter: isCI ? [["github"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    timezoneId: "Asia/Kolkata",
    locale: "en-IN",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    {
      name: "mobile",
      use: { ...devices["Desktop Chrome"], viewport: { width: 375, height: 812 }, isMobile: false, hasTouch: true },
    },
  ],
  webServer: externalBaseUrl
    ? undefined
    : {
        command: `npm run build && npx vite preview --host 127.0.0.1 --port ${PORT} --strictPort`,
        url: baseURL,
        reuseExistingServer: !isCI,
        timeout: 240_000,
        stdout: "ignore",
        stderr: "pipe",
        env: {
          VITE_DATA_MODE: "sample",
          // Point the app at a proxy port nothing listens on; the spec refuses these requests anyway.
          VITE_PROXY_URL: "http://127.0.0.1:4999",
        },
      },
});
