/**
 * Pure dashboard logic: section layout persistence, expiry rows, VIX regime and PCR direction.
 * No React and no DOM access beyond an injectable Storage, so it is unit-tested in isolation.
 */
import {
  dteLabel,
  getContractSpec,
  getMarketSession,
  getExpiries,
  getLotSize,
  istDateString,
  isWeeklyExpiry,
  normalizeExpiry,
  type Exchange,
} from "@/lib/options";

// ───────────────────────── Layout ─────────────────────────

export const DASH_LAYOUT_KEY = "mc_dash_layout_v1";
export const WELCOME_DISMISS_KEY = "mc_dash_welcome_dismissed_v1";

export type SectionId =
  | "indices"
  | "brief"
  | "metrics"
  | "positioning"
  | "volatility"
  | "expiry"
  | "movers"
  | "futures"
  | "ivScanner"
  | "sectors"
  | "active"
  | "breadth";

export type Density = "compact" | "comfortable";

export interface SectionMeta {
  id: SectionId;
  title: string;
  subtitle: string;
  tooltip: string;
}

export const SECTIONS: readonly SectionMeta[] = [
  {
    id: "indices",
    title: "Indices",
    subtitle: "Spot, day range and previous close",
    tooltip: "Index spot prices with the day's range. The sparkline shows today's 5-minute closes when recorded, otherwise the last week. The dashed line is the previous close. Select a card to open its option chain.",
  },
  {
    id: "brief",
    title: "Daily market brief",
    subtitle: "Gap, VIX, PCR, max pain, FII positioning, walls and today's events",
    tooltip: "A one-glance summary of today's set-up, built from the same data as the full pages. Each line links to the page that explains it. Educational, not a trade call.",
  },
  {
    id: "metrics",
    title: "Key market metrics",
    subtitle: "PCR, VIX, breadth and max pain",
    tooltip: "PCR is total put OI divided by total call OI for the nearest expiry. Max pain is the strike where option buyers lose the most at expiry. VIX is the market's 30-day implied volatility.",
  },
  {
    id: "positioning",
    title: "Positioning",
    subtitle: "Gamma levels, premium flow, FII longs, IV rank",
    tooltip: "Summaries from the Gamma Exposure, Flow, Participants and Volatility pages. Each card links to its full page.",
  },
  {
    id: "volatility",
    title: "Expected move",
    subtitle: "From each index's own option chain",
    tooltip: "Expected move to the nearest expiry, solved from the at-the-money IV and the ATM straddle of the symbol's own chain. IV rank uses real history and says so when there is not enough of it.",
  },
  {
    id: "expiry",
    title: "Expiries",
    subtitle: "GIFT Nifty, NSE/BSE index and MCX expiries",
    tooltip: "NIFTY weekly expires on Tuesday and SENSEX weekly on Thursday. BANKNIFTY, FINNIFTY, MIDCPNIFTY and BANKEX are monthly only. Holiday shifts follow the exchange calendar. MCX dates are approximate.",
  },
  {
    id: "movers",
    title: "Top movers",
    subtitle: "Biggest F&O gainers and losers today",
    tooltip: "F&O stocks with the largest percentage change today. Select a row to open its option chain.",
  },
  {
    id: "futures",
    title: "Index performance and VIX",
    subtitle: "Day change by index and the VIX trend",
    tooltip: "Day change for each index and the India VIX history. Rising VIX usually means option premiums are getting more expensive.",
  },
  {
    id: "ivScanner",
    title: "IV rank scanner",
    subtitle: "IVR, IVP, HV20 and VRP for the main indices",
    tooltip: "IV rank shows where current IV sits in its one-year range. VRP is IV minus 20-day realised volatility. Educational labels, not signals.",
  },
  {
    id: "sectors",
    title: "Sector performance",
    subtitle: "Sectoral index returns",
    tooltip: "Green means the sector is up and red means it is down; stronger shading means a bigger move.",
  },
  {
    id: "active",
    title: "Most active F&O",
    subtitle: "Volume leaders with OI buildup",
    tooltip: "Long buildup: price up, OI up. Short buildup: price down, OI up. Short covering: price up, OI down. Long unwinding: price down, OI down.",
  },
  {
    id: "breadth",
    title: "Market breadth",
    subtitle: "Advance/decline, VIX regime and F&O breadth",
    tooltip: "A simple composite of advance/decline, VIX level and F&O stock breadth. Educational, not a signal.",
  },
];

export const SECTION_IDS: readonly SectionId[] = SECTIONS.map((s) => s.id);

export function sectionMeta(id: SectionId): SectionMeta {
  return SECTIONS.find((s) => s.id === id) ?? SECTIONS[0];
}

export interface DashLayout {
  order: SectionId[];
  hidden: SectionId[];
  density: Density;
}

export const DEFAULT_LAYOUT: DashLayout = { order: [...SECTION_IDS], hidden: [], density: "comfortable" };

const isSectionId = (v: unknown): v is SectionId => typeof v === "string" && (SECTION_IDS as readonly string[]).includes(v);

/**
 * Coerce anything (old, partial or corrupt JSON) into a valid layout. Sections missing from a saved
 * order (for example ones added in a later release) are inserted after their default predecessor,
 * so a new section lands where it belongs instead of at the very bottom.
 */
export function sanitizeLayout(raw: unknown): DashLayout {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_LAYOUT, order: [...DEFAULT_LAYOUT.order] };
  const r = raw as Partial<Record<keyof DashLayout, unknown>>;
  const seen = new Set<SectionId>();
  const order: SectionId[] = [];
  if (Array.isArray(r.order)) {
    for (const id of r.order) {
      if (isSectionId(id) && !seen.has(id)) {
        seen.add(id);
        order.push(id);
      }
    }
  }
  SECTION_IDS.forEach((id, i) => {
    if (seen.has(id)) return;
    let at = 0;
    for (let j = i - 1; j >= 0; j--) {
      const k = order.indexOf(SECTION_IDS[j]);
      if (k >= 0) {
        at = k + 1;
        break;
      }
    }
    order.splice(at, 0, id);
    seen.add(id);
  });
  const hidden = Array.isArray(r.hidden) ? Array.from(new Set(r.hidden.filter(isSectionId))) : [];
  const density: Density = r.density === "compact" ? "compact" : "comfortable";
  return { order, hidden, density };
}

function storageOrNull(s?: Storage | null): Storage | null {
  if (s !== undefined) return s;
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function loadLayout(storage?: Storage | null): DashLayout {
  const s = storageOrNull(storage);
  try {
    const raw = s?.getItem(DASH_LAYOUT_KEY);
    return sanitizeLayout(raw ? JSON.parse(raw) : null);
  } catch {
    return sanitizeLayout(null);
  }
}

export function saveLayout(layout: DashLayout, storage?: Storage | null): void {
  const s = storageOrNull(storage);
  try {
    s?.setItem(DASH_LAYOUT_KEY, JSON.stringify(sanitizeLayout(layout)));
  } catch {
    /* storage full or blocked: the layout simply is not remembered */
  }
}

/** Move a section one step up (-1) or down (+1). Returns the same object when the move is impossible. */
export function moveSection(layout: DashLayout, id: SectionId, dir: -1 | 1): DashLayout {
  const i = layout.order.indexOf(id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= layout.order.length) return layout;
  const order = [...layout.order];
  [order[i], order[j]] = [order[j], order[i]];
  return { ...layout, order };
}

export function setSectionVisible(layout: DashLayout, id: SectionId, visible: boolean): DashLayout {
  const hidden = layout.hidden.filter((h) => h !== id);
  if (!visible) hidden.push(id);
  return { ...layout, hidden };
}

export function visibleSections(layout: DashLayout): SectionId[] {
  return layout.order.filter((id) => !layout.hidden.includes(id));
}

export function readFlag(key: string, storage?: Storage | null): boolean {
  try {
    return storageOrNull(storage)?.getItem(key) === "1";
  } catch {
    return false;
  }
}

export function writeFlag(key: string, value: boolean, storage?: Storage | null): void {
  try {
    const s = storageOrNull(storage);
    if (value) s?.setItem(key, "1");
    else s?.removeItem(key);
  } catch {
    /* ignore */
  }
}

// ───────────────────────── Expiries ─────────────────────────

export interface IndexExpiryRow {
  symbol: string;
  exchange: Exchange;
  date: string; // ISO
  type: "weekly" | "monthly";
  lotSize: number | undefined;
  dte: string;
  /** "live" when the date came from the broker/exchange expiry list, "derived" when computed from SEBI rules. */
  basis: "live" | "derived";
  /** True when the contract spec still needs checking against the latest circular. */
  verify: boolean;
  urgent: boolean;
}

export const DASHBOARD_INDEX_EXPIRIES: readonly string[] = ["NIFTY", "SENSEX", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "BANKEX"];

/**
 * The nearest expiry for each index underlying. `liveNearest` may carry the first expiry from a live
 * expiry list (any format normalizeExpiry accepts); otherwise SEBI rules plus the holiday calendar decide.
 */
export function buildIndexExpiryRows(now: Date, liveNearest: Partial<Record<string, string | undefined>> = {}, symbols: readonly string[] = DASHBOARD_INDEX_EXPIRIES): IndexExpiryRow[] {
  const today = istDateString(now);
  const rows: IndexExpiryRow[] = [];
  for (const symbol of symbols) {
    const spec = getContractSpec(symbol);
    const live = liveNearest[symbol] ? normalizeExpiry(String(liveNearest[symbol]), now) : "";
    const liveOk = live && live >= today && dteLabel(live, now) !== "Expired";
    const derived = getExpiries(symbol, now, 1)[0];
    const date = liveOk ? live : derived?.date ?? "";
    if (!date) continue;
    const type: "weekly" | "monthly" = liveOk ? (isWeeklyExpiry(symbol, date) ? "weekly" : "monthly") : derived?.type ?? "monthly";
    const dte = dteLabel(date, now);
    rows.push({
      symbol,
      exchange: spec?.exchange ?? (symbol === "SENSEX" || symbol === "BANKEX" ? "BSE" : "NSE"),
      date,
      type,
      lotSize: getLotSize(symbol, date),
      dte,
      basis: liveOk ? "live" : "derived",
      verify: spec?.verify ?? true,
      urgent: dte.startsWith("Expiry today") || (date > today && daysBetweenIso(today, date) <= 1),
    });
  }
  return rows;
}

// ── MCX (approximate; the options math core covers NSE/BSE only) ──

export interface McxExpiryRow {
  symbol: string;
  unit: string;
  date: string;
  rule: string;
  dte: string;
}

interface McxRule {
  symbol: string;
  unit: string;
  rule: string;
  months?: readonly number[];
  expiryFor: (y: number, m: number) => string;
}

function isoOf(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Weekday (0 = Sunday) of a calendar date, computed in UTC so no timezone can shift it. */
function weekdayOf(y: number, m: number, d: number): number {
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** The given day, or the closest earlier weekday. */
export function weekdayOnOrBefore(y: number, m: number, d: number): string {
  let day = Math.min(d, daysInMonth(y, m));
  while (day > 1 && (weekdayOf(y, m, day) === 0 || weekdayOf(y, m, day) === 6)) day -= 1;
  return isoOf(y, m, day);
}

/** n weekdays before the last weekday of the month. */
export function weekdaysBeforeMonthEnd(y: number, m: number, n: number): string {
  let day = daysInMonth(y, m);
  while (weekdayOf(y, m, day) === 0 || weekdayOf(y, m, day) === 6) day -= 1;
  let left = n;
  while (left > 0 && day > 1) {
    day -= 1;
    if (weekdayOf(y, m, day) !== 0 && weekdayOf(y, m, day) !== 6) left -= 1;
  }
  return isoOf(y, m, day);
}

export function daysBetweenIso(fromIso: string, toIso: string): number {
  const a = Date.UTC(+fromIso.slice(0, 4), +fromIso.slice(5, 7) - 1, +fromIso.slice(8, 10));
  const b = Date.UTC(+toIso.slice(0, 4), +toIso.slice(5, 7) - 1, +toIso.slice(8, 10));
  return Math.round((b - a) / 86_400_000);
}

const MCX_RULES: readonly McxRule[] = [
  { symbol: "CRUDEOIL", unit: "100 bbl", rule: "Around the 19th (prior weekday)", expiryFor: (y, m) => weekdayOnOrBefore(y, m, 19) },
  { symbol: "NATURALGAS", unit: "1,250 mmBtu", rule: "3 weekdays before month end", expiryFor: (y, m) => weekdaysBeforeMonthEnd(y, m, 3) },
  { symbol: "GOLD", unit: "1 kg", rule: "5th of even months", months: [2, 4, 6, 8, 10, 12], expiryFor: (y, m) => weekdayOnOrBefore(y, m, 5) },
  { symbol: "SILVER", unit: "30 kg", rule: "5th of Mar/May/Jul/Sep/Dec", months: [3, 5, 7, 9, 12], expiryFor: (y, m) => weekdayOnOrBefore(y, m, 5) },
];

/**
 * Approximate next MCX futures expiries. Exchange holidays are not applied, so the dates are
 * labelled approximate in the UI. Dates are built from IST calendar parts, never via toISOString.
 */
export function buildMcxExpiryRows(now: Date): McxExpiryRow[] {
  const today = istDateString(now);
  const y0 = +today.slice(0, 4);
  const m0 = +today.slice(5, 7);
  return MCX_RULES.map((r) => {
    let date = "";
    for (let i = 0; i < 14 && !date; i++) {
      const m = ((m0 - 1 + i) % 12) + 1;
      const y = y0 + Math.floor((m0 - 1 + i) / 12);
      if (r.months && !r.months.includes(m)) continue;
      const d = r.expiryFor(y, m);
      if (d >= today) date = d;
    }
    const days = date ? daysBetweenIso(today, date) : NaN;
    const dte = !date ? "—" : days === 0 ? "Today" : days === 1 ? "1 day" : `${days} days`;
    return { symbol: r.symbol, unit: r.unit, date, rule: r.rule, dte };
  });
}

// ───────────────────────── Signals ─────────────────────────

export type Tone = "bullish" | "bearish" | "warning" | "info" | "neutral";

export interface VixRegime {
  label: string;
  tone: Tone;
  note: string;
}

/** Plain-language India VIX regime. Bands are conventional, not a forecast. */
export function vixRegime(vix: number | null | undefined): VixRegime | null {
  if (vix === null || vix === undefined || !Number.isFinite(vix) || vix <= 0) return null;
  if (vix < 12) return { label: "Very low", tone: "info", note: "Option premiums are cheap by historical standards." };
  if (vix < 15) return { label: "Low", tone: "info", note: "Calm market; premiums on the lower side." };
  if (vix < 20) return { label: "Normal", tone: "neutral", note: "Typical volatility for Indian indices." };
  if (vix < 25) return { label: "Elevated", tone: "warning", note: "Premiums are rich; expect larger daily swings." };
  return { label: "High", tone: "bearish", note: "Stress regime; wide ranges and fast moves." };
}

export type Direction = "up" | "down" | "flat";

/** Direction of change between two readings, with a dead band so tiny moves read as flat. */
export function direction(current: number | null | undefined, previous: number | null | undefined, eps = 0.01): Direction | null {
  if (current === null || current === undefined || previous === null || previous === undefined) return null;
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return null;
  const d = current - previous;
  if (Math.abs(d) <= eps) return "flat";
  return d > 0 ? "up" : "down";
}

export const ARROW: Record<Direction, string> = { up: "▲", down: "▼", flat: "■" };

/** Position (0–100) of a value inside a range; 50 when the range is empty. */
export function rangePosition(value: number, low: number, high: number): number {
  const span = high - low;
  if (!(span > 0) || !Number.isFinite(value)) return 50;
  return Math.min(100, Math.max(0, ((value - low) / span) * 100));
}

/** Composite 0–100 breadth score used by the Market breadth card. */
export function sentimentScore(o: { advances: number; declines: number; unchanged: number; vix: number | null; stocksUp: number; stocksDown: number; totalStocks: number }): number {
  let score = 50;
  const total = o.advances + o.declines + o.unchanged;
  if (total > 0) score += ((o.advances - o.declines) / total) * 25;
  if (o.vix !== null && Number.isFinite(o.vix) && o.vix > 0) {
    if (o.vix < 12) score += 10;
    else if (o.vix < 15) score += 5;
    else if (o.vix > 25) score -= 15;
    else if (o.vix > 20) score -= 10;
  }
  if (o.totalStocks > 0) score += ((o.stocksUp - o.stocksDown) / o.totalStocks) * 15;
  return Math.max(0, Math.min(100, Math.round(score)));
}

export function sentimentLabel(score: number): { label: string; tone: Tone } {
  if (score >= 70) return { label: "Strongly positive", tone: "bullish" };
  if (score >= 55) return { label: "Positive", tone: "bullish" };
  if (score >= 45) return { label: "Neutral", tone: "warning" };
  if (score >= 30) return { label: "Negative", tone: "bearish" };
  return { label: "Strongly negative", tone: "bearish" };
}

export const TONE_TEXT: Record<Tone, string> = {
  bullish: "text-bullish",
  bearish: "text-bearish",
  warning: "text-warning",
  info: "text-info",
  neutral: "text-muted-foreground",
};

/** Text tone for a signed change. */
export function signTone(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v) || v === 0) return "text-muted-foreground";
  return v > 0 ? "text-bullish" : "text-bearish";
}

// ───────────────────────── Widget status ─────────────────────────

export type WidgetStatus = "loading" | "error" | "empty" | "stale" | "sample" | "derived" | "live" | "delayed" | "closed";

/**
 * Map a hook result (react-query style plus our SourceMeta) to a widget status.
 * Outside the NSE session, fresh data is labelled "closed" (closing prices) rather than "live".
 */
export function statusFrom(o: {
  isLoading?: boolean;
  isError?: boolean;
  hasData: boolean;
  source?: string;
  stale?: boolean;
  isLive?: boolean;
  /** Defaults to the IST clock (pre-open or open). */
  sessionOpen?: boolean;
}): WidgetStatus {
  if (o.isLoading && !o.hasData) return "loading";
  if (o.isError && !o.hasData) return "error";
  if (!o.hasData) return "empty";
  if (o.source === "sample") return "sample";
  if (o.stale || o.source === "database" || o.source === "cache") return "stale";
  const open = o.sessionOpen ?? ["open", "pre-open"].includes(getMarketSession());
  if (!open) return "closed";
  return o.isLive ? "live" : "delayed";
}

const SOURCE_NAME: Record<string, string> = { dhan: "Dhan", nse: "NSE", bse: "BSE", tradingview: "TradingView", tv: "TradingView", cache: "Cache", database: "Local DB", sample: "Sample", none: "Offline" };

export function sourceName(source: string | undefined): string | undefined {
  if (!source) return undefined;
  return SOURCE_NAME[source] ?? source.toUpperCase();
}
