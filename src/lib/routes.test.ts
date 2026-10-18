import { describe, expect, it } from "vitest";
import {
  editDistance,
  hasPage,
  missingPages,
  pageLoader,
  findRoute,
  LEGACY_REDIRECTS,
  matchPath,
  normalizePathname,
  ROUTE_GROUPS,
  ROUTES,
  routeForShortcut,
  routeTitle,
  routesByGroup,
  staticPaths,
  suggestRoutes,
} from "./routes";

describe("ROUTES registry", () => {
  it("has unique paths, nav labels and shortcuts", () => {
    const paths = ROUTES.map((r) => r.path);
    expect(new Set(paths).size).toBe(paths.length);
    const shortcuts = ROUTES.map((r) => r.shortcut).filter(Boolean);
    expect(new Set(shortcuts).size).toBe(shortcuts.length);
    const labels = ROUTES.filter((r) => !r.hidden).map((r) => r.navLabel);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("covers every existing and planned page", () => {
    const expected = [
      "/", "/option-chain", "/oi-analysis", "/watchlist", "/strategy-builder", "/position-tracker", "/broker-settings",
      "/optimizer", "/volatility", "/gex", "/max-pain-pcr", "/flow", "/screener", "/participants", "/expiry-day",
      "/calculators", "/paper-trading", "/learn", "/learn/:slug",
      "/straddles", "/contract/:symbol/:expiry/:strike/:type", "/futures", "/backtest", "/journal", "/alerts", "/events",
      "/ecosystem",
      "/one-cliq", "/orders",
    ];
    expect(ROUTES.map((r) => r.path).sort()).toEqual([...expected].sort());
  });

  it("uses only known groups, PascalCase icons and g-letter shortcuts", () => {
    for (const r of ROUTES) {
      expect(ROUTE_GROUPS).toContain(r.group);
      expect(r.icon).toMatch(/^[A-Z][A-Za-z0-9]+$/);
      if (r.shortcut) expect(r.shortcut).toMatch(/^g [a-z]$/);
      expect(typeof r.lazy).toBe("function");
      expect(r.keywords.length).toBeGreaterThan(0);
    }
  });

  it("binds the documented g-sequences", () => {
    const map = Object.fromEntries(ROUTES.filter((r) => r.shortcut).map((r) => [r.shortcut, r.path]));
    expect(map).toEqual({
      "g d": "/",
      "g c": "/option-chain",
      "g o": "/oi-analysis",
      "g s": "/strategy-builder",
      "g v": "/volatility",
      "g x": "/gex",
      "g f": "/flow",
      "g t": "/one-cliq",
      "g p": "/position-tracker",
      "g l": "/learn",
    });
  });

  it("points every legacy redirect at a real static route", () => {
    const statics = new Set(staticPaths());
    for (const target of Object.values(LEGACY_REDIRECTS)) expect(statics.has(target)).toBe(true);
  });
});

describe("path helpers", () => {
  it("normalises pathnames", () => {
    expect(normalizePathname("")).toBe("/");
    expect(normalizePathname("/")).toBe("/");
    expect(normalizePathname("/Option-Chain/")).toBe("/option-chain");
    expect(normalizePathname("option-chain?x=1#y")).toBe("/option-chain");
  });

  it("matches params", () => {
    expect(matchPath("/learn/:slug", "/learn/what-is-delta")).toEqual({ slug: "what-is-delta" });
    expect(matchPath("/learn/:slug", "/learn")).toBeNull();
    expect(matchPath("/", "/")).toEqual({});
    expect(matchPath("/gex", "/gexx")).toBeNull();
  });

  it("finds routes and titles", () => {
    expect(findRoute("/learn")?.path).toBe("/learn");
    expect(findRoute("/learn/iv-crush")?.path).toBe("/learn/:slug");
    expect(routeTitle("/option-chain/")).toBe("Option Chain");
    expect(routeTitle("/")).toBe("Dashboard");
    expect(routeTitle("/does-not-exist")).toBe("Page not found");
  });

  it("groups visible routes in order and hides detail routes", () => {
    const groups = routesByGroup();
    expect(groups.map((g) => g.group)).toEqual(ROUTE_GROUPS.filter((g) => groups.some((x) => x.group === g)));
    expect(groups.flatMap((g) => g.routes).some((r) => r.path.includes(":"))).toBe(false);
  });

  it("resolves shortcuts case-insensitively", () => {
    expect(routeForShortcut("c")?.path).toBe("/option-chain");
    expect(routeForShortcut("C")?.path).toBe("/option-chain");
    expect(routeForShortcut("z")).toBeUndefined();
  });
});

describe("suggestions", () => {
  it("computes edit distance", () => {
    expect(editDistance("", "abc")).toBe(3);
    expect(editDistance("kitten", "sitting")).toBe(3);
    expect(editDistance("gex", "gex")).toBe(0);
  });

  it.each([
    ["/optionchain", "/option-chain"],
    ["/option-chian", "/option-chain"],
    ["/strategy", "/strategy-builder"],
    ["/greeks", "/option-chain"],
    ["/volatilty", "/volatility"],
    ["/calculator", "/calculators"],
    ["/paper-trade", "/paper-trading"],
    ["/fii", "/participants"],
    ["/maxpain", "/max-pain-pcr"],
    ["/watch-list", "/watchlist"],
  ])("suggests %s → %s first", (input, expected) => {
    expect(suggestRoutes(input)[0]?.path).toBe(expected);
  });

  it("returns nothing for nonsense and respects the limit", () => {
    expect(suggestRoutes("/qqqqzzzzxxxx")).toEqual([]);
    expect(suggestRoutes("/option", { limit: 1 })).toHaveLength(1);
  });

  it("never suggests hidden routes", () => {
    expect(suggestRoutes("/lesson").some((r) => r.hidden)).toBe(false);
  });
});

describe("page loaders", () => {
  it("finds the pages that exist today", () => {
    for (const name of ["Index", "OptionChain", "OIAnalysis", "Watchlist", "StrategyBuilder", "PositionTracker", "BrokerSettings", "NotFound"]) {
      expect(hasPage(name)).toBe(true);
    }
  });

  it("names a page file for every route", () => {
    for (const r of ROUTES) expect(r.page).toMatch(/^[A-Z][A-Za-z0-9]+$/);
  });

  it("rejects with a clear message for a missing page", async () => {
    expect(hasPage("DefinitelyNotAPage")).toBe(false);
    await expect(pageLoader("DefinitelyNotAPage")()).rejects.toThrow("src/pages/DefinitelyNotAPage.tsx is missing");
  });

  it("reports missing pages against a custom list", () => {
    const fake = { ...ROUTES[0], page: "DefinitelyNotAPage" };
    expect(missingPages([ROUTES[0], fake])).toEqual([fake]);
  });
});
