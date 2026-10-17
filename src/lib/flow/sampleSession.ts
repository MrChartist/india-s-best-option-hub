/**
 * Sample session: a deterministic, clearly labelled simulation of one trading session built
 * backwards from a (sample) chain, so the flow tape and Premium Tide have something to show when
 * no live source is reachable. The UI must label anything built from this as "Sample data".
 *
 * The final snapshot equals the given chain (volume, OI and LTP), and earlier snapshots replay a
 * plausible intraday path: U-shaped volume, a random-walk spot and LTPs moved by delta.
 */
import type { OptionData, OptionLegData } from "@/lib/mockData";
import type { ChainSnapshot, StrikeSnap } from "@/lib/snapshotStore";
import { isTradingDay, istDateString, nowIST, previousTradingDay, toISTDate } from "@/lib/options";

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** The session the simulation covers: today once 09:15 IST has passed on a trading day, else the previous trading day. */
export function sampleSessionWindow(now: Date = new Date()): { date: string; start: number; end: number } {
  const t = nowIST(now);
  const today = istDateString(now);
  const afterOpen = isTradingDay(today) && t.hh * 60 + t.mm >= 9 * 60 + 20;
  const date = afterOpen ? today : previousTradingDay(today) || today;
  const start = toISTDate(date, "09:15").getTime();
  const close = toISTDate(date, "15:30").getTime();
  const end = afterOpen ? Math.min(now.getTime(), close) : close;
  return { date, start, end };
}

const r2 = (v: number) => Math.round(v * 100) / 100;

/**
 * Cumulative OI change per snapshot for one contract. Each active interval is drawn as opening
 * (OI up with volume), closing (OI down) or churn (volume without OI change); the opening and
 * closing legs are then scaled so the session ends at the chain's reported change in OI.
 * `volW` holds the contract's per-interval volume weights (0 = no trade).
 */
export function oiPath(
  volW: number[],
  leg: Pick<OptionLegData, "volume" | "oiChange" | "oi">,
  rand: () => number,
): number[] {
  const target = Number.isFinite(leg.oiChange) ? leg.oiChange : 0;
  const totalW = volW.reduce((a, b) => a + b, 0) || 1;
  const vol = Math.max(0, leg.volume || 0);
  const inc = volW.map((x) => {
    if (x <= 0) return 0;
    const dVol = (vol * x) / totalW;
    const u = rand();
    // Lean towards the session's net OI direction so the scaling below stays gentle.
    const openShare = target >= 0 ? 0.45 : 0.25;
    const closeShare = target >= 0 ? 0.25 : 0.45;
    if (u < openShare) return dVol * (0.2 + 0.6 * rand());
    if (u < openShare + closeShare) return -dVol * (0.2 + 0.6 * rand());
    return dVol * (rand() - 0.5) * 0.08;
  });
  const P = inc.reduce((a, v) => a + (v > 0 ? v : 0), 0);
  const N = inc.reduce((a, v) => a + (v < 0 ? -v : 0), 0);
  // Scale one side so Σ inc ≈ target, within limits that keep each print's tag meaningful.
  let a = 1;
  let b = 1;
  if (target >= P - N) a = P > 0 ? Math.min(3, (target + N) / P) : 1;
  else b = N > 0 ? Math.min(3, (P - target) / N) : 1;
  const scaled = inc.map((v) => (v > 0 ? v * a : v * b));
  // Whatever scaling could not absorb is spread by volume, so the final snapshot lands exactly.
  const residual = target - scaled.reduce((x, y) => x + y, 0);
  let acc = 0;
  const path = scaled.map((v, i) => (acc += v + (residual * volW[i]) / totalW));
  // OI can never fall below zero: blend towards the straight volume-weighted path (which ends at
  // the same place and stays between 0 and the target) until the floor holds.
  const floor = -Math.max(0, (Number.isFinite(leg.oi) ? leg.oi : 0) - target);
  let accW = 0;
  const linear = volW.map((x) => (accW += x) * (target / totalW));
  for (const lambda of [1, 0.75, 0.5, 0.25, 0]) {
    const blended = path.map((v, i) => lambda * v + (1 - lambda) * linear[i]);
    if (lambda === 0 || blended.every((v) => v >= floor - 1e-9)) return blended;
  }
  return linear;
}

export interface SampleSessionInput {
  symbol: string;
  expiry: string;
  spot: number;
  chain: OptionData[];
  now?: Date;
  /** Minutes between simulated snapshots. Default 5. */
  stepMin?: number;
}

export function simulateSession(o: SampleSessionInput): ChainSnapshot[] {
  const chain = (Array.isArray(o.chain) ? o.chain : [])
    .filter((r) => r && r.strikePrice > 0)
    .sort((a, b) => a.strikePrice - b.strikePrice);
  if (chain.length === 0 || !(o.spot > 0)) return [];
  const { start, end } = sampleSessionWindow(o.now ?? new Date());
  const stepMs = Math.max(1, o.stepMin ?? 5) * 60_000;
  const n = Math.max(2, Math.floor((end - start) / stepMs) + 1);
  const rand = rng(hashString(`${o.symbol}|${o.expiry}|${Math.round(o.spot)}`));

  // Market-wide volume weights: U-shaped (busy open and close), with noise.
  const w: number[] = [];
  for (let i = 0; i < n; i++) {
    const u = n > 1 ? i / (n - 1) : 1;
    w.push((0.35 + 1.6 * (u - 0.5) ** 2 * 4) * (0.6 + 0.8 * rand()));
  }
  // Spot path: random walk that ends at the given spot.
  const vol = 0.0009;
  const walk: number[] = [0];
  for (let i = 1; i < n; i++) walk.push(walk[i - 1] + (rand() - 0.5) * 2 * vol);
  const shift = walk[n - 1];
  const spots = walk.map((x) => o.spot * Math.exp(x - shift));

  // Each contract trades in bursts rather than in every interval, so prints spread across the
  // session; liquid near-the-money strikes trade more often than far wings.
  const meanW = w.reduce((a, b) => a + b, 0) / n;
  const atmGap = chain.length > 1 ? Math.abs(chain[1].strikePrice - chain[0].strikePrice) || 1 : 1;
  type Path = { strike: number; side: "CE" | "PE"; leg: OptionLegData; delta: number; cumW: number[]; cumOi: number[] };
  const paths: Path[] = [];
  for (const r of chain) {
    for (const side of ["CE", "PE"] as const) {
      const leg = side === "CE" ? r.ce : r.pe;
      if (!leg || !(leg.ltp > 0)) continue;
      const delta =
        Number.isFinite(leg.delta) && leg.delta !== 0
          ? leg.delta
          : side === "CE"
            ? r.strikePrice < o.spot
              ? 0.7
              : 0.3
            : r.strikePrice > o.spot
              ? -0.7
              : -0.3;
      const away = Math.abs(r.strikePrice - o.spot) / atmGap;
      const activity = Math.max(0.03, 0.2 * Math.exp(-away / 7));
      const active = w.map((x, i) => i > 0 && rand() < Math.min(0.9, (activity * x) / meanW));
      if (!active.some(Boolean)) active[1 + Math.floor(rand() * (n - 1))] = true;
      const raw = w.map((x, i) => (active[i] ? x * (0.4 + 1.2 * rand() ** 2) : 0));
      const total = raw.reduce((a, b) => a + b, 0) || 1;
      let acc = 0;
      const cumW = raw.map((x) => (acc += x) / total);
      paths.push({ strike: r.strikePrice, side, leg, delta, cumW, cumOi: oiPath(raw, leg, rand) });
    }
  }

  const snaps: ChainSnapshot[] = [];
  const prevLtp = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    // Real polls never land on the exact minute: jitter interior snapshots by up to ±75 s.
    const jitter = i === 0 || i === n - 1 ? 0 : Math.round((rand() - 0.5) * 150) * 1000;
    const ts = i === n - 1 ? end : Math.min(end - 1000, start + i * stepMs + jitter);
    const rows: StrikeSnap[] = [];
    for (const p of paths) {
      const last = i === n - 1;
      const volume = last ? p.leg.volume : Math.round(p.leg.volume * p.cumW[i]);
      const oiPrev = p.leg.oi - (p.leg.oiChange || 0);
      const oi = last ? p.leg.oi : Math.max(0, Math.round(oiPrev + p.cumOi[i]));
      const ltp = last ? p.leg.ltp : Math.max(0.05, r2(p.leg.ltp + p.delta * (spots[i] - o.spot)));
      const key = `${p.strike}|${p.side}`;
      const before = prevLtp.get(key) ?? ltp;
      prevLtp.set(key, ltp);
      const spread = Math.max(0.05, r2(ltp * 0.006));
      const lean = Math.max(
        0,
        Math.min(1, 0.5 + (ltp > before ? 0.45 : ltp < before ? -0.45 : 0) + (rand() - 0.5) * 0.3),
      );
      const bid = Math.max(0.05, r2(ltp - lean * spread));
      rows.push({
        strike: p.strike,
        side: p.side,
        ltp,
        oi,
        vol: Math.max(0, volume),
        iv: p.leg.iv || 0,
        bid,
        ask: r2(bid + spread),
      });
    }
    snaps.push({
      id: `${o.symbol}|${o.expiry}|${ts}|sample`,
      symbol: o.symbol.toUpperCase(),
      expiry: o.expiry,
      ts,
      spot: r2(spots[i]),
      rows,
    });
  }
  return snaps;
}
