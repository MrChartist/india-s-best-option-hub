/**
 * Gamma levels over a session: call wall, put wall, gamma flip and total GEX recomputed for each
 * chain snapshot, so the GEX page can show how positioning moved against spot since the open.
 *
 * Walls are convention-free. The flip always comes from the dealer model (the seller view has no
 * flip by construction). Total GEX follows the chosen convention, in ₹ Cr per 1% move.
 */
import { buildGexView, inferOiUnit, type GexConvention } from "@/lib/gexData";
import { istDateString } from "@/lib/options";
import { snapshotToChain, type ChainSnapshot } from "@/lib/snapshotStore";

export interface LevelsPoint {
  ts: number;
  spot: number;
  callWall: number | null;
  putWall: number | null;
  /** Dealer-model gamma flip (null when total GEX does not change sign within ±5%). */
  flip: number | null;
  /** Total GEX at spot under the chosen convention, ₹ Cr per 1% move. */
  totalGex: number;
}

export interface LevelsHistoryOptions {
  convention?: GexConvention;
  /** Keep at most this many points (evenly spaced, first and last always kept). Default 40. */
  maxPoints?: number;
  /** Profile grid steps used for the flip. Default 60 (±5% in 1/6 % steps). */
  steps?: number;
}

const fin = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Evenly thin a time-ordered list to at most n items, always keeping the first and last. */
export function thinEvenly<T>(list: T[], n: number): T[] {
  const max = Math.max(2, Math.floor(n));
  if (list.length <= max) return [...list];
  const out: T[] = [];
  const stride = (list.length - 1) / (max - 1);
  let lastIdx = -1;
  for (let i = 0; i < max; i++) {
    const idx = Math.round(i * stride);
    if (idx !== lastIdx) out.push(list[idx]);
    lastIdx = idx;
  }
  return out;
}

/** Snapshots from the latest IST session in the list, oldest first. */
export function latestSession(snaps: ChainSnapshot[]): ChainSnapshot[] {
  const sorted = (Array.isArray(snaps) ? snaps : [])
    .filter((s) => s && fin(s.ts) && Array.isArray(s.rows) && s.rows.length > 0)
    .sort((a, b) => a.ts - b.ts);
  if (sorted.length === 0) return [];
  const day = istDateString(new Date(sorted[sorted.length - 1].ts));
  return sorted.filter((s) => istDateString(new Date(s.ts)) === day);
}

/** Levels for one snapshot; null when the snapshot has no usable spot or open interest. */
export function levelsForSnapshot(
  snap: ChainSnapshot,
  lotSize: number,
  o: Pick<LevelsHistoryOptions, "convention" | "steps"> = {},
): LevelsPoint | null {
  if (!snap || !(snap.spot > 0) || !snap.expiry) return null;
  const chain = snapshotToChain(snap);
  if (chain.length === 0) return null;
  const lot = fin(lotSize) && lotSize > 0 ? lotSize : 1;
  const view = buildGexView([{ expiry: snap.expiry, chain, lotSize: lot }], snap.spot, {
    convention: o.convention ?? "sellerShortBoth",
    oiUnit: inferOiUnit(chain, lot),
    rangePct: 5,
    steps: o.steps ?? 60,
  });
  if (view.byStrike.length === 0) return null;
  const hasCall = view.byStrike.some((r) => r.callGex !== 0);
  const hasPut = view.byStrike.some((r) => r.putGex !== 0);
  return {
    ts: snap.ts,
    spot: snap.spot,
    callWall: hasCall && fin(view.levels.callWall) ? view.levels.callWall : null,
    putWall: hasPut && fin(view.levels.putWall) ? view.levels.putWall : null,
    flip: view.dealerFlip,
    totalGex: view.totals.netGex,
  };
}

/** Levels for every (thinned) snapshot of the latest session, oldest first. */
export function levelsHistory(snaps: ChainSnapshot[], lotSize: number, o: LevelsHistoryOptions = {}): LevelsPoint[] {
  const session = thinEvenly(latestSession(snaps), o.maxPoints ?? 40);
  const out: LevelsPoint[] = [];
  for (const s of session) {
    const p = levelsForSnapshot(s, lotSize, o);
    if (p) out.push(p);
  }
  return out;
}

export interface LevelChange {
  key: "spot" | "callWall" | "putWall" | "flip" | "totalGex";
  label: string;
  from: number | null;
  to: number | null;
  /** to − from; null when either end is missing. */
  delta: number | null;
  changed: boolean;
}

const LABELS: Record<LevelChange["key"], string> = {
  spot: "Spot",
  callWall: "Call wall",
  putWall: "Put wall",
  flip: "Flip (dealer model)",
  totalGex: "Total GEX",
};

/**
 * What moved between the first and last point of the session. Walls and flip count as changed
 * when they differ at all (flip: by more than 0.1% of spot, since it is interpolated); spot and
 * total GEX always report their delta.
 */
export function levelsChangedSinceOpen(points: LevelsPoint[]): LevelChange[] {
  if (!Array.isArray(points) || points.length === 0) return [];
  const first = points[0];
  const last = points[points.length - 1];
  const keys: LevelChange["key"][] = ["callWall", "putWall", "flip", "totalGex", "spot"];
  return keys.map((key) => {
    const from = first[key];
    const to = last[key];
    const delta = fin(from) && fin(to) ? to - from : null;
    let changed: boolean;
    if (key === "flip") {
      const tol = (last.spot > 0 ? last.spot : 1) * 0.001;
      changed = (from === null) !== (to === null) || (delta !== null && Math.abs(delta) > tol);
    } else if (key === "callWall" || key === "putWall") {
      changed = (from === null) !== (to === null) || (delta !== null && delta !== 0);
    } else {
      changed = delta !== null && Math.abs(delta) > 1e-9;
    }
    return { key, label: LABELS[key], from: fin(from) ? from : null, to: fin(to) ? to : null, delta, changed };
  });
}

/** Number of times a wall moved to a different strike during the session. */
export function wallMoves(points: LevelsPoint[], key: "callWall" | "putWall"): number {
  let n = 0;
  for (let i = 1; i < (points?.length ?? 0); i++) {
    const a = points[i - 1][key];
    const b = points[i][key];
    if (a !== null && b !== null && a !== b) n++;
  }
  return n;
}
