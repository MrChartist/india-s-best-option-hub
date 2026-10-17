/**
 * Pure model for the strike × expiry heatmap: merges per-expiry matrices (each expiry can have its
 * own lot size), windows strikes around spot and finds per-expiry gamma markers.
 */
import { computeGammaLevels, multiExpiryExposure, type GexChainInput, type GexConvention } from "@/lib/gexData";

export type HeatMetric = "gex" | "dex" | "oi" | "oiChange";

export interface HeatColumnMarkers {
  expiry: string;
  callWall: number;
  putWall: number;
  /** Strike nearest the dealer-model flip (null when there is no flip). */
  flipStrike: number | null;
  flip: number | null;
}

export interface HeatmapModel {
  expiries: string[];
  strikes: number[];
  /** values[strikeIndex][expiryIndex]; NaN where the strike is not listed. */
  values: number[][];
  maxAbs: number;
  markers: HeatColumnMarkers[];
  spotStrike: number | null;
}

function nearest(strikes: number[], x: number): number | null {
  let best: number | null = null;
  for (const k of strikes) if (best === null || Math.abs(k - x) < Math.abs(best - x)) best = k;
  return best;
}

export function buildHeatmapModel(
  chains: GexChainInput[],
  spot: number,
  metric: HeatMetric,
  o: { convention: GexConvention; oiUnit: "contracts" | "qty"; window: number | "all" },
): HeatmapModel {
  const list = (Array.isArray(chains) ? chains : []).filter(
    (c) => c.expiry && Array.isArray(c.chain) && c.chain.length > 0,
  );
  const merged = new Map<number, Map<string, number>>();
  const expiries: string[] = [];
  const markers: HeatColumnMarkers[] = [];

  for (const c of list) {
    if (expiries.includes(c.expiry)) continue;
    expiries.push(c.expiry);
    const rows = multiExpiryExposure([{ expiry: c.expiry, chain: c.chain }], spot, c.lotSize, metric, {
      convention: o.convention,
      oiUnit: o.oiUnit,
    });
    for (const row of rows) {
      const m = merged.get(row.strike) ?? new Map<string, number>();
      m.set(c.expiry, row[c.expiry]);
      merged.set(row.strike, m);
    }
    // Walls are convention-free; the flip uses the dealer model so a marker exists in both views.
    const lv = computeGammaLevels(c.chain, spot, c.expiry, c.lotSize, {
      convention: "dealerLongCallShortPut",
      oiUnit: o.oiUnit,
    });
    const colStrikes = c.chain.map((r) => r.strikePrice);
    markers.push({
      expiry: c.expiry,
      callWall: lv.callWall,
      putWall: lv.putWall,
      flip: lv.flip,
      flipStrike: lv.flip === null ? null : nearest(colStrikes, lv.flip),
    });
  }

  let strikes = [...merged.keys()].sort((a, b) => a - b);
  if (o.window !== "all" && strikes.length > 0 && spot > 0) {
    const atm = strikes.reduce((bi, k, i) => (Math.abs(k - spot) < Math.abs(strikes[bi] - spot) ? i : bi), 0);
    strikes = strikes.slice(Math.max(0, atm - o.window), atm + o.window + 1);
  }

  let maxAbs = 0;
  const values = strikes.map((k) =>
    expiries.map((e) => {
      const v = merged.get(k)?.get(e);
      const val = v === undefined ? NaN : v;
      if (Number.isFinite(val)) maxAbs = Math.max(maxAbs, Math.abs(val));
      return val;
    }),
  );

  return { expiries, strikes, values, maxAbs, markers, spotStrike: nearest(strikes, spot) };
}

/**
 * Cell intensity in [0, 0.6]. A square-root scale keeps small values visible next to a large wall.
 */
export function heatAlpha(v: number, maxAbs: number): number {
  if (!Number.isFinite(v) || !(maxAbs > 0)) return 0;
  return Math.min(0.6, Math.sqrt(Math.abs(v) / maxAbs) * 0.6);
}
