// Delta Strike Tracker — locates the live chain strikes nearest a small set of
// target option deltas, and records/reads their premium history via the
// dailySnapshotStore-backed proxy endpoints. Pure logic + fetch, no React.

import type { OptionData } from "./mockData";

// Local proxy base URL — override via VITE_PROXY_URL if deploying proxy elsewhere
const PROXY_BASE = import.meta.env.VITE_PROXY_URL || "http://localhost:4002";

export const TARGET_DELTAS = [0.10, 0.20, 0.30, 0.40, 0.50] as const;

export function deltaLabel(target: number, leg: "CE" | "PE"): string {
  return `${leg}_${Math.round(target * 100)}D`;
}

export interface NearestDeltaStrike {
  label: string;
  targetDelta: number;
  leg: "CE" | "PE";
  strike: number;
  actualDelta: number;
  premium: number;
}

// Nearest-by-absolute-distance search, same pattern as getATMIV in oiUtils.ts.
// CE deltas run 0..1 so the target is compared as-is; PE deltas run -1..0 so
// the target is compared against its negative.
export function pickNearestDeltaStrikes(chain: OptionData[]): NearestDeltaStrike[] {
  if (chain.length === 0) return [];

  const picks: NearestDeltaStrike[] = [];
  for (const target of TARGET_DELTAS) {
    const ceNearest = [...chain].sort((a, b) =>
      Math.abs(a.ce.delta - target) - Math.abs(b.ce.delta - target)
    )[0];
    picks.push({
      label: deltaLabel(target, "CE"),
      targetDelta: target,
      leg: "CE",
      strike: ceNearest.strikePrice,
      actualDelta: ceNearest.ce.delta,
      premium: ceNearest.ce.ltp,
    });

    const peNearest = [...chain].sort((a, b) =>
      Math.abs(a.pe.delta + target) - Math.abs(b.pe.delta + target)
    )[0];
    picks.push({
      label: deltaLabel(target, "PE"),
      targetDelta: target,
      leg: "PE",
      strike: peNearest.strikePrice,
      actualDelta: peNearest.pe.delta,
      premium: peNearest.pe.ltp,
    });
  }
  return picks;
}

// Best-effort background write — never throws, matching how dailySnapshotStore.mjs
// and trendingOiStore.ts both treat their own writes as non-critical.
export async function recordDeltaStrikeSnapshot(symbol: string, expiry: string, picks: NearestDeltaStrike[]): Promise<void> {
  try {
    await fetch(`${PROXY_BASE}/api/delta-strike-snapshot`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        symbol,
        expiry,
        entries: picks.map(p => ({ label: p.label, premium: p.premium })),
      }),
    });
  } catch (e) {
    console.warn("Delta strike snapshot recording failed:", e);
  }
}

export async function fetchDeltaStrikeSeries(symbol: string, expiry: string, label: string): Promise<{ date: string; value: number }[]> {
  try {
    const params = new URLSearchParams({ symbol, expiry, label });
    const res = await fetch(`${PROXY_BASE}/api/delta-strike-snapshot?${params.toString()}`);
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data?.series) ? data.series : [];
  } catch (e) {
    console.warn("Delta strike series fetch failed:", e);
    return [];
  }
}
