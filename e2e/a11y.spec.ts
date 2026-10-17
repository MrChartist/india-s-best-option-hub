import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { ROUTES, staticPaths } from "../src/lib/routes";

/**
 * Accessibility sweep: every static route × light/dark, in sample-data mode with the
 * proxy unreachable. Fails on axe "critical" or "serious" violations for WCAG 2.0 A/AA
 * and WCAG 2.2 AA. Needs the dev dependency @axe-core/playwright.
 *
 *   npx playwright test e2e/a11y.spec.ts --project=desktop
 */

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const BLOCKING = new Set(["critical", "serious"]);

/**
 * Known items that are reviewed and accepted. Keep each entry narrow (rule + selector
 * fragment) and say why, so the list shrinks rather than grows.
 */
const ALLOW_LIST: Array<{ rule: string; target?: RegExp; reason: string }> = [
  // Recharts draws decorative SVG text (axis ticks) with colours that axe cannot resolve
  // through CSS variables on SVG presentation attributes; the chart wrappers expose an
  // aria-label and a data table/summary instead.
  { rule: "color-contrast", target: /recharts/, reason: "SVG chart ticks, summarised elsewhere" },
  // Recharts 2.x hard-codes role="img" with no accessible name on every <Scatter> point
  // (cartesian/Scatter.js); the charts carry an aria-label and a text summary.
  { rule: "svg-img-alt", target: /recharts-scatter-symbol/, reason: "Recharts scatter points, chart labelled at wrapper" },
  // Sonner mounts an empty live region list when no toast is showing.
  { rule: "list", target: /\[data-sonner-toaster\]/, reason: "empty toast container" },
];

const PROXY_URL_PATTERN = /^https?:\/\/(localhost|127\.0\.0\.1):(4002|4999)\//;
const PROXY_WS_PATTERN = /^wss?:\/\/(localhost|127\.0\.0\.1):(4002|4999)\//;

async function prepare(page: Page, theme: "light" | "dark") {
  await page.route(PROXY_URL_PATTERN, (route) => route.abort("connectionrefused"));
  await page.routeWebSocket(PROXY_WS_PATTERN, () => {
    /* silent mock socket */
  });
  await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
  await page.addInitScript((t) => {
    try {
      window.localStorage.setItem("theme", t);
    } catch {
      /* storage blocked: colour scheme emulation still applies */
    }
  }, theme);
}

function isAllowed(rule: string, target: string): boolean {
  return ALLOW_LIST.some((a) => a.rule === rule && (!a.target || a.target.test(target)));
}

for (const theme of ["light", "dark"] as const) {
  test.describe(`a11y (${theme})`, () => {
    for (const path of staticPaths()) {
      const route = ROUTES.find((r) => r.path === path);
      test(`${path} has no serious WCAG violations`, async ({ page }) => {
        await prepare(page, theme);
        await page.goto(path, { waitUntil: "domcontentloaded" });
        await expect(page.locator("#main h1").first()).toBeVisible();
        await page.waitForLoadState("load");
        await page.waitForTimeout(600);

        const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();

        const blocking = results.violations
          .filter((v) => v.impact && BLOCKING.has(v.impact))
          .flatMap((v) =>
            v.nodes
              .map((n) => ({ rule: v.id, impact: v.impact, target: n.target.join(" "), summary: n.failureSummary ?? "" }))
              .filter((n) => !isAllowed(n.rule, n.target)),
          );

        const report = blocking
          .slice(0, 25)
          .map((b) => `[${b.impact}] ${b.rule} → ${b.target}\n    ${b.summary.replace(/\n/g, "\n    ")}`)
          .join("\n");
        expect(blocking, `${route?.title ?? path} (${theme}):\n${report}`).toEqual([]);
      });
    }
  });
}
