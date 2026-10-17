/**
 * Pure expiry-day (0DTE) analytics: straddle series, VWAP, constant-IV decay curves, theta per
 * minute, hero-zero screening, OI walls and max-pain drift, multi-straddle combos and the expiry
 * rule examples. No React and no DOM; every function tolerates bad input and returns NaN or empty.
 *
 * Pricing, Greeks, probabilities, time and charges come from "@/lib/options". The only local maths
 * is straddleIV76 (implied vol of a CE+PE pair by bisection), which the shared contract lacks.
 *
 * Time convention: the decay curve and theta use TRADING time (only the 375 session minutes count),
 * so "theta per minute" = Black-76 thetaTrading ÷ 375 is the model decay per session minute on both
 * expiry day and earlier days. Displayed ATM IV stays in the usual calendar convention.
 */
import type { OptionData, OptionLegData } from "@/lib/mockData";
import type { BasketLeg } from "@/components/option-chain/basket";
import type { ChainSnapshot, StrikeSnap } from "@/lib/snapshotStore";
import {
  DIVIDEND_YIELD,
  TRADING_MINUTES_PER_DAY,
  addCalendarDays,
  atmIV,
  atmStraddle,
  black76Price,
  chainForward,
  enrichChain,
  expectedMoveFromIV,
  expectedMoveFromStraddle,
  forwardFromSpot,
  getChargeRates,
  getContractSpec,
  getExpiries,
  greeks76,
  isTradingDay,
  isoWeekday,
  istDateString,
  isWeeklyExpiry,
  maxPain,
  nowIST,
  probITM,
  timeToExpiryYears,
  toISTDate,
  type OptionType,
} from "@/lib/options";

const finite = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const pos = (x: unknown): x is number => finite(x) && x > 0;

/** Index option underlyings with expiries, in selector order. */
export const EXPIRY_SYMBOLS = ["NIFTY", "SENSEX", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "BANKEX"] as const;
export type ExpirySymbol = (typeof EXPIRY_SYMBOLS)[number];

export function isExpirySymbol(s: string): s is ExpirySymbol {
  return (EXPIRY_SYMBOLS as readonly string[]).includes(s);
}

export function dividendYield(symbol: string): number {
  const q = DIVIDEND_YIELD[symbol.toUpperCase()];
  return finite(q) ? q : 0;
}

// ── Symbol and expiry selection ──

export interface ExpiryPick {
  symbol: ExpirySymbol;
  expiry: string;
  /** True when that expiry is today (IST) and has not passed 15:30. */
  today: boolean;
  type: "weekly" | "monthly";
}

/**
 * The default symbol for the page: a weekly expiring today (NIFTY on Tuesday, SENSEX on Thursday),
 * then any monthly expiring today, then whichever weekly expires soonest.
 */
export function pickExpirySymbol(now: Date = new Date(), symbols: readonly ExpirySymbol[] = EXPIRY_SYMBOLS): ExpiryPick {
  const today = istDateString(now);
  const cands: ExpiryPick[] = [];
  for (const symbol of symbols) {
    const e = getExpiries(symbol, now, 1)[0];
    if (!e) continue;
    const weekly = isWeeklyExpiry(symbol, e.date);
    cands.push({ symbol, expiry: e.date, today: e.date === today, type: weekly ? "weekly" : e.type });
  }
  const weeklyToday = cands.find((c) => c.today && c.type === "weekly");
  if (weeklyToday) return weeklyToday;
  const anyToday = cands.find((c) => c.today);
  if (anyToday) return anyToday;
  const weeklies = cands.filter((c) => c.type === "weekly").sort((a, b) => (a.expiry < b.expiry ? -1 : a.expiry > b.expiry ? 1 : 0));
  if (weeklies[0]) return weeklies[0];
  return cands[0] ?? { symbol: "NIFTY", expiry: "", today: false, type: "weekly" };
}

/** Next two expiries for a symbol (near and next). */
export function nearAndNext(symbol: string, now: Date = new Date()): { near: string; next: string } {
  const list = getExpiries(symbol, now, 2);
  return { near: list[0]?.date ?? "", next: list[1]?.date ?? "" };
}

// ── Snapshot helpers ──

/** Mid when a sane two-sided quote exists (spread at most 20% of mid), else LTP. NaN when nothing. */
export function snapMid(s: Pick<StrikeSnap, "ltp" | "bid" | "ask"> | undefined): number {
  if (!s) return NaN;
  if (pos(s.bid) && pos(s.ask) && s.ask >= s.bid) {
    const mid = (s.bid + s.ask) / 2;
    if (s.ask - s.bid <= Math.max(0.1, mid * 0.2)) return mid;
  }
  return pos(s.ltp) ? s.ltp : NaN;
}

export type SnapIndex = Map<string, StrikeSnap>;
const key = (strike: number, side: OptionType) => `${strike}|${side}`;

export function indexSnapshot(snap: Pick<ChainSnapshot, "rows">): SnapIndex {
  const m: SnapIndex = new Map();
  for (const r of snap?.rows ?? []) m.set(key(r.strike, r.side), r);
  return m;
}

/** Sorted strikes that have both a CE and a PE price. */
export function pairedStrikes(idx: SnapIndex): number[] {
  const out = new Set<number>();
  for (const r of idx.values()) {
    if (r.side !== "CE") continue;
    const pe = idx.get(key(r.strike, "PE"));
    if (pe && finite(snapMid(r)) && finite(snapMid(pe))) out.add(r.strike);
  }
  return [...out].sort((a, b) => a - b);
}

export function nearestOf(values: number[], target: number): number {
  if (values.length === 0 || !finite(target)) return NaN;
  let best = values[0];
  for (const v of values) if (Math.abs(v - target) < Math.abs(best - target)) best = v;
  return best;
}

/** Keep at most `max` evenly spaced items, always keeping the first and last. */
export function downsample<T>(arr: T[], max: number): T[] {
  if (!Array.isArray(arr)) return [];
  if (max < 2 || arr.length <= max) return arr.slice();
  const out: T[] = [];
  const step = (arr.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) out.push(arr[Math.round(i * step)]);
  return out;
}

/** Merge snapshot lists by time, dropping any that fall within minGapMs of the previous kept one. */
export function mergeSnapshots(lists: ChainSnapshot[][], minGapMs = 10_000): ChainSnapshot[] {
  const all = lists.flat().filter((s) => s && finite(s.ts) && Array.isArray(s.rows) && s.rows.length > 0);
  all.sort((a, b) => a.ts - b.ts);
  const out: ChainSnapshot[] = [];
  for (const s of all) {
    const last = out[out.length - 1];
    if (last && s.ts - last.ts < minGapMs) continue;
    out.push(s);
  }
  return out;
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Weekday name of an ISO expiry date ("Tuesday"); "" when invalid. */
export function expiryWeekday(expiry: string): string {
  if (!expiry) return "";
  const t = toISTDate(expiry, "12:00").getTime();
  if (!Number.isFinite(t)) return "";
  return WEEKDAYS[nowIST(new Date(t)).weekday] ?? "";
}

/**
 * The regular expiry date this contract was moved from, when an exchange holiday pulled it to an
 * earlier day (for example Tue 20 Oct 2026, Dussehra, to Mon 19 Oct). Null for a normal expiry.
 */
export function shiftedFromDate(symbol: string, expiry: string): string | null {
  const spec = getContractSpec(symbol);
  if (!spec || !expiry) return null;
  const wd = isoWeekday(expiry);
  if (!Number.isFinite(wd) || wd === spec.expiryWeekday) return null;
  for (let i = 1; i <= 6; i++) {
    const d = addCalendarDays(expiry, i);
    if (isoWeekday(d) !== spec.expiryWeekday) continue;
    return isTradingDay(d, spec.exchange) ? null : d;
  }
  return null;
}

/** Tailwind text class for a signed value. */
export function signTone(v: number): string {
  if (!Number.isFinite(v) || v === 0) return "";
  return v > 0 ? "text-bullish" : "text-bearish";
}

/** "14:32" in IST for an epoch ms. */
export function hhmmIST(ts: number): string {
  if (!finite(ts)) return "—";
  const d = new Date(ts + 330 * 60_000);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

// ── Straddle series and VWAP ──

export interface StraddlePoint {
  ts: number;
  spot: number;
  /** Call strike (the straddle strike; for a custom pair, the CE strike). */
  strike: number;
  /** Put strike: equal to `strike` for a straddle, different for a custom CE/PE pair. */
  peStrike: number;
  ce: number;
  pe: number;
  straddle: number;
  /** Combined cumulative CE+PE volume at the strike (contracts), NaN when unknown. */
  vol: number;
}

/** Floating ATM, a fixed straddle strike, or a custom pair (CE and PE at their own strikes). */
export type StrikeMode = { kind: "floating" } | { kind: "fixed"; strike: number } | { kind: "pair"; ce: number; pe: number };

/** True when the mode prices two legs at different strikes (a strangle or any custom pair). */
export function isSplitPair(mode: StrikeMode | undefined): boolean {
  return mode?.kind === "pair" && mode.ce !== mode.pe;
}

/** ATM straddle (floating), a fixed-strike straddle or a custom CE/PE pair for each snapshot. Snapshots without prices are skipped. */
export function straddleSeries(snaps: ChainSnapshot[], mode: StrikeMode = { kind: "floating" }): StraddlePoint[] {
  const out: StraddlePoint[] = [];
  for (const s of snaps ?? []) {
    if (!s || !finite(s.ts)) continue;
    const idx = indexSnapshot(s);
    let ceK: number;
    let peK: number;
    if (mode.kind === "pair") {
      ceK = mode.ce;
      peK = mode.pe;
    } else {
      const strikes = pairedStrikes(idx);
      if (strikes.length === 0) continue;
      ceK = mode.kind === "fixed" ? mode.strike : nearestOf(strikes, s.spot);
      if (!strikes.includes(ceK)) continue;
      peK = ceK;
    }
    const c = idx.get(key(ceK, "CE"));
    const p = idx.get(key(peK, "PE"));
    const ce = snapMid(c);
    const pe = snapMid(p);
    if (!finite(ce) || !finite(pe)) continue;
    const vol = c && p && finite(c.vol) && finite(p.vol) ? c.vol + p.vol : NaN;
    out.push({ ts: s.ts, spot: s.spot, strike: ceK, peStrike: peK, ce, pe, straddle: ce + pe, vol });
  }
  return out;
}

/**
 * Running VWAP of a straddle series. Weights are the increase in combined volume at the same strike
 * between consecutive points; until any volume is seen the running time-average is used.
 */
export function vwapSeries(points: StraddlePoint[]): { values: number[]; basis: "volume" | "time" } {
  let pv = 0;
  let v = 0;
  let tw = 0;
  let n = 0;
  const values: number[] = [];
  for (let i = 0; i < (points ?? []).length; i++) {
    const p = points[i];
    tw += p.straddle;
    n += 1;
    const prev = points[i - 1];
    if (prev && prev.strike === p.strike && prev.peStrike === p.peStrike && finite(prev.vol) && finite(p.vol)) {
      const w = p.vol - prev.vol;
      if (w > 0) {
        pv += w * p.straddle;
        v += w;
      }
    }
    values.push(v > 0 ? pv / v : tw / n);
  }
  return { values, basis: v > 0 ? "volume" : "time" };
}

// ── Black-76 straddle helpers ──

export function straddlePrice76(F: number, K: number, T: number, r: number, sigma: number): number {
  if (!pos(F) || !pos(K) || !finite(T) || !finite(r) || !finite(sigma)) return NaN;
  return black76Price({ F, K, T, r, sigma, type: "CE" }) + black76Price({ F, K, T, r, sigma, type: "PE" });
}

/** Implied vol (decimal) of a CE+PE pair by bisection. NaN when the price is below intrinsic or T ≤ 0. Local helper: not in the shared contract. */
export function straddleIV76(price: number, F: number, K: number, T: number, r: number): number {
  if (!pos(price) || !pos(F) || !pos(K) || !pos(T) || !finite(r)) return NaN;
  const intrinsicPV = Math.abs(F - K) * Math.exp(-r * T);
  if (price <= intrinsicPV + 1e-9) return NaN;
  let lo = 0.001;
  let hi = 5;
  if (straddlePrice76(F, K, T, r, hi) < price) return NaN;
  if (straddlePrice76(F, K, T, r, lo) > price) return lo;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    const v = straddlePrice76(F, K, T, r, mid);
    if (v > price) hi = mid;
    else lo = mid;
    if (hi - lo < 1e-7) break;
  }
  return (lo + hi) / 2;
}

/** Trading-time T in years at an instant (session minutes only, floor 1 minute; 0 after expiry). */
export function tradingT(expiry: string, ts: number): number {
  return timeToExpiryYears(expiry, new Date(ts), { mode: "trading" });
}

/** Theta of a long straddle per session minute (₹ per unit, negative) = Black-76 thetaTrading ÷ 375. */
export function straddleThetaPerMinute(F: number, K: number, T: number, r: number, sigma: number): number {
  if (!pos(F) || !pos(K) || !pos(T) || !pos(sigma) || !finite(r)) return NaN;
  const c = greeks76({ F, K, T, r, sigma, type: "CE" });
  const p = greeks76({ F, K, T, r, sigma, type: "PE" });
  const day = c.thetaTrading + p.thetaTrading;
  return finite(day) ? day / TRADING_MINUTES_PER_DAY : NaN;
}

/** Model decay over the next `minutes` session minutes at constant F and IV (positive = value lost). */
export function straddleDecayOver(F: number, K: number, T: number, r: number, sigma: number, minutes: number): number {
  if (!pos(T) || !finite(minutes) || minutes <= 0) return NaN;
  const dT = minutes / (252 * TRADING_MINUTES_PER_DAY);
  const now = straddlePrice76(F, K, T, r, sigma);
  const later = straddlePrice76(F, K, Math.max(T - dT, 0), r, sigma);
  return now - later;
}

export interface TheoryPoint {
  ts: number;
  /** Pure time decay: spot and IV frozen at the opening values. */
  theory: number;
}

export interface StraddleAnalytics {
  points: StraddlePoint[];
  vwap: number[];
  vwapBasis: "volume" | "time";
  open: StraddlePoint | null;
  last: StraddlePoint | null;
  /** Share of the opening straddle that has decayed (0..1, negative when it gained). */
  decayPct: number;
  /** Opening straddle IV (decimal, trading-time) used for the constant-IV curve. */
  sigmaOpen: number;
  /** Current straddle IV (decimal, trading-time). */
  sigmaNow: number;
  /** Opening IV restated in calendar convention (decimal) for display. */
  sigmaOpenCalendar: number;
  sigmaNowCalendar: number;
  /** Constant-IV, constant-spot decay curve from the open to the session close (or expiry). */
  theory: TheoryPoint[];
  /** Theory value at the last point's time. */
  theoryNow: number;
  /** Theory decay share at the last point's time. */
  theoryDecayPct: number;
  /** ₹ per unit per session minute (negative for a long straddle). */
  thetaPerMin: number;
  /** Model value lost over the next 15 session minutes (₹ per unit). */
  decayNext15: number;
  /** Strike used for the theory curve (opening strike). */
  theoryStrike: number;
  /** Session close used for the curve (epoch ms). */
  curveEnd: number;
}

const EMPTY_ANALYTICS: StraddleAnalytics = {
  points: [],
  vwap: [],
  vwapBasis: "time",
  open: null,
  last: null,
  decayPct: NaN,
  sigmaOpen: NaN,
  sigmaNow: NaN,
  sigmaOpenCalendar: NaN,
  sigmaNowCalendar: NaN,
  theory: [],
  theoryNow: NaN,
  theoryDecayPct: NaN,
  thetaPerMin: NaN,
  decayNext15: NaN,
  theoryStrike: NaN,
  curveEnd: NaN,
};

/** 15:30 IST of the IST date of ts, capped at the expiry close. */
export function sessionCloseFor(ts: number, expiry: string): number {
  const day = istDateString(new Date(ts));
  const close = toISTDate(day, "15:30").getTime();
  const exp = expiry ? toISTDate(expiry, "15:30").getTime() : NaN;
  return finite(exp) ? Math.min(close, exp) : close;
}

/** Everything the straddle panels need, from a time-ordered snapshot list. */
export function analyseStraddle(
  snaps: ChainSnapshot[],
  o: { expiry: string; r: number; q?: number; mode?: StrikeMode; stepMin?: number },
): StraddleAnalytics {
  const points = straddleSeries(snaps, o.mode ?? { kind: "floating" });
  if (points.length === 0) return EMPTY_ANALYTICS;
  // A split CE/PE pair has no single-strike Black-76 straddle, so its IV, theta and theory stay NaN.
  const modelled = !isSplitPair(o.mode);
  const { values: vwap, basis: vwapBasis } = vwapSeries(points);
  const open = points[0];
  const last = points[points.length - 1];
  const q = o.q ?? 0;
  const r = o.r;
  const decayPct = open.straddle > 0 ? (open.straddle - last.straddle) / open.straddle : NaN;

  const T0 = tradingT(o.expiry, open.ts);
  const F0 = forwardFromSpot(open.spot, T0, r, q);
  const K0 = open.strike;
  const sigmaOpen = modelled ? straddleIV76(open.straddle, F0, K0, T0, r) : NaN;
  const Tn = tradingT(o.expiry, last.ts);
  const Fn = forwardFromSpot(last.spot, Tn, r, q);
  const sigmaNow = modelled ? straddleIV76(last.straddle, Fn, last.strike, Tn, r) : NaN;
  const T0c = timeToExpiryYears(o.expiry, new Date(open.ts));
  const Tnc = timeToExpiryYears(o.expiry, new Date(last.ts));
  const sigmaOpenCalendar = pos(T0c) && finite(sigmaOpen) ? sigmaOpen * Math.sqrt(T0 / T0c) : NaN;
  const sigmaNowCalendar = pos(Tnc) && finite(sigmaNow) ? sigmaNow * Math.sqrt(Tn / Tnc) : NaN;

  const curveEnd = sessionCloseFor(open.ts, o.expiry);
  const theory: TheoryPoint[] = [];
  if (finite(sigmaOpen)) {
    const stepMs = Math.max(1, o.stepMin ?? 5) * 60_000;
    const first = Math.ceil(open.ts / stepMs) * stepMs;
    const at = (ts: number): TheoryPoint => ({ ts, theory: straddlePrice76(F0, K0, tradingT(o.expiry, ts), r, sigmaOpen) });
    theory.push({ ts: open.ts, theory: open.straddle });
    for (let t = first; t < curveEnd; t += stepMs) if (t > open.ts) theory.push(at(t));
    if (curveEnd > open.ts) theory.push(at(curveEnd));
  }
  const Tl = tradingT(o.expiry, last.ts);
  const theoryNow = finite(sigmaOpen) ? straddlePrice76(F0, K0, Tl, r, sigmaOpen) : NaN;
  const theoryDecayPct = finite(theoryNow) && open.straddle > 0 ? (open.straddle - theoryNow) / open.straddle : NaN;

  return {
    points,
    vwap,
    vwapBasis,
    open,
    last,
    decayPct,
    sigmaOpen,
    sigmaNow,
    sigmaOpenCalendar,
    sigmaNowCalendar,
    theory,
    theoryNow,
    theoryDecayPct,
    thetaPerMin: straddleThetaPerMinute(Fn, last.strike, Tn, r, sigmaNow),
    decayNext15: straddleDecayOver(Fn, last.strike, Tn, r, sigmaNow, 15),
    theoryStrike: K0,
    curveEnd,
  };
}

/**
 * Fixed-strike decomposition: for each point, the constant-IV value with the ACTUAL spot path.
 * Actual − this = the part explained by IV change; this − pure-time theory = the part explained by spot.
 */
export function constantIvWithSpot(points: StraddlePoint[], o: { expiry: string; r: number; q?: number; sigma: number; strike: number }): number[] {
  return (points ?? []).map((p) => {
    const T = tradingT(o.expiry, p.ts);
    const F = forwardFromSpot(p.spot, T, o.r, o.q ?? 0);
    return straddlePrice76(F, o.strike, T, o.r, o.sigma);
  });
}

/** Theoretical value and share remaining at fixed IST checkpoints of the opening day. */
export function decaySchedule(
  a: Pick<StraddleAnalytics, "open" | "sigmaOpen" | "theoryStrike">,
  o: { expiry: string; r: number; q?: number; checkpoints?: string[] },
): Array<{ time: string; ts: number; value: number; remainingPct: number }> {
  if (!a.open || !finite(a.sigmaOpen)) return [];
  const day = istDateString(new Date(a.open.ts));
  const T0 = tradingT(o.expiry, a.open.ts);
  const F0 = forwardFromSpot(a.open.spot, T0, o.r, o.q ?? 0);
  const cps = o.checkpoints ?? ["10:00", "11:00", "12:00", "13:00", "14:00", "14:30", "15:00", "15:15", "15:25"];
  const out: Array<{ time: string; ts: number; value: number; remainingPct: number }> = [];
  for (const time of cps) {
    const ts = toISTDate(day, time).getTime();
    if (!(ts > a.open.ts)) continue;
    const value = straddlePrice76(F0, a.theoryStrike, tradingT(o.expiry, ts), o.r, a.sigmaOpen);
    out.push({ time, ts, value, remainingPct: a.open.straddle > 0 ? value / a.open.straddle : NaN });
  }
  return out;
}

/** Premium chart Y domain: ₹10 per unit either side of the data (scaled by the lot multiplier), never below zero. */
export function premiumDomain(mult: number): [(min: number) => number, (max: number) => number] {
  const pad = 10 * (Number.isFinite(mult) && mult > 0 ? mult : 1);
  return [(min: number) => Math.max(0, Math.floor(min - pad)), (max: number) => Math.ceil(max + pad)];
}

// ── Multi-straddle / strangle combos ──

export interface ComboSpec {
  id: string;
  kind: "straddle" | "strangle";
  /** Straddle: strike = base + offset. Strangle: CE at base + offset, PE at base − offset (offset > 0). */
  offset: number;
  expiry: "near" | "next";
}

export const MAX_COMBOS = 4;
export const COMBO_STORAGE_KEY = "mc_expiry_combos_v1";

export function defaultCombos(step: number): ComboSpec[] {
  const s = pos(step) ? step : 50;
  return [
    { id: "atm", kind: "straddle", offset: 0, expiry: "near" },
    { id: "str2", kind: "strangle", offset: 2 * s, expiry: "near" },
    { id: "next", kind: "straddle", offset: 0, expiry: "next" },
  ];
}

/** Validate combos read from storage; drops anything malformed and caps at MAX_COMBOS. */
export function parseCombos(raw: unknown): ComboSpec[] {
  if (!Array.isArray(raw)) return [];
  const out: ComboSpec[] = [];
  const seen = new Set<string>();
  for (const x of raw) {
    if (!x || typeof x !== "object") continue;
    const c = x as Record<string, unknown>;
    const kind = c.kind === "straddle" || c.kind === "strangle" ? c.kind : null;
    const expiry = c.expiry === "near" || c.expiry === "next" ? c.expiry : null;
    const offset = typeof c.offset === "number" && Number.isFinite(c.offset) ? Math.round(c.offset) : null;
    const id = typeof c.id === "string" && c.id ? c.id : null;
    if (!kind || !expiry || offset === null || !id || seen.has(id)) continue;
    if (kind === "strangle" && offset <= 0) continue;
    if (Math.abs(offset) > 5000) continue;
    seen.add(id);
    out.push({ id, kind, offset, expiry });
    if (out.length >= MAX_COMBOS) break;
  }
  return out;
}

export function comboStrikes(spec: ComboSpec, base: number): { ce: number; pe: number } {
  if (spec.kind === "straddle") return { ce: base + spec.offset, pe: base + spec.offset };
  return { ce: base + Math.abs(spec.offset), pe: base - Math.abs(spec.offset) };
}

export function comboLabel(spec: ComboSpec, base?: number): string {
  const exp = spec.expiry === "next" ? " · next exp" : "";
  if (spec.kind === "straddle") {
    const rel = spec.offset === 0 ? "ATM" : `ATM${spec.offset > 0 ? "+" : "−"}${Math.abs(spec.offset)}`;
    return `${rel} straddle${finite(base) ? ` (${base + spec.offset})` : ""}${exp}`;
  }
  const s = comboStrikes(spec, finite(base) ? base : 0);
  return `±${Math.abs(spec.offset)} strangle${finite(base) ? ` (${s.pe}/${s.ce})` : ""}${exp}`;
}

/** Combined premium (₹ per unit) of a combo across a snapshot series at fixed strikes. */
export function comboSeries(snaps: ChainSnapshot[], spec: ComboSpec, base: number): Array<{ ts: number; value: number }> {
  if (!finite(base)) return [];
  const { ce, pe } = comboStrikes(spec, base);
  const out: Array<{ ts: number; value: number }> = [];
  for (const s of snaps ?? []) {
    const idx = indexSnapshot(s);
    const c = snapMid(idx.get(key(ce, "CE")));
    const p = snapMid(idx.get(key(pe, "PE")));
    if (finite(c) && finite(p)) out.push({ ts: s.ts, value: c + p });
  }
  return out;
}

/** Opening ATM strike of a series (nearest paired strike to the first snapshot's spot). */
export function openingATM(snaps: ChainSnapshot[]): number {
  for (const s of snaps ?? []) {
    const strikes = pairedStrikes(indexSnapshot(s));
    if (strikes.length > 0) return nearestOf(strikes, s.spot);
  }
  return NaN;
}

// ── Hero-zero ──

export interface HeroZeroRow {
  strike: number;
  type: OptionType;
  ltp: number;
  /** % change vs previous close (live) or vs the first snapshot of the session. NaN when unknown. */
  changePct: number;
  changeBasis: "prev-close" | "session-open" | "none";
  volume: number;
  oi: number;
  /** Distance from spot to strike, % of spot (positive = OTM). */
  distancePct: number;
  /** Gamma per ₹1 of premium (per unit). */
  gammaPerRupee: number;
  /** Probability of expiring in the money (decimal). */
  probITM: number;
  /** Probability of profit at expiry for the long: beyond strike ± premium (decimal). */
  pop: number;
  /** Leg IV used, decimal. */
  iv: number;
}

type LegExt = OptionLegData & { pChange?: number };

/** Far-OTM contracts priced under maxPrice, with gain, volume, gamma per ₹ and POP. */
export function heroZeroCandidates(
  chain: OptionData[],
  o: { spot: number; expiry: string; now?: Date; r: number; q?: number; maxPrice?: number; minPrice?: number; openLtp?: Map<string, number> },
): HeroZeroRow[] {
  if (!Array.isArray(chain) || chain.length === 0 || !pos(o.spot) || !o.expiry) return [];
  const now = o.now ?? new Date();
  const maxPrice = o.maxPrice ?? 10;
  const minPrice = o.minPrice ?? 0.05;
  const T = timeToExpiryYears(o.expiry, now);
  if (!pos(T)) return [];
  const F = chainForward(chain, o.spot, T, o.r);
  const enriched = enrichChain(chain, { spot: o.spot, expiry: o.expiry, now, r: o.r, q: o.q, forward: pos(F) ? F : undefined });
  const fwd = pos(F) ? F : o.spot;
  const ivAtm = atmIV(chain, fwd);
  const strikes = enriched.map((r) => r.strikePrice).filter(pos).sort((a, b) => a - b);
  const atm = nearestOf(strikes, o.spot);
  const out: HeroZeroRow[] = [];
  for (const row of enriched) {
    const K = row.strikePrice;
    if (!pos(K) || K === atm) continue;
    for (const type of ["CE", "PE"] as const) {
      const otm = type === "CE" ? K > o.spot : K < o.spot;
      if (!otm) continue;
      const leg = (type === "CE" ? row.ce : row.pe) as LegExt | undefined;
      if (!leg) continue;
      const ltp = leg.ltp;
      if (!pos(ltp) || ltp < minPrice || ltp >= maxPrice) continue;
      const ivPct = pos(leg.iv) ? leg.iv : ivAtm;
      const sigma = pos(ivPct) ? ivPct / 100 : NaN;
      let changePct = NaN;
      let changeBasis: HeroZeroRow["changeBasis"] = "none";
      if (finite(leg.pChange) && leg.pChange !== 0) {
        changePct = leg.pChange;
        changeBasis = "prev-close";
      } else {
        const o0 = o.openLtp?.get(key(K, type));
        if (pos(o0)) {
          changePct = ((ltp - o0) / o0) * 100;
          changeBasis = "session-open";
        }
      }
      const be = type === "CE" ? K + ltp : K - ltp;
      out.push({
        strike: K,
        type,
        ltp,
        changePct,
        changeBasis,
        volume: finite(leg.volume) ? leg.volume : 0,
        oi: finite(leg.oi) ? leg.oi : 0,
        distancePct: (Math.abs(K - o.spot) / o.spot) * 100,
        gammaPerRupee: finite(leg.gamma) && leg.gamma > 0 ? leg.gamma / ltp : NaN,
        probITM: finite(sigma) ? probITM({ F: fwd, K, T, sigma, type }) : NaN,
        pop: finite(sigma) && be > 0 ? probITM({ F: fwd, K: be, T, sigma, type }) : NaN,
        iv: sigma,
      });
    }
  }
  return out;
}

/** One long lot of a hero-zero contract as a basket leg (premium ₹ per unit, IV decimal). */
export function heroZeroLeg(symbol: string, expiry: string, x: Pick<HeroZeroRow, "strike" | "type" | "ltp" | "iv">): BasketLeg {
  return {
    symbol: symbol.toUpperCase(),
    expiry,
    strike: x.strike,
    type: x.type,
    side: "BUY",
    lots: 1,
    premium: Math.round(x.ltp * 100) / 100,
    iv: Number.isFinite(x.iv) && x.iv > 0 ? Math.round(x.iv * 10_000) / 10_000 : null,
  };
}

export type HeroSort = "gain" | "volume" | "gamma" | "pop";

export function sortHeroZero(rows: HeroZeroRow[], by: HeroSort): HeroZeroRow[] {
  const val = (r: HeroZeroRow): number => {
    switch (by) {
      case "gain":
        return finite(r.changePct) ? r.changePct : -Infinity;
      case "volume":
        return r.volume;
      case "gamma":
        return finite(r.gammaPerRupee) ? r.gammaPerRupee : -Infinity;
      case "pop":
        return finite(r.pop) ? r.pop : -Infinity;
    }
  };
  return [...(rows ?? [])].sort((a, b) => val(b) - val(a) || b.volume - a.volume || a.ltp - b.ltp);
}

/** LTP at the first snapshot of the session, keyed "strike|side". */
export function openingLtpMap(snaps: ChainSnapshot[]): Map<string, number> {
  const m = new Map<string, number>();
  const first = (snaps ?? [])[0];
  for (const r of first?.rows ?? []) if (pos(r.ltp)) m.set(key(r.strike, r.side), r.ltp);
  return m;
}

// ── OI walls and max-pain drift ──

export interface WallStrike {
  strike: number;
  oi: number;
  oiChange: number;
}

export interface OIWalls {
  calls: WallStrike[];
  puts: WallStrike[];
  callWall: number;
  putWall: number;
  maxPain: number;
  pcr: number;
}

/** Largest CE OI at or above ATM (resistance) and PE OI at or below ATM (support). */
export function oiWalls(chain: OptionData[], spot: number, n = 3): OIWalls {
  const rows = (Array.isArray(chain) ? chain : []).filter((r) => r && pos(r.strikePrice));
  if (rows.length === 0 || !pos(spot)) return { calls: [], puts: [], callWall: NaN, putWall: NaN, maxPain: NaN, pcr: NaN };
  const atm = nearestOf(rows.map((r) => r.strikePrice), spot);
  let ceTot = 0;
  let peTot = 0;
  for (const r of rows) {
    ceTot += finite(r.ce?.oi) ? r.ce.oi : 0;
    peTot += finite(r.pe?.oi) ? r.pe.oi : 0;
  }
  const calls = rows
    .filter((r) => r.strikePrice >= atm && pos(r.ce?.oi))
    .map((r) => ({ strike: r.strikePrice, oi: r.ce.oi, oiChange: finite(r.ce.oiChange) ? r.ce.oiChange : 0 }))
    .sort((a, b) => b.oi - a.oi)
    .slice(0, n);
  const puts = rows
    .filter((r) => r.strikePrice <= atm && pos(r.pe?.oi))
    .map((r) => ({ strike: r.strikePrice, oi: r.pe.oi, oiChange: finite(r.pe.oiChange) ? r.pe.oiChange : 0 }))
    .sort((a, b) => b.oi - a.oi)
    .slice(0, n);
  return {
    calls,
    puts,
    callWall: calls[0]?.strike ?? NaN,
    putWall: puts[0]?.strike ?? NaN,
    maxPain: ceTot + peTot > 0 ? maxPain(rows) : NaN,
    pcr: ceTot > 0 ? peTot / ceTot : NaN,
  };
}

/** OI change between the first and the given snapshot, per strike and side (contracts). */
export function oiChangeSince(first: ChainSnapshot | undefined, last: ChainSnapshot | undefined): Map<string, number> {
  const m = new Map<string, number>();
  if (!first || !last) return m;
  const a = indexSnapshot(first);
  for (const r of last.rows) {
    const p = a.get(key(r.strike, r.side));
    if (p) m.set(key(r.strike, r.side), r.oi - p.oi);
  }
  return m;
}

export interface DriftPoint {
  ts: number;
  spot: number;
  maxPain: number;
  callWall: number;
  putWall: number;
}

/** Max pain and OI walls per snapshot (downsampled to maxPoints). */
export function wallDriftSeries(snaps: ChainSnapshot[], maxPoints = 90): DriftPoint[] {
  const out: DriftPoint[] = [];
  for (const s of downsample(snaps ?? [], maxPoints)) {
    const rows = s.rows ?? [];
    if (rows.length === 0) continue;
    const byStrike = new Map<number, { ce: number; pe: number }>();
    for (const r of rows) {
      const e = byStrike.get(r.strike) ?? { ce: 0, pe: 0 };
      if (r.side === "CE") e.ce = r.oi;
      else e.pe = r.oi;
      byStrike.set(r.strike, e);
    }
    const chain: OptionData[] = [...byStrike.entries()].map(([strikePrice, v]) => ({
      strikePrice,
      ce: { ltp: 0, oi: v.ce, oiChange: 0, volume: 0, iv: 0, delta: 0, gamma: 0, theta: 0, vega: 0, bidPrice: 0, askPrice: 0 },
      pe: { ltp: 0, oi: v.pe, oiChange: 0, volume: 0, iv: 0, delta: 0, gamma: 0, theta: 0, vega: 0, bidPrice: 0, askPrice: 0 },
    }));
    const w = oiWalls(chain, s.spot, 1);
    if (!finite(w.maxPain)) continue;
    out.push({ ts: s.ts, spot: s.spot, maxPain: w.maxPain, callWall: w.callWall, putWall: w.putWall });
  }
  return out;
}

// ── Weekly compare ──

export interface ExpiryMetrics {
  spot: number;
  strike: number;
  straddle: number;
  straddlePct: number;
  /** PERCENT (calendar convention). */
  atmIv: number;
  emStraddle: number;
  emStraddlePct: number;
  /** One standard deviation to expiry from ATM IV, in points. */
  emIv: number;
  /** Implied one-day move from ATM IV, % of spot. */
  dailyMovePct: number;
}

export function expiryMetrics(chain: OptionData[], o: { spot: number; expiry: string; now?: Date; r: number }): ExpiryMetrics {
  const nan: ExpiryMetrics = { spot: NaN, strike: NaN, straddle: NaN, straddlePct: NaN, atmIv: NaN, emStraddle: NaN, emStraddlePct: NaN, emIv: NaN, dailyMovePct: NaN };
  if (!Array.isArray(chain) || chain.length === 0 || !pos(o.spot)) return nan;
  const T = timeToExpiryYears(o.expiry, o.now ?? new Date());
  const st = atmStraddle(chain, o.spot);
  const F = chainForward(chain, o.spot, pos(T) ? T : 0, o.r);
  const iv = atmIV(chain, pos(F) ? F : o.spot);
  const em = expectedMoveFromStraddle(st.straddle, o.spot);
  const emIv = pos(iv) && pos(T) ? expectedMoveFromIV(pos(F) ? F : o.spot, iv / 100, T).move : NaN;
  return {
    spot: o.spot,
    strike: st.strike,
    straddle: st.straddle,
    straddlePct: st.straddlePct,
    atmIv: iv,
    emStraddle: em.move,
    emStraddlePct: em.pct,
    emIv,
    dailyMovePct: pos(iv) ? iv / Math.sqrt(252) : NaN,
  };
}

// ── Expiry rules ──

/** Extra 2% extreme-loss margin per short lot of an index option on its expiry day (₹). */
export function elmPerLot(spot: number, lotSize: number, rate = 0.02): number {
  return pos(spot) && pos(lotSize) ? spot * lotSize * rate : NaN;
}

export interface ExerciseExample {
  strike: number;
  intrinsic: number;
  qty: number;
  /** STT if the ITM long is left to exercise (on intrinsic value). */
  sttExercise: number;
  /** STT if the same long is sold before the close at ≈ intrinsic premium. */
  sttSell: number;
  exerciseRate: number;
  sellRate: number;
  rateFrom: string;
}

/** One lot of a call one strike in the money, held to expiry vs sold before 15:30. */
export function exerciseExample(spot: number, step: number, lotSize: number, onDate?: string): ExerciseExample | null {
  if (!pos(spot) || !pos(step) || !pos(lotSize)) return null;
  const strike = Math.floor(spot / step) * step - step;
  const intrinsic = spot - strike;
  const rates = getChargeRates(onDate);
  const sttExercise = intrinsic * lotSize * rates.sttOptionExercise;
  const sttSell = intrinsic * lotSize * rates.sttOptionSell;
  return { strike, intrinsic, qty: lotSize, sttExercise, sttSell, exerciseRate: rates.sttOptionExercise, sellRate: rates.sttOptionSell, rateFrom: rates.effectiveFrom };
}

/** Where the clock is relative to the 15:00–15:30 settlement averaging window on the given date. */
export function settlementWindowState(now: Date, expiry: string): "before" | "averaging" | "settled" | "not-today" {
  const today = istDateString(now);
  if (today !== expiry) return "not-today";
  const t = now.getTime();
  const start = toISTDate(expiry, "15:00").getTime();
  const end = toISTDate(expiry, "15:30").getTime();
  if (t < start) return "before";
  if (t < end) return "averaging";
  return "settled";
}
