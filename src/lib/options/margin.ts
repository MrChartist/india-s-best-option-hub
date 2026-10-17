/**
 * SPAN-style margin ESTIMATE (not the exchange's SPAN file).
 *
 * 16 scenarios: price moves of 0, ±1/3, ±2/3 and ±1 × the price scan range, each with
 * volatility up and down (14), plus two extreme moves of ±2 × the scan range counted at 35%.
 * Exposure margin: 2% (index) / 3.5% (stock) of short-option and futures notional.
 * Expiry-day ELM: an extra 2% of notional on short index options expiring today (SEBI, Nov 2024).
 * Defined-risk structures are capped at their max loss; long-only positions need the premium only.
 */
import { black76Price, forwardFromSpot } from "./blackScholes";
import { getContractSpec } from "./instruments";
import { getMarketParams } from "./marketParams";
import { maxProfitLoss } from "./payoff";
import { istDateString, timeToExpiryYears } from "./time";
import type { Leg } from "./types";
import { isLegEnabled, sideSign } from "./types";

export interface MarginEstimate {
  span: number;
  exposure: number;
  elmExpiryDay: number;
  premiumReceived: number;
  total: number;
  hedgeBenefit: number;
  nakedTotal: number;
  definedRisk: boolean;
  method: "scenario-approx" | "defined-risk" | "long-only";
  isEstimate: true;
}

export interface MarginOptions {
  spot: number;
  now?: Date;
  /** Fallback vol (decimal) for legs without iv. */
  sigma?: number;
  /** Price scan range as a fraction of spot (default: index 6%, stock 12%, or 3.5σ over two days if larger). */
  priceScanPct?: number;
  /** Volatility scan in absolute decimal vol (default 0.04 = 4 vol points). */
  volScan?: number;
}

const SCENARIOS: Array<{ move: number; vol: 1 | -1 | 0; weight: number }> = [
  ...[0, 1 / 3, -1 / 3, 2 / 3, -2 / 3, 1, -1].flatMap((m) => [
    { move: m, vol: 1 as const, weight: 1 },
    { move: m, vol: -1 as const, weight: 1 },
  ]),
  { move: 2, vol: 0, weight: 0.35 },
  { move: -2, vol: 0, weight: 0.35 },
];

function qty(l: Leg): number {
  return (Number(l.lots) || 0) * (Number(l.lotSize) || 0);
}

function emptyEstimate(): MarginEstimate {
  return { span: 0, exposure: 0, elmExpiryDay: 0, premiumReceived: 0, total: 0, hedgeBenefit: 0, nakedTotal: 0, definedRisk: false, method: "scenario-approx", isEstimate: true };
}

function isIndexLegs(legs: Leg[]): boolean {
  const s = getContractSpec(legs[0]?.symbol ?? "");
  return s ? s.kind === "INDEX" : true;
}

function estimateCore(legs: Leg[], o: MarginOptions): Omit<MarginEstimate, "hedgeBenefit" | "nakedTotal"> {
  const now = o.now ?? new Date();
  const spot = o.spot;
  const { r } = getMarketParams();
  const index = isIndexLegs(legs);
  const baseSigma = o.sigma && o.sigma > 0 ? o.sigma : 0.15;
  const psr =
    o.priceScanPct && o.priceScanPct > 0 ? o.priceScanPct : Math.max(index ? 0.06 : 0.12, 3.5 * baseSigma * Math.sqrt(2 / 252));
  const volScan = o.volScan && o.volScan > 0 ? o.volScan : 0.04;
  const exposurePct = index ? 0.02 : 0.035;
  const today = istDateString(now);

  let premiumReceived = 0;
  let premiumPaid = 0;
  let exposure = 0;
  let elm = 0;
  let hasShortOrFut = false;
  for (const l of legs) {
    const n = qty(l);
    if (l.type === "FUT") {
      hasShortOrFut = true;
      exposure += exposurePct * spot * n;
      continue;
    }
    if (l.side === "SELL") {
      hasShortOrFut = true;
      premiumReceived += (Number(l.premium) || 0) * n;
      exposure += exposurePct * spot * n;
      if (index && l.expiry === today) elm += 0.02 * spot * n;
    } else {
      premiumPaid += (Number(l.premium) || 0) * n;
    }
  }

  if (!hasShortOrFut) {
    return { span: 0, exposure: 0, elmExpiryDay: 0, premiumReceived: 0, total: premiumPaid, definedRisk: true, method: "long-only", isEstimate: true };
  }

  const legT = legs.map((l) => timeToExpiryYears(l.expiry, now));
  const valueAt = (S: number, dVol: number) => {
    let v = 0;
    legs.forEach((l, i) => {
      const T = legT[i];
      const F = T > 0 ? forwardFromSpot(S, T, r, 0) : S;
      const px =
        l.type === "FUT"
          ? F
          : black76Price({ F, K: l.strike, T: T > 0 ? T : 0, r, sigma: Math.max((l.iv && l.iv > 0 ? l.iv : baseSigma) + dVol, 0.01), type: l.type });
      v += sideSign(l.side) * px * qty(l);
    });
    return v;
  };
  const base = valueAt(spot, 0);
  let worst = 0;
  for (const sc of SCENARIOS) {
    const loss = (base - valueAt(spot * (1 + sc.move * psr), sc.vol * volScan)) * sc.weight;
    if (loss > worst) worst = loss;
  }

  const pl = maxProfitLoss(legs);
  const hasFut = legs.some((l) => l.type === "FUT");
  const definedRisk = !hasFut && !pl.unlimitedLoss && Number.isFinite(pl.maxLoss);
  let span = worst;
  let method: MarginEstimate["method"] = "scenario-approx";
  if (definedRisk) {
    // A hedged structure can never lose more than its expiry max loss. For a debit structure
    // part of that loss is the net debit, which is already collected below as premiumPaid
    // (SPAN's net-option-value credit), so only the remainder needs to be blocked as span.
    const netDebit = Math.max(0, premiumPaid - premiumReceived);
    const cap = Math.max(0, Math.abs(pl.maxLoss) - netDebit);
    if (cap < span) span = cap;
    method = "defined-risk";
  }
  const total = span + exposure + elm + premiumPaid;
  return { span, exposure, elmExpiryDay: elm, premiumReceived, total, definedRisk, method, isEstimate: true };
}

/** SPAN-style margin estimate with hedge benefit versus margining every leg on its own. */
export function estimateMargin(legs: Leg[], o: MarginOptions): MarginEstimate {
  const act = (Array.isArray(legs) ? legs : []).filter((l) => l && isLegEnabled(l) && qty(l) > 0);
  if (act.length === 0 || !o || !(o.spot > 0)) return emptyEstimate();
  const core = estimateCore(act, o);
  const nakedTotal = act.length === 1 ? core.total : act.reduce((s, l) => s + estimateCore([l], o).total, 0);
  return { ...core, nakedTotal, hedgeBenefit: Math.max(0, nakedTotal - core.total) };
}
