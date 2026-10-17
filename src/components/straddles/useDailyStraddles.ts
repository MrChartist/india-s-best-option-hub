/**
 * Daily straddle history for one symbol and expiry: NSE F&O bhavcopy through the local proxy
 * (/api/x/bhavcopy-fo, one file per trading day), falling back to a clearly labelled sample when
 * the chain itself is sample data, the underlying trades on BSE, or the archives do not answer.
 */
import { useQuery } from "@tanstack/react-query";
import { proxyGet } from "@/lib/api/proxyClient";
import { getContractSpec } from "@/lib/options";
import { loadBhavcopyDays, sampleBhavcopyDays, straddleHistoryDates, type BhavcopyDay, type BhavcopyFoRow } from "@/lib/straddles";

export type DailyMode = "bhavcopy" | "sample";

export interface DailyStraddleData {
  mode: DailyMode;
  days: BhavcopyDay[];
  /** Why the sample is shown (null for bhavcopy). */
  reason: string | null;
  requested: number;
  answered: number;
}

function offlineText(reason: string): string {
  if (reason === "proxy-offline" || reason === "offline") return "The local proxy is not reachable";
  if (reason === "sample-mode") return "The app is in sample-data mode";
  if (reason === "timeout") return "NSE archives timed out";
  return `NSE archives did not answer (${reason})`;
}

async function load(symbol: string, expiry: string, days: number, sampleChain: boolean, spot: number, signal?: AbortSignal): Promise<DailyStraddleData> {
  const dates = straddleHistoryDates(new Date(), days, expiry);
  const sample = (reason: string): DailyStraddleData => {
    const out = sampleBhavcopyDays({ symbol, expiry, spot, dates, now: new Date() });
    return { mode: "sample", days: out, reason, requested: dates.length, answered: 0 };
  };
  if (sampleChain) return sample("Live data is unavailable");
  if (getContractSpec(symbol)?.exchange === "BSE") return sample(`${symbol} options trade on BSE, so they are not in the NSE F&O bhavcopy`);
  if (dates.length === 0) return { mode: "bhavcopy", days: [], reason: null, requested: 0, answered: 0 };
  const res = await loadBhavcopyDays(
    dates,
    async (date) => {
      const env = await proxyGet<BhavcopyFoRow[]>("/api/x/bhavcopy-fo", { date, symbol, expiry }, { timeoutMs: 70_000, signal });
      return { data: Array.isArray(env.data) ? env.data : null, reason: env.meta.reason };
    },
    { signal },
  );
  if (res.answered === 0) return sample(offlineText(res.reason ?? "no data"));
  return { mode: "bhavcopy", days: res.days, reason: null, requested: res.requested, answered: res.answered };
}

export function useDailyStraddles(o: { symbol: string; expiry: string; days: number; sampleChain: boolean; spot: number; enabled: boolean }) {
  const spotKey = o.sampleChain ? Math.round(o.spot) : 0;
  return useQuery({
    queryKey: ["straddles-daily", o.symbol, o.expiry, o.days, o.sampleChain ? `sample:${spotKey}` : "nse"],
    queryFn: ({ signal }) => load(o.symbol, o.expiry, o.days, o.sampleChain, o.spot, signal),
    enabled: o.enabled && !!o.symbol && !!o.expiry && o.spot > 0,
    staleTime: o.sampleChain ? Infinity : 30 * 60_000,
    retry: 0,
  });
}
