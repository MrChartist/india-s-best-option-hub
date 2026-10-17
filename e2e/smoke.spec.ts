import { expect, test, type ConsoleMessage, type Page } from "@playwright/test";
import { ROUTES, staticPaths } from "../src/lib/routes";

/**
 * Smoke test: every page renders a visible heading with no console errors and
 * no uncaught exceptions, with the data proxy unreachable (sample-data mode).
 */

/** Every route the roadmap promises. The registry must contain all of them. */
const REQUIRED_PATHS = [
  "/",
  "/option-chain",
  "/oi-analysis",
  "/watchlist",
  "/strategy-builder",
  "/position-tracker",
  "/broker-settings",
  "/optimizer",
  "/volatility",
  "/gex",
  "/max-pain-pcr",
  "/flow",
  "/screener",
  "/participants",
  "/expiry-day",
  "/calculators",
  "/paper-trading",
  "/learn",
  "/straddles",
  "/futures",
  "/backtest",
  "/journal",
  "/alerts",
  "/events",
  "/ecosystem",
];

/** Browser noise caused by the proxy being offline. Anything else fails the test. */
const NETWORK_NOISE = [
  /Failed to load resource/i,
  /net::ERR_/i,
  /ERR_CONNECTION_REFUSED/i,
  /WebSocket connection to .* failed/i,
  /fonts\.(googleapis|gstatic)\.com/i,
];

const PROXY_URL_PATTERN = /^https?:\/\/(localhost|127\.0\.0\.1):(4002|4999)\//;
const PROXY_WS_PATTERN = /^wss?:\/\/(localhost|127\.0\.0\.1):(4002|4999)\//;

interface Collected {
  errors: string[];
}

async function preparePage(page: Page): Promise<Collected> {
  const collected: Collected = { errors: [] };

  page.on("console", (msg: ConsoleMessage) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    const where = msg.location()?.url ?? "";
    if (NETWORK_NOISE.some((re) => re.test(text) || re.test(where))) return;
    collected.errors.push(`console.error: ${text}${where ? ` (${where})` : ""}`);
  });
  page.on("pageerror", (err) => {
    collected.errors.push(`uncaught: ${err.name}: ${err.message}`);
  });

  // Behave as if the proxy is not running: HTTP is refused, the WebSocket opens but stays silent.
  await page.route(PROXY_URL_PATTERN, (route) => route.abort("connectionrefused"));
  await page.routeWebSocket(PROXY_WS_PATTERN, () => {
    /* mocked socket: never connects upstream, never sends */
  });

  return collected;
}

test.describe("route registry", () => {
  test("contains every roadmap page", () => {
    const registered = new Set(staticPaths());
    const missing = REQUIRED_PATHS.filter((p) => !registered.has(p));
    expect(missing, "routes missing from src/lib/routes.ts").toEqual([]);
  });
});

test.describe("page smoke", () => {
  for (const path of staticPaths()) {
    const route = ROUTES.find((r) => r.path === path);
    test(`${path} renders a heading without errors`, async ({ page }) => {
      const collected = await preparePage(page);
      await page.goto(path, { waitUntil: "domcontentloaded" });

      const heading = page.locator("#main h1").first();
      await expect(heading, `${route?.title ?? path}: expected a visible <h1> inside #main`).toBeVisible();
      // An unwired route falls through to the 404 page, which also has an h1.
      await expect(heading, `${path} is not wired in App.tsx`).not.toHaveText("Page not found");

      // Let lazy chunks, queries and effects settle so late errors are caught.
      await page.waitForLoadState("load");
      await page.waitForTimeout(750);

      await expect(page.getByText("Something went wrong on this page.")).toHaveCount(0);
      expect(collected.errors, `console errors on ${path}`).toEqual([]);
      await expect(page).toHaveTitle(/Mr\. Chartist/);
    });
  }
});

test.describe("404 page", () => {
  test("suggests the closest route for a typo", async ({ page }) => {
    const collected = await preparePage(page);
    await page.goto("/option-chian", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
    const firstSuggestion = page.locator("#main").getByRole("list").getByRole("link").first();
    await expect(firstSuggestion).toHaveAttribute("href", "/option-chain");
    await expect(page).toHaveTitle(/Page not found · Option Hub by Mr\. Chartist/);
    expect(collected.errors).toEqual([]);
  });
});

test.describe("keyboard navigation", () => {
  test("g then c opens the option chain", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === "mobile", "Keyboard shortcuts are a desktop feature");
    await preparePage(page);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#main h1").first()).toBeVisible();
    await page.locator("body").click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("g");
    await page.keyboard.press("c");
    await expect(page).toHaveURL(/\/option-chain$/);
  });
});
