/**
 * Participant-wise OI / volume (FII, DII, Pro, Client) and FII/DII cash flows.
 *
 * Source: NSE publishes fao_participant_oi_DDMMYYYY.csv and fao_participant_vol_DDMMYYYY.csv
 * after the close (usually between 18:00 and 20:00 IST). The proxy parses them into
 * ParticipantOIRow objects under /api/x/participant-oi, /participant-oi/history,
 * /participant-vol and /fii-stats.
 *
 * Everything below the "derived" header is pure and unit-tested. The fetchers never throw:
 * they fall back to history recorded in this browser, and then to clearly labelled sample data.
 */
import { proxyFetchJSON, proxyGet, type ProxyMeta } from "@/lib/api/proxyClient";
import { fetchFIIDII, type FIIDIIData, type HistoricalCandleResponse } from "@/lib/marketApi";
import {
  addCalendarDays,
  istDateString,
  isTradingDay,
  isValidIsoDate,
  normalizeExpiry,
  nowIST,
  previousTradingDay,
} from "@/lib/options";
import type { FiiStatsRow, Participant, ParticipantOIRow } from "@/lib/types/market";

export type { FiiStatsRow, Participant, ParticipantOIRow };

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/** Participant-wise volume uses the same columns: "long" = bought, "short" = sold. */
export type ParticipantVolRow = ParticipantOIRow;

export const PARTICIPANTS: readonly Participant[] = ["FII", "DII", "Pro", "Client"] as const;

export type Product = "futIdx" | "futStk" | "optIdxCall" | "optIdxPut";
export const PRODUCTS: readonly Product[] = ["futIdx", "optIdxCall", "optIdxPut", "futStk"] as const;

export const PRODUCT_LABEL: Record<Product, string> = {
  futIdx: "Index futures",
  optIdxCall: "Index calls",
  optIdxPut: "Index puts",
  futStk: "Stock futures",
};

/** Where a dataset came from. "live" = proxy (NSE), "cache" = recorded in this browser, "sample" = simulated. */
export type DataMode = "live" | "cache" | "sample";

export interface ProductStats {
  long: number;
  short: number;
  /** long − short (contracts) */
  net: number;
  /** long + short */
  gross: number;
  /** long ÷ (long + short) × 100; NaN when both are zero */
  longPct: number;
  /** long ÷ short; Infinity when short is 0 and long > 0; NaN when both are 0 */
  lsRatio: number;
}

export interface ProductChange {
  long: number;
  short: number;
  net: number;
  /** percentage points */
  longPct: number;
}

export interface ParticipantProductView extends ProductStats {
  change: ProductChange | null;
}

export interface ParticipantView {
  participant: Participant;
  date: string;
  products: Record<Product, ParticipantProductView>;
  /**
   * Net index direction in contracts: net index futures + net index calls − net index puts.
   * A rough "long the index" measure (long calls and short puts are both bullish).
   */
  indexDirection: number;
  indexDirectionChange: number | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Derived ratios (pure)
// ─────────────────────────────────────────────────────────────────────────────

const LONG_KEY: Record<Product, keyof ParticipantOIRow> = {
  futIdx: "futIdxLong",
  futStk: "futStkLong",
  optIdxCall: "optIdxCallLong",
  optIdxPut: "optIdxPutLong",
};
const SHORT_KEY: Record<Product, keyof ParticipantOIRow> = {
  futIdx: "futIdxShort",
  futStk: "futStkShort",
  optIdxCall: "optIdxCallShort",
  optIdxPut: "optIdxPutShort",
};

function finite(v: unknown): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(/,/g, "")) : NaN;
  return Number.isFinite(n) ? n : 0;
}

/** Long % of a book: long ÷ (long + short) × 100. NaN when there is no position. */
export function longPercent(long: number, short: number): number {
  const l = Math.max(0, finite(long));
  const s = Math.max(0, finite(short));
  const g = l + s;
  return g > 0 ? (l / g) * 100 : NaN;
}

/** Long/short ratio. Infinity when short is zero and long is positive; NaN when both are zero. */
export function longShortRatio(long: number, short: number): number {
  const l = Math.max(0, finite(long));
  const s = Math.max(0, finite(short));
  if (s === 0) return l > 0 ? Infinity : NaN;
  return l / s;
}

export function productStats(row: ParticipantOIRow, product: Product): ProductStats {
  const long = finite(row[LONG_KEY[product]]);
  const short = finite(row[SHORT_KEY[product]]);
  return {
    long,
    short,
    net: long - short,
    gross: long + short,
    longPct: longPercent(long, short),
    lsRatio: longShortRatio(long, short),
  };
}

export function productChange(today: ProductStats, prev: ProductStats | null | undefined): ProductChange | null {
  if (!prev) return null;
  const dPct = Number.isFinite(today.longPct) && Number.isFinite(prev.longPct) ? today.longPct - prev.longPct : NaN;
  return { long: today.long - prev.long, short: today.short - prev.short, net: today.net - prev.net, longPct: dPct };
}

/** Net index direction = net index futures + net index calls − net index puts (contracts). */
export function indexDirection(row: ParticipantOIRow): number {
  return productStats(row, "futIdx").net + productStats(row, "optIdxCall").net - productStats(row, "optIdxPut").net;
}

export function deriveParticipantView(row: ParticipantOIRow, prev?: ParticipantOIRow | null): ParticipantView {
  const products = {} as Record<Product, ParticipantProductView>;
  for (const p of PRODUCTS) {
    const s = productStats(row, p);
    products[p] = { ...s, change: prev ? productChange(s, productStats(prev, p)) : null };
  }
  const dir = indexDirection(row);
  return {
    participant: row.participant,
    date: row.date,
    products,
    indexDirection: dir,
    indexDirectionChange: prev ? dir - indexDirection(prev) : null,
  };
}

/** Views for each participant on one date, in PARTICIPANTS order. `prevRows` may be empty. */
export function deriveParticipantViews(rows: ParticipantOIRow[], prevRows: ParticipantOIRow[] = []): ParticipantView[] {
  const out: ParticipantView[] = [];
  for (const p of PARTICIPANTS) {
    const r = rows.find((x) => x.participant === p);
    if (!r) continue;
    out.push(deriveParticipantView(r, prevRows.find((x) => x.participant === p) ?? null));
  }
  return out;
}

/**
 * Futures and options are zero-sum: for each product the four participants' longs must add up to
 * their shorts. Returns the largest imbalance as a fraction of gross (0 = perfectly balanced).
 */
export function clearingImbalance(rows: ParticipantOIRow[]): number {
  let worst = 0;
  for (const p of PRODUCTS) {
    let l = 0;
    let s = 0;
    for (const r of rows) {
      l += finite(r[LONG_KEY[p]]);
      s += finite(r[SHORT_KEY[p]]);
    }
    const g = Math.max(l, s);
    if (g > 0) worst = Math.max(worst, Math.abs(l - s) / g);
  }
  return worst;
}

/** Local mirror of the proxy's deriveFiiStats, used when /api/x/fii-stats is unavailable. */
export function deriveFiiStats(oiRows: ParticipantOIRow[], volRows?: ParticipantVolRow[] | null): FiiStatsRow[] {
  const fii = oiRows.find((r) => r.participant === "FII");
  if (!fii) return [];
  const vol = volRows?.find((r) => r.participant === "FII") ?? null;
  const seg = (segment: FiiStatsRow["segment"], product: Product): FiiStatsRow => {
    const s = productStats(fii, product);
    const v = vol ? productStats(vol, product) : null;
    return {
      date: fii.date,
      segment,
      longOi: s.long,
      shortOi: s.short,
      netOi: s.net,
      longPct: Number.isFinite(s.longPct) ? Math.round(s.longPct * 100) / 100 : 0,
      buyVol: v ? v.long : null,
      sellVol: v ? v.short : null,
      netVol: v ? v.net : null,
    };
  };
  return [
    seg("Index Futures", "futIdx"),
    seg("Index Calls", "optIdxCall"),
    seg("Index Puts", "optIdxPut"),
    seg("Stock Futures", "futStk"),
  ];
}

// ── FII long % zones ──

export type LongPctZone =
  "extreme-short" | "heavy-short" | "leaning-short" | "leaning-long" | "heavy-long" | "extreme-long" | "unknown";

/** Extreme bands sit below 10% and above 90%; "heavy" between 10–25% and 75–90%. */
export const LONG_PCT_BANDS = { extremeLow: 10, heavyLow: 25, heavyHigh: 75, extremeHigh: 90 } as const;

export function classifyLongPct(pct: number): LongPctZone {
  if (!Number.isFinite(pct)) return "unknown";
  const b = LONG_PCT_BANDS;
  if (pct <= b.extremeLow) return "extreme-short";
  if (pct <= b.heavyLow) return "heavy-short";
  if (pct < 50) return "leaning-short";
  if (pct < b.heavyHigh) return "leaning-long";
  if (pct < b.extremeHigh) return "heavy-long";
  return "extreme-long";
}

export const ZONE_TEXT: Record<
  LongPctZone,
  { label: string; note: string; tone: "bullish" | "bearish" | "warning" | "neutral" }
> = {
  "extreme-short": {
    label: "Extreme short",
    note: "FIIs are rarely this short. Past extremes often came near short-term bottoms, as shorts later covered.",
    tone: "warning",
  },
  "heavy-short": {
    label: "Heavily short",
    note: "FIIs hold far more short than long index futures. Short covering can drive sharp rallies.",
    tone: "bearish",
  },
  "leaning-short": { label: "Leaning short", note: "More shorts than longs, but not stretched.", tone: "bearish" },
  "leaning-long": { label: "Leaning long", note: "More longs than shorts, but not stretched.", tone: "bullish" },
  "heavy-long": {
    label: "Heavily long",
    note: "FIIs are positioned for upside. Long unwinding can add to falls.",
    tone: "bullish",
  },
  "extreme-long": {
    label: "Extreme long",
    note: "FIIs are rarely this long. Crowded longs have often preceded pauses or pullbacks.",
    tone: "warning",
  },
  unknown: { label: "No data", note: "Participant data is not available for this date.", tone: "neutral" },
};

// ── History series ──

export interface HistoryPoint {
  date: string;
  fiiLongPct: number;
  fiiNetFut: number;
  clientNetFut: number;
  proNetFut: number;
  diiNetFut: number;
  fiiCallNet: number;
  fiiPutNet: number;
  clientCallNet: number;
  clientPutNet: number;
  proCallNet: number;
  proPutNet: number;
  fiiDirection: number;
  clientDirection: number;
  proDirection: number;
}

/** Group rows by date (sorted ascending). Dates with fewer than all four participants are kept. */
export function groupByDate(rows: ParticipantOIRow[]): Map<string, ParticipantOIRow[]> {
  const m = new Map<string, ParticipantOIRow[]>();
  for (const r of [...rows].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))) {
    const list = m.get(r.date);
    if (list) list.push(r);
    else m.set(r.date, [r]);
  }
  return m;
}

export function buildHistorySeries(rows: ParticipantOIRow[]): HistoryPoint[] {
  const out: HistoryPoint[] = [];
  for (const [date, list] of groupByDate(rows)) {
    const by = (p: Participant) => list.find((r) => r.participant === p);
    const fii = by("FII");
    if (!fii) continue;
    const client = by("Client");
    const pro = by("Pro");
    const dii = by("DII");
    const net = (r: ParticipantOIRow | undefined, p: Product) => (r ? productStats(r, p).net : NaN);
    out.push({
      date,
      fiiLongPct: productStats(fii, "futIdx").longPct,
      fiiNetFut: net(fii, "futIdx"),
      clientNetFut: net(client, "futIdx"),
      proNetFut: net(pro, "futIdx"),
      diiNetFut: net(dii, "futIdx"),
      fiiCallNet: net(fii, "optIdxCall"),
      fiiPutNet: net(fii, "optIdxPut"),
      clientCallNet: net(client, "optIdxCall"),
      clientPutNet: net(client, "optIdxPut"),
      proCallNet: net(pro, "optIdxCall"),
      proPutNet: net(pro, "optIdxPut"),
      fiiDirection: indexDirection(fii),
      clientDirection: client ? indexDirection(client) : NaN,
      proDirection: pro ? indexDirection(pro) : NaN,
    });
  }
  return out;
}

/** Trailing simple moving average; entries before `window` points are NaN. */
export function sma(values: number[], window: number): number[] {
  const w = Math.max(1, Math.floor(window));
  const out: number[] = [];
  let sum = 0;
  let count = 0;
  const q: number[] = [];
  for (const v of values) {
    const x = Number.isFinite(v) ? v : NaN;
    q.push(x);
    if (Number.isFinite(x)) {
      sum += x;
      count += 1;
    }
    if (q.length > w) {
      const old = q.shift() as number;
      if (Number.isFinite(old)) {
        sum -= old;
        count -= 1;
      }
    }
    out.push(q.length === w && count === w ? sum / w : NaN);
  }
  return out;
}

/** Pearson correlation of two equal-length series (non-finite pairs skipped). NaN if under 3 pairs or zero variance. */
export function pearson(a: number[], b: number[]): number {
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (Number.isFinite(a[i]) && Number.isFinite(b[i])) {
      xs.push(a[i]);
      ys.push(b[i]);
    }
  }
  const n = xs.length;
  if (n < 3) return NaN;
  const mx = xs.reduce((s, v) => s + v, 0) / n;
  const my = ys.reduce((s, v) => s + v, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  if (sxx === 0 || syy === 0) return NaN;
  return sxy / Math.sqrt(sxx * syy);
}

/** Percentile rank (0–100) of `value` within `history` (share of history at or below it). */
export function percentileRank(value: number, history: number[]): number {
  const h = history.filter((v) => Number.isFinite(v));
  if (!Number.isFinite(value) || h.length === 0) return NaN;
  return (h.filter((v) => v <= value).length / h.length) * 100;
}

// ─────────────────────────────────────────────────────────────────────────────
// Publication window (IST)
// ─────────────────────────────────────────────────────────────────────────────

export const PUBLISH_WINDOW = { fromHour: 18, toHour: 20 } as const;

export type PublishState = "before-window" | "in-window" | "published" | "non-trading-day";

/** Where today's participant file stands, judged by the IST clock. */
export function publishState(now: Date = new Date()): PublishState {
  const t = nowIST(now);
  if (!isTradingDay(t.date)) return "non-trading-day";
  if (t.hh < PUBLISH_WINDOW.fromHour) return "before-window";
  if (t.hh < PUBLISH_WINDOW.toHour) return "in-window";
  return "published";
}

/** The most recent date whose file should normally be out by now. */
export function latestExpectedDate(now: Date = new Date()): string {
  const t = nowIST(now);
  if (isTradingDay(t.date) && t.hh >= PUBLISH_WINDOW.toHour) return t.date;
  return previousTradingDay(t.date);
}

/** True when `date` is today (IST) and the file may simply not be out yet. */
export function isAwaitingPublication(date: string, now: Date = new Date()): boolean {
  const t = nowIST(now);
  return date === t.date && isTradingDay(t.date) && t.hh < PUBLISH_WINDOW.toHour + 1;
}

// ─────────────────────────────────────────────────────────────────────────────
// Row validation
// ─────────────────────────────────────────────────────────────────────────────

const PARTICIPANT_SET: ReadonlySet<string> = new Set(PARTICIPANTS);
const NUMERIC_KEYS = [...Object.values(LONG_KEY), ...Object.values(SHORT_KEY)] as Array<keyof ParticipantOIRow>;

/** Keep well-formed rows only, coercing numbers. Unknown participants and bad dates are dropped. */
export function sanitizeRows(raw: unknown): ParticipantOIRow[] {
  if (!Array.isArray(raw)) return [];
  const out: ParticipantOIRow[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const date = typeof r.date === "string" ? r.date : "";
    const participant = typeof r.participant === "string" ? r.participant : "";
    if (!isValidIsoDate(date) || !PARTICIPANT_SET.has(participant)) continue;
    const row = { date, participant } as ParticipantOIRow;
    for (const k of NUMERIC_KEYS) (row as unknown as Record<string, number>)[k] = Math.max(0, finite(r[k]));
    out.push(row);
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Browser history store (localStorage, keyed by date)
// ─────────────────────────────────────────────────────────────────────────────

export interface KVStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const OI_STORE_KEY = "mc_participant_oi_v1";
export const VOL_STORE_KEY = "mc_participant_vol_v1";
export const CASH_STORE_KEY = "mc_fii_dii_cash_v1";
/** About 13 months of sessions, so the 1Y window can be served from this browser. */
export const MAX_STORED_DAYS = 270;
/** Longest history window the page offers (1 year of sessions). */
export const MAX_HISTORY_DAYS = 250;

function defaultStorage(): KVStorage | null {
  try {
    const ls = (globalThis as { localStorage?: KVStorage }).localStorage;
    return ls ?? null;
  } catch {
    return null;
  }
}

type DateKeyed<T> = Record<string, T[]>;

function readStore<T>(key: string, storage: KVStorage | null): DateKeyed<T> {
  if (!storage) return {};
  try {
    const raw = storage.getItem(key);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as DateKeyed<T>) : {};
  } catch {
    return {};
  }
}

function writeStore<T>(key: string, data: DateKeyed<T>, storage: KVStorage | null): void {
  if (!storage) return;
  const dates = Object.keys(data).sort().slice(-MAX_STORED_DAYS);
  const trimmed: DateKeyed<T> = {};
  for (const d of dates) trimmed[d] = data[d];
  try {
    storage.setItem(key, JSON.stringify(trimmed));
  } catch {
    /* quota or private mode: history simply does not persist */
  }
}

/** Merge rows into a date-keyed map (a date's rows are replaced as a whole). Pure. */
export function mergeByDate(store: DateKeyed<ParticipantOIRow>, rows: ParticipantOIRow[]): DateKeyed<ParticipantOIRow> {
  const next: DateKeyed<ParticipantOIRow> = { ...store };
  for (const [date, list] of groupByDate(rows)) {
    const byP = new Map<string, ParticipantOIRow>();
    for (const r of next[date] ?? []) byP.set(r.participant, r);
    for (const r of list) byP.set(r.participant, r);
    next[date] = PARTICIPANTS.map((p) => byP.get(p)).filter((r): r is ParticipantOIRow => !!r);
  }
  return next;
}

export function flattenStore(store: DateKeyed<ParticipantOIRow>): ParticipantOIRow[] {
  return Object.keys(store)
    .sort()
    .flatMap((d) => sanitizeRows(store[d]));
}

export function loadStoredRows(
  kind: "oi" | "vol" = "oi",
  storage: KVStorage | null = defaultStorage(),
): ParticipantOIRow[] {
  return flattenStore(readStore<ParticipantOIRow>(kind === "oi" ? OI_STORE_KEY : VOL_STORE_KEY, storage));
}

export function saveRows(
  rows: ParticipantOIRow[],
  kind: "oi" | "vol" = "oi",
  storage: KVStorage | null = defaultStorage(),
): ParticipantOIRow[] {
  const key = kind === "oi" ? OI_STORE_KEY : VOL_STORE_KEY;
  const merged = mergeByDate(readStore<ParticipantOIRow>(key, storage), sanitizeRows(rows));
  writeStore(key, merged, storage);
  return flattenStore(merged);
}

// ─────────────────────────────────────────────────────────────────────────────
// Cash market FII / DII flows (₹ crore)
// ─────────────────────────────────────────────────────────────────────────────

export interface CashFlowDay {
  date: string;
  fiiBuy: number;
  fiiSell: number;
  fiiNet: number;
  diiBuy: number;
  diiSell: number;
  diiNet: number;
}

export interface MonthlyCashTotal {
  month: string; // yyyy-mm
  fiiNet: number;
  diiNet: number;
  days: number;
}

/** Turn NSE's fiidiiTradeReact rows (one per category) into one row per date. */
export function parseCashFlows(rows: FIIDIIData[]): CashFlowDay[] {
  const byDate = new Map<string, CashFlowDay>();
  for (const r of rows) {
    const date = normalizeExpiry(r.date || "");
    if (!date) continue;
    const cat = (r.category || "").toUpperCase();
    const isFii = cat.includes("FII") || cat.includes("FPI");
    const isDii = cat.includes("DII");
    if (!isFii && !isDii) continue;
    const d = byDate.get(date) ?? { date, fiiBuy: 0, fiiSell: 0, fiiNet: 0, diiBuy: 0, diiSell: 0, diiNet: 0 };
    if (isFii) {
      d.fiiBuy = finite(r.buyValue);
      d.fiiSell = finite(r.sellValue);
      d.fiiNet = finite(r.netValue) || d.fiiBuy - d.fiiSell;
    } else {
      d.diiBuy = finite(r.buyValue);
      d.diiSell = finite(r.sellValue);
      d.diiNet = finite(r.netValue) || d.diiBuy - d.diiSell;
    }
    byDate.set(date, d);
  }
  return [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
}

export function monthlyCashTotals(days: CashFlowDay[]): MonthlyCashTotal[] {
  const m = new Map<string, MonthlyCashTotal>();
  for (const d of days) {
    const month = d.date.slice(0, 7);
    const t = m.get(month) ?? { month, fiiNet: 0, diiNet: 0, days: 0 };
    t.fiiNet += d.fiiNet;
    t.diiNet += d.diiNet;
    t.days += 1;
    m.set(month, t);
  }
  return [...m.values()].sort((a, b) => (a.month < b.month ? -1 : 1));
}

/** Running cumulative FII and DII net over the given days. */
export function cumulativeCash(days: CashFlowDay[]): Array<CashFlowDay & { fiiCum: number; diiCum: number }> {
  let f = 0;
  let d = 0;
  return days.map((x) => {
    f += x.fiiNet;
    d += x.diiNet;
    return { ...x, fiiCum: f, diiCum: d };
  });
}

function isCashDay(v: unknown): v is CashFlowDay {
  if (!v || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.date === "string" && isValidIsoDate(r.date) && typeof r.fiiNet === "number" && typeof r.diiNet === "number"
  );
}

export function loadStoredCash(storage: KVStorage | null = defaultStorage()): CashFlowDay[] {
  const s = readStore<CashFlowDay>(CASH_STORE_KEY, storage);
  return Object.keys(s)
    .sort()
    .map((d) => s[d]?.[0])
    .filter(isCashDay);
}

export function saveCash(days: CashFlowDay[], storage: KVStorage | null = defaultStorage()): CashFlowDay[] {
  const s = readStore<CashFlowDay>(CASH_STORE_KEY, storage);
  for (const d of days) if (isCashDay(d)) s[d.date] = [d];
  writeStore(CASH_STORE_KEY, s, storage);
  return loadStoredCash(storage);
}

// ─────────────────────────────────────────────────────────────────────────────
// Sample data (deterministic, clearly labelled in the UI)
// ─────────────────────────────────────────────────────────────────────────────

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The last `count` trading days ending on or before `endDate` (ascending). */
export function lastTradingDays(endDate: string, count: number): string[] {
  const out: string[] = [];
  let d = isTradingDay(endDate) ? endDate : previousTradingDay(endDate);
  let guard = 0;
  while (out.length < count && guard < count * 3 + 30) {
    out.push(d);
    d = previousTradingDay(d);
    guard += 1;
  }
  return out.reverse();
}

/**
 * Simulated participant OI for `days` trading days ending at `endDate`. Each product clears
 * (total long = total short), with Client as the balancing participant, as in real data.
 */
export function sampleParticipantHistory(days: number, endDate: string, seed = 20261017): ParticipantOIRow[] {
  const rand = mulberry32(seed);
  const between = (lo: number, hi: number) => lo + (hi - lo) * rand();
  // Always walk the same 250-day path and keep the last `days`, so the latest sample day is the
  // same whether a page asks for 20 days (Dashboard card) or 60 (FII/DII page).
  const keep = Math.max(1, Math.min(250, Math.floor(days)));
  const dates = lastTradingDays(endDate, 250);
  const firstKept = dates.length - keep;
  const out: ParticipantOIRow[] = [];
  let dayIndex = -1;
  let fiiPct = between(0.22, 0.32);
  let fiiGross = between(2.4e5, 2.9e5);
  for (const date of dates) {
    dayIndex += 1;
    fiiPct = Math.min(0.62, Math.max(0.08, fiiPct + (rand() - 0.5) * 0.045 + (0.27 - fiiPct) * 0.05));
    fiiGross = Math.max(1.6e5, fiiGross * (1 + (rand() - 0.5) * 0.05));
    const fii = { futIdxLong: fiiGross * fiiPct, futIdxShort: fiiGross * (1 - fiiPct) };
    const dii = { futIdxLong: between(0.55e5, 0.75e5), futIdxShort: between(0.02e5, 0.05e5) };
    const pro = { futIdxLong: between(0.35e5, 0.7e5), futIdxShort: between(0.35e5, 0.75e5) };

    const rows: Record<Participant, Record<string, number>> = {
      FII: { ...fii },
      DII: { ...dii },
      Pro: { ...pro },
      Client: {},
    };

    rows.FII.futStkLong = between(1.6e6, 1.9e6);
    rows.FII.futStkShort = between(1.15e6, 1.35e6);
    rows.DII.futStkLong = between(0.4e5, 0.7e5);
    rows.DII.futStkShort = between(2.6e6, 3.0e6);
    rows.Pro.futStkLong = between(0.45e6, 0.6e6);
    rows.Pro.futStkShort = between(0.4e6, 0.55e6);

    const callScale = between(0.85, 1.15);
    const putScale = between(0.85, 1.15);
    rows.FII.optIdxCallLong = between(1.1e6, 1.6e6) * callScale;
    rows.FII.optIdxCallShort = between(0.9e6, 1.5e6) * callScale;
    rows.FII.optIdxPutLong = between(1.0e6, 1.5e6) * putScale;
    rows.FII.optIdxPutShort = between(0.9e6, 1.4e6) * putScale;
    rows.DII.optIdxCallLong = 0;
    rows.DII.optIdxCallShort = between(0, 300);
    rows.DII.optIdxPutLong = between(0, 2000);
    rows.DII.optIdxPutShort = 0;
    rows.Pro.optIdxCallLong = between(2.0e6, 2.8e6) * callScale;
    rows.Pro.optIdxCallShort = between(2.4e6, 3.2e6) * callScale;
    rows.Pro.optIdxPutLong = between(1.8e6, 2.6e6) * putScale;
    rows.Pro.optIdxPutShort = between(2.2e6, 3.0e6) * putScale;

    // Client balances every product so the market clears.
    const clientGross: Record<Product, number> = {
      futIdx: between(2.6e5, 3.2e5),
      futStk: between(3.0e6, 3.4e6),
      optIdxCall: between(3.4e6, 4.4e6) * callScale,
      optIdxPut: between(3.0e6, 4.0e6) * putScale,
    };
    for (const p of PRODUCTS) {
      const lk = LONG_KEY[p] as string;
      const sk = SHORT_KEY[p] as string;
      const othersNet = (["FII", "DII", "Pro"] as const).reduce((s, who) => s + rows[who][lk] - rows[who][sk], 0);
      // client net = −othersNet; choose long/short around clientGross
      const net = -othersNet;
      const gross = Math.max(clientGross[p], Math.abs(net) * 1.2);
      rows.Client[lk] = (gross + net) / 2;
      rows.Client[sk] = (gross - net) / 2;
    }

    if (dayIndex < firstKept) continue;
    for (const p of PARTICIPANTS) {
      const r = rows[p];
      // Round longs, then make the client absorb rounding so totals stay equal.
      out.push({
        date,
        participant: p,
        futIdxLong: Math.round(r.futIdxLong),
        futIdxShort: Math.round(r.futIdxShort),
        futStkLong: Math.round(r.futStkLong),
        futStkShort: Math.round(r.futStkShort),
        optIdxCallLong: Math.round(r.optIdxCallLong),
        optIdxCallShort: Math.round(r.optIdxCallShort),
        optIdxPutLong: Math.round(r.optIdxPutLong),
        optIdxPutShort: Math.round(r.optIdxPutShort),
      });
    }
    // fix rounding drift on the client row
    const dayRows = out.slice(-4);
    const client = dayRows.find((r) => r.participant === "Client");
    if (client) {
      for (const p of PRODUCTS) {
        const lk = LONG_KEY[p];
        const sk = SHORT_KEY[p];
        let l = 0;
        let s = 0;
        for (const r of dayRows) {
          l += r[lk] as number;
          s += r[sk] as number;
        }
        (client as unknown as Record<string, number>)[sk] = (client[sk] as number) + (l - s);
      }
    }
  }
  return out;
}

/** Simulated volume rows (bought/sold) loosely tied to the OI rows of the same date. */
export function sampleParticipantVolume(oiRows: ParticipantOIRow[], seed = 7): ParticipantVolRow[] {
  const rand = mulberry32(seed);
  return oiRows.map((r) => {
    const out = { ...r } as ParticipantVolRow;
    for (const p of PRODUCTS) {
      const lk = LONG_KEY[p];
      const sk = SHORT_KEY[p];
      const turnover = p.startsWith("opt") ? 4 + rand() * 3 : 0.25 + rand() * 0.2;
      const base = ((r[lk] as number) + (r[sk] as number)) / 2;
      const tilt = 1 + (rand() - 0.5) * 0.08;
      (out as unknown as Record<string, number>)[lk] = Math.round(base * turnover * tilt);
      (out as unknown as Record<string, number>)[sk] = Math.round(base * turnover * (2 - tilt));
    }
    return out;
  });
}

/** Simulated FII/DII cash flows (₹ crore) for `days` trading days ending at `endDate`. */
export function sampleCashFlows(days: number, endDate: string, seed = 99): CashFlowDay[] {
  const rand = mulberry32(seed);
  return lastTradingDays(endDate, Math.max(1, Math.floor(days))).map((date) => {
    const fiiNet = Math.round((rand() - 0.58) * 9000 * 100) / 100;
    const diiNet = Math.round((-fiiNet * (0.55 + rand() * 0.5) + (rand() - 0.4) * 2500) * 100) / 100;
    const fiiBuy = Math.round((11000 + rand() * 7000) * 100) / 100;
    const diiBuy = Math.round((12000 + rand() * 6000) * 100) / 100;
    return {
      date,
      fiiBuy,
      fiiSell: Math.round((fiiBuy - fiiNet) * 100) / 100,
      fiiNet,
      diiBuy,
      diiSell: Math.round((diiBuy - diiNet) * 100) / 100,
      diiNet,
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Fetchers (never throw)
// ─────────────────────────────────────────────────────────────────────────────

export interface Sourced<T> {
  data: T;
  mode: DataMode;
  /** epoch ms of the underlying data, when known */
  asOf?: number;
  reason?: string;
}

function liveMode(meta: ProxyMeta): DataMode {
  return meta.source === "sample" ? "sample" : meta.stale || meta.source === "cache" ? "cache" : "live";
}

export async function fetchParticipantOI(
  date?: string,
  signal?: AbortSignal,
): Promise<Sourced<ParticipantOIRow[]> | null> {
  const env = await proxyGet<unknown>("/api/x/participant-oi", { date }, { signal, timeoutMs: 20000 });
  const rows = sanitizeRows(env.data);
  if (rows.length === 0) return null;
  saveRows(rows, "oi");
  return { data: rows, mode: liveMode(env.meta), asOf: env.meta.asOf, reason: env.meta.reason };
}

export async function fetchParticipantVol(
  date?: string,
  signal?: AbortSignal,
): Promise<Sourced<ParticipantVolRow[]> | null> {
  const env = await proxyGet<unknown>("/api/x/participant-vol", { date }, { signal, timeoutMs: 20000 });
  const rows = sanitizeRows(env.data);
  if (rows.length === 0) return null;
  saveRows(rows, "vol");
  return { data: rows, mode: liveMode(env.meta), asOf: env.meta.asOf, reason: env.meta.reason };
}

export async function fetchParticipantHistory(
  days: number,
  signal?: AbortSignal,
): Promise<Sourced<ParticipantOIRow[]> | null> {
  const env = await proxyGet<unknown>(
    "/api/x/participant-oi/history",
    { days: Math.max(1, Math.min(60, Math.floor(days))) },
    { signal, timeoutMs: 45000 },
  );
  const rows = sanitizeRows(env.data);
  if (rows.length === 0) return null;
  return { data: saveRows(rows, "oi"), mode: liveMode(env.meta), asOf: env.meta.asOf, reason: env.meta.reason };
}

function isFiiStatsRow(v: unknown): v is FiiStatsRow {
  if (!v || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  return typeof r.segment === "string" && typeof r.longOi === "number" && typeof r.shortOi === "number";
}

export async function fetchFiiStats(date?: string, signal?: AbortSignal): Promise<Sourced<FiiStatsRow[]> | null> {
  const env = await proxyGet<unknown>("/api/x/fii-stats", { date }, { signal, timeoutMs: 20000 });
  const rows = Array.isArray(env.data) ? env.data.filter(isFiiStatsRow) : [];
  if (rows.length === 0) return null;
  return { data: rows, mode: liveMode(env.meta), asOf: env.meta.asOf, reason: env.meta.reason };
}

export async function fetchCashFlows(): Promise<Sourced<CashFlowDay[]>> {
  let latest: CashFlowDay[] = [];
  try {
    latest = parseCashFlows(await fetchFIIDII());
  } catch {
    latest = [];
  }
  const stored = latest.length ? saveCash(latest) : loadStoredCash();
  if (latest.length) return { data: stored, mode: "live", asOf: Date.now() };
  if (stored.length)
    return { data: stored, mode: "cache", reason: "FII/DII feed unavailable. Showing days recorded in this browser." };
  const t = nowIST();
  return {
    data: sampleCashFlows(60, latestExpectedDate()),
    mode: "sample",
    reason: `FII/DII feed unavailable on ${t.date}.`,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// FII positioning vs next-day NIFTY (lead-lag)
// ─────────────────────────────────────────────────────────────────────────────

export interface DailyClose {
  date: string;
  close: number;
}

/** Daily closes from the proxy's columnar candles (timestamps in seconds or ms), ascending, one per IST date. */
export function parseDailyCloses(
  data:
    | { timestamp?: Array<number | string>; start_Time?: Array<number | string>; close?: Array<number | null> }
    | null
    | undefined,
): DailyClose[] {
  const ts = data?.timestamp ?? data?.start_Time ?? [];
  const byDate = new Map<string, number>();
  ts.forEach((t, i) => {
    const sec = typeof t === "number" ? t : Number(t);
    const close = data?.close?.[i];
    if (!Number.isFinite(sec) || typeof close !== "number" || !Number.isFinite(close) || close <= 0) return;
    byDate.set(istDateString(new Date(sec > 1e12 ? sec : sec * 1000)), close);
  });
  return [...byDate.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([date, close]) => ({ date, close }));
}

export interface LeadLagPoint {
  date: string;
  /** FII index-futures long % on the day. */
  fiiLong: number;
  /** Day-over-day change in FII long %, percentage points. */
  fiiChange: number;
  /** NIFTY return from this day's close to the next session's close, percent. */
  nextRet: number;
}

export interface LeadLag {
  points: LeadLagPoint[];
  n: number;
  /** Pearson correlation of the day's change in FII long % with the next-day NIFTY return. */
  corrChange: number;
  /** Pearson correlation of the FII long % level with the next-day NIFTY return. */
  corrLevel: number;
}

/**
 * Pair each participant day t with NIFTY's close-to-close return from t to the next session in
 * `closes`. Days without a close on t or a later close are skipped; the first day has no change.
 */
export function nextDayCorrelation(series: HistoryPoint[], closes: DailyClose[]): LeadLag {
  const sorted = [...closes].sort((a, b) => (a.date < b.date ? -1 : 1));
  const idx = new Map(sorted.map((c, i) => [c.date, i]));
  const points: LeadLagPoint[] = [];
  for (let k = 1; k < series.length; k++) {
    const p = series[k];
    const i = idx.get(p.date);
    if (i === undefined || i + 1 >= sorted.length) continue;
    const change = p.fiiLongPct - series[k - 1].fiiLongPct;
    if (!Number.isFinite(change) || !Number.isFinite(p.fiiLongPct)) continue;
    points.push({
      date: p.date,
      fiiLong: p.fiiLongPct,
      fiiChange: change,
      nextRet: (sorted[i + 1].close / sorted[i].close - 1) * 100,
    });
  }
  return {
    points,
    n: points.length,
    corrChange: pearson(
      points.map((x) => x.fiiChange),
      points.map((x) => x.nextRet),
    ),
    corrLevel: pearson(
      points.map((x) => x.fiiLong),
      points.map((x) => x.nextRet),
    ),
  };
}

/** Plain-English strength of a correlation coefficient. */
export function correlationStrength(r: number): "none" | "weak" | "moderate" | "strong" | "unknown" {
  if (!Number.isFinite(r)) return "unknown";
  const a = Math.abs(r);
  return a < 0.1 ? "none" : a < 0.3 ? "weak" : a < 0.5 ? "moderate" : "strong";
}

/**
 * Simulated NIFTY closes for the sample dashboard: a seeded random walk on the series' dates plus
 * the next session, with only a faint link to FII positioning. Never shown as market data.
 */
export function sampleNiftyCloses(series: HistoryPoint[], seed = 31): DailyClose[] {
  const rand = mulberry32(seed);
  const out: DailyClose[] = [];
  let close = 25200;
  const dates = series.map((p) => p.date);
  const levels: number[] = [];
  for (let k = dates.length - 1; k >= 0; k--) {
    levels.unshift(close);
    const change = k > 0 ? series[k].fiiLongPct - series[k - 1].fiiLongPct : 0;
    const ret = (rand() - 0.5) * 0.018 + (Number.isFinite(change) ? change : 0) * 0.0004;
    close = close / (1 + ret);
  }
  dates.forEach((date, k) => out.push({ date, close: Math.round(levels[k] * 100) / 100 }));
  return out;
}

/** NIFTY 50 daily closes through the proxy (Yahoo daily candles). Null when unavailable. */
export async function fetchNiftyCloses(
  fromIso: string,
  toIso: string,
  signal?: AbortSignal,
): Promise<Sourced<DailyClose[]> | null> {
  try {
    const res = await proxyFetchJSON<HistoricalCandleResponse>(
      "/api/yahoo-chart",
      { symbol: "NIFTY", interval: "D", fromDate: fromIso, toDate: toIso },
      { withDhan: false, signal },
    );
    const closes = parseDailyCloses(res?.data);
    return closes.length ? { data: closes, mode: "live", asOf: Date.now() } : null;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Dashboard loader
// ─────────────────────────────────────────────────────────────────────────────

export interface ParticipantsDashboard {
  /** Date actually shown (yyyy-mm-dd) */
  date: string;
  /** Date the user asked for, or null for "latest" */
  requestedDate: string | null;
  mode: DataMode;
  reason?: string;
  /** True when the requested date is today and NSE has not published yet */
  awaitingPublication: boolean;
  /** The requested date had no file (holiday or not yet published); an earlier date is shown instead */
  fellBack: boolean;
  oi: ParticipantOIRow[];
  prevOi: ParticipantOIRow[];
  vol: ParticipantVolRow[];
  volMode: DataMode | null;
  views: ParticipantView[];
  fiiStats: FiiStatsRow[];
  fiiStatsDerived: boolean;
  history: ParticipantOIRow[];
  historyMode: DataMode;
  series: HistoryPoint[];
  storedDays: number;
}

function rowsOn(rows: ParticipantOIRow[], date: string): ParticipantOIRow[] {
  return rows.filter((r) => r.date === date);
}

function latestDateIn(rows: ParticipantOIRow[], onOrBefore?: string): string | null {
  let best: string | null = null;
  for (const r of rows) if ((!onOrBefore || r.date <= onOrBefore) && (!best || r.date > best)) best = r.date;
  return best;
}

function previousDateIn(rows: ParticipantOIRow[], date: string): string | null {
  let best: string | null = null;
  for (const r of rows) if (r.date < date && (!best || r.date > best)) best = r.date;
  return best;
}

/**
 * Load everything the Participants page needs. `date` null = latest published file.
 * `days` is the history window (up to 250 sessions, 1Y; the proxy serves 60, older days come from this browser).
 */
export async function loadParticipantsDashboard(opts: {
  date: string | null;
  days: number;
  now?: Date;
  signal?: AbortSignal;
}): Promise<ParticipantsDashboard> {
  const { date, signal } = opts;
  const days = Math.max(5, Math.min(MAX_HISTORY_DAYS, Math.floor(opts.days)));
  const now = opts.now ?? new Date();

  const [oiRes, volRes, histRes, statsRes] = await Promise.all([
    fetchParticipantOI(date ?? undefined, signal),
    fetchParticipantVol(date ?? undefined, signal),
    fetchParticipantHistory(Math.min(60, days), signal),
    fetchFiiStats(date ?? undefined, signal),
  ]);

  const stored = loadStoredRows("oi");
  const awaiting = !!date && isAwaitingPublication(date, now);

  // ── history ──
  let history: ParticipantOIRow[];
  let historyMode: DataMode;
  if (histRes || stored.length > 0) {
    history = stored.length ? stored : (histRes?.data ?? []);
    historyMode = histRes ? histRes.mode : "cache";
  } else {
    history = [];
    historyMode = "sample";
  }

  // ── selected date ──
  let mode: DataMode;
  let reason: string | undefined;
  let oi: ParticipantOIRow[] = [];
  let shownDate: string | null = null;
  let fellBack = false;

  if (oiRes) {
    oi = oiRes.data;
    shownDate = oi[0].date;
    mode = oiRes.mode;
    reason = oiRes.reason;
  } else {
    const cached = date ? rowsOn(history, date) : [];
    if (cached.length) {
      oi = cached;
      shownDate = date;
      mode = "cache";
      reason = "NSE file unavailable right now. Showing the copy saved in this browser.";
    } else {
      const fallbackDate = latestDateIn(history, date ?? undefined);
      if (fallbackDate) {
        oi = rowsOn(history, fallbackDate);
        shownDate = fallbackDate;
        mode = historyMode === "live" ? "cache" : historyMode;
        fellBack = !!date;
        reason = date
          ? `No participant file for ${date}.`
          : "Latest file unavailable. Showing the most recent saved day.";
      } else {
        mode = "sample";
      }
    }
  }

  if (mode === "sample" || !shownDate) {
    const end = date && isTradingDay(date) && !awaiting ? date : latestExpectedDate(now);
    history = sampleParticipantHistory(days, end);
    historyMode = "sample";
    shownDate = latestDateIn(history) ?? end;
    oi = rowsOn(history, shownDate);
    mode = "sample";
    reason = reason ?? "Participant data could not be loaded from NSE.";
  }

  // make sure the shown day is in the history used for charts
  if (historyMode !== "sample" && !history.some((r) => r.date === shownDate)) {
    history = flattenStore(mergeByDate(mergeByDate({}, history), oi));
  }

  // ── previous day for day-over-day change ──
  let prevDate = previousDateIn(history, shownDate);
  let prevOi = prevDate ? rowsOn(history, prevDate) : [];
  if (!prevOi.length && mode !== "sample") {
    const pd = previousTradingDay(shownDate);
    const prevRes = await fetchParticipantOI(pd, signal);
    if (prevRes) {
      prevOi = prevRes.data;
      prevDate = pd;
    }
  }

  // ── volume ──
  let vol: ParticipantVolRow[] = [];
  let volMode: DataMode | null = null;
  if (volRes && volRes.data[0]?.date === shownDate) {
    vol = volRes.data;
    volMode = volRes.mode;
  } else if (mode !== "sample") {
    const storedVol = rowsOn(loadStoredRows("vol"), shownDate);
    if (storedVol.length) {
      vol = storedVol;
      volMode = "cache";
    }
  } else {
    vol = sampleParticipantVolume(oi);
    volMode = "sample";
  }

  // ── FII stats ──
  let fiiStats: FiiStatsRow[];
  let fiiStatsDerived = false;
  if (statsRes && statsRes.data[0]?.date === shownDate && mode !== "sample") {
    fiiStats = statsRes.data;
  } else {
    fiiStats = deriveFiiStats(oi, vol.length ? vol : null);
    fiiStatsDerived = true;
  }

  const windowDates = [...new Set(history.map((r) => r.date))]
    .sort()
    .filter((d) => d <= shownDate)
    .slice(-days);
  const windowed = history.filter((r) => windowDates.includes(r.date));

  return {
    date: shownDate,
    requestedDate: date,
    mode,
    reason,
    awaitingPublication: awaiting && shownDate !== date,
    fellBack: fellBack || (!!date && shownDate !== date),
    oi,
    prevOi,
    vol,
    volMode,
    views: deriveParticipantViews(oi, prevOi),
    fiiStats,
    fiiStatsDerived,
    history: windowed,
    historyMode,
    series: buildHistorySeries(windowed),
    storedDays: new Set(stored.map((r) => r.date)).size,
  };
}

/** Earliest date the date picker offers (about 18 months back). */
export function minPickerDate(now: Date = new Date()): string {
  return addCalendarDays(nowIST(now).date, -548);
}
