import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * Broker Settings directory: all 33 brokers, search/filter, capability matrix and the Connect cards,
 * with no horizontal page scroll (the matrix scrolls inside its own frame) at desktop and 375 px.
 */
const PROXY_URL_PATTERN = /^https?:\/\/(localhost|127\.0\.0\.1):(4002|4999)\//;

test.beforeEach(async ({ page }) => {
  await page.route(PROXY_URL_PATTERN, (route) => route.abort("connectionrefused"));
  await page.goto("/broker-settings", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: /all brokers \(33\)/i })).toBeVisible();
});

test("search and filters narrow the capability matrix", async ({ page }) => {
  const status = page.getByRole("status").filter({ hasText: /Showing \d+ of 33 brokers/ });
  await expect(status).toHaveText("Showing 33 of 33 brokers");
  const matrix = page.getByRole("table").filter({ has: page.getByRole("columnheader", { name: "Live feed" }) });
  await expect(matrix.getByRole("row")).toHaveCount(34);

  await page.locator("#broker-search").fill("zerodha");
  await expect(status).toHaveText("Showing 1 of 33 brokers");
  await expect(matrix.getByRole("row").nth(1)).toContainText("Zerodha (Kite)");
  await expect(matrix.getByRole("row").nth(1)).toContainText("Blocked");

  await page.getByRole("button", { name: "Clear", exact: true }).click();
  await page.locator("#broker-auth").selectOption("sessionLogin");
  await expect(status).not.toHaveText("Showing 33 of 33 brokers");

  const hasHorizontalScroll = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(hasHorizontalScroll, "page must not scroll sideways").toBe(false);
});

test("a broker opens as a card with its beta note and sign-in method", async ({ page }) => {
  await page.getByRole("button", { name: "Kotak Securities (Neo)" }).click();
  const card = page.locator("#broker-card-kotak");
  await expect(card).toBeVisible();
  await expect(card.getByText(/beta: not yet verified with a live account/i)).toBeVisible();
  await expect(card.getByText(/session login\./i)).toBeVisible();
  const hasHorizontalScroll = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(hasHorizontalScroll, "page must not scroll sideways").toBe(false);
});

test("the directory has no serious accessibility violations", async ({ page }) => {
  const results = await new AxeBuilder({ page }).include("#broker-directory-title").include("section[aria-labelledby='broker-directory-title']").withTags(["wcag2a", "wcag2aa", "wcag22aa"]).analyze();
  const serious = results.violations.filter((v) => v.impact === "critical" || v.impact === "serious");
  expect(serious.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
});
