/**
 * Data for one symbol/expiry on the expiry-day page: the live chain (useLiveOptionChain), the
 * snapshots recorded in this browser for the current session (useSnapshots), an in-session ring
 * buffer of live polls, and a clearly labelled sample session when nothing real is available.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useLiveOptionChain } from "@/hooks/useMarketData";
import { useNow } from "@/hooks/useNow";
import { useSnapshots } from "@/hooks/useSnapshotRecorder";
import { sampleSessionWindow } from "@/lib/flow";
import { getMarketParams, getStrikeStep, istDateString } from "@/lib/options";
import { buildSnapshot, snapshotToChain, type ChainSnapshot } from "@/lib/snapshotStore";
import type { OptionData } from "@/lib/mockData";
import { dividendYield, mergeSnapshots } from "./expiryMath";
import { SAMPLE_SESSION_R, simulateExpirySession } from "./expirySample";

/** live = polling now; recorded = snapshots saved earlier in this browser; sample = simulated; empty = chain but no history. */
export type SessionMode = "live" | "recorded" | "sample" | "empty";

const RING_MAX = 1600;
const RING_GAP_MS = 15_000;

/** Shared, boundary-aligned clock (re-exported for the expiry components that import it from here). */
export { useNow };

export interface ExpirySession {
  symbol: string;
  expiry: string;
  mode: SessionMode;
  /** Time-ordered snapshots for the session (sample when mode is "sample"). */
  snaps: ChainSnapshot[];
  /** Latest chain to analyse (live/cached chain, or the last sample snapshot). */
  chain: OptionData[];
  spot: number;
  lotSize: number;
  strikeStep: number;
  /** Chain source from the data layer. */
  chainSource: string;
  chainIsLive: boolean;
  chainStale: boolean;
  asOf: number;
  reason?: string;
  isLoading: boolean;
  isError: boolean;
  /** Snapshots recorded in this browser (before merging with the ring buffer). */
  recordedCount: number;
  r: number;
  q: number;
  window: { date: string; start: number; end: number };
}

export function useExpirySession(symbol: string, expiry: string, o: { forceSample?: boolean } = {}): ExpirySession {
  const chainQ = useLiveOptionChain(symbol, expiry || undefined);
  const data = chainQ.data;
  const sessionKey = `${symbol}|${expiry}`;

  // Session window: recompute when the IST date changes (checked every minute).
  const minute = useNow(60_000);
  const dayKey = istDateString(minute);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- recompute only on a new IST day
  const win = useMemo(() => sampleSessionWindow(new Date()), [dayKey]);

  const recordedQ = useSnapshots(symbol, expiry, win.start);
  const recorded = useMemo(() => recordedQ.data ?? [], [recordedQ.data]);

  // In-session ring buffer of live polls (at most one per 15 s).
  const [ring, setRing] = useState<{ key: string; snaps: ChainSnapshot[] }>({ key: sessionKey, snaps: [] });
  const ringKeyRef = useRef(sessionKey);
  ringKeyRef.current = sessionKey;
  useEffect(() => {
    if (!data || !data.isLive || data.source === "sample" || data.chain.length === 0 || !(data.spotPrice > 0)) return;
    const ts = data.asOf || Date.now();
    const exp = data.expiry || expiry;
    if (!exp) return;
    setRing((prev) => {
      const base = prev.key === ringKeyRef.current ? prev.snaps : [];
      const last = base[base.length - 1];
      if (last && ts - last.ts < RING_GAP_MS) return prev.key === ringKeyRef.current ? prev : { key: ringKeyRef.current, snaps: base };
      const snap = buildSnapshot(symbol, exp, data.spotPrice, data.chain, ts);
      if (snap.rows.length === 0) return prev;
      return { key: ringKeyRef.current, snaps: [...base, snap].slice(-RING_MAX) };
    });
  }, [data, symbol, expiry]);
  const ringSnaps = useMemo(() => (ring.key === sessionKey ? ring.snaps : []), [ring, sessionKey]);

  const { r } = getMarketParams();
  const q = dividendYield(symbol);
  const isSampleChain = data?.source === "sample";
  const forceSample = !!o.forceSample;

  const sample = useMemo(() => {
    if (!data || data.chain.length === 0 || !(data.spotPrice > 0)) return [];
    if (!isSampleChain && !forceSample) return [];
    // Anchored to the sample chain at this instant, so the last snapshot matches the sample option chain.
    return simulateExpirySession({ symbol, expiry: expiry || data.expiry, spot: data.spotPrice, now: new Date() });
    // Rebuild only when the inputs that shape the simulation change, not on every poll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSampleChain, forceSample, symbol, expiry, data?.expiry, data ? Math.round(data.spotPrice) : 0, dayKey]);

  const merged = useMemo(() => {
    const inWindow = (s: ChainSnapshot) => s.ts >= win.start - 60_000 && s.ts <= win.end + 15 * 60_000;
    return mergeSnapshots([recorded.filter(inWindow), ringSnaps.filter(inWindow)]);
  }, [recorded, ringSnaps, win.start, win.end]);

  let mode: SessionMode;
  let snaps: ChainSnapshot[];
  if (sample.length > 0) {
    mode = "sample";
    snaps = sample;
  } else if (merged.length >= 2) {
    mode = data?.isLive ? "live" : "recorded";
    snaps = merged;
  } else {
    mode = "empty";
    snaps = merged;
  }

  const chain = useMemo<OptionData[]>(() => {
    if (mode === "sample" && sample.length > 0) return snapshotToChain(sample[sample.length - 1]);
    return data?.chain ?? [];
  }, [mode, sample, data?.chain]);
  const lastSnap = snaps[snaps.length - 1];
  const spot = mode === "sample" && lastSnap ? lastSnap.spot : data?.spotPrice ?? NaN;

  return {
    symbol,
    expiry: expiry || data?.expiry || "",
    mode,
    snaps,
    chain,
    spot,
    lotSize: data?.lotSize ?? NaN,
    strikeStep: data?.stepSize && data.stepSize > 0 ? data.stepSize : getStrikeStep(symbol),
    chainSource: mode === "sample" ? "sample" : data?.source ?? "none",
    chainIsLive: !!data?.isLive,
    chainStale: !!data?.stale,
    asOf: mode === "sample" && lastSnap ? lastSnap.ts : data?.asOf ?? 0,
    reason: data?.reason,
    isLoading: chainQ.isLoading,
    isError: chainQ.isError && !data,
    recordedCount: recorded.length,
    // The sample session is priced at the sample chain's rate; analyse it with the same rate.
    r: mode === "sample" ? SAMPLE_SESSION_R : r,
    q,
    window: win,
  };
}
