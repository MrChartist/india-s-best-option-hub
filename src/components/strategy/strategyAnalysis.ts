/**
 * One pure pass that turns the builder's legs into every number the page shows. All maths comes
 * from @/lib/options; calendars/diagonals (legs on several expiries) are evaluated at the front
 * expiry with the later legs marked to model, because the piecewise-linear expiry payoff does not
 * apply to them.
 */
import {
  breakevens as expiryBreakevens,
  breakevensAfterCharges,
  chargesForLegs,
  estimateMargin,
  expectedValue,
  forwardFromSpot,
  greeks76,
  marginFundsRequired,
  maxProfitLoss,
  netPremium,
  positionGreeks,
  probOfReachingProfit,
  probabilityOfProfit,
  resolveLegIVs,
  sideSign,
  spotGrid,
  strategyValueAt,
  timeToExpiryYears,
  toISTDate,
  ZERO_GREEKS,
  type BrokerPreset,
  type ChargesBreakdown,
  type Greeks,
  type Leg,
  type MarginEstimate,
} from "@/lib/options";
import { evAtDate, frontExpiry, isMultiExpiry, popAtDate } from "@/lib/strategyTemplates";
import type { BuilderLeg } from "./strategyState";

export interface LegGreeksRow {
  id: string;
  leg: Leg;
  /** Per-unit model greeks (unsigned by side). */
  unit: Greeks;
  /** Position greeks: side sign × lots × lot size. */
  position: Greeks;
}

export interface StrategyAnalysis {
  empty: boolean;
  active: Leg[];
  multiExpiry: boolean;
  frontExpiry: string;
  frontAt: Date | null;
  /** Years to the front expiry. */
  T: number;
  /** Forward to the front expiry. */
  F: number;
  maxProfit: number;
  maxLoss: number;
  unlimitedProfit: boolean;
  unlimitedLoss: boolean;
  /** max profit / |max loss|, only when both are finite and non-zero. */
  riskReward: number | null;
  breakevens: number[];
  breakevensNet: number[];
  pop: number;
  ev: number;
  net: { net: number; type: "CREDIT" | "DEBIT" };
  margin: MarginEstimate;
  returnOnMargin: number | null;
  charges: ChargesBreakdown;
  legGreeks: LegGreeksRow[];
  netGreeks: Greeks;
  /** Model P&L right now at the current spot (mark-to-model vs entry premiums). */
  pnlNow: number;
}

export interface AnalysisInput {
  legs: BuilderLeg[];
  spot: number;
  now: Date;
  r: number;
  q: number;
  /** Decimal ATM IV of the front expiry (fallback vol). */
  atmIv: number;
  /** Per-strike smile for the front expiry (decimal). */
  smile: (K: number) => number;
  broker?: BrokerPreset;
  roundTrip: boolean;
}

function crossings(grid: number[], values: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < grid.length; i++) {
    const a = values[i - 1];
    const b = values[i];
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    if (a === 0) out.push(grid[i - 1]);
    else if (Math.sign(a) !== Math.sign(b) && b !== 0) out.push(grid[i - 1] + ((0 - a) * (grid[i] - grid[i - 1])) / (b - a));
  }
  return out.map((x) => Math.round(x * 100) / 100);
}

function legLabelGreeks(l: Leg, o: { spot: number; now: Date; r: number; q: number }): Greeks {
  if (l.type === "FUT") return { ...ZERO_GREEKS, delta: 1 };
  const T = timeToExpiryYears(l.expiry, o.now);
  if (!(T > 0)) return { ...ZERO_GREEKS };
  const F = forwardFromSpot(o.spot, T, o.r, o.q);
  const g = greeks76({ F, K: l.strike, T, r: o.r, sigma: Math.max(l.iv ?? 0.15, 0.001), type: l.type });
  // greeks76 returns dV/dF; convert to spot greeks (dF/dS = F/S = e^{(r−q)T}) to match the Position Tracker.
  const k = F / o.spot;
  return { ...g, delta: g.delta * k, gamma: g.gamma * k * k };
}

const EMPTY_MARGIN: MarginEstimate = {
  span: 0, exposure: 0, elmExpiryDay: 0, premiumReceived: 0, total: 0, hedgeBenefit: 0, nakedTotal: 0,
  definedRisk: false, method: "long-only", isEstimate: true,
};
const EMPTY_CHARGES: ChargesBreakdown = { brokerage: 0, stt: 0, exchange: 0, sebi: 0, stamp: 0, gst: 0, total: 0 };

export function analyseStrategy(input: AnalysisInput): StrategyAnalysis {
  const { spot, now, r, q } = input;
  const enabled = input.legs.filter((l) => l.enabled && l.lots > 0 && l.lotSize > 0);
  if (enabled.length === 0 || !(spot > 0)) {
    return {
      empty: true, active: [], multiExpiry: false, frontExpiry: "", frontAt: null, T: 0, F: spot,
      maxProfit: 0, maxLoss: 0, unlimitedProfit: false, unlimitedLoss: false, riskReward: null,
      breakevens: [], breakevensNet: [], pop: NaN, ev: NaN, net: { net: 0, type: "DEBIT" },
      margin: EMPTY_MARGIN, returnOnMargin: null, charges: EMPTY_CHARGES, legGreeks: [], netGreeks: { ...ZERO_GREEKS }, pnlNow: 0,
    };
  }
  const active = resolveLegIVs(enabled, { spot, now, r, q });
  const front = frontExpiry(active);
  const frontAt = front ? toISTDate(front, "15:30") : null;
  const T = Math.max(timeToExpiryYears(front, now) || 0, 0);
  const F = forwardFromSpot(spot, T, r, q);
  const multi = isMultiExpiry(active);
  const charges = chargesForLegs(active, { roundTrip: input.roundTrip, broker: input.broker });
  const roundTripCost = input.roundTrip ? charges.total : chargesForLegs(active, { roundTrip: true, broker: input.broker }).total;

  const mpl = maxProfitLoss(active);
  let maxProfit = mpl.maxProfit;
  let maxLoss = mpl.maxLoss;
  let be: number[];
  let beNet: number[];
  let pop: number;
  let ev: number;
  if (multi && frontAt) {
    const grid = spotGrid(active, spot, { pctRange: 0.3, points: 301 });
    const atFront = new Date(frontAt.getTime());
    const values = grid.map((S) => strategyValueAt(active, S, { now, atDate: atFront, r, q }));
    const finite = values.filter(Number.isFinite);
    maxProfit = mpl.unlimitedProfit ? Infinity : Math.max(0, ...finite);
    maxLoss = mpl.unlimitedLoss ? -Infinity : Math.min(0, ...finite);
    be = crossings(grid, values);
    beNet = crossings(grid, values.map((v) => v - roundTripCost));
    const sigma = input.smile(F) || input.atmIv;
    pop = popAtDate(active, { F, T, sigma, atDate: atFront, now, r, q });
    ev = evAtDate(active, { F, T, sigma, atDate: atFront, now, r, q });
  } else {
    be = expiryBreakevens(active);
    beNet = breakevensAfterCharges(active, { broker: input.broker });
    pop = T > 0 ? probabilityOfProfit(active, { F, T, sigma: input.smile }) : NaN;
    ev = T > 0 ? expectedValue(active, { F, T, sigma: input.smile(F) || input.atmIv }) : NaN;
  }
  const riskReward = Number.isFinite(maxProfit) && Number.isFinite(maxLoss) && maxLoss < 0 && maxProfit > 0 ? maxProfit / Math.abs(maxLoss) : null;

  const margin = estimateMargin(active, { spot, now, sigma: input.atmIv });
  // Same capital base as the Optimizer: funds required (SPAN + exposure + ELM + net debit),
  // not margin.total, which adds the gross premium paid on every long leg.
  const funds = marginFundsRequired(margin);
  const returnOnMargin = Number.isFinite(maxProfit) && funds > 0 ? maxProfit / funds : null;

  const ctx = { spot, now, r, q };
  const legGreeks: LegGreeksRow[] = active.map((l, i) => {
    const unit = legLabelGreeks(l, ctx);
    const mult = sideSign(l.side) * l.lots * l.lotSize;
    const position = Object.fromEntries(Object.entries(unit).map(([k, v]) => [k, Number.isFinite(v) ? v * mult : 0])) as unknown as Greeks;
    return { id: enabled[i].id, leg: l, unit, position };
  });
  const netGreeks = positionGreeks(active.map((l, i) => ({ ...l, greeks: legGreeks[i].unit })));

  return {
    empty: false,
    active,
    multiExpiry: multi,
    frontExpiry: front,
    frontAt,
    T,
    F,
    maxProfit,
    maxLoss,
    unlimitedProfit: mpl.unlimitedProfit,
    unlimitedLoss: mpl.unlimitedLoss,
    riskReward,
    breakevens: be,
    breakevensNet: beNet,
    pop,
    ev,
    net: netPremium(active),
    margin,
    returnOnMargin,
    charges,
    legGreeks,
    netGreeks,
    pnlNow: strategyValueAt(active, spot, { now, r, q }),
  };
}

/**
 * P50: chance of touching 50% of max profit before expiry (Monte-Carlo, seeded so it is stable).
 * Single-expiry strategies only; NaN otherwise or when max profit is unlimited/zero.
 */
export function computeP50(a: StrategyAnalysis, spot: number, sigma: number, r: number): number {
  if (a.empty || a.multiExpiry || !(a.T > 0) || !Number.isFinite(a.maxProfit) || !(a.maxProfit > 0)) return NaN;
  return probOfReachingProfit(a.active, { S: spot, T: a.T, sigma, target: 0.5 * a.maxProfit, paths: 1200, seed: 50, r });
}
