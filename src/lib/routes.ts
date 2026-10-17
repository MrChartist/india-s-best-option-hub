/**
 * Route registry: the single source of truth for every page in the terminal.
 *
 * The sidebar, command palette, keyboard shortcuts, document titles, the 404
 * suggestions and the Playwright smoke test all read from ROUTES, so adding a
 * page means adding one entry here (plus the page file).
 *
 * Pure data and helpers only: nothing here touches the DOM, and the `lazy`
 * factories are not called until a route is rendered.
 */
import type { ComponentType } from "react";

export type RouteGroup =
  | "Markets"
  | "Chain & OI"
  | "Volatility"
  | "Positioning"
  | "Strategy"
  | "Trade"
  | "Portfolio"
  | "Learn"
  | "Settings";

export interface RouteDef {
  /** React Router path, e.g. "/option-chain" or "/learn/:slug". */
  path: string;
  /** Page title used for document.title and page headings. */
  title: string;
  /** Short label for the sidebar and command palette. */
  navLabel: string;
  group: RouteGroup;
  /** Canonical lucide-react icon name (PascalCase), e.g. "LayoutDashboard". */
  icon: string;
  /** Two-key "g then letter" sequence, written as "g c". */
  shortcut?: string;
  /** Extra search terms for the command palette and 404 suggestions. */
  keywords: string[];
  badge?: "New" | "Beta";
  /** One-line description for the command palette and 404 page. */
  description?: string;
  /** Hide from the sidebar and palette (detail routes such as /learn/:slug). */
  hidden?: boolean;
  /** Page file name in src/pages (without .tsx). */
  page: string;
  lazy: () => Promise<{ default: ComponentType }>;
}

/** Sidebar group order. */
export const ROUTE_GROUPS: readonly RouteGroup[] = [
  "Markets",
  "Chain & OI",
  "Volatility",
  "Positioning",
  "Strategy",
  "Trade",
  "Portfolio",
  "Learn",
  "Settings",
];

export const APP_NAME = "Mr. Chartist";

// ── Page loaders ──────────────────────────────────────────────────────────
//
// Pages are discovered with import.meta.glob instead of one static import()
// per route, so a page that has not been written yet makes its route fail
// softly (the error boundary shows "This page could not be loaded") instead of
// breaking the whole production build. Vite still emits one chunk per page.

type PageModule = { default?: ComponentType };
type PageLoader = () => Promise<PageModule>;

function discoverPages(): Record<string, PageLoader> {
  try {
    return import.meta.glob<PageModule>(["../pages/*.tsx", "!../pages/*.test.tsx"]);
  } catch {
    // Outside Vite (e.g. Playwright importing this file for staticPaths) there is no glob.
    return {};
  }
}

const PAGE_MODULES: Record<string, PageLoader> = discoverPages();

/** Module key for a page name, e.g. "OptionChain" → "../pages/OptionChain.tsx". */
const pageKey = (name: string) => `../pages/${name}.tsx`;

/** True when src/pages/<name>.tsx exists in this build. */
export function hasPage(name: string): boolean {
  return pageKey(name) in PAGE_MODULES;
}

/** Lazy loader for src/pages/<name>.tsx (default export). Rejects with a clear message if the file is missing. */
export function pageLoader(name: string): () => Promise<{ default: ComponentType }> {
  return async () => {
    const load = PAGE_MODULES[pageKey(name)];
    if (!load) throw new Error(`Page not built yet: src/pages/${name}.tsx is missing.`);
    const mod = await load();
    if (!mod.default) throw new Error(`src/pages/${name}.tsx has no default export.`);
    return { default: mod.default };
  };
}

export const ROUTES: RouteDef[] = [
  // ── Markets ─────────────────────────────────────────────────────────────
  {
    path: "/",
    title: "Dashboard",
    navLabel: "Dashboard",
    group: "Markets",
    icon: "LayoutDashboard",
    shortcut: "g d",
    keywords: ["home", "overview", "indices", "nifty", "banknifty", "market", "vix", "breadth"],
    description: "Indices, market breadth, VIX and the day at a glance.",
    page: "Index",
    lazy: pageLoader("Index"),
  },
  {
    path: "/watchlist",
    title: "Watchlist",
    navLabel: "Watchlist",
    group: "Markets",
    icon: "Star",
    keywords: ["favourites", "favorites", "stocks", "symbols", "tracking", "list"],
    description: "Your saved F&O symbols with live price and OI.",
    page: "Watchlist",
    lazy: pageLoader("Watchlist"),
  },
  {
    path: "/events",
    title: "Events Calendar",
    navLabel: "Events",
    group: "Markets",
    icon: "CalendarDays",
    keywords: ["events", "calendar", "results", "earnings", "rbi", "mpc", "budget", "cpi", "gdp", "fomc", "holidays", "expiry", "implied move"],
    badge: "New",
    description: "Results, RBI, Budget, CPI, FOMC, expiries and holidays, with implied vs realised results moves.",
    page: "Events",
    lazy: pageLoader("Events"),
  },

  // ── Chain & OI ──────────────────────────────────────────────────────────
  {
    path: "/option-chain",
    title: "Option Chain",
    navLabel: "Option Chain",
    group: "Chain & OI",
    icon: "TableProperties",
    shortcut: "g c",
    keywords: ["chain", "strikes", "calls", "puts", "ce", "pe", "greeks", "ltp", "iv", "oi"],
    description: "Full NSE option chain with OI, IV and Greeks.",
    page: "OptionChain",
    lazy: pageLoader("OptionChain"),
  },
  {
    path: "/oi-analysis",
    title: "OI Analysis",
    navLabel: "OI Analysis",
    group: "Chain & OI",
    icon: "ChartColumn",
    shortcut: "g o",
    keywords: ["open interest", "oi change", "buildup", "long buildup", "short covering", "support", "resistance"],
    description: "Open interest, OI change and buildup by strike.",
    page: "OIAnalysis",
    lazy: pageLoader("OIAnalysis"),
  },
  {
    path: "/max-pain-pcr",
    title: "Max Pain & PCR",
    navLabel: "Max Pain & PCR",
    group: "Chain & OI",
    icon: "Target",
    keywords: ["max pain", "pcr", "put call ratio", "oi replay", "intraday", "expiry pin"],
    badge: "New",
    description: "Max pain, put-call ratio history and intraday OI replay.",
    page: "MaxPainPCR",
    lazy: pageLoader("MaxPainPCR"),
  },
  {
    path: "/screener",
    title: "F&O Screener",
    navLabel: "F&O Screener",
    group: "Chain & OI",
    icon: "ScanSearch",
    keywords: ["scanner", "screener", "buildup", "ban list", "mwpl", "rollover", "iv", "pcr", "stocks"],
    badge: "New",
    description: "Scan F&O stocks for buildup, IV, PCR, ban list and rollover.",
    page: "Screener",
    lazy: pageLoader("Screener"),
  },
  {
    path: "/expiry-day",
    title: "Expiry Day",
    navLabel: "Expiry Day",
    group: "Chain & OI",
    icon: "Zap",
    keywords: ["0dte", "expiry", "straddle", "theta", "hero zero", "settlement", "weekly"],
    badge: "New",
    description: "Expiry-day command centre: straddle decay, OI walls, countdown.",
    page: "ExpiryDay",
    lazy: pageLoader("ExpiryDay"),
  },
  {
    path: "/straddles",
    title: "Straddles",
    navLabel: "Straddles",
    group: "Chain & OI",
    icon: "ChartSpline",
    keywords: ["straddle", "strangle", "vwap", "premium", "bhavcopy", "atm", "combined premium"],
    badge: "New",
    description: "Straddle and strangle charts for any symbol and expiry: premium with VWAP, legs, spot and daily bhavcopy.",
    page: "Straddles",
    lazy: pageLoader("Straddles"),
  },
  {
    path: "/contract/:symbol/:expiry/:strike/:type",
    title: "Contract",
    navLabel: "Contract",
    group: "Chain & OI",
    icon: "ScanSearch",
    keywords: ["contract", "option", "strike", "ltp", "oi", "iv", "greeks", "bhavcopy", "depth"],
    hidden: true,
    page: "Contract",
    lazy: pageLoader("Contract"),
  },

  // ── Volatility ──────────────────────────────────────────────────────────
  {
    path: "/volatility",
    title: "Volatility",
    navLabel: "Volatility",
    group: "Volatility",
    icon: "Waves",
    shortcut: "g v",
    keywords: ["iv", "iv rank", "ivr", "ivp", "smile", "skew", "term structure", "vol cone", "expected move", "hv"],
    badge: "New",
    description: "IV rank, smile, term structure, volatility cone and expected move.",
    page: "Volatility",
    lazy: pageLoader("Volatility"),
  },

  // ── Positioning ─────────────────────────────────────────────────────────
  {
    path: "/gex",
    title: "Gamma Exposure",
    navLabel: "Gamma Exposure",
    group: "Positioning",
    icon: "Magnet",
    shortcut: "g x",
    keywords: ["gex", "gamma", "dealer", "call wall", "put wall", "zero gamma", "flip", "exposure"],
    badge: "New",
    description: "Dealer gamma exposure, call and put walls, gamma flip.",
    page: "GammaExposure",
    lazy: pageLoader("GammaExposure"),
  },
  {
    path: "/flow",
    title: "Options Flow",
    navLabel: "Options Flow",
    group: "Positioning",
    icon: "Activity",
    shortcut: "g f",
    keywords: ["flow", "tape", "unusual activity", "premium", "tide", "alerts", "uoa"],
    badge: "Beta",
    description: "Derived options tape, premium tide and unusual activity.",
    page: "Flow",
    lazy: pageLoader("Flow"),
  },
  {
    path: "/participants",
    title: "FII / DII Positioning",
    navLabel: "FII / DII Positioning",
    group: "Positioning",
    icon: "Landmark",
    keywords: ["fii", "dii", "pro", "client", "participant", "institutional", "index futures", "long short"],
    badge: "New",
    description: "Participant-wise OI for FII, DII, Pro and Client.",
    page: "Participants",
    lazy: pageLoader("Participants"),
  },
  {
    path: "/futures",
    title: "Futures and Rollover",
    navLabel: "Futures & Rollover",
    group: "Positioning",
    icon: "ChartCandlestick",
    keywords: ["futures", "rollover", "roll cost", "basis", "cost of carry", "term structure", "near next far", "expiry week", "futures oi", "bhavcopy"],
    badge: "New",
    description: "Index and stock futures: basis, annualised carry, rollover and roll cost vs the last 3 expiries, OI buildup per series and an expiry-week roll tracker.",
    page: "Futures",
    lazy: pageLoader("Futures"),
  },

  // ── Strategy ────────────────────────────────────────────────────────────
  {
    path: "/strategy-builder",
    title: "Strategy Builder",
    navLabel: "Strategy Builder",
    group: "Strategy",
    icon: "Layers",
    shortcut: "g s",
    keywords: ["strategy", "payoff", "straddle", "strangle", "iron condor", "spread", "legs", "breakeven", "pop"],
    description: "Build multi-leg strategies with payoff, Greeks and POP.",
    page: "StrategyBuilder",
    lazy: pageLoader("StrategyBuilder"),
  },
  {
    path: "/optimizer",
    title: "Strategy Optimizer",
    navLabel: "Optimizer",
    group: "Strategy",
    icon: "WandSparkles",
    keywords: ["optimise", "optimize", "best strategy", "target", "view", "return", "risk"],
    badge: "New",
    description: "Find strategies that fit your target price, date and risk.",
    page: "Optimizer",
    lazy: pageLoader("Optimizer"),
  },
  {
    path: "/backtest",
    title: "Backtester",
    navLabel: "Backtester",
    group: "Strategy",
    icon: "History",
    keywords: ["backtest", "backtester", "historical", "bhavcopy", "stockmock", "strangle", "iron condor", "vix regime"],
    badge: "New",
    description: "Backtest option strategies on historical data with VIX-regime splits.",
    page: "Backtest",
    lazy: pageLoader("Backtest"),
  },
  {
    path: "/calculators",
    title: "Calculators",
    navLabel: "Calculators",
    group: "Strategy",
    icon: "Calculator",
    keywords: ["charges", "brokerage", "stt", "margin", "position size", "black scholes", "iv calculator", "lot size"],
    badge: "New",
    description: "Charges, margin, position size, option pricing and IV.",
    page: "Calculators",
    lazy: pageLoader("Calculators"),
  },

  // ── Trade (1Cliq execution; real orders need Live Trading on in Broker settings) ──
  {
    path: "/one-cliq",
    title: "1Cliq Trade",
    navLabel: "1Cliq Trade",
    group: "Trade",
    icon: "Zap",
    shortcut: "g t",
    keywords: ["1cliq", "one click", "oneclick", "scalping", "execution", "terminal", "hotkeys", "panic", "close all", "f6", "f7", "stop loss", "target", "trade"],
    badge: "Beta",
    description: "One-click scalping terminal: hotkeys, server-side SL/target, F6 close all, F7 cancel all.",
    page: "OneCliq",
    lazy: pageLoader("OneCliq"),
  },
  {
    path: "/orders",
    title: "Orders",
    navLabel: "Orders",
    group: "Trade",
    icon: "ListOrdered",
    keywords: ["orders", "order book", "orderbook", "pending", "cancel", "dhan", "live orders"],
    badge: "Beta",
    description: "Today's real Dhan order book, with cancel for resting orders.",
    page: "Orders",
    lazy: pageLoader("Orders"),
  },

  // ── Portfolio ───────────────────────────────────────────────────────────
  {
    path: "/position-tracker",
    title: "Position Tracker",
    navLabel: "Positions",
    group: "Portfolio",
    icon: "Briefcase",
    shortcut: "g p",
    keywords: ["positions", "portfolio", "pnl", "p&l", "mtm", "holdings", "trades"],
    description: "Track open positions, MTM and portfolio Greeks.",
    page: "PositionTracker",
    lazy: pageLoader("PositionTracker"),
  },
  {
    path: "/paper-trading",
    title: "Paper Trading",
    navLabel: "Paper Trading",
    group: "Portfolio",
    icon: "Wallet",
    keywords: ["paper", "virtual", "practice", "simulator", "orders", "demo trading"],
    badge: "New",
    description: "Practise with a virtual order book and automatic expiry settlement.",
    page: "PaperTrading",
    lazy: pageLoader("PaperTrading"),
  },
  {
    path: "/journal",
    title: "Trade Journal",
    navLabel: "Trade Journal",
    group: "Portfolio",
    icon: "BookOpenCheck",
    keywords: ["journal", "trade log", "tradebook", "import", "zerodha", "dhan", "upstox", "angel", "win rate", "turnover", "sebi"],
    badge: "New",
    description: "Import your tradebook, review round trips, edge by setup and turnover.",
    page: "Journal",
    lazy: pageLoader("Journal"),
  },
  {
    path: "/alerts",
    title: "Alerts",
    navLabel: "Alerts",
    group: "Portfolio",
    icon: "BellRing",
    keywords: ["alerts", "alert", "notifications", "price alert", "webhook", "pcr", "iv", "triggers", "notify"],
    badge: "New",
    description: "Every alert in one place: rules, trigger log, channels and import/export.",
    page: "Alerts",
    lazy: pageLoader("Alerts"),
  },

  // ── Learn ───────────────────────────────────────────────────────────────
  {
    path: "/learn",
    title: "Learn",
    navLabel: "Learn (NISMExams)",
    group: "Learn",
    icon: "GraduationCap",
    shortcut: "g l",
    keywords: ["learn", "education", "nism", "lessons", "greeks explained", "basics", "course", "guide"],
    badge: "New",
    description: "Plain-English lessons on options, Greeks and F&O rules.",
    page: "Learn",
    lazy: pageLoader("Learn"),
  },
  {
    path: "/learn/:slug",
    title: "Lesson",
    navLabel: "Lesson",
    group: "Learn",
    icon: "BookOpen",
    keywords: ["lesson"],
    hidden: true,
    page: "LearnLesson",
    lazy: pageLoader("LearnLesson"),
  },

  // ── Settings ────────────────────────────────────────────────────────────
  {
    path: "/broker-settings",
    title: "Broker Settings",
    navLabel: "Broker API Keys",
    group: "Settings",
    icon: "Settings",
    keywords: ["broker", "api", "keys", "dhan", "zerodha", "upstox", "angel", "credentials", "settings"],
    description: "Connect broker APIs for live data.",
    page: "BrokerSettings",
    lazy: pageLoader("BrokerSettings"),
  },
];

/**
 * Old or guessable paths and where they now live. The integrator can render
 * these as <Navigate replace /> routes; the 404 page always suggests them first.
 */
export const LEGACY_REDIRECTS: Readonly<Record<string, string>> = {
  "/home": "/",
  "/dashboard": "/",
  "/greeks": "/option-chain",
  "/chain": "/option-chain",
  "/oi": "/oi-analysis",
  "/strategy": "/strategy-builder",
  "/strategies": "/strategy-builder",
  "/positions": "/position-tracker",
  "/portfolio": "/position-tracker",
  "/paper": "/paper-trading",
  "/settings": "/broker-settings",
  "/broker": "/broker-settings",
  "/max-pain": "/max-pain-pcr",
  "/pcr": "/max-pain-pcr",
  "/gamma": "/gex",
  "/fii-dii": "/participants",
  "/iv": "/volatility",
  "/0dte": "/expiry-day",
  "/scanner": "/screener",
  "/straddle": "/straddles",
  "/backtester": "/backtest",
  "/trade-journal": "/journal",
  "/calendar": "/events",
  "/rollover": "/futures",
  "/alert": "/alerts",
  "/1cliq": "/one-cliq",
  "/oneclick": "/one-cliq",
  "/one-click": "/one-cliq",
  "/order-book": "/orders",
  // Sub-pages of the old split OI analysis (PR #11); main's OI analysis covers them in one page.
  "/oi-analysis/trending-oi": "/oi-analysis",
  "/oi-analysis/strike-analysis": "/oi-analysis",
  "/oi-analysis/delta-tracker": "/oi-analysis",
};

// ── Helpers ───────────────────────────────────────────────────────────────

/** Strip query, hash and trailing slashes; always starts with "/". */
export function normalizePathname(pathname: string): string {
  const clean = (pathname || "/").split(/[?#]/)[0].trim();
  const withSlash = clean.startsWith("/") ? clean : `/${clean}`;
  const trimmed = withSlash.replace(/\/+$/, "");
  return trimmed === "" ? "/" : trimmed.toLowerCase();
}

function splitPath(path: string): string[] {
  return path.split("/").filter(Boolean);
}

/** Match a pathname against a route pattern ("/learn/:slug"). Returns params or null. */
export function matchPath(pattern: string, pathname: string): Record<string, string> | null {
  const a = splitPath(pattern.toLowerCase());
  const b = splitPath(normalizePathname(pathname));
  if (a.length !== b.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < a.length; i++) {
    if (a[i].startsWith(":")) {
      params[a[i].slice(1)] = decodeURIComponent(b[i]);
    } else if (a[i] !== b[i]) {
      return null;
    }
  }
  return params;
}

/** The registered route for a pathname, preferring static paths over param paths. */
export function findRoute(pathname: string, routes: readonly RouteDef[] = ROUTES): RouteDef | undefined {
  const exact = routes.find((r) => !r.path.includes(":") && matchPath(r.path, pathname));
  return exact ?? routes.find((r) => matchPath(r.path, pathname) !== null);
}

/** Page title for a pathname, e.g. "/option-chain" → "Option Chain". Unknown paths → "Page not found". */
export function routeTitle(pathname: string): string {
  return findRoute(pathname)?.title ?? "Page not found";
}

/** Visible (sidebar and palette) routes, grouped in ROUTE_GROUPS order. Empty groups are dropped. */
export function routesByGroup(routes: readonly RouteDef[] = ROUTES): { group: RouteGroup; routes: RouteDef[] }[] {
  return ROUTE_GROUPS.map((group) => ({
    group,
    routes: routes.filter((r) => r.group === group && !r.hidden),
  })).filter((g) => g.routes.length > 0);
}

/** Registered routes whose page file is not in this build (for the integrator and CI). */
export function missingPages(routes: readonly RouteDef[] = ROUTES): RouteDef[] {
  return routes.filter((r) => !hasPage(r.page));
}

/** Every static path (no params). Used by the smoke test and the 404 page. */
export function staticPaths(routes: readonly RouteDef[] = ROUTES): string[] {
  return routes.filter((r) => !r.path.includes(":")).map((r) => r.path);
}

/** Route bound to a "g then letter" sequence; `key` is the second key ("c" for "g c"). */
export function routeForShortcut(key: string, routes: readonly RouteDef[] = ROUTES): RouteDef | undefined {
  const k = key.toLowerCase();
  return routes.find((r) => r.shortcut?.toLowerCase() === `g ${k}`);
}

// ── Fuzzy suggestions (404 page) ─────────────────────────────────────────

/** Levenshtein edit distance (iterative, O(min(a,b)) memory). */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  if (a.length < b.length) [a, b] = [b, a];
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[b.length];
}

function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/**
 * Score how well a mistyped path matches a route (lower is better, 0 = exact).
 * Combines whole-path edit distance with the best token match against the
 * path, title and keywords, so "/optionchain", "/chain" and "/greeks" all land
 * somewhere sensible.
 */
export function routeDistance(pathname: string, route: RouteDef): number {
  const query = normalizePathname(pathname).replace(/^\//, "");
  if (!query) return route.path === "/" ? 0 : Number.POSITIVE_INFINITY;
  const routeSlug = route.path.replace(/^\//, "").toLowerCase();
  const compactQuery = query.replace(/[^a-z0-9]/g, "");
  const compactSlug = routeSlug.replace(/[^a-z0-9]/g, "");

  const pathScore = compactSlug ? editDistance(compactQuery, compactSlug) / Math.max(compactQuery.length, compactSlug.length) : 1;

  const queryTokens = tokens(query);
  const haystack = [...tokens(route.path), ...tokens(route.title), ...tokens(route.navLabel), ...route.keywords.flatMap(tokens)];
  let tokenScore = 1;
  for (const q of queryTokens) {
    for (const h of haystack) {
      if (h === q) {
        tokenScore = Math.min(tokenScore, 0.05);
      } else if (q.length >= 3 && (h.startsWith(q) || q.startsWith(h)) && h.length >= 2) {
        tokenScore = Math.min(tokenScore, 0.2);
      } else {
        const d = editDistance(q, h) / Math.max(q.length, h.length);
        tokenScore = Math.min(tokenScore, d + 0.1);
      }
    }
  }
  return Math.min(pathScore, tokenScore);
}

/** Normalised edit distance between the compacted query and the route path (0..1). */
function wholePathDistance(pathname: string, route: RouteDef): number {
  const q = normalizePathname(pathname).replace(/[^a-z0-9]/g, "");
  const slug = route.path.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!q || !slug) return 1;
  return editDistance(q, slug) / Math.max(q.length, slug.length);
}

/**
 * Closest visible routes to a mistyped pathname, best first.
 * Only returns routes under `maxDistance` (0..1), so nonsense paths get none.
 */
export function suggestRoutes(
  pathname: string,
  { limit = 3, maxDistance = 0.5, routes = ROUTES }: { limit?: number; maxDistance?: number; routes?: readonly RouteDef[] } = {},
): RouteDef[] {
  const legacy = LEGACY_REDIRECTS[normalizePathname(pathname)];
  return routes
    .filter((r) => !r.hidden && !r.path.includes(":"))
    .map((r) => ({ r, d: r.path === legacy ? -1 : routeDistance(pathname, r), p: wholePathDistance(pathname, r) }))
    .filter((x) => x.d <= maxDistance)
    // Ties (e.g. two routes sharing an exact keyword) go to the closer whole path, then the shorter one.
    .sort((x, y) => x.d - y.d || x.p - y.p || x.r.path.length - y.r.path.length)
    .slice(0, limit)
    .map((x) => x.r);
}
