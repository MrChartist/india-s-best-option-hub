/**
 * Data for the Contract page.
 *
 *  - Quote: the live option chain for the symbol/expiry (react-query shared with other pages), which
 *    falls back to the labelled sample chain when no live source answers.
 *  - Intraday: recorded snapshots for the session (after a backfill from the proxy's server
 *    recorder), plus the current live quote. With a sample chain, a deterministic sample session
 *    anchored to that chain instead. Sample and recorded data are never mixed.
 *  - Daily: NSE F&O bhavcopy rows for the contract, one request per trading day through the proxy.
 *    In sample mode, a labelled sample history.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLiveOptionChain } from "@/hooks/useMarketData";
import { proxyGet } from "@/lib/api/proxyClient";
import { getContractSpec, getLotSize, getMarketSession, getStrikeStep, toISTDate } from "@/lib/options";
import { loadBhavcopyDays } from "@/lib/straddles/daily";
import { buildSnapshot, getLatestSnapshots, getSnapshots, snapshotDateIST, type ChainSnapshot } from "@/lib/snapshotStore";
import { hydrateSnapshots } from "@/lib/history/hydrate";
import { buildSampleContractSession, buildSampleDailyHistory, type ContractDailyRow } from "@/lib/history/sampleSession";
import {
  contractSessionWindow,
  dailyHistoryDates,
  enrichContractSeries,
  extractContractSeries,
  pickBhavcopyRow,
  summariseSeries,
  type BhavcopyFoRow,
  type ContractKey,
  type EnrichedPoint,
} from "@/lib/history/contractSeries";

export type IntradayMode = "live" | "recorded" | "sample" | "empty";

export interface IntradayResult {
  mode: IntradayMode;
  snaps: ChainSnapshot[];
  /** IST date of the session shown. */
  date: string;
  /** Snapshots copied from the proxy's server recorder during this load. */
  imported: number;
}

export interface DailyResult {
  mode: "bhavcopy" | "sample" | "unavailable";
  rows: ContractDailyRow[];
  reason?: string;
  /** Trading days requested and how many answered. */
  requested: number;
  answered: number;
}

async function loadIntraday(key: ContractKey, sample: boolean, spot: number): Promise<IntradayResult> {
  const now = new Date();
  if (sample) {
    const snaps = buildSampleContractSession({ symbol: key.symbol, expiry: key.expiry, strike: key.strike, spot, now });
    return { mode: snaps.length ? "sample" : "empty", snaps, date: snaps.length ? snapshotDateIST(snaps[0].ts) : contractSessionWindow(now).date, imported: 0 };
  }
  const win = contractSessionWindow(now);
  const hydrated = await hydrateSnapshots(key.symbol, key.expiry, { from: win.from, to: win.to }).catch(() => ({ imported: 0 }));
  let snaps = await getSnapshots(key.symbol, key.expiry, win.from, win.to);
  let date = win.date;
  if (snaps.length === 0) {
    // Nothing for this session: show the most recent recorded day instead.
    const [latest] = await getLatestSnapshots(key.symbol, key.expiry, 1);
    if (latest) {
      date = snapshotDateIST(latest.ts);
      snaps = await getSnapshots(key.symbol, key.expiry, toISTDate(date, "09:00").getTime(), toISTDate(date, "15:35").getTime());
    }
  }
  return { mode: snaps.length ? "recorded" : "empty", snaps, date, imported: hydrated.imported };
}

async function loadDaily(key: ContractKey, sample: boolean, spot: number, days: number, signal?: AbortSignal): Promise<DailyResult> {
  if (sample) {
    const rows = buildSampleDailyHistory({ symbol: key.symbol, expiry: key.expiry, strike: key.strike, type: key.type, spot, days });
    return { mode: "sample", rows, requested: days, answered: rows.length };
  }
  if (getContractSpec(key.symbol)?.exchange === "BSE") return { mode: "unavailable", rows: [], reason: `${key.symbol} options trade on BSE, so they are not in the NSE F&O bhavcopy.`, requested: 0, answered: 0 };
  const dates = dailyHistoryDates(new Date(), days, key.expiry);
  // Shared loader: two archives at a time, stops when the proxy is offline or the query is
  // cancelled (strike/expiry/days change or the page unmounts), so no requests linger.
  const res = await loadBhavcopyDays(
    dates,
    async (date) => {
      const env = await proxyGet<BhavcopyFoRow[]>("/api/x/bhavcopy-fo", { date, symbol: key.symbol, expiry: key.expiry }, { timeoutMs: 70_000, signal });
      return { data: Array.isArray(env.data) ? env.data : null, reason: env.meta.reason };
    },
    { signal },
  );
  if (res.answered === 0) {
    const r = res.reason ?? "no data";
    const why = r === "proxy-offline" || r === "offline" ? "The local proxy is not reachable." : `NSE archives did not answer (${r}).`;
    return { mode: "unavailable", rows: [], reason: why, requested: dates.length, answered: 0 };
  }
  const rows: ContractDailyRow[] = [];
  for (const d of res.days) {
    const row = pickBhavcopyRow(d.rows, key, d.date);
    if (row) rows.push(row);
  }
  return { mode: "bhavcopy", rows: rows.sort((a, b) => (a.date < b.date ? -1 : 1)), requested: dates.length, answered: res.answered };
}

export function useContractData(key: ContractKey, opts: { dailyDays: number }) {
  const live = useLiveOptionChain(key.symbol, key.expiry);
  const data = live.data;
  const sample = data?.source === "sample";
  const expiryMatches = !!data && (data.expiry === key.expiry || sample);
  const spot = data?.spotPrice ?? 0;
  const row = expiryMatches ? data?.chain.find((r) => r.strikePrice === key.strike) : undefined;
  const leg = row ? (key.type === "CE" ? row.ce : row.pe) : undefined;
  const otherLeg = row ? (key.type === "CE" ? row.pe : row.ce) : undefined;
  const lotSize = (expiryMatches ? data?.lotSize : undefined) || getLotSize(key.symbol, key.expiry) || 0;
  const marketOpen = getMarketSession() === "open";

  const intraday = useQuery({
    queryKey: ["contract-intraday", key.symbol, key.expiry, key.strike, sample ? `sample:${Math.round(spot)}` : "recorded"],
    queryFn: () => loadIntraday(key, sample, spot),
    enabled: !!data && (!sample || spot > 0),
    staleTime: sample ? Infinity : 20_000,
    refetchInterval: !sample && marketOpen ? 60_000 : false,
    retry: 0,
  });

  const daily = useQuery({
    queryKey: ["contract-daily", key.symbol, key.expiry, key.strike, key.type, opts.dailyDays, sample ? `sample:${Math.round(spot)}` : "nse"],
    queryFn: ({ signal }) => loadDaily(key, sample, spot, opts.dailyDays, signal),
    enabled: !!data && (!sample || spot > 0),
    staleTime: sample ? Infinity : 30 * 60_000,
    retry: 0,
  });

  /** Intraday series with the current live quote appended when it is newer than the last snapshot. */
  const series = useMemo((): EnrichedPoint[] => {
    const snaps = intraday.data?.snaps ?? [];
    const all = [...snaps];
    const liveUsable = !!data && !sample && data.isLive && !data.stale && !!row && intraday.data?.date === contractSessionWindow().date;
    if (liveUsable && row) {
      const lastTs = snaps.length ? snaps[snaps.length - 1].ts : 0;
      if (data.asOf - lastTs > 10_000) all.push(buildSnapshot(key.symbol, key.expiry, spot, [row], data.asOf));
    }
    return enrichContractSeries(extractContractSeries(all, key.strike, key.type), key);
  }, [intraday.data, data, sample, row, key, spot]);

  const summary = useMemo(() => summariseSeries(series), [series]);
  const intradayMode: IntradayMode = sample ? (series.length ? "sample" : "empty") : series.length === 0 ? "empty" : data?.isLive && !data.stale && intraday.data?.date === contractSessionWindow().date ? "live" : "recorded";

  const strikes = useMemo(() => (expiryMatches ? (data?.chain ?? []).map((r) => r.strikePrice).sort((a, b) => a - b) : []), [data, expiryMatches]);
  const atmBand = data?.stepSize || getStrikeStep(key.symbol);

  return {
    live,
    data,
    sample,
    expiryMatches,
    spot,
    leg,
    otherLeg,
    lotSize,
    strikes,
    atmBand,
    intraday,
    intradayMode,
    series,
    summary,
    daily,
  };
}

export type ContractData = ReturnType<typeof useContractData>;
