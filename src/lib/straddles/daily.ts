/**
 * Multi-day straddle history from NSE F&O bhavcopy (one end-of-day file per trading day, through
 * the local proxy at /api/x/bhavcopy-fo), with a clearly labelled sample fallback built from the
 * sample chain priced at each day's 15:30 IST close.
 */
import {
  defaultSampleIv,
  expectedMoveFromStraddle,
  gaussianSource,
  generateSampleChain,
  isTradingDay,
  istDateString,
  mulberry32,
  nowIST,
  previousTradingDay,
  sampleSeed,
  timeToExpiryYears,
  toISTDate,
} from "@/lib/options";
import type { BhavcopyFoRow } from "@/lib/history/contractSeries";
import { sampleSessionWindow } from "@/lib/flow";
import type { StrikeSelection } from "./selection";

export type { BhavcopyFoRow };

/** One trading day's bhavcopy rows for a symbol and expiry. */
export interface BhavcopyDay {
  date: string;
  rows: BhavcopyFoRow[];
}

export interface DailyStraddleRow {
  date: string;
  underlyingClose: number;
  ceStrike: number;
  peStrike: number;
  ce: number;
  pe: number;
  combined: number;
  /** Combined premium as a percent of the underlying close. */
  combinedPct: number;
  /** Change in the combined premium from the previous row (₹ per unit); NaN on the first row, or when a fixed pair's strikes changed. */
  change: number;
  changePct: number;
  ceOi: number;
  peOi: number;
  /** Contracts traded across both legs. */
  volume: number;
  /** Straddle-implied move (0.85 × combined) for same-strike pairs, in points. */
  impliedMove: number;
}

const finite = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const priceOf = (r: BhavcopyFoRow | undefined) => (r ? (r.close > 0 ? r.close : r.settle > 0 ? r.settle : NaN) : NaN);

/** Straddle (or custom pair) per day from bhavcopy rows. The rolling ATM is the strike nearest each day's underlying close. */
export function dailyStraddles(days: BhavcopyDay[], sel: StrikeSelection): DailyStraddleRow[] {
  const out: DailyStraddleRow[] = [];
  const sorted = (Array.isArray(days) ? days : []).filter((d) => d && typeof d.date === "string").sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  for (const day of sorted) {
    const ce = new Map<number, BhavcopyFoRow>();
    const pe = new Map<number, BhavcopyFoRow>();
    let under = NaN;
    for (const r of day.rows ?? []) {
      if (!r || !finite(r.strike)) continue;
      if (r.type === "CE") ce.set(r.strike, r);
      else if (r.type === "PE") pe.set(r.strike, r);
      if (!finite(under) && finite(r.underlyingClose) && r.underlyingClose > 0) under = r.underlyingClose;
    }
    let ceK = NaN;
    let peK = NaN;
    if (sel.kind === "atm") {
      if (!finite(under)) continue;
      let best = NaN;
      for (const [k, c] of ce) {
        if (!finite(priceOf(c)) || !finite(priceOf(pe.get(k)))) continue;
        if (!finite(best) || Math.abs(k - under) < Math.abs(best - under)) best = k;
      }
      ceK = best;
      peK = best;
    } else if (sel.kind === "fixed") {
      ceK = sel.strike;
      peK = sel.strike;
    } else {
      ceK = sel.ce;
      peK = sel.pe;
    }
    const c = ce.get(ceK);
    const p = pe.get(peK);
    const cp = priceOf(c);
    const pp = priceOf(p);
    if (!finite(cp) || !finite(pp)) continue;
    const combined = cp + pp;
    const prev = out[out.length - 1];
    // The rolling ATM compares day to day like an index; fixed strikes and pairs only when unchanged.
    const comparable = !!prev && (sel.kind === "atm" || (prev.ceStrike === ceK && prev.peStrike === peK));
    const change = comparable ? combined - prev.combined : NaN;
    out.push({
      date: day.date,
      underlyingClose: under,
      ceStrike: ceK,
      peStrike: peK,
      ce: cp,
      pe: pp,
      combined,
      combinedPct: finite(under) && under > 0 ? (combined / under) * 100 : NaN,
      change,
      changePct: comparable && prev.combined > 0 ? (change / prev.combined) * 100 : NaN,
      ceOi: c?.oi ?? NaN,
      peOi: p?.oi ?? NaN,
      volume: (c?.volume ?? 0) + (p?.volume ?? 0),
      impliedMove: ceK === peK && finite(under) ? expectedMoveFromStraddle(combined, under).move : NaN,
    });
  }
  return out;
}

/**
 * Trading dates for the daily view, oldest first: the last `days` sessions before today, plus today
 * once NSE has published its bhavcopy (after 19:00 IST). Never after the contract's expiry.
 */
export function straddleHistoryDates(now: Date, days: number, expiry?: string): string[] {
  const t = nowIST(now);
  const today = istDateString(now);
  let d = isTradingDay(today) && t.hh >= 19 ? today : previousTradingDay(today);
  const want = Math.max(0, Math.min(60, Math.floor(days)));
  const out: string[] = [];
  for (let guard = 0; d && out.length < want && guard < 250; guard++) {
    if (!expiry || d <= expiry) out.push(d);
    d = previousTradingDay(d);
  }
  return out.reverse();
}

/**
 * SAMPLE bhavcopy days for a symbol and expiry (always labelled "Sample"): underlying closes walk
 * back from today's sample spot and every strike is priced by the sample chain at that day's close.
 * When the last date is the sample intraday session's day, that day closes on the sample chain at
 * `now` (the same anchor as the sample session), so the daily and intraday views agree.
 * Deterministic for the same inputs.
 */
export function sampleBhavcopyDays(o: { symbol: string; expiry: string; spot: number; dates: string[]; strikes?: number; now?: Date }): BhavcopyDay[] {
  const symbol = String(o?.symbol || "").toUpperCase();
  if (!symbol || !(o.spot > 0) || !o.expiry || !Array.isArray(o.dates) || o.dates.length === 0) return [];
  const dates = o.dates.filter((d) => timeToExpiryYears(o.expiry, toISTDate(d, "15:30")) >= 0 && d <= o.expiry);
  if (dates.length === 0) return [];
  const iv = defaultSampleIv(symbol);
  const rand = mulberry32(sampleSeed(symbol, o.expiry, 7_331 + dates.length));
  const gauss = gaussianSource(rand);
  const dailyVol = iv / Math.sqrt(252);
  const now = o.now ?? new Date();
  const anchorLast = dates[dates.length - 1] === sampleSessionWindow(now).date && timeToExpiryYears(o.expiry, now) > 0;
  const closes: number[] = new Array(dates.length);
  let s = o.spot;
  for (let i = dates.length - 1; i >= 0; i--) {
    if (!(anchorLast && i === dates.length - 1)) s = s * Math.exp(-gauss() * dailyVol);
    closes[i] = Math.round(s * 100) / 100;
  }
  return dates.map((date, i) => {
    const atmIv = iv * (1 + 0.06 * gauss());
    const anchored = anchorLast && i === dates.length - 1;
    const { chain } = anchored
      ? generateSampleChain({ symbol, spot: o.spot, expiry: o.expiry, now })
      : generateSampleChain({ symbol, spot: closes[i], expiry: o.expiry, now: toISTDate(date, "15:30"), atmIv, strikes: o.strikes ?? 41 });
    const rows: BhavcopyFoRow[] = [];
    for (const r of chain) {
      for (const type of ["CE", "PE"] as const) {
        const leg = type === "CE" ? r.ce : r.pe;
        rows.push({ symbol, expiry: o.expiry, strike: r.strikePrice, type, close: leg.ltp, settle: leg.ltp, oi: leg.oi, chgOi: leg.oiChange, volume: leg.volume, underlyingClose: closes[i] });
      }
    }
    return { date, rows };
  });
}

export type BhavcopyFetcher = (date: string) => Promise<{ data: BhavcopyFoRow[] | null; reason?: string }>;

export interface BhavcopyLoad {
  days: BhavcopyDay[];
  requested: number;
  answered: number;
  /** Why nothing came back, when answered is 0. */
  reason?: string;
}

const OFFLINE = new Set(["proxy-offline", "offline", "sample-mode"]);

/** Fetch bhavcopy days two at a time (each is a large archive), stopping early when the proxy is offline. */
export async function loadBhavcopyDays(dates: string[], fetchDay: BhavcopyFetcher, o: { signal?: AbortSignal } = {}): Promise<BhavcopyLoad> {
  const days: BhavcopyDay[] = [];
  let answered = 0;
  let lastReason = "";
  for (let i = 0; i < dates.length; i += 2) {
    if (o.signal?.aborted) break;
    const batch = dates.slice(i, i + 2);
    const res = await Promise.all(batch.map((date) => fetchDay(date).then((r) => ({ date, r }))));
    let offline = false;
    for (const { date, r } of res) {
      if (!r.data) {
        lastReason = r.reason ?? "unavailable";
        if (OFFLINE.has(lastReason)) offline = true;
        continue;
      }
      answered++;
      days.push({ date, rows: r.data });
    }
    if (offline) break;
  }
  return { days, requested: dates.length, answered, reason: answered === 0 ? lastReason || "no data" : undefined };
}
