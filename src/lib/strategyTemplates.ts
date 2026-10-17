/**
 * Strategy template library (about 40 structures) for the Strategy Builder.
 *
 * Strikes are defined RELATIVE to the market, never as fixed numbers:
 *   - { kind: "atm", offset }   ATM ± n strike steps
 *   - { kind: "delta", delta }  the listed strike whose |Δ| is closest to `delta` (e.g. sell the 0.16Δ put)
 *   - { kind: "em", mult }      forward × e^{mult·σ√T}, i.e. a multiple of the 1σ expected move
 *   - { kind: "wing", of, steps } another leg's strike ± n strike steps (spread wings)
 * Templates are resolved against the live chain (or a labelled sample chain) by resolveTemplate().
 *
 * The chain/analytics helpers at the bottom (smileFromChain, chainQuote, popAtDate, evAtDate) are
 * local helpers that the shared math contract (@/lib/options) does not provide.
 */
import type { OptionData, OptionLegData } from "@/lib/mockData";
import {
  black76Price,
  chargesForLegs,
  estimateMargin,
  findATMStrike,
  forwardFromSpot,
  getMarketParams,
  greeks76,
  legIV,
  legMid,
  maxProfitLoss,
  lognormalGrid,
  pctToDec,
  probabilityOfProfit,
  strategyValueAt,
  syntheticFuture,
  timeToExpiryYears,
  toISTDate,
  type BrokerPreset,
  type Leg,
  type OptionType,
  type Side,
} from "@/lib/options";

// ───────────────────────────── Types ─────────────────────────────

export type TemplateView = "Bullish" | "Bearish" | "Neutral" | "Volatile";
export const TEMPLATE_VIEWS: readonly TemplateView[] = ["Bullish", "Bearish", "Neutral", "Volatile"];

export type StrikeRule =
  | { kind: "atm"; offset: number }
  | { kind: "delta"; delta: number }
  | { kind: "em"; mult: number }
  | { kind: "wing"; of: number; steps: number };

export interface TemplateLeg {
  type: OptionType | "FUT";
  side: Side;
  /** Lots multiplier (ratio spreads use 2). */
  ratio: number;
  strike: StrikeRule;
  /** Index into the expiry list: 0 = selected expiry, 1 = the next one (calendars/diagonals). */
  expiry?: number;
}

export interface StrategyTemplate {
  id: string;
  name: string;
  view: TemplateView;
  description: string;
  /** "Defined" when both max profit and max loss are capped at expiry. */
  risk: "Defined" | "Undefined";
  legs: TemplateLeg[];
  /** Short tags for search ("income", "hedge", "calendar"). */
  tags: string[];
}

export type PriceMode = "mid" | "ltp" | "natural";

export interface ResolveContext {
  symbol: string;
  spot: number;
  /** Expiries in ascending order; index 0 is the user's selected expiry. */
  expiries: string[];
  strikeStep: number;
  lotSizeFor: (expiry: string) => number;
  chainFor?: (expiry: string) => OptionData[] | undefined;
  /** Decimal ATM IV used when the chain has no IV for a strike. */
  atmIv: number;
  priceMode?: PriceMode;
  /** Base lots multiplier (default 1). */
  lots?: number;
  now?: Date;
  r?: number;
  q?: number;
}

// ───────────────────────────── Templates ─────────────────────────────

const atm = (offset = 0): StrikeRule => ({ kind: "atm", offset });
const dlt = (delta: number): StrikeRule => ({ kind: "delta", delta });
const em = (mult: number): StrikeRule => ({ kind: "em", mult });
const wing = (of: number, steps: number): StrikeRule => ({ kind: "wing", of, steps });
const L = (type: TemplateLeg["type"], side: Side, strike: StrikeRule, ratio = 1, expiry = 0): TemplateLeg => ({ type, side, strike, ratio, expiry });

export const STRATEGY_TEMPLATES: readonly StrategyTemplate[] = [
  // ── Bullish ──
  { id: "long-call", name: "Long Call", view: "Bullish", risk: "Undefined", tags: ["directional", "debit"],
    description: "Buy an ATM call. Loss is limited to the premium; profit grows as the price rises.",
    legs: [L("CE", "BUY", atm(0))] },
  { id: "short-put", name: "Short Put", view: "Bullish", risk: "Undefined", tags: ["income", "credit"],
    description: "Sell a 0.30Δ put. Collects premium if the price stays above the strike; large loss on a sharp fall.",
    legs: [L("PE", "SELL", dlt(0.3))] },
  { id: "bull-call-spread", name: "Bull Call Spread", view: "Bullish", risk: "Defined", tags: ["spread", "debit"],
    description: "Buy the ATM call and sell a call near the 1σ upside. Cheaper than a long call, with capped profit.",
    legs: [L("CE", "BUY", atm(0)), L("CE", "SELL", em(1))] },
  { id: "bull-put-spread", name: "Bull Put Spread", view: "Bullish", risk: "Defined", tags: ["spread", "credit", "income"],
    description: "Sell a 0.30Δ put and buy a lower put as a hedge. Earns the credit if the price holds above the short strike.",
    legs: [L("PE", "SELL", dlt(0.3)), L("PE", "BUY", wing(0, -4))] },
  { id: "call-ratio-backspread", name: "Call Ratio Backspread", view: "Bullish", risk: "Undefined", tags: ["ratio", "volatility"],
    description: "Sell one ATM call and buy two higher calls. Profits from a strong rally; worst case is a slow drift to the long strike.",
    legs: [L("CE", "SELL", atm(0)), L("CE", "BUY", wing(0, 3), 2)] },
  { id: "long-synthetic", name: "Long Synthetic Future", view: "Bullish", risk: "Undefined", tags: ["synthetic"],
    description: "Buy the ATM call and sell the ATM put. Behaves like a long future with no upfront cash for the option pair.",
    legs: [L("CE", "BUY", atm(0)), L("PE", "SELL", atm(0))] },
  { id: "long-futures", name: "Long Futures", view: "Bullish", risk: "Undefined", tags: ["futures"],
    description: "Buy the future. A linear bet on the price rising, with margin and mark-to-market every day.",
    legs: [L("FUT", "BUY", atm(0))] },
  { id: "covered-call", name: "Covered Call", view: "Bullish", risk: "Undefined", tags: ["futures", "income"],
    description: "Long future plus a short 0.25Δ call. The call premium cushions small falls but caps the upside.",
    legs: [L("FUT", "BUY", atm(0)), L("CE", "SELL", dlt(0.25))] },
  { id: "protective-put", name: "Protective Put", view: "Bullish", risk: "Undefined", tags: ["futures", "hedge"],
    description: "Long future plus a long 0.25Δ put. The put limits the downside like insurance.",
    legs: [L("FUT", "BUY", atm(0)), L("PE", "BUY", dlt(0.25))] },
  { id: "bull-call-butterfly", name: "Bullish Call Butterfly", view: "Bullish", risk: "Defined", tags: ["butterfly", "target"],
    description: "A call butterfly centred at the 1σ upside. Low cost, best profit if the price pins near the target at expiry.",
    legs: [L("CE", "SELL", em(1), 2), L("CE", "BUY", wing(0, -3)), L("CE", "BUY", wing(0, 3))] },
  { id: "bull-risk-reversal", name: "Risk Reversal (Bullish)", view: "Bullish", risk: "Undefined", tags: ["skew", "synthetic"],
    description: "Sell a 0.25Δ put to fund a 0.25Δ call. Near-zero cost bullish view that uses the put skew.",
    legs: [L("PE", "SELL", dlt(0.25)), L("CE", "BUY", dlt(0.25))] },
  { id: "call-diagonal", name: "Call Diagonal (PMCC)", view: "Bullish", risk: "Defined", tags: ["diagonal", "calendar"],
    description: "Buy a deep 0.70Δ call in the next expiry and sell a 0.30Δ call in the near expiry. A capital-light covered call.",
    legs: [L("CE", "BUY", dlt(0.7), 1, 1), L("CE", "SELL", dlt(0.3), 1, 0)] },

  // ── Bearish ──
  { id: "long-put", name: "Long Put", view: "Bearish", risk: "Defined", tags: ["directional", "debit"],
    description: "Buy an ATM put. Loss is limited to the premium; profit grows as the price falls.",
    legs: [L("PE", "BUY", atm(0))] },
  { id: "short-call", name: "Short Call", view: "Bearish", risk: "Undefined", tags: ["income", "credit"],
    description: "Sell a 0.30Δ call. Collects premium if the price stays below the strike; unlimited loss on a rally.",
    legs: [L("CE", "SELL", dlt(0.3))] },
  { id: "bear-put-spread", name: "Bear Put Spread", view: "Bearish", risk: "Defined", tags: ["spread", "debit"],
    description: "Buy the ATM put and sell a put near the 1σ downside. Cheaper than a long put, with capped profit.",
    legs: [L("PE", "BUY", atm(0)), L("PE", "SELL", em(-1))] },
  { id: "bear-call-spread", name: "Bear Call Spread", view: "Bearish", risk: "Defined", tags: ["spread", "credit", "income"],
    description: "Sell a 0.30Δ call and buy a higher call as a hedge. Earns the credit if the price stays below the short strike.",
    legs: [L("CE", "SELL", dlt(0.3)), L("CE", "BUY", wing(0, 4))] },
  { id: "put-ratio-backspread", name: "Put Ratio Backspread", view: "Bearish", risk: "Defined", tags: ["ratio", "volatility"],
    description: "Sell one ATM put and buy two lower puts. Profits from a sharp fall; worst case is a slow drift to the long strike.",
    legs: [L("PE", "SELL", atm(0)), L("PE", "BUY", wing(0, -3), 2)] },
  { id: "short-synthetic", name: "Short Synthetic Future", view: "Bearish", risk: "Undefined", tags: ["synthetic"],
    description: "Sell the ATM call and buy the ATM put. Behaves like a short future.",
    legs: [L("CE", "SELL", atm(0)), L("PE", "BUY", atm(0))] },
  { id: "short-futures", name: "Short Futures", view: "Bearish", risk: "Undefined", tags: ["futures"],
    description: "Sell the future. A linear bet on the price falling, with unlimited risk on a rally.",
    legs: [L("FUT", "SELL", atm(0))] },
  { id: "covered-put", name: "Covered Put", view: "Bearish", risk: "Undefined", tags: ["futures", "income"],
    description: "Short future plus a short 0.25Δ put. The put premium cushions small rallies but caps the downside profit.",
    legs: [L("FUT", "SELL", atm(0)), L("PE", "SELL", dlt(0.25))] },
  { id: "protective-call", name: "Protective Call", view: "Bearish", risk: "Undefined", tags: ["futures", "hedge"],
    description: "Short future plus a long 0.25Δ call. The call limits the loss on a sharp rally.",
    legs: [L("FUT", "SELL", atm(0)), L("CE", "BUY", dlt(0.25))] },
  { id: "bear-put-butterfly", name: "Bearish Put Butterfly", view: "Bearish", risk: "Defined", tags: ["butterfly", "target"],
    description: "A put butterfly centred at the 1σ downside. Low cost, best profit if the price pins near the target at expiry.",
    legs: [L("PE", "SELL", em(-1), 2), L("PE", "BUY", wing(0, 3)), L("PE", "BUY", wing(0, -3))] },
  { id: "bear-risk-reversal", name: "Risk Reversal (Bearish)", view: "Bearish", risk: "Undefined", tags: ["skew", "synthetic"],
    description: "Sell a 0.25Δ call to fund a 0.25Δ put. Near-zero cost bearish view.",
    legs: [L("CE", "SELL", dlt(0.25)), L("PE", "BUY", dlt(0.25))] },
  { id: "put-diagonal", name: "Put Diagonal", view: "Bearish", risk: "Defined", tags: ["diagonal", "calendar"],
    description: "Buy a deep 0.70Δ put in the next expiry and sell a 0.30Δ put in the near expiry.",
    legs: [L("PE", "BUY", dlt(0.7), 1, 1), L("PE", "SELL", dlt(0.3), 1, 0)] },

  // ── Neutral ──
  { id: "short-straddle", name: "Short Straddle", view: "Neutral", risk: "Undefined", tags: ["income", "credit", "theta"],
    description: "Sell the ATM call and put. Highest premium, best if the price pins at the strike; unlimited risk both ways.",
    legs: [L("CE", "SELL", atm(0)), L("PE", "SELL", atm(0))] },
  { id: "short-strangle", name: "Short Strangle", view: "Neutral", risk: "Undefined", tags: ["income", "credit", "theta"],
    description: "Sell the 0.16Δ call and put (about 1σ away). Wider profit zone than a straddle; unlimited risk both ways.",
    legs: [L("CE", "SELL", dlt(0.16)), L("PE", "SELL", dlt(0.16))] },
  { id: "iron-condor", name: "Iron Condor", view: "Neutral", risk: "Defined", tags: ["income", "credit", "hedged"],
    description: "Short 0.16Δ strangle with bought wings. Defined-risk range trade and a favourite for weekly expiries.",
    legs: [L("CE", "SELL", dlt(0.16)), L("PE", "SELL", dlt(0.16)), L("CE", "BUY", wing(0, 4)), L("PE", "BUY", wing(1, -4))] },
  { id: "iron-butterfly", name: "Iron Butterfly", view: "Neutral", risk: "Defined", tags: ["income", "credit", "hedged"],
    description: "Short ATM straddle with wings at the 1σ expected move. Bigger credit than a condor, narrower range.",
    legs: [L("CE", "SELL", atm(0)), L("PE", "SELL", atm(0)), L("CE", "BUY", em(1)), L("PE", "BUY", em(-1))] },
  { id: "long-call-butterfly", name: "Long Call Butterfly", view: "Neutral", risk: "Defined", tags: ["butterfly", "debit"],
    description: "Buy 1 lower call, sell 2 ATM calls, buy 1 higher call. Cheap, with best profit if the price pins at ATM.",
    legs: [L("CE", "SELL", atm(0), 2), L("CE", "BUY", wing(0, -4)), L("CE", "BUY", wing(0, 4))] },
  { id: "long-put-butterfly", name: "Long Put Butterfly", view: "Neutral", risk: "Defined", tags: ["butterfly", "debit"],
    description: "The put version of the ATM butterfly. Same shape, sometimes better priced because of the put skew.",
    legs: [L("PE", "SELL", atm(0), 2), L("PE", "BUY", wing(0, 4)), L("PE", "BUY", wing(0, -4))] },
  { id: "broken-wing-butterfly", name: "Broken Wing Butterfly", view: "Neutral", risk: "Defined", tags: ["butterfly", "credit"],
    description: "A put butterfly with a wider lower wing, often opened for a small credit so there is no upside risk.",
    legs: [L("PE", "SELL", atm(-1), 2), L("PE", "BUY", wing(0, 3)), L("PE", "BUY", wing(0, -6))] },
  { id: "jade-lizard", name: "Jade Lizard", view: "Neutral", risk: "Undefined", tags: ["income", "credit"],
    description: "Short 0.25Δ put plus a bear call spread. With enough credit there is no upside risk at all.",
    legs: [L("PE", "SELL", dlt(0.25)), L("CE", "SELL", dlt(0.25)), L("CE", "BUY", wing(1, 3))] },
  { id: "reverse-jade-lizard", name: "Reverse Jade Lizard", view: "Neutral", risk: "Undefined", tags: ["income", "credit"],
    description: "Short 0.25Δ call plus a bull put spread. The mirror of the jade lizard, with no downside risk if the credit is large enough.",
    legs: [L("CE", "SELL", dlt(0.25)), L("PE", "SELL", dlt(0.25)), L("PE", "BUY", wing(1, -3))] },
  { id: "call-ratio-spread", name: "Call Ratio Spread", view: "Neutral", risk: "Undefined", tags: ["ratio", "credit"],
    description: "Buy one ATM call and sell two calls near the 1σ upside. Mildly bullish to neutral; unlimited risk on a big rally.",
    legs: [L("CE", "BUY", atm(0)), L("CE", "SELL", em(1), 2)] },
  { id: "put-ratio-spread", name: "Put Ratio Spread", view: "Neutral", risk: "Undefined", tags: ["ratio", "credit"],
    description: "Buy one ATM put and sell two puts near the 1σ downside. Mildly bearish to neutral; large risk on a crash.",
    legs: [L("PE", "BUY", atm(0)), L("PE", "SELL", em(-1), 2)] },
  { id: "call-calendar", name: "Call Calendar", view: "Neutral", risk: "Defined", tags: ["calendar", "theta", "vega"],
    description: "Sell the near-expiry ATM call and buy the next-expiry ATM call. Gains from faster near-term decay and rising IV.",
    legs: [L("CE", "SELL", atm(0), 1, 0), L("CE", "BUY", atm(0), 1, 1)] },
  { id: "put-calendar", name: "Put Calendar", view: "Neutral", risk: "Defined", tags: ["calendar", "theta", "vega"],
    description: "Sell the near-expiry ATM put and buy the next-expiry ATM put.",
    legs: [L("PE", "SELL", atm(0), 1, 0), L("PE", "BUY", atm(0), 1, 1)] },

  // ── Volatile ──
  { id: "long-straddle", name: "Long Straddle", view: "Volatile", risk: "Undefined", tags: ["volatility", "debit", "event"],
    description: "Buy the ATM call and put. Profits from a large move either way; loses to time decay if the price stalls.",
    legs: [L("CE", "BUY", atm(0)), L("PE", "BUY", atm(0))] },
  { id: "long-strangle", name: "Long Strangle", view: "Volatile", risk: "Undefined", tags: ["volatility", "debit", "event"],
    description: "Buy the 0.25Δ call and put. Cheaper than a straddle but needs a bigger move.",
    legs: [L("CE", "BUY", dlt(0.25)), L("PE", "BUY", dlt(0.25))] },
  { id: "short-iron-condor", name: "Reverse Iron Condor", view: "Volatile", risk: "Defined", tags: ["volatility", "debit", "hedged"],
    description: "Buy a 0.25Δ strangle and sell further wings to cut the cost. Defined-risk breakout trade.",
    legs: [L("CE", "BUY", dlt(0.25)), L("PE", "BUY", dlt(0.25)), L("CE", "SELL", wing(0, 4)), L("PE", "SELL", wing(1, -4))] },
  { id: "short-iron-butterfly", name: "Reverse Iron Butterfly", view: "Volatile", risk: "Defined", tags: ["volatility", "debit", "hedged"],
    description: "Buy the ATM straddle and sell wings at the 1σ move. Cheaper breakout trade with capped profit.",
    legs: [L("CE", "BUY", atm(0)), L("PE", "BUY", atm(0)), L("CE", "SELL", em(1)), L("PE", "SELL", em(-1))] },
  { id: "strip", name: "Strip", view: "Volatile", risk: "Undefined", tags: ["volatility", "debit"],
    description: "Buy one ATM call and two ATM puts. A volatility bet that pays more on a fall.",
    legs: [L("CE", "BUY", atm(0)), L("PE", "BUY", atm(0), 2)] },
  { id: "strap", name: "Strap", view: "Volatile", risk: "Undefined", tags: ["volatility", "debit"],
    description: "Buy two ATM calls and one ATM put. A volatility bet that pays more on a rally.",
    legs: [L("CE", "BUY", atm(0), 2), L("PE", "BUY", atm(0))] },
];

export function getTemplate(id: string): StrategyTemplate | undefined {
  return STRATEGY_TEMPLATES.find((t) => t.id === id);
}

export function templatesByView(view: TemplateView): StrategyTemplate[] {
  return STRATEGY_TEMPLATES.filter((t) => t.view === view);
}

// ───────────────────────────── Chain helpers ─────────────────────────────

const pos = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x) && x > 0;

function sortedStrikes(chain: OptionData[] | undefined): number[] {
  return Array.from(new Set((chain ?? []).map((r) => r?.strikePrice).filter(pos))).sort((a, b) => a - b);
}

/** Snap a strike to the nearest multiple of step (or to the nearest listed strike when given). */
export function snapStrike(value: number, step: number, listed?: number[]): number {
  if (!Number.isFinite(value)) return NaN;
  if (listed && listed.length > 0) {
    let best = listed[0];
    for (const k of listed) if (Math.abs(k - value) < Math.abs(best - value)) best = k;
    return best;
  }
  const s = step > 0 ? step : 50;
  return Math.max(s, Math.round(value / s) * s);
}

/**
 * Per-strike smile from the chain (decimal IV), linear in strike between quoted strikes and flat
 * beyond the ends. Falls back to `fallback` when the chain carries no IV.
 */
export function smileFromChain(chain: OptionData[] | undefined, forward: number, fallback: number): (K: number) => number {
  const pts = (chain ?? [])
    .filter((r) => r && pos(r.strikePrice))
    .map((r) => ({ k: r.strikePrice, iv: legIV(r, forward) }))
    .filter((p) => pos(p.iv))
    .sort((a, b) => a.k - b.k)
    .map((p) => ({ k: p.k, iv: pctToDec(p.iv) }));
  const fb = pos(fallback) ? fallback : 0.15;
  if (pts.length === 0) return () => fb;
  return (K: number) => {
    if (!Number.isFinite(K)) return fb;
    if (K <= pts[0].k) return pts[0].iv;
    const last = pts[pts.length - 1];
    if (K >= last.k) return last.iv;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      if (K <= b.k) return b.k === a.k ? a.iv : a.iv + ((K - a.k) / (b.k - a.k)) * (b.iv - a.iv);
    }
    return fb;
  };
}

/**
 * Price of one option leg from a chain row in the chosen mode.
 * mid: (bid+ask)/2 when two-sided, else LTP. ltp: last traded price. natural: ask to buy, bid to sell.
 * Returns 0 when no usable price exists.
 */
export function quoteLeg(leg: OptionLegData | undefined, side: Side, mode: PriceMode): number {
  if (!leg) return 0;
  if (mode === "ltp") return pos(leg.ltp) ? leg.ltp : legMid(leg);
  if (mode === "natural") {
    const px = side === "BUY" ? leg.askPrice : leg.bidPrice;
    return pos(px) ? px : legMid(leg);
  }
  return legMid(leg);
}

/** Premium and IV (decimal) for strike/type from the chain; null when the strike is not quoted. */
export function chainQuote(
  chain: OptionData[] | undefined,
  strike: number,
  type: OptionType,
  side: Side,
  mode: PriceMode,
): { premium: number; iv?: number } | null {
  const row = (chain ?? []).find((r) => r && r.strikePrice === strike);
  if (!row) return null;
  const leg = type === "CE" ? row.ce : row.pe;
  const premium = quoteLeg(leg, side, mode);
  if (!(premium > 0)) return null;
  return { premium: Math.round(premium * 100) / 100, iv: pos(leg?.iv) ? pctToDec(leg.iv) : undefined };
}

// ───────────────────────────── Resolution ─────────────────────────────

function marketContext(ctx: ResolveContext, expiry: string) {
  const now = ctx.now ?? new Date();
  const r = Number.isFinite(ctx.r) ? (ctx.r as number) : 0.065;
  const q = Number.isFinite(ctx.q) ? (ctx.q as number) : 0;
  const Traw = timeToExpiryYears(expiry, now);
  const T = Number.isFinite(Traw) && Traw > 0 ? Traw : 1 / (365 * 24 * 60);
  const F = forwardFromSpot(ctx.spot, T, r, q);
  const chain = ctx.chainFor?.(expiry);
  const listed = sortedStrikes(chain);
  const smile = smileFromChain(chain, F, ctx.atmIv);
  return { now, r, q, T, F, chain, listed, smile };
}

/** Candidate strikes: the listed chain strikes, else a synthetic grid of ±60 steps around spot. */
function candidateStrikes(listed: number[], spot: number, step: number): number[] {
  if (listed.length > 0) return listed;
  const s = step > 0 ? step : 50;
  const atmK = Math.round(spot / s) * s;
  const out: number[] = [];
  for (let i = -60; i <= 60; i++) if (atmK + i * s > 0) out.push(atmK + i * s);
  return out;
}

/** Strike whose |Black-76 delta| is closest to target, for the given type. */
export function strikeForDelta(
  target: number,
  type: OptionType,
  o: { F: number; T: number; r: number; strikes: number[]; sigmaAt: (K: number) => number },
): number {
  let best = NaN;
  let bestErr = Infinity;
  for (const K of o.strikes) {
    const d = Math.abs(greeks76({ F: o.F, K, T: o.T, r: o.r, sigma: o.sigmaAt(K), type }).delta);
    if (!Number.isFinite(d)) continue;
    const err = Math.abs(d - target);
    if (err < bestErr) {
      bestErr = err;
      best = K;
    }
  }
  return best;
}

/**
 * Resolve a template into concrete legs (premium per unit, iv decimal) against the chain(s).
 * Missing quotes fall back to Black-76 theoretical prices on the smile. Never throws.
 */
export function resolveTemplate(t: StrategyTemplate, ctx: ResolveContext): Leg[] {
  if (!t || !(ctx.spot > 0) || ctx.expiries.length === 0) return [];
  const mode = ctx.priceMode ?? "mid";
  const baseLots = Math.max(1, Math.round(ctx.lots ?? 1));
  const strikes: number[] = [];
  const out: Leg[] = [];
  t.legs.forEach((tl) => {
    const expiry = ctx.expiries[Math.min(tl.expiry ?? 0, ctx.expiries.length - 1)];
    const m = marketContext(ctx, expiry);
    const cands = candidateStrikes(m.listed, ctx.spot, ctx.strikeStep);
    const lotSize = ctx.lotSizeFor(expiry);
    const lots = baseLots * Math.max(1, tl.ratio);
    if (tl.type === "FUT") {
      const synth = m.chain && m.chain.length ? syntheticFuture(m.chain, ctx.spot) : NaN;
      const fut = pos(synth) ? synth : m.F;
      strikes.push(NaN);
      out.push({ symbol: ctx.symbol, type: "FUT", side: tl.side, strike: 0, expiry, lots, lotSize, premium: Math.round(fut * 100) / 100 });
      return;
    }
    const atmK = m.chain && m.chain.length ? findATMStrike(m.chain, ctx.spot) : snapStrike(ctx.spot, ctx.strikeStep);
    let K: number;
    const rule = tl.strike;
    switch (rule.kind) {
      case "atm":
        K = snapStrike(atmK + rule.offset * ctx.strikeStep, ctx.strikeStep, m.listed);
        break;
      case "delta":
        K = strikeForDelta(rule.delta, tl.type, { F: m.F, T: m.T, r: m.r, strikes: cands, sigmaAt: m.smile });
        break;
      case "em": {
        const sig = m.smile(m.F);
        K = snapStrike(m.F * Math.exp(rule.mult * sig * Math.sqrt(m.T)), ctx.strikeStep, m.listed);
        // keep 1σ strikes off the ATM strike so spreads always have width
        if (K === atmK && rule.mult !== 0) K = snapStrike(atmK + Math.sign(rule.mult) * ctx.strikeStep, ctx.strikeStep, m.listed);
        break;
      }
      case "wing": {
        const ref = strikes[rule.of];
        K = Number.isFinite(ref) ? snapStrike(ref + rule.steps * ctx.strikeStep, ctx.strikeStep, m.listed) : NaN;
        if (Number.isFinite(ref) && K === ref) K = ref + rule.steps * ctx.strikeStep;
        break;
      }
    }
    if (!pos(K)) K = snapStrike(atmK, ctx.strikeStep);
    strikes.push(K);
    const q = chainQuote(m.chain, K, tl.type, tl.side, mode);
    const iv = q?.iv ?? m.smile(K);
    const premium = q?.premium ?? Math.max(0.05, Math.round(black76Price({ F: m.F, K, T: m.T, r: m.r, sigma: iv, type: tl.type }) * 20) / 20);
    out.push({ symbol: ctx.symbol, type: tl.type, side: tl.side, strike: K, expiry, lots, lotSize, premium, iv });
  });
  return out;
}

// ───────────────────────────── Analytics helpers ─────────────────────────────

/** Earliest expiry among enabled legs ("" for none). */
export function frontExpiry(legs: Leg[]): string {
  const ex = legs.filter((l) => l && l.enabled !== false && l.expiry).map((l) => l.expiry).sort();
  return ex[0] ?? "";
}

/** True when enabled legs span more than one expiry (calendars / diagonals). */
export function isMultiExpiry(legs: Leg[]): boolean {
  return new Set(legs.filter((l) => l && l.enabled !== false).map((l) => l.expiry)).size > 1;
}

/**
 * Probability that the position is in profit at `atDate` (model value of later legs), integrating
 * strategyValueAt over the lognormal density of the spot. Used for calendars and diagonals, where the
 * piecewise-linear expiry payoff does not apply.
 */
export function popAtDate(
  legs: Leg[],
  o: { F: number; T: number; sigma: number; atDate: Date; now?: Date; spot?: number; r?: number; q?: number },
): number {
  if (!(o.F > 0) || !(o.sigma > 0) || !(o.T > 0)) return NaN;
  let p = 0;
  for (const { S, w } of lognormalGrid(o.F, o.sigma, o.T)) {
    const v = strategyValueAt(legs, S, { now: o.now, atDate: o.atDate, spot: o.spot, r: o.r, q: o.q });
    if (v > 0) p += w;
  }
  return Math.max(0, Math.min(1, p));
}

/** Expected P&L (rupees) at atDate under the same lognormal integration as popAtDate. */
export function evAtDate(
  legs: Leg[],
  o: { F: number; T: number; sigma: number; atDate: Date; now?: Date; spot?: number; r?: number; q?: number },
): number {
  if (!(o.F > 0) || !(o.sigma > 0) || !(o.T > 0)) return NaN;
  let ev = 0;
  for (const { S, w } of lognormalGrid(o.F, o.sigma, o.T)) {
    const v = strategyValueAt(legs, S, { now: o.now, atDate: o.atDate, spot: o.spot, r: o.r, q: o.q });
    if (Number.isFinite(v)) ev += v * w;
  }
  return ev;
}

// ───────────────────────────── View wizard ranking ─────────────────────────────

export interface ViewInput {
  direction: TemplateView;
  /** Target spot. For "Volatile" the distance |target − spot| is applied both ways. */
  targetPrice: number;
  targetDate: Date;
  broker?: BrokerPreset;
}

export interface RankedTemplate {
  template: StrategyTemplate;
  legs: Leg[];
  /** Model P&L at the target (rupees, before charges). */
  pnlAtTarget: number;
  charges: number;
  netPnl: number;
  margin: number;
  /** netPnl / margin (fraction). NaN when margin is zero. */
  returnOnMargin: number;
  pop: number;
  maxLoss: number;
  unlimitedLoss: boolean;
}

/**
 * Rank templates for a view by expected return on margin, net of round-trip charges, at the target
 * price and date. Templates that resolve to nothing are skipped.
 */
export function rankTemplates(view: ViewInput, ctx: ResolveContext, templates: readonly StrategyTemplate[] = STRATEGY_TEMPLATES): RankedTemplate[] {
  if (!(ctx.spot > 0) || !(view.targetPrice > 0)) return [];
  const now = ctx.now ?? new Date();
  const pool = templates.filter((t) => t.view === view.direction);
  const out: RankedTemplate[] = [];
  for (const template of pool) {
    const legs = resolveTemplate(template, ctx);
    if (legs.length === 0) continue;
    const valueAt = (S: number) => strategyValueAt(legs, S, { now, atDate: view.targetDate, spot: ctx.spot, r: ctx.r, q: ctx.q });
    let pnl: number;
    if (view.direction === "Volatile") {
      const d = Math.abs(view.targetPrice - ctx.spot);
      pnl = (valueAt(ctx.spot + d) + valueAt(Math.max(1, ctx.spot - d))) / 2;
    } else {
      pnl = valueAt(view.targetPrice);
    }
    const charges = chargesForLegs(legs, { roundTrip: true, broker: view.broker }).total;
    const margin = estimateMargin(legs, { spot: ctx.spot, now, sigma: ctx.atmIv }).total;
    const mpl = maxProfitLoss(legs);
    const front = frontExpiry(legs);
    const T = timeToExpiryYears(front, now);
    const r = Number.isFinite(ctx.r) ? (ctx.r as number) : getMarketParams().r;
    const q = ctx.q ?? 0;
    const F = forwardFromSpot(ctx.spot, T > 0 ? T : 0, r, q);
    const pop = isMultiExpiry(legs)
      ? popAtDate(legs, { F, T, sigma: ctx.atmIv, atDate: new Date(toISTDate(front, "15:30").getTime() - 60_000), now, spot: ctx.spot, r, q })
      : probabilityOfProfit(legs, { F, T, sigma: ctx.atmIv });
    const netPnl = pnl - charges;
    out.push({
      template,
      legs,
      pnlAtTarget: pnl,
      charges,
      netPnl,
      margin,
      returnOnMargin: margin > 0 ? netPnl / margin : NaN,
      pop,
      maxLoss: mpl.maxLoss,
      unlimitedLoss: mpl.unlimitedLoss,
    });
  }
  return out.sort((a, b) => {
    const ra = Number.isFinite(a.returnOnMargin) ? a.returnOnMargin : -Infinity;
    const rb = Number.isFinite(b.returnOnMargin) ? b.returnOnMargin : -Infinity;
    return rb - ra;
  });
}
