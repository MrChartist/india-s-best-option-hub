/**
 * Pure portfolio analytics for the Position Tracker: live repricing, Greeks in rupees, beta-weighted
 * NIFTY delta, scenario grid, margin / capital at risk and management hints.
 *
 * All pricing goes through "@/lib/options" (Black-76 on the forward). Nothing here touches the DOM.
 */
import type { OptionData } from "@/lib/mockData";
import {
  estimateMargin,
  forwardFromSpot,
  getDividendYield,
  greeks76,
  impliedVol76,
  istDateString,
  legMid,
  maxProfitLoss,
  netPremium,
  pctToDec,
  strategyValueAt,
  timeToExpiryYears,
  type Leg,
  type MarginEstimate,
  type OHLC,
} from "@/lib/options";
import { grossPnlAt, isExpired, positionExpiryIso, positionToLeg, roundTripCharges, sideSign, type TrackedPosition } from "@/lib/positionStore";

const isPos = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x) && x > 0;

// ── Quotes ──

export interface ChainQuote {
  ltp: number;
  bid: number;
  ask: number;
  mid: number;
  /** percent, 0 when unknown */
  iv: number;
}

/** Quote for one contract from a chain, or null when the strike is not listed. */
export function quoteFromChain(chain: OptionData[] | undefined, strike: number, type: "CE" | "PE"): ChainQuote | null {
  const row = (chain ?? []).find((r) => Math.abs(r.strikePrice - strike) < 1e-6);
  if (!row) return null;
  const leg = type === "CE" ? row.ce : row.pe;
  if (!leg) return null;
  return { ltp: leg.ltp || 0, bid: leg.bidPrice || 0, ask: leg.askPrice || 0, mid: legMid(leg), iv: leg.iv || 0 };
}

// ── Per-position live analytics ──

export interface PositionLive {
  id: string;
  symbol: string;
  expiryIso: string;
  expired: boolean;
  /** Years to expiry (0 once expired, NaN when the expiry is unknown). */
  T: number;
  spot: number;
  cmp: number;
  /** Decimal IV used for the Greeks (NaN when unknown). */
  iv: number;
  ivSource: "solved" | "chain" | "stored" | "none";
  /** Signed quantity in units (SELL negative). */
  qty: number;
  /** Per-unit spot delta. */
  deltaUnit: number;
  /** Position delta in units of the underlying (signed). */
  delta: number;
  /** Position delta in lots of this underlying. */
  deltaLots: number;
  /** ₹ per calendar day. */
  theta: number;
  /** ₹ per 1 vol point. */
  vega: number;
  /** Change in ₹ delta (delta × spot) for a 1% move in the underlying (notional gamma). */
  gamma1pct: number;
  /** Gamma P&L for a 1% move: ½ · Γ · (0.01 · S)² · qty, in ₹ (sign follows the position's gamma). */
  gammaPnl1pct: number;
  grossPnl: number;
  /** Entry + exit charges if squared off at the CMP now. */
  charges: number;
  netPnl: number;
  /** Premium paid (long) or received (short) at entry, ₹. */
  premiumValue: number;
}

export interface LiveContext {
  spot: number;
  now: Date;
  r: number;
  /** Chain IV in percent for this contract (fallback when the CMP cannot be inverted). */
  chainIvPct?: number;
}

/**
 * Second-order (gamma) P&L in ₹ for a fractional spot move: ½ · Γ · (pct · S)² · qty.
 * Γ is per unit of the underlying; qty is signed (short gamma gives a negative number).
 */
export function gammaPnlForMove(gammaUnit: number, spot: number, qty: number, pct = 0.01): number {
  if (!Number.isFinite(gammaUnit) || !isPos(spot) || !Number.isFinite(qty)) return NaN;
  const dS = pct * spot;
  return 0.5 * gammaUnit * dS * dS * qty;
}

/** Solve IV from the CMP on the forward, then Black-76 Greeks converted to spot sensitivities. */
export function livePosition(p: TrackedPosition, ctx: LiveContext): PositionLive {
  const expiryIso = positionExpiryIso(p);
  const expired = isExpired(p, ctx.now);
  const T = expiryIso ? timeToExpiryYears(expiryIso, ctx.now) : NaN;
  const q = getDividendYield(p.symbol);
  const qty = sideSign(p.action) * p.lots * p.lotSize;
  const spot = ctx.spot;
  const cmp = p.currentPrice;

  let iv = NaN;
  let ivSource: PositionLive["ivSource"] = "none";
  if (isPos(spot) && T > 0 && isPos(cmp)) {
    const F = forwardFromSpot(spot, T, ctx.r, q);
    const solved = impliedVol76(cmp, { F, K: p.strike, T, r: ctx.r, type: p.type });
    if (Number.isFinite(solved) && solved > 0.005 && solved < 4.9) {
      iv = solved;
      ivSource = "solved";
    }
  }
  if (!Number.isFinite(iv) && isPos(ctx.chainIvPct)) {
    iv = pctToDec(ctx.chainIvPct);
    ivSource = "chain";
  }
  if (!Number.isFinite(iv) && isPos(p.iv)) {
    iv = pctToDec(p.iv);
    ivSource = "stored";
  }

  let deltaUnit = NaN;
  let gammaUnit = NaN;
  let thetaUnit = NaN;
  let vegaUnit = NaN;
  if (isPos(spot) && T > 0 && Number.isFinite(iv)) {
    const F = forwardFromSpot(spot, T, ctx.r, q);
    const g = greeks76({ F, K: p.strike, T, r: ctx.r, sigma: iv, type: p.type });
    const carry = Math.exp((ctx.r - q) * T); // dF/dS
    deltaUnit = g.delta * carry;
    gammaUnit = g.gamma * carry * carry;
    thetaUnit = g.theta;
    vegaUnit = g.vega;
  } else if (isPos(spot) && (expired || T === 0)) {
    const itm = p.type === "CE" ? spot > p.strike : spot < p.strike;
    deltaUnit = itm ? (p.type === "CE" ? 1 : -1) : 0;
    gammaUnit = 0;
    thetaUnit = 0;
    vegaUnit = 0;
  }

  const delta = deltaUnit * qty;
  const gross = grossPnlAt(p, cmp);
  const charges = roundTripCharges(p, cmp).total;
  return {
    id: p.id,
    symbol: p.symbol,
    expiryIso,
    expired,
    T,
    spot,
    cmp,
    iv,
    ivSource,
    qty,
    deltaUnit,
    delta,
    deltaLots: p.lotSize > 0 ? delta / p.lotSize : NaN,
    theta: thetaUnit * qty,
    vega: vegaUnit * qty,
    gamma1pct: isPos(spot) ? gammaUnit * qty * spot * spot * 0.01 : NaN,
    gammaPnl1pct: isPos(spot) ? gammaPnlForMove(gammaUnit, spot, qty, 0.01) : NaN,
    grossPnl: gross,
    charges,
    netPnl: gross - charges,
    premiumValue: p.entryPrice * p.lots * p.lotSize,
  };
}

// ── Beta ──

/** Beta of a stock to the index from aligned daily log returns (by IST date). NaN with < 60 overlaps. */
export function betaFromBars(stock: OHLC[], index: OHLC[], minObs = 60): number {
  const day = (t: number) => istDateString(new Date(t > 1e12 ? t : t * 1000));
  const idx = new Map<string, number>();
  for (const b of index ?? []) if (isPos(b.c)) idx.set(day(b.t), b.c);
  const pairs: Array<[string, number, number]> = [];
  for (const b of stock ?? []) {
    const d = day(b.t);
    const ic = idx.get(d);
    if (isPos(b.c) && isPos(ic)) pairs.push([d, b.c, ic]);
  }
  pairs.sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const rs: number[] = [];
  const ri: number[] = [];
  for (let i = 1; i < pairs.length; i++) {
    rs.push(Math.log(pairs[i][1] / pairs[i - 1][1]));
    ri.push(Math.log(pairs[i][2] / pairs[i - 1][2]));
  }
  const n = rs.length;
  if (n < minObs) return NaN;
  const ms = rs.reduce((a, b) => a + b, 0) / n;
  const mi = ri.reduce((a, b) => a + b, 0) / n;
  let cov = 0;
  let varI = 0;
  for (let i = 0; i < n; i++) {
    cov += (rs[i] - ms) * (ri[i] - mi);
    varI += (ri[i] - mi) ** 2;
  }
  return varI > 0 ? cov / varI : NaN;
}

// ── Aggregation per underlying ──

export interface UnderlyingSummary {
  symbol: string;
  spot: number;
  lotSize: number;
  positions: number;
  delta: number;
  deltaLots: number;
  theta: number;
  vega: number;
  gamma1pct: number;
  gammaPnl1pct: number;
  grossPnl: number;
  charges: number;
  netPnl: number;
  beta: number;
  /** Delta expressed in NIFTY lots after beta weighting. */
  niftyLots: number;
  /** Futures lots to trade to flatten delta (−Δ / lot). */
  hedgeFutLots: number;
  margin: MarginEstimate | null;
  /** Worst expiry loss in ₹ (positive number); NaN when unlimited. */
  capitalAtRisk: number;
  unlimitedRisk: boolean;
}

export interface PortfolioSummary {
  underlyings: UnderlyingSummary[];
  theta: number;
  vega: number;
  gamma1pct: number;
  gammaPnl1pct: number;
  grossPnl: number;
  charges: number;
  netPnl: number;
  niftyLots: number;
  niftyDeltaUnits: number;
  margin: number;
  capitalAtRisk: number;
  unlimitedRisk: boolean;
}

/** Legs for one group with the live IV attached (for margin and scenario repricing). */
export function legsWithIv(positions: TrackedPosition[], live: Record<string, PositionLive>): Leg[] {
  return positions
    .filter((p) => positionExpiryIso(p))
    .map((p) => {
      const iv = live[p.id]?.iv;
      return positionToLeg(p, Number.isFinite(iv) && iv > 0 ? { iv } : {});
    });
}

function groupBy<T>(xs: T[], key: (x: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const x of xs) {
    const k = key(x);
    const arr = m.get(k);
    if (arr) arr.push(x);
    else m.set(k, [x]);
  }
  return m;
}

export function summarisePortfolio(
  positions: TrackedPosition[],
  live: Record<string, PositionLive>,
  o: { spots: Record<string, number>; betas: Record<string, number>; niftySpot: number; niftyLot: number; now: Date },
): PortfolioSummary {
  const open = positions.filter((p) => !live[p.id]?.expired);
  const bySymbol = groupBy(open, (p) => p.symbol);
  const underlyings: UnderlyingSummary[] = [];
  for (const [symbol, list] of bySymbol) {
    const spot = o.spots[symbol] ?? NaN;
    const rows = list.map((p) => live[p.id]).filter((x): x is PositionLive => !!x);
    const sum = (k: keyof PositionLive) => rows.reduce((a, r) => a + (Number.isFinite(r[k] as number) ? (r[k] as number) : 0), 0);
    const lotSize = list[0]?.lotSize ?? NaN;
    const delta = sum("delta");
    const beta = symbol === "NIFTY" ? 1 : Number.isFinite(o.betas[symbol]) ? o.betas[symbol] : 1;
    const niftyLots = isPos(spot) && isPos(o.niftySpot) && isPos(o.niftyLot) ? (delta * spot * beta) / o.niftySpot / o.niftyLot : NaN;

    let margin: MarginEstimate | null = null;
    let capitalAtRisk = 0;
    let unlimitedRisk = false;
    const legs = legsWithIv(list, live);
    if (isPos(spot) && legs.length) {
      margin = estimateMargin(legs, { spot, now: o.now });
    }
    for (const [, groupLegs] of groupBy(legs, (l) => l.expiry)) {
      const mpl = maxProfitLoss(groupLegs);
      if (mpl.unlimitedLoss || !Number.isFinite(mpl.maxLoss)) unlimitedRisk = true;
      else capitalAtRisk += Math.max(0, -mpl.maxLoss);
    }
    underlyings.push({
      symbol,
      spot,
      lotSize,
      positions: list.length,
      delta,
      deltaLots: isPos(lotSize) ? delta / lotSize : NaN,
      theta: sum("theta"),
      vega: sum("vega"),
      gamma1pct: sum("gamma1pct"),
      gammaPnl1pct: sum("gammaPnl1pct"),
      grossPnl: sum("grossPnl"),
      charges: sum("charges"),
      netPnl: sum("netPnl"),
      beta,
      niftyLots,
      hedgeFutLots: isPos(lotSize) ? -delta / lotSize : NaN,
      margin,
      capitalAtRisk: unlimitedRisk ? NaN : capitalAtRisk,
      unlimitedRisk,
    });
  }
  underlyings.sort((a, b) => a.symbol.localeCompare(b.symbol));
  const total = (k: keyof UnderlyingSummary) => underlyings.reduce((a, u) => a + (Number.isFinite(u[k] as number) ? (u[k] as number) : 0), 0);
  const niftyLots = total("niftyLots");
  return {
    underlyings,
    theta: total("theta"),
    vega: total("vega"),
    gamma1pct: total("gamma1pct"),
    gammaPnl1pct: total("gammaPnl1pct"),
    grossPnl: total("grossPnl"),
    charges: total("charges"),
    netPnl: total("netPnl"),
    niftyLots,
    niftyDeltaUnits: isPos(o.niftyLot) ? niftyLots * o.niftyLot : NaN,
    margin: underlyings.reduce((a, u) => a + (u.margin?.total ?? 0), 0),
    capitalAtRisk: total("capitalAtRisk"),
    unlimitedRisk: underlyings.some((u) => u.unlimitedRisk),
  };
}

// ── Scenario grid ──

export const SCENARIO_SPOT_PCTS = [-0.03, -0.02, -0.01, 0, 0.01, 0.02, 0.03] as const;
export const SCENARIO_IV_SHIFTS = [0.05, 0, -0.05] as const;

/**
 * Portfolio P&L (₹, vs entry, before charges) for each IV shift × spot move. Every underlying moves
 * by the same percentage; legs are repriced with Black-76 at their live IV plus the shift.
 * Returns matrix[ivIdx][spotIdx].
 */
export function scenarioGrid(
  positions: TrackedPosition[],
  live: Record<string, PositionLive>,
  spots: Record<string, number>,
  o: { now: Date; r: number; spotPcts?: readonly number[]; ivShifts?: readonly number[]; atDate?: Date },
): number[][] {
  const spotPcts = o.spotPcts ?? SCENARIO_SPOT_PCTS;
  const ivShifts = o.ivShifts ?? SCENARIO_IV_SHIFTS;
  const open = positions.filter((p) => !live[p.id]?.expired && positionExpiryIso(p));
  const groups = [...groupBy(open, (p) => p.symbol)].filter(([s]) => isPos(spots[s]));
  return ivShifts.map((shift) =>
    spotPcts.map((pct) =>
      groups.reduce((acc, [symbol, list]) => {
        const legs = legsWithIv(list, live);
        const v = strategyValueAt(legs, spots[symbol] * (1 + pct), { now: o.now, atDate: o.atDate, ivShift: shift, r: o.r, q: getDividendYield(symbol), spot: spots[symbol] });
        return acc + (Number.isFinite(v) ? v : 0);
      }, 0),
    ),
  );
}

// ── Management hints ──

export type HintSeverity = "success" | "info" | "warning" | "danger";

export interface Hint {
  id: string;
  severity: HintSeverity;
  title: string;
  detail: string;
  symbol?: string;
}

/** Strike of the given type whose |delta| is closest to `target`, from the strikes listed in the chain. */
export function strikeForDelta(
  chain: OptionData[] | undefined,
  o: { spot: number; T: number; r: number; q: number; iv: number; type: "CE" | "PE"; target: number },
): number | null {
  if (!chain?.length || !isPos(o.spot) || !(o.T > 0) || !isPos(o.iv)) return null;
  const F = forwardFromSpot(o.spot, o.T, o.r, o.q);
  let best: number | null = null;
  let bestErr = Infinity;
  for (const row of chain) {
    const K = row.strikePrice;
    if (!isPos(K)) continue;
    const otm = o.type === "CE" ? K >= o.spot : K <= o.spot;
    if (!otm) continue;
    const d = Math.abs(greeks76({ F, K, T: o.T, r: o.r, sigma: o.iv, type: o.type }).delta);
    const err = Math.abs(d - o.target);
    if (err < bestErr) {
      bestErr = err;
      best = K;
    }
  }
  return best;
}

export interface HintInput {
  positions: TrackedPosition[];
  live: Record<string, PositionLive>;
  summary: PortfolioSummary;
  chains: Record<string, OptionData[] | undefined>;
  now: Date;
  r: number;
  formatINR: (v: number) => string;
}

/** Group key: explicit strategyId, else symbol + expiry. */
export function strategyKey(p: TrackedPosition): string {
  return p.strategyId ? `S:${p.strategyId}` : `${p.symbol}|${positionExpiryIso(p)}`;
}

export function managementHints(input: HintInput): Hint[] {
  const { positions, live, summary, now, r, formatINR } = input;
  const hints: Hint[] = [];
  const today = istDateString(now);
  const open = positions.filter((p) => !live[p.id]?.expired);

  // Expired positions waiting for settlement.
  const expired = positions.filter((p) => live[p.id]?.expired);
  if (expired.length) {
    hints.push({
      id: "expired",
      severity: "warning",
      title: `${expired.length} position${expired.length === 1 ? " has" : "s have"} expired`,
      detail: "Settle them at intrinsic value with “Settle expired”. ITM longs are charged STT on exercise.",
    });
  }

  // 1) 50% of max profit captured (credit structures).
  for (const [key, list] of groupBy(open, strategyKey)) {
    const legs = list.map((p) => positionToLeg(p)).filter((l) => l.expiry);
    if (!legs.length) continue;
    const prem = netPremium(legs);
    if (prem.type !== "CREDIT") continue;
    const mpl = maxProfitLoss(legs);
    if (mpl.unlimitedProfit || !(mpl.maxProfit > 0)) continue;
    const pnl = list.reduce((a, p) => a + (live[p.id]?.grossPnl ?? 0), 0);
    const captured = pnl / mpl.maxProfit;
    if (captured >= 0.5) {
      const name = list[0].tag || `${list[0].symbol} ${positionExpiryIso(list[0]) || ""}`.trim();
      hints.push({
        id: `profit-${key}`,
        severity: "success",
        symbol: list[0].symbol,
        title: `${name}: ${Math.round(captured * 100)}% of max profit captured`,
        detail: `P&L ${formatINR(pnl)} of a possible ${formatINR(mpl.maxProfit)}. Many credit traders book at 50% — the remaining premium pays little for the risk still on.`,
      });
    }
  }

  // 2) Roll the untested side (short CE + short PE in the same group).
  for (const [key, list] of groupBy(open, strategyKey)) {
    const shortsCE = list.filter((p) => p.action === "SELL" && p.type === "CE");
    const shortsPE = list.filter((p) => p.action === "SELL" && p.type === "PE");
    if (!shortsCE.length || !shortsPE.length) continue;
    const absDelta = (ps: TrackedPosition[]) => Math.max(...ps.map((p) => Math.abs(live[p.id]?.deltaUnit ?? 0)));
    const dCE = absDelta(shortsCE);
    const dPE = absDelta(shortsPE);
    const tested = dCE >= 0.3 && dPE <= 0.15 ? "CE" : dPE >= 0.3 && dCE <= 0.15 ? "PE" : null;
    if (!tested) continue;
    const untested = tested === "CE" ? shortsPE : shortsCE;
    const leg = untested.reduce((a, b) => (Math.abs(live[b.id]?.deltaUnit ?? 0) > Math.abs(live[a.id]?.deltaUnit ?? 0) ? b : a));
    const lv = live[leg.id];
    const keptPct = leg.entryPrice > 0 ? Math.round((1 - leg.currentPrice / leg.entryPrice) * 100) : 0;
    const target = lv && Number.isFinite(lv.iv) ? strikeForDelta(input.chains[`${leg.symbol}|${lv.expiryIso}`], { spot: lv.spot, T: lv.T, r, q: getDividendYield(leg.symbol), iv: lv.iv, type: leg.type, target: Math.min(0.3, Math.max(dCE, dPE) * 0.6) }) : null;
    hints.push({
      id: `roll-${key}`,
      severity: "info",
      symbol: leg.symbol,
      title: `${leg.symbol}: ${tested} side is tested — consider rolling the ${leg.type} ${leg.strike}`,
      detail: `The untested short ${leg.type} has kept ${keptPct}% of its premium. Rolling it ${leg.type === "PE" ? "up" : "down"}${target && target !== leg.strike ? ` to about ${target}` : " towards spot"} collects fresh credit and cuts net delta. It also narrows the profit zone.`,
    });
  }

  // 3) Delta hedge in futures lots.
  for (const u of summary.underlyings) {
    if (!Number.isFinite(u.hedgeFutLots) || Math.abs(u.deltaLots) < 0.5) continue;
    const lots = Math.round(u.hedgeFutLots);
    const action = u.hedgeFutLots > 0 ? "Buy" : "Sell";
    hints.push({
      id: `hedge-${u.symbol}`,
      severity: Math.abs(u.deltaLots) >= 2 ? "warning" : "info",
      symbol: u.symbol,
      title: `${u.symbol}: net delta ${u.deltaLots > 0 ? "+" : "−"}${Math.abs(u.deltaLots).toFixed(2)} lots`,
      detail:
        lots !== 0
          ? `${action} ${Math.abs(lots)} ${u.symbol} futures lot${Math.abs(lots) === 1 ? "" : "s"} (−Δ / lot = ${u.hedgeFutLots > 0 ? "+" : "−"}${Math.abs(u.hedgeFutLots).toFixed(2)}) to get close to delta-neutral.`
          : `Less than half a futures lot away from neutral (−Δ / lot = ${u.hedgeFutLots.toFixed(2)}). A full lot would overshoot; adjust options instead.`,
    });
  }

  // 4) Expiry-day short gamma and STT on exercise.
  const expiringShort = open.filter((p) => p.action === "SELL" && positionExpiryIso(p) === today);
  if (expiringShort.length) {
    const g = expiringShort.reduce((a, p) => a + (live[p.id]?.gamma1pct ?? 0), 0);
    hints.push({
      id: "expiry-gamma",
      severity: "danger",
      title: `Short gamma on expiry day (${expiringShort.length} leg${expiringShort.length === 1 ? "" : "s"})`,
      detail: `A 1% move changes your ₹ delta by about ${formatINR(Math.abs(g))}. Gamma peaks in the last hours, so small moves swing P&L fast. Index shorts also attract an extra 2% ELM today.`,
    });
  }
  const itmLongsToday = open.filter((p) => p.action === "BUY" && positionExpiryIso(p) === today && (live[p.id]?.deltaUnit ?? 0) !== 0 && Math.abs(live[p.id]?.deltaUnit ?? 0) > 0.5);
  if (itmLongsToday.length) {
    hints.push({
      id: "exercise-stt",
      severity: "warning",
      title: "ITM long options expire today",
      detail: "If held to 15:30 they are exercised and STT is charged on the full intrinsic value. Squaring off before the close is usually cheaper.",
    });
  }

  const order: Record<HintSeverity, number> = { danger: 0, warning: 1, success: 2, info: 3 };
  return hints.sort((a, b) => order[a.severity] - order[b.severity]);
}
