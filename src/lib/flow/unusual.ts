/**
 * Unusual options activity from a single chain plus recorded history.
 *
 * A contract is flagged when any of these hold (all configurable):
 *   VOL_OI       volume / OI ≥ 1.25 (more contracts traded today than are open)
 *   VOL_SPIKE    volume ≥ 3 × its 5-day average at the same time of day (needs recorded snapshots)
 *   BIG_PREMIUM  volume × LTP × lot ≥ ₹10 lakh for indices, ₹2 lakh for stocks
 *
 * Volume and OI are in contracts (NSE option-chain convention).
 */
import type { OptionData, OptionLegData } from "@/lib/mockData";
import type { ChainSnapshot } from "@/lib/snapshotStore";
import { getContractSpec, istDateString } from "@/lib/options";
import { classifyMoneyness, dteFor, nearestStrike } from "./derivePrints";
import type { Moneyness } from "./types";

export type UnusualFlag = "VOL_OI" | "VOL_SPIKE" | "BIG_PREMIUM";

export interface UnusualThresholds {
  volOi: number;
  volMultiple: number;
  /** ₹ premium threshold for index options. */
  minPremiumIndex: number;
  /** ₹ premium threshold for stock options. */
  minPremiumStock: number;
  /** Ignore contracts that traded fewer contracts than this. */
  minVolume: number;
}

export const DEFAULT_UNUSUAL_THRESHOLDS: UnusualThresholds = {
  volOi: 1.25,
  volMultiple: 3,
  minPremiumIndex: 10_00_000,
  minPremiumStock: 2_00_000,
  minVolume: 50,
};

export interface UnusualChainInput {
  symbol: string;
  expiry: string;
  spot: number;
  lotSize: number;
  chain: OptionData[];
  /** Epoch ms the chain is from (for DTE). Default now. */
  ts?: number;
}

export interface UnusualHistory {
  /** Average daily volume per contract key "strike|CE" over the last `days` sessions. */
  avgVolume: Map<string, number>;
  /** Number of past sessions the averages are built from (0 = no history). */
  days: number;
}

export const EMPTY_HISTORY: UnusualHistory = { avgVolume: new Map(), days: 0 };

export interface UnusualContract {
  key: string;
  symbol: string;
  expiry: string;
  strike: number;
  type: "CE" | "PE";
  volume: number;
  oi: number;
  oiChange: number;
  ltp: number;
  /** LTP change vs previous close (₹) when the feed provides it. */
  priceChange?: number;
  premium: number;
  volOi: number;
  avgVolume?: number;
  volMultiple?: number;
  moneyness: Moneyness;
  /** Underlying when the chain was read. */
  spot: number;
  /** Distance from spot as a fraction of spot (positive = above spot). */
  distancePct: number;
  dte: number;
  flags: UnusualFlag[];
  score: number;
  /** Share of this side's total OI held at the strike, 0..1. */
  oiShare: number;
}

const INDEX_FALLBACK = new Set(["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "NIFTYNXT50", "SENSEX", "BANKEX", "SENSEX50"]);

export function isIndexUnderlying(symbol: string): boolean {
  const s = String(symbol || "").toUpperCase();
  const spec = getContractSpec(s);
  return spec ? spec.kind === "INDEX" : INDEX_FALLBACK.has(s);
}

export function premiumThreshold(symbol: string, t: UnusualThresholds = DEFAULT_UNUSUAL_THRESHOLDS): number {
  return isIndexUnderlying(symbol) ? t.minPremiumIndex : t.minPremiumStock;
}

const finite = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

/** Flag one contract against the thresholds (pure). */
export function flagContract(
  o: { symbol: string; volume: number; oi: number; premium: number; avgVolume?: number },
  t: UnusualThresholds = DEFAULT_UNUSUAL_THRESHOLDS,
): { flags: UnusualFlag[]; volOi: number; volMultiple?: number } {
  const flags: UnusualFlag[] = [];
  const vol = finite(o.volume) ? o.volume : 0;
  const oi = finite(o.oi) ? o.oi : 0;
  const volOi = oi > 0 ? vol / oi : vol > 0 ? Infinity : 0;
  if (vol < t.minVolume) return { flags, volOi };
  if (volOi >= t.volOi) flags.push("VOL_OI");
  let volMultiple: number | undefined;
  if (finite(o.avgVolume) && o.avgVolume > 0) {
    volMultiple = vol / o.avgVolume;
    if (volMultiple >= t.volMultiple) flags.push("VOL_SPIKE");
  }
  if (finite(o.premium) && o.premium >= premiumThreshold(o.symbol, t)) flags.push("BIG_PREMIUM");
  return { flags, volOi, volMultiple };
}

export function unusual(input: UnusualChainInput, history: UnusualHistory = EMPTY_HISTORY, thresholds: Partial<UnusualThresholds> = {}): UnusualContract[] {
  const t: UnusualThresholds = { ...DEFAULT_UNUSUAL_THRESHOLDS, ...thresholds };
  const chain = Array.isArray(input?.chain) ? input.chain : [];
  if (chain.length === 0) return [];
  const lot = finite(input.lotSize) && input.lotSize > 0 ? input.lotSize : 1;
  const spot = finite(input.spot) ? input.spot : 0;
  const atm = nearestStrike(chain.map((r) => r.strikePrice), spot);
  const dte = dteFor(input.expiry, input.ts ?? Date.now());
  let ceOiTotal = 0;
  let peOiTotal = 0;
  for (const r of chain) {
    ceOiTotal += finite(r?.ce?.oi) ? r.ce.oi : 0;
    peOiTotal += finite(r?.pe?.oi) ? r.pe.oi : 0;
  }
  const out: UnusualContract[] = [];
  const consider = (strike: number, type: "CE" | "PE", leg: OptionLegData | undefined) => {
    if (!leg) return;
    const volume = finite(leg.volume) ? leg.volume : 0;
    const ltp = finite(leg.ltp) ? leg.ltp : 0;
    if (volume <= 0 || ltp <= 0) return;
    const oi = finite(leg.oi) ? leg.oi : 0;
    const premium = volume * ltp * lot;
    const key = `${strike}|${type}`;
    const avg = history.days > 0 ? history.avgVolume.get(key) : undefined;
    const f = flagContract({ symbol: input.symbol, volume, oi, premium, avgVolume: avg }, t);
    if (f.flags.length === 0) return;
    const sideTotal = type === "CE" ? ceOiTotal : peOiTotal;
    const score =
      f.flags.length * 10 +
      Math.min(10, finite(f.volOi) ? f.volOi * 2 : 10) +
      Math.min(10, f.volMultiple ?? 0) +
      Math.min(10, premium / premiumThreshold(input.symbol, t));
    const c: UnusualContract = {
      key: `${input.symbol}|${input.expiry}|${key}`,
      symbol: input.symbol,
      expiry: input.expiry,
      strike,
      type,
      volume,
      oi,
      oiChange: finite(leg.oiChange) ? leg.oiChange : 0,
      ltp,
      premium,
      volOi: f.volOi,
      moneyness: classifyMoneyness(strike, type, spot, atm),
      spot,
      distancePct: spot > 0 ? (strike - spot) / spot : NaN,
      dte,
      flags: f.flags,
      score: Math.round(score * 10) / 10,
      oiShare: sideTotal > 0 ? oi / sideTotal : 0,
    };
    if (finite(leg.change)) c.priceChange = leg.change;
    if (finite(avg)) c.avgVolume = avg;
    if (f.volMultiple !== undefined) c.volMultiple = f.volMultiple;
    out.push(c);
  };
  for (const r of chain) {
    if (!r || !finite(r.strikePrice)) continue;
    consider(r.strikePrice, "CE", r.ce);
    consider(r.strikePrice, "PE", r.pe);
  }
  return out.sort((a, b) => b.score - a.score || b.premium - a.premium);
}

/**
 * Average volume per contract over the last `days` sessions before `todayIso`, using the last
 * recorded snapshot of each session at or before the same time of day as `nowTs` (so the
 * comparison is like-for-like intraday). Returns days = 0 when nothing usable was recorded.
 */
export function averageVolumeFromSnapshots(snaps: ChainSnapshot[], o: { nowTs: number; days?: number }): UnusualHistory {
  const days = Math.max(1, o.days ?? 5);
  const today = istDateString(new Date(o.nowTs));
  const minuteOfDay = (ts: number) => {
    const d = new Date(ts + 330 * 60_000);
    return d.getUTCHours() * 60 + d.getUTCMinutes();
  };
  const cutoff = minuteOfDay(o.nowTs);
  const lastPerDay = new Map<string, ChainSnapshot>();
  for (const s of snaps ?? []) {
    if (!s || !Array.isArray(s.rows)) continue;
    const date = istDateString(new Date(s.ts));
    if (date >= today) continue;
    if (minuteOfDay(s.ts) > cutoff) continue;
    const prev = lastPerDay.get(date);
    if (!prev || s.ts > prev.ts) lastPerDay.set(date, s);
  }
  const chosen = [...lastPerDay.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).slice(0, days).map(([, s]) => s);
  if (chosen.length === 0) return { avgVolume: new Map(), days: 0 };
  const sums = new Map<string, number>();
  for (const s of chosen) for (const r of s.rows) sums.set(`${r.strike}|${r.side}`, (sums.get(`${r.strike}|${r.side}`) ?? 0) + (finite(r.vol) ? r.vol : 0));
  const avgVolume = new Map<string, number>();
  for (const [k, v] of sums) avgVolume.set(k, v / chosen.length);
  return { avgVolume, days: chosen.length };
}

// ── Presets ──

export type UnusualPresetId = "all" | "fresh-otm-calls" | "put-writing-support" | "far-otm-lottery";

export interface UnusualPreset {
  id: UnusualPresetId;
  label: string;
  description: string;
  test: (c: UnusualContract) => boolean;
}

/** Price direction: feed change when present, otherwise undefined (unknown). */
const up = (c: UnusualContract) => (c.priceChange === undefined ? undefined : c.priceChange > 0);

export const UNUSUAL_PRESETS: UnusualPreset[] = [
  { id: "all", label: "All unusual", description: "Every contract that trips at least one threshold.", test: () => true },
  {
    id: "fresh-otm-calls",
    label: "Fresh OTM call buying",
    description: "OTM calls with rising OI and rising price: new long positions (long build-up).",
    test: (c) => c.type === "CE" && c.moneyness === "OTM" && c.oiChange > 0 && up(c) !== false,
  },
  {
    id: "put-writing-support",
    label: "Put writing at support",
    description: "OTM puts with rising OI and falling price at a heavy-OI strike: writers defending a level (short build-up).",
    test: (c) => c.type === "PE" && c.moneyness === "OTM" && c.oiChange > 0 && up(c) !== true && c.oiShare >= 0.05,
  },
  {
    id: "far-otm-lottery",
    label: "Far-OTM lottery",
    description: "Cheap contracts (premium ≤ 0.2% of spot) 2.5% or more away from spot, expiring within a week, trading heavily.",
    test: (c) => {
      const far = Number.isFinite(c.distancePct) && (c.type === "CE" ? c.distancePct >= 0.025 : c.distancePct <= -0.025);
      const cheap = c.spot > 0 && c.ltp <= c.spot * 0.002;
      return c.moneyness === "OTM" && far && cheap && c.dte <= 7 && (c.volOi >= 1.25 || (c.volMultiple ?? 0) >= 3);
    },
  },
];

export function applyPreset(list: UnusualContract[], id: UnusualPresetId): UnusualContract[] {
  const p = UNUSUAL_PRESETS.find((x) => x.id === id) ?? UNUSUAL_PRESETS[0];
  return (list ?? []).filter(p.test);
}
