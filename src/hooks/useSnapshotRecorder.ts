/**
 * Snapshot recorder hooks.
 *
 * useSnapshotRecorder records live option-chain snapshots into IndexedDB while the NSE session is
 * open (never sample or stale data), at most once every 15 seconds per symbol, and writes one
 * end-of-day DailyStat per symbol once the clock passes 15:30 IST on a trading day.
 *
 * Chains come from react-query: a fresh ["live-option-chain"] poll that a page or FlowFeeder already
 * runs is reused, and otherwise one cached fetch is shared by every recorder instance, so the
 * recorder adds at most one proxy call per symbol per gap. Snapshots older than
 * SNAPSHOT_RETENTION_DAYS are pruned once per session.
 *
 * useSnapshots reads recorded snapshots with react-query.
 */
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { OptionChainHookData } from "@/hooks/useMarketData";
import { fetchLiveOptionChain } from "@/lib/marketApi";
import { getMarketSession, isTradingDay, istDateString, normalizeExpiry, nowIST } from "@/lib/options";
import {
  MIN_SNAPSHOT_GAP_MS,
  computeDailyStat,
  getDailyStats,
  getLatestSnapshots,
  getSnapshotStats,
  getSnapshots,
  pruneSnapshots,
  putDailyStat,
  recordSnapshot,
  setRecordingActive,
  snapshotDateIST,
  snapshotToChain,
  type ChainSnapshot,
} from "@/lib/snapshotStore";

export const DEFAULT_RECORD_INTERVAL_MS = 60_000;

/** True at or after 15:30 IST on a trading day. */
export function isAfterCloseIST(now: Date = new Date()): boolean {
  const t = nowIST(now);
  return isTradingDay(t.date) && t.hh * 60 + t.mm >= 15 * 60 + 30;
}

/** Clamp the requested interval to the recorder minimum. */
export function effectiveInterval(intervalMs?: number): number {
  const v = typeof intervalMs === "number" && Number.isFinite(intervalMs) ? intervalMs : DEFAULT_RECORD_INTERVAL_MS;
  return Math.max(MIN_SNAPSHOT_GAP_MS, v);
}

/** Recorded chains are kept this many days; older rows are deleted automatically. */
export const SNAPSHOT_RETENTION_DAYS = 30;

let prunedThisSession = false;

/** Prune old snapshots once per page session (IndexedDB otherwise grows until the quota fails). */
async function pruneOnce(): Promise<void> {
  if (prunedThisSession) return;
  prunedThisSession = true;
  try {
    await pruneSnapshots(SNAPSHOT_RETENTION_DAYS);
  } catch {
    prunedThisSession = false; // IndexedDB busy or unavailable: try again next start
  }
}

interface RecordableChain {
  chain: OptionChainHookData["chain"];
  spotPrice: number;
  expiry: string;
  stale: boolean;
}

/**
 * Latest chain for a symbol/expiry. Reuses a fresh live-option-chain query (pages poll every 3 s)
 * when one exists, otherwise fetches through a shared query so parallel recorders dedupe.
 */
async function getRecordableChain(qc: QueryClient, symbol: string, expiry: string | undefined): Promise<RecordableChain> {
  const minUpdatedAt = Date.now() - MIN_SNAPSHOT_GAP_MS;
  for (const [key, data] of qc.getQueriesData<OptionChainHookData>({ queryKey: ["live-option-chain"] })) {
    if (!data || data.stale || data.source === "sample" || data.chain.length === 0) continue;
    const [, kSymbol, kExpiry] = key as [string, unknown, unknown];
    if (typeof kSymbol !== "string" || kSymbol.toUpperCase() !== symbol) continue;
    const keyExpiry = typeof kExpiry === "string" && kExpiry ? normalizeExpiry(kExpiry) || kExpiry : undefined;
    if (expiry ? keyExpiry !== expiry && data.expiry !== expiry : keyExpiry !== undefined) continue;
    if ((qc.getQueryState(key)?.dataUpdatedAt ?? 0) < minUpdatedAt) continue;
    return { chain: data.chain, spotPrice: data.spotPrice, expiry: data.expiry, stale: false };
  }
  const res = await qc.fetchQuery({
    queryKey: ["snapshot-recorder-chain", symbol, expiry ?? ""],
    queryFn: () => fetchLiveOptionChain(symbol, expiry),
    staleTime: MIN_SNAPSHOT_GAP_MS - 1000,
    gcTime: 2 * MIN_SNAPSHOT_GAP_MS,
    retry: 0,
  });
  return { chain: res.chain, spotPrice: res.spotPrice, expiry: res.expiry, stale: res.stale };
}

const eodWritten = new Set<string>();

async function writeEndOfDay(symbol: string, expiry: string): Promise<void> {
  const today = istDateString();
  const key = `${symbol}|${today}`;
  if (eodWritten.has(key)) return;
  const existing = await getDailyStats(symbol, 1);
  if (existing.some((s) => s.date === today)) {
    eodWritten.add(key);
    return;
  }
  const [latest] = await getLatestSnapshots(symbol, expiry, 1);
  if (!latest || snapshotDateIST(latest.ts) !== today) return; // nothing recorded today
  const stat = computeDailyStat({ symbol, date: today, spot: latest.spot, chain: snapshotToChain(latest), expiry: latest.expiry, now: new Date(latest.ts) });
  await putDailyStat(stat);
  eodWritten.add(key);
}

export function useSnapshotRecorder(
  symbols: Array<{ symbol: string; expiry?: string }>,
  intervalMs?: number,
): { recording: boolean; count: number } {
  const qc = useQueryClient();
  const [recording, setRecording] = useState(false);
  const [count, setCount] = useState(0);
  const symbolsKey = symbols.map((s) => `${s.symbol.toUpperCase()}@${s.expiry ? normalizeExpiry(s.expiry) || s.expiry : ""}`).join(",");
  const every = effectiveInterval(intervalMs);
  const busy = useRef(false);
  /** Last expiry seen per symbol, for the end-of-day stat. */
  const lastExpiry = useRef(new Map<string, string>());

  useEffect(() => {
    const targets = symbolsKey
      ? symbolsKey.split(",").map((t) => {
          const [symbol, expiry] = t.split("@");
          return { symbol, expiry: expiry || undefined };
        })
      : [];
    if (targets.length === 0) return;
    let cancelled = false;
    let active = false;

    const refreshCount = async () => {
      try {
        const s = await getSnapshotStats();
        if (!cancelled) setCount(s.count);
      } catch {
        /* IndexedDB unavailable */
      }
    };

    const tick = async () => {
      if (busy.current || cancelled) return;
      busy.current = true;
      try {
        const open = getMarketSession() === "open";
        if (open !== active) {
          active = open;
          setRecordingActive(open);
          setRecording(open);
        }
        if (open) {
          for (const t of targets) {
            if (cancelled) break;
            try {
              const res = await getRecordableChain(qc, t.symbol, t.expiry);
              if (res.stale || res.chain.length === 0) continue; // only fresh live data is recorded
              const expiry = res.expiry || (t.expiry ? normalizeExpiry(t.expiry) : "");
              if (!expiry) continue;
              lastExpiry.current.set(t.symbol, expiry);
              await recordSnapshot(t.symbol, expiry, res.spotPrice, res.chain);
            } catch {
              /* skip this symbol this round */
            }
          }
          await refreshCount();
        } else if (isAfterCloseIST()) {
          for (const t of targets) {
            const expiry = lastExpiry.current.get(t.symbol) || (t.expiry ? normalizeExpiry(t.expiry) : "");
            if (!expiry) continue;
            try {
              await writeEndOfDay(t.symbol, expiry);
            } catch {
              /* retry next tick */
            }
          }
        }
      } finally {
        busy.current = false;
      }
    };

    void pruneOnce().then(refreshCount);
    void tick();
    const timer = setInterval(() => void tick(), every);
    return () => {
      cancelled = true;
      clearInterval(timer);
      if (active) setRecordingActive(false);
      setRecording(false);
    };
  }, [symbolsKey, every, qc]);

  return { recording, count };
}

/** Recorded snapshots for a symbol/expiry from fromTs onwards (ascending by time). */
export function useSnapshots(symbol: string, expiry: string, fromTs?: number) {
  return useQuery({
    queryKey: ["chain-snapshots", symbol.toUpperCase(), expiry, fromTs ?? 0],
    queryFn: (): Promise<ChainSnapshot[]> => getSnapshots(symbol, expiry, fromTs),
    enabled: !!symbol && !!expiry,
    refetchInterval: () => (getMarketSession() === "open" ? 30_000 : false),
    staleTime: 10_000,
    retry: 0,
  });
}
