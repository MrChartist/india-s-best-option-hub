/**
 * End-of-day options backtest engine (pure, synchronous, deterministic).
 *
 * How a run works:
 *  1. Entry: on each close, decide whether to open a trade (one position at a time). "dte" timing
 *     opens one trade per expiry on the last session whose calendar DTE is still at or above the
 *     target; "weekday" timing opens on the chosen weekdays into the nearest expiry with at least the
 *     minimum DTE. A weekday filter can restrict either.
 *  2. Strikes: legs come from a strategy template (src/lib/strategyTemplates.ts). In ATM ± N, delta
 *     and premium modes the first short leg of each option type (or the first long leg when the
 *     structure has no short leg of that type) is re-selected; every other leg of that type keeps its
 *     distance to it, so spreads, condors and calendars keep their shape.
 *  3. Exits, checked at each later close in this order: expiry settlement, stop loss, profit target,
 *     days held, exit DTE. Profit and stop are % of the net premium (or of the estimated margin when the
 *     structure costs almost nothing). Fills are at the day's close with slippage.
 *  4. Costs: brokerage, STT, exchange, SEBI, stamp duty and GST from the dated rate table at each fill
 *     date; long ITM options left to expiry pay STT on the settlement intrinsic value. Lot sizes are
 *     the ones in force for each contract on the entry date (a revision re-lots open far contracts
 *     on its effective date, keeping units, so a pre-revision entry keeps the old lot's quantity).
 *  5. When a strike has no close on a day, it is priced with Black-76 on the day's implied forward and
 *     smile, and the fill is counted as model-priced.
 */
import {
  BROKER_PRESETS,
  FALLBACK_IV,
  black76Price,
  calcCharges,
  calendarDaysBetween,
  estimateMargin,
  exerciseSTT,
  forwardFromSpot,
  getBrokerPreset,
  getContractSpec,
  getDividendYield,
  getLotSize,
  getMarketParams,
  getStrikeStep,
  impliedForward,
  impliedVol76,
  intrinsic,
  isoWeekday,
  timeToExpiryYears,
  toISTDate,
  type BrokerPreset,
  type Exchange,
  type Fill,
  type Leg,
  type OptionType,
} from "@/lib/options";
import { getTemplate, snapStrike, strikeForDelta, type StrategyTemplate, type TemplateLeg } from "@/lib/strategyTemplates";
import { computeStats, splitByReason, splitByVix, splitByWeekday, withDrawdown } from "./stats";
import type {
  BacktestConfig,
  BacktestOutput,
  BacktestProgress,
  EodChain,
  EodDataset,
  EodDay,
  EquityPoint,
  ExitReason,
  SkipCounts,
  Trade,
  TradeLeg,
} from "./types";

const TICK = 0.05;
const roundTick = (x: number) => Math.round(x / TICK) * TICK;
const round2 = (x: number) => Math.round(x * 100) / 100;

// ───────────────────────────── Chain views ─────────────────────────────

/** One expiry on one day with the forward, smile and pricing helpers the engine needs. */
export interface ChainView {
  expiry: string;
  date: string;
  spot: number;
  /** Years to expiry from the day's 15:30 IST close (0 on expiry day). */
  T: number;
  F: number;
  r: number;
  step: number;
  strikes: number[];
  atmK: number;
  atmIv: number;
  fut: number | null;
  quote(K: number, type: OptionType): number | null;
  sigmaAt(K: number): number;
  /** Black-76 price on the day's forward and smile (intrinsic on expiry day). */
  model(K: number, type: OptionType): number;
  snap(K: number): number;
}

const positive = (x: number | null | undefined): x is number => typeof x === "number" && Number.isFinite(x) && x > 0;

export function makeChainView(day: EodDay, chain: EodChain, symbol: string, r: number): ChainView {
  const idx = new Map<number, number>();
  chain.strikes.forEach((k, i) => idx.set(k, i));
  const step = getStrikeStep(symbol);
  const T = timeToExpiryYears(chain.expiry, toISTDate(day.date, "15:30"));
  const strikes = chain.strikes;
  const quote = (K: number, type: OptionType): number | null => {
    const i = idx.get(K);
    if (i === undefined) return null;
    const v = type === "CE" ? chain.ce[i] : chain.pe[i];
    return positive(v) ? v : null;
  };
  const atmK = strikes.length ? snapStrike(day.spot, step, strikes) : Math.round(day.spot / step) * step;
  // Forward from put-call parity at the strike nearest spot with both closes; else spot carried at r − q.
  let F = NaN;
  if (T > 0) {
    const order = [...strikes].sort((a, b) => Math.abs(a - day.spot) - Math.abs(b - day.spot)).slice(0, 5);
    for (const K of order) {
      const c = quote(K, "CE");
      const p = quote(K, "PE");
      if (c !== null && p !== null) {
        const f = impliedForward(K, c, p, T, r);
        if (Number.isFinite(f) && Math.abs(f / day.spot - 1) < 0.05) {
          F = f;
          break;
        }
      }
    }
    if (!Number.isFinite(F)) F = forwardFromSpot(day.spot, T, r, getDividendYield(symbol));
  } else F = day.spot;

  const ivCache = new Map<number, number>();
  const rawCache = new Map<number, number>();
  const rawIv = (K: number): number => {
    const hit = rawCache.get(K);
    if (hit !== undefined) return hit;
    const iv = solveIv(K);
    rawCache.set(K, iv);
    return iv;
  };
  const solveIv = (K: number): number => {
    if (!(T > 0)) return NaN;
    const otm: OptionType = K >= F ? "CE" : "PE";
    for (const type of [otm, otm === "CE" ? "PE" : "CE"] as OptionType[]) {
      const px = quote(K, type);
      if (px === null) continue;
      const iv = impliedVol76(px, { F, K, T, r, type });
      if (Number.isFinite(iv) && iv > 0.01 && iv < 3) return iv;
    }
    return NaN;
  };
  const atmRaw = rawIv(atmK);
  const atmIv = Number.isFinite(atmRaw) ? atmRaw : FALLBACK_IV;
  const sigmaAt = (K: number): number => {
    const hit = ivCache.get(K);
    if (hit !== undefined) return hit;
    let iv = rawIv(K);
    if (!Number.isFinite(iv)) {
      // Interpolate from the nearest listed strikes with an implied vol, else flat ATM.
      let lo = NaN;
      let hi = NaN;
      for (const k of strikes) {
        if (k <= K && Number.isFinite(rawIv(k))) lo = k;
        if (k >= K && Number.isFinite(rawIv(k))) {
          hi = k;
          break;
        }
      }
      if (Number.isFinite(lo) && Number.isFinite(hi) && hi > lo) iv = rawIv(lo) + ((rawIv(hi) - rawIv(lo)) * (K - lo)) / (hi - lo);
      else if (Number.isFinite(lo)) iv = rawIv(lo);
      else if (Number.isFinite(hi)) iv = rawIv(hi);
      else iv = atmIv;
    }
    ivCache.set(K, iv);
    return iv;
  };
  const model = (K: number, type: OptionType): number => {
    if (!(T > 0)) return round2(intrinsic(day.spot, K, type));
    return Math.max(TICK, roundTick(black76Price({ F, K, T, r, sigma: sigmaAt(K), type })));
  };
  return {
    expiry: chain.expiry,
    date: day.date,
    spot: day.spot,
    T,
    F,
    r,
    step,
    strikes,
    atmK,
    atmIv,
    fut: positive(chain.fut) ? chain.fut : null,
    quote,
    sigmaAt,
    model,
    snap: (K: number) => (strikes.length ? snapStrike(K, step, strikes) : Math.round(K / step) * step),
  };
}

// ───────────────────────────── Expiry series ─────────────────────────────

/** Monthly expiries in a dataset: the last expiry seen in each calendar month. */
export function monthlyExpiries(ds: EodDataset): Set<string> {
  const all = new Set<string>();
  for (const d of ds.days) for (const c of d.chains) all.add(c.expiry);
  const lastOfMonth = new Map<string, string>();
  for (const e of [...all].sort()) lastOfMonth.set(e.slice(0, 7), e);
  return new Set(lastOfMonth.values());
}

function seriesOf(day: EodDay, cfg: BacktestConfig, monthly: Set<string>): string[] {
  return day.chains
    .map((c) => c.expiry)
    .filter((e) => e > day.date && (cfg.series === "nearest" || monthly.has(e)))
    .sort();
}

/**
 * The expiry to open on this day, or null. dte timing: the nearest series expiry with DTE ≥ target,
 * only on the last session before its DTE drops below the target (holidays and data gaps included).
 * weekday timing: the nearest series expiry with DTE ≥ the minimum.
 */
export function entryExpiry(day: EodDay, next: EodDay | undefined, cfg: BacktestConfig, monthly: Set<string>): string | null {
  const wd = isoWeekday(day.date);
  if (cfg.weekdays.length > 0 && !cfg.weekdays.includes(wd)) return null;
  const minDte = Math.max(1, Math.round(cfg.dte));
  const exp = seriesOf(day, cfg, monthly).find((e) => calendarDaysBetween(day.date, e) >= minDte);
  if (!exp) return null;
  if (cfg.timing === "weekday") return exp;
  const dte = calendarDaysBetween(day.date, exp);
  // Too early: a later session still has DTE ≥ target.
  if (next && next.chains.some((c) => c.expiry === exp) && calendarDaysBetween(next.date, exp) >= minDte) return null;
  // A long data gap would open far earlier than asked; skip rather than mislabel the entry.
  if (dte - minDte > 6) return null;
  return exp;
}

// ───────────────────────────── Strike resolution ─────────────────────────────

export interface ResolvedLeg {
  type: OptionType | "FUT";
  side: TemplateLeg["side"];
  ratio: number;
  strike: number;
  view: ChainView;
}

function baseStrike(tl: TemplateLeg, v: ChainView, prior: number[]): number {
  const type = tl.type as OptionType;
  const rule = tl.strike;
  switch (rule.kind) {
    case "atm":
      return v.snap(v.atmK + rule.offset * v.step);
    case "delta": {
      const K = strikeForDelta(rule.delta, type, { F: v.F, T: v.T, r: v.r, strikes: v.strikes, sigmaAt: v.sigmaAt });
      return Number.isFinite(K) ? K : v.atmK;
    }
    case "em": {
      const sig = v.sigmaAt(v.F);
      let K = v.snap(v.F * Math.exp(rule.mult * sig * Math.sqrt(v.T)));
      if (K === v.atmK && rule.mult !== 0) K = v.snap(v.atmK + Math.sign(rule.mult) * v.step);
      return K;
    }
    case "wing": {
      const ref = prior[rule.of];
      if (!Number.isFinite(ref)) return v.atmK;
      const K = v.snap(ref + rule.steps * v.step);
      return K === ref ? ref + rule.steps * v.step : K;
    }
  }
}

/** Index of the leg re-selected per option type (first short atm/delta leg, else first long one). */
export function anchorLegs(t: StrategyTemplate): Partial<Record<OptionType, number>> {
  const out: Partial<Record<OptionType, number>> = {};
  for (const type of ["CE", "PE"] as OptionType[]) {
    const isAnchorable = (l: TemplateLeg) => l.type === type && (l.strike.kind === "atm" || l.strike.kind === "delta");
    let i = t.legs.findIndex((l) => isAnchorable(l) && l.side === "SELL");
    if (i < 0) i = t.legs.findIndex((l) => isAnchorable(l));
    if (i >= 0) out[type] = i;
  }
  return out;
}

function overrideStrike(cfg: BacktestConfig, type: OptionType, v: ChainView): number {
  if (cfg.strikeMode === "atm") {
    const n = Math.max(0, Math.round(cfg.atmOffset));
    return v.snap(v.atmK + (type === "CE" ? n : -n) * v.step);
  }
  if (cfg.strikeMode === "delta") {
    const K = strikeForDelta(Math.min(0.95, Math.max(0.01, cfg.delta)), type, { F: v.F, T: v.T, r: v.r, strikes: v.strikes, sigmaAt: v.sigmaAt });
    return Number.isFinite(K) ? K : v.atmK;
  }
  // Premium target: the out-of-the-money strike whose close is nearest the target.
  const target = Math.max(TICK, cfg.premium);
  const side = v.strikes.filter((K) => (type === "CE" ? K >= v.atmK : K <= v.atmK));
  let best = v.atmK;
  let bestErr = Infinity;
  for (const K of side.length ? side : v.strikes) {
    const px = v.quote(K, type) ?? v.model(K, type);
    const err = Math.abs(px - target);
    if (err < bestErr) {
      bestErr = err;
      best = K;
    }
  }
  return best;
}

/** Resolve a template's legs against the front (and, for calendars, the next) expiry's chain. */
export function resolveLegs(t: StrategyTemplate, cfg: BacktestConfig, front: ChainView, back: ChainView | null): ResolvedLeg[] | null {
  const views: ChainView[] = [];
  for (const tl of t.legs) {
    const v = (tl.expiry ?? 0) >= 1 ? back : front;
    if (!v) return null;
    views.push(v);
  }
  const base: number[] = [];
  t.legs.forEach((tl, i) => base.push(tl.type === "FUT" ? NaN : baseStrike(tl, views[i], base)));
  let final = base;
  if (cfg.strikeMode !== "template") {
    const anchors = anchorLegs(t);
    const shift: Partial<Record<OptionType, number>> = {};
    for (const type of ["CE", "PE"] as OptionType[]) {
      const i = anchors[type];
      if (i === undefined) continue;
      shift[type] = overrideStrike(cfg, type, views[i]) - base[i];
    }
    final = [];
    t.legs.forEach((tl, i) => {
      if (tl.type === "FUT") return void final.push(NaN);
      const type = tl.type as OptionType;
      if (tl.strike.kind === "wing") return void final.push(baseStrike(tl, views[i], final));
      const s = shift[type] ?? 0;
      final.push(s === 0 ? base[i] : views[i].snap(base[i] + s));
    });
  }
  return t.legs.map((tl, i) => ({ type: tl.type, side: tl.side, ratio: Math.max(1, tl.ratio), strike: tl.type === "FUT" ? 0 : final[i], view: views[i] }));
}

// ───────────────────────────── Fills and costs ─────────────────────────────

/** Price after slippage: worse for the trader on every fill. */
export function slipped(price: number, action: "BUY" | "SELL", slippagePct: number): number {
  const s = Math.max(0, slippagePct) / 100;
  if (!(s > 0)) return price;
  const p = action === "BUY" ? price * (1 + s) : price * (1 - s);
  return Math.max(TICK, roundTick(p));
}

/** Per-unit P&L of one leg from entry to exit. */
export function legPnlPerUnit(l: Pick<TradeLeg, "side" | "entry">, exit: number): number {
  return l.side === "BUY" ? exit - l.entry : l.entry - exit;
}

const qtyOf = (l: Pick<TradeLeg, "lots" | "lotSize">) => l.lots * l.lotSize;

function chargesFor(legs: TradeLeg[], prices: number[], opening: boolean, date: string, broker: BrokerPreset, exchange: Exchange): number {
  const fills: Fill[] = legs.map((l, i) => ({
    type: l.type,
    side: opening ? l.side : l.side === "BUY" ? "SELL" : "BUY",
    price: prices[i],
    qty: qtyOf(l),
    exchange,
  }));
  return calcCharges(fills, { broker, onDate: date }).total;
}

// ───────────────────────────── Run ─────────────────────────────

interface OpenTrade {
  id: number;
  entryIdx: number;
  entryDate: string;
  expiry: string;
  entryDte: number;
  entrySpot: number;
  vix: number | null;
  weekday: number;
  legs: TradeLeg[];
  /** Last known close per leg (carried over a day the expiry is missing from the data). */
  last: number[];
  entryCharges: number;
  netPremium: number;
  basis: number;
  basisKind: "premium" | "margin";
  margin: number;
  mae: number;
  mfe: number;
  modelFills: number;
}

export const ENGINE_LIMITS = { maxLots: 500, maxDte: 90, maxDaysHeld: 90 } as const;

/** Sanitise a config (clamps and fills defaults) so the engine never sees impossible values. */
export function normaliseConfig(c: BacktestConfig): BacktestConfig {
  const pct = (v: number | null) => (v === null || !Number.isFinite(v) || v <= 0 ? null : Math.min(v, 10_000));
  const days = (v: number | null, max: number) => (v === null || !Number.isFinite(v) || v < 0 ? null : Math.min(Math.round(v), max));
  return {
    ...c,
    lots: Math.min(ENGINE_LIMITS.maxLots, Math.max(1, Math.round(c.lots || 1))),
    dte: Math.min(ENGINE_LIMITS.maxDte, Math.max(1, Math.round(c.dte || 1))),
    weekdays: [...new Set((c.weekdays ?? []).filter((d) => d >= 1 && d <= 5))].sort(),
    atmOffset: Math.max(0, Math.min(40, Math.round(c.atmOffset || 0))),
    delta: Math.min(0.9, Math.max(0.02, Number(c.delta) || 0.2)),
    premium: Math.max(TICK, Number(c.premium) || 50),
    profitPct: pct(c.profitPct),
    stopPct: pct(c.stopPct),
    maxDaysHeld: days(c.maxDaysHeld, ENGINE_LIMITS.maxDaysHeld) || null,
    exitDte: days(c.exitDte, ENGINE_LIMITS.maxDte),
    slippagePct: Math.min(20, Math.max(0, Number(c.slippagePct) || 0)),
    capital: Math.max(1, Number(c.capital) || 500_000),
  };
}

/**
 * Run a backtest step by step. Yields progress roughly every 1% of days and returns the output.
 * Throws only for an unknown template.
 */
export function* backtestSteps(rawCfg: BacktestConfig, ds: EodDataset): Generator<BacktestProgress, BacktestOutput, void> {
  const cfg = normaliseConfig(rawCfg);
  const template = getTemplate(cfg.templateId);
  if (!template) throw new Error(`Unknown strategy template "${cfg.templateId}"`);
  const symbol = ds.symbol;
  const r = getMarketParams().r;
  const broker = getBrokerPreset(cfg.brokerId) ?? BROKER_PRESETS[0];
  const monthly = monthlyExpiries(ds);
  const days = ds.days.filter((d) => d.date >= cfg.from && d.date <= cfg.to && d.spot > 0);
  const total = days.length;
  // Lot in force for a contract on the entry date. A lot revision re-lots longer-dated contracts on
  // its effective date, so a trade entered before the revision into a post-revision expiry still
  // trades the old lot: look the lot up at min(entry date, expiry). Units are preserved through a
  // re-lot (NSE adjusts the lot count, not the quantity), so qty stays as entered while open.
  const lotFor = (expiry: string, onDate: string) => {
    const asOf = onDate && onDate < expiry ? onDate : expiry;
    return getLotSize(symbol, asOf) ?? getContractSpec(symbol)?.lotSize ?? 1;
  };
  const usesBack = template.legs.some((l) => (l.expiry ?? 0) >= 1);
  const exchange: Exchange = getContractSpec(symbol)?.exchange ?? "NSE";

  const trades: Trade[] = [];
  const raw: Array<Omit<EquityPoint, "drawdown" | "drawdownPct">> = [];
  const skipped: SkipCounts = { noChain: 0, noPrice: 0, busy: 0 };
  const warnings = new Set<string>();
  const traded = new Set<string>();
  const lotSizes: Array<{ expiry: string; lotSize: number }> = [];
  let realised = 0;
  const pos: { open: OpenTrade | null } = { open: null };
  let nextId = 1;

  const viewCache = new Map<string, ChainView | null>();
  const viewFor = (day: EodDay, expiry: string): ChainView | null => {
    const key = `${day.date}|${expiry}`;
    if (viewCache.has(key)) return viewCache.get(key) ?? null;
    const chain = day.chains.find((c) => c.expiry === expiry);
    const v = chain && chain.strikes.length > 0 ? makeChainView(day, chain, symbol, r) : null;
    viewCache.set(key, v);
    return v;
  };

  /** Close of each open leg on `day`; carries the last close (flagged) when the expiry is missing. */
  const marks = (o: OpenTrade, day: EodDay): { prices: number[]; model: boolean[] } => {
    const prices: number[] = [];
    const model: boolean[] = [];
    o.legs.forEach((l, i) => {
      const v = viewFor(day, l.expiry);
      if (!v) {
        prices.push(o.last[i]);
        model.push(true);
        return;
      }
      if (l.type === "FUT") {
        prices.push(v.fut ?? round2(v.F));
        model.push(v.fut === null);
        return;
      }
      const q = v.quote(l.strike, l.type);
      prices.push(q ?? v.model(l.strike, l.type));
      model.push(q === null);
    });
    return { prices, model };
  };

  const grossAt = (o: OpenTrade, prices: number[]) => o.legs.reduce((a, l, i) => a + legPnlPerUnit(l, prices[i]) * qtyOf(l), 0);

  const close = (o: OpenTrade, day: EodDay, dayIdx: number, reason: ExitReason, exitPrices: number[], exitCharges: number, exitSpot: number, modelExit: boolean[]) => {
    const legs = o.legs.map((l, i) => ({ ...l, exit: round2(exitPrices[i]), modelExit: modelExit[i] || undefined }));
    const gross = legs.reduce((a, l) => a + legPnlPerUnit(l, l.exit) * qtyOf(l), 0);
    const charges = o.entryCharges + exitCharges;
    const net = gross - charges;
    realised += net;
    trades.push({
      id: o.id,
      entryDate: o.entryDate,
      exitDate: day.date,
      expiry: o.expiry,
      entryDte: o.entryDte,
      entrySpot: o.entrySpot,
      exitSpot,
      vix: o.vix,
      weekday: o.weekday,
      legs,
      netPremium: round2(o.netPremium),
      basis: round2(o.basis),
      basisKind: o.basisKind,
      margin: Math.round(o.margin),
      gross: round2(gross),
      charges: round2(charges),
      net: round2(net),
      daysHeld: dayIdx - o.entryIdx,
      reason,
      mae: round2(Math.min(o.mae, gross)),
      mfe: round2(Math.max(o.mfe, gross)),
      modelFills: o.modelFills + modelExit.filter(Boolean).length,
    });
  };

  /** Market exit at the close (with slippage and charges). */
  const exitAtClose = (o: OpenTrade, day: EodDay, dayIdx: number, reason: ExitReason, m: { prices: number[]; model: boolean[] }) => {
    const fills = o.legs.map((l, i) => (l.type === "FUT" ? m.prices[i] : slipped(m.prices[i], l.side === "BUY" ? "SELL" : "BUY", cfg.slippagePct)));
    const exitCharges = chargesFor(o.legs, fills, false, day.date, broker, exchange);
    close(o, day, dayIdx, reason, fills, exitCharges, day.spot, m.model);
  };

  /** Settle at expiry: front-expiry options at intrinsic on the settlement close, later legs at their close. */
  const settle = (o: OpenTrade, day: EodDay, dayIdx: number, settleSpot: number) => {
    const m = marks(o, day);
    const prices: number[] = [];
    const modelExit: boolean[] = [];
    const marketIdx: number[] = [];
    let stt = 0;
    o.legs.forEach((l, i) => {
      if (l.expiry === o.expiry) {
        if (l.type === "FUT") prices.push(settleSpot);
        else {
          const iv = intrinsic(settleSpot, l.strike, l.type);
          prices.push(iv);
          if (l.side === "BUY") stt += exerciseSTT(iv, qtyOf(l), o.expiry);
        }
        modelExit.push(false);
      } else {
        marketIdx.push(i);
        const px = l.type === "FUT" ? m.prices[i] : slipped(m.prices[i], l.side === "BUY" ? "SELL" : "BUY", cfg.slippagePct);
        prices.push(px);
        modelExit.push(m.model[i]);
      }
    });
    const marketCharges = marketIdx.length
      ? chargesFor(
          marketIdx.map((i) => o.legs[i]),
          marketIdx.map((i) => prices[i]),
          false,
          day.date,
          broker,
          exchange,
        )
      : 0;
    close(o, day, dayIdx, "expiry", prices, stt + marketCharges, settleSpot, modelExit);
  };

  const tryOpen = (day: EodDay, next: EodDay | undefined, dayIdx: number): void => {
    const exp = entryExpiry(day, next, cfg, monthly);
    if (!exp) return;
    if (cfg.timing === "dte" && traded.has(exp)) return;
    if (pos.open) {
      skipped.busy += 1;
      return;
    }
    traded.add(exp);
    const front = viewFor(day, exp);
    let back: ChainView | null = null;
    if (usesBack) {
      const later = seriesOf(day, cfg, monthly).filter((e) => e > exp);
      back = later.length ? viewFor(day, later[0]) : null;
    }
    if (!front || (usesBack && !back)) {
      skipped.noChain += 1;
      return;
    }
    const resolved = resolveLegs(template, cfg, front, back);
    if (!resolved) {
      skipped.noChain += 1;
      return;
    }
    const legs: TradeLeg[] = [];
    const closes: number[] = [];
    let modelFills = 0;
    for (const rl of resolved) {
      const lotSize = lotFor(rl.view.expiry, day.date);
      const lots = cfg.lots * rl.ratio;
      if (rl.type === "FUT") {
        const px = rl.view.fut ?? round2(rl.view.F);
        if (rl.view.fut === null) modelFills += 1;
        legs.push({ type: "FUT", side: rl.side, strike: 0, expiry: rl.view.expiry, lots, lotSize, entry: px, exit: px, modelEntry: rl.view.fut === null || undefined });
        closes.push(px);
        continue;
      }
      const q = rl.view.quote(rl.strike, rl.type);
      const px = q ?? rl.view.model(rl.strike, rl.type);
      if (!positive(px) || !positive(rl.strike)) {
        skipped.noPrice += 1;
        return;
      }
      if (q === null) modelFills += 1;
      const fill = slipped(px, rl.side, cfg.slippagePct);
      const iv = rl.view.sigmaAt(rl.strike);
      legs.push({
        type: rl.type,
        side: rl.side,
        strike: rl.strike,
        expiry: rl.view.expiry,
        lots,
        lotSize,
        entry: round2(fill),
        exit: round2(fill),
        iv: Number.isFinite(iv) ? Math.round(iv * 10000) / 10000 : undefined,
        modelEntry: q === null || undefined,
      });
      closes.push(px);
    }
    for (const l of legs) {
      const last = lotSizes[lotSizes.length - 1];
      if (!last || last.lotSize !== l.lotSize) lotSizes.push({ expiry: l.expiry, lotSize: l.lotSize });
    }
    const entryCharges = chargesFor(legs, legs.map((l) => l.entry), true, day.date, broker, exchange);
    const netPremium = legs.filter((l) => l.type !== "FUT").reduce((a, l) => a + (l.side === "SELL" ? 1 : -1) * l.entry * qtyOf(l), 0);
    const asLegs: Leg[] = legs.map((l) => ({ symbol, type: l.type, side: l.side, strike: l.strike, expiry: l.expiry, lots: l.lots, lotSize: l.lotSize, premium: l.entry, iv: l.iv }));
    const margin = estimateMargin(asLegs, { spot: day.spot, now: toISTDate(day.date, "15:30"), sigma: front.atmIv }).fundsRequired;
    const baseQty = cfg.lots * lotFor(exp, day.date);
    const premiumBasis = Math.abs(netPremium) >= 2 * baseQty;
    pos.open = {
      id: nextId++,
      entryIdx: dayIdx,
      entryDate: day.date,
      expiry: exp,
      entryDte: calendarDaysBetween(day.date, exp),
      entrySpot: day.spot,
      vix: day.vix,
      weekday: isoWeekday(day.date),
      legs,
      last: closes,
      entryCharges,
      netPremium,
      basis: premiumBasis ? Math.abs(netPremium) : Math.max(1, margin),
      basisKind: premiumBasis ? "premium" : "margin",
      margin,
      mae: 0,
      mfe: 0,
      modelFills,
    };
  };

  yield { phase: "simulate", done: 0, total, trades: 0 };
  const every = Math.max(1, Math.floor(total / 100));
  for (let i = 0; i < total; i++) {
    const day = days[i];
    const o = pos.open;
    if (o) {
      if (day.date >= o.expiry) {
        let settleSpot = day.spot;
        if (day.date !== o.expiry) {
          const prev = i > 0 ? days[i - 1] : undefined;
          if (prev && prev.date < o.expiry) settleSpot = prev.spot;
          warnings.add("Some expiry-day files were missing, so those trades settled on the last close before expiry.");
        }
        settle(o, day, i, settleSpot);
        pos.open = null;
      } else {
        const m = marks(o, day);
        o.last = m.prices;
        const gross = grossAt(o, m.prices);
        o.mae = Math.min(o.mae, gross);
        o.mfe = Math.max(o.mfe, gross);
        const held = i - o.entryIdx;
        let reason: ExitReason | null = null;
        if (cfg.stopPct !== null && gross <= (-o.basis * cfg.stopPct) / 100) reason = "stop";
        else if (cfg.profitPct !== null && gross >= (o.basis * cfg.profitPct) / 100) reason = "target";
        else if (cfg.maxDaysHeld !== null && held >= cfg.maxDaysHeld) reason = "time";
        else if (cfg.exitDte !== null && calendarDaysBetween(day.date, o.expiry) <= cfg.exitDte) reason = "dte";
        if (reason) {
          exitAtClose(o, day, i, reason, m);
          pos.open = null;
        }
      }
    }
    tryOpen(day, days[i + 1], i);
    const cur = pos.open;
    let unrealised = 0;
    if (cur) {
      const m = cur.entryIdx === i ? { prices: cur.last } : marks(cur, day);
      unrealised = grossAt(cur, m.prices) - cur.entryCharges;
    }
    raw.push({ date: day.date, equity: cfg.capital + realised + unrealised, pnl: realised + unrealised, inTrade: !!cur });
    if (i % every === 0 || i === total - 1) yield { phase: "simulate", done: i + 1, total, trades: trades.length };
  }

  const still = pos.open;
  if (still && total > 0) {
    const lastIdx = total - 1;
    const day = days[lastIdx];
    exitAtClose(still, day, lastIdx, "end", still.entryIdx === lastIdx ? { prices: still.last, model: still.legs.map(() => false) } : marks(still, day));
    raw[lastIdx] = { ...raw[lastIdx], equity: cfg.capital + realised, pnl: realised };
    warnings.add("The last trade was still open when the data ended, so it was closed at the final close.");
  }

  yield { phase: "stats", done: total, total, trades: trades.length };
  const equity = withDrawdown(raw);
  const modelFills = trades.reduce((a, t) => a + t.modelFills, 0);
  if (modelFills > 0) warnings.add(`${modelFills} fill${modelFills === 1 ? " was" : "s were"} priced with Black-76 because the strike had no close that day.`);
  return {
    symbol,
    source: ds.source,
    templateId: template.id,
    templateName: template.name,
    config: cfg,
    trades,
    equity,
    stats: computeStats(trades, equity, cfg.capital),
    byVix: splitByVix(trades),
    byWeekday: splitByWeekday(trades),
    byReason: splitByReason(trades),
    skipped,
    range: { from: days[0]?.date ?? cfg.from, to: days[total - 1]?.date ?? cfg.to, days: total },
    lotSizes,
    warnings: [...warnings],
  };
}

/** Run to completion synchronously (tests and the main-thread fallback use the generator directly). */
export function runBacktestSync(cfg: BacktestConfig, ds: EodDataset): BacktestOutput {
  const it = backtestSteps(cfg, ds);
  for (;;) {
    const step = it.next();
    if (step.done) return step.value;
  }
}
