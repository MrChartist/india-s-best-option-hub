/**
 * Beta to NIFTY from one year of daily returns (Yahoo daily bars through the proxy), cached for a day
 * in localStorage ("mc_beta_v1"). Indices other than NIFTY are computed the same way; NIFTY is 1.
 * When bars are unavailable beta falls back to 1 and is labelled "assumed".
 */
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { fetchDailyBars } from "@/lib/volatility/api";
import type { OHLC } from "@/lib/options";
import { betaFromBars } from "./analytics";

const CACHE_KEY = "mc_beta_v1";
const TTL_MS = 24 * 60 * 60 * 1000;

export interface BetaInfo {
  beta: number;
  basis: "index" | "computed" | "assumed";
  loading: boolean;
}

type Cache = Record<string, { beta: number; at: number }>;

function readCache(): Cache {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? (parsed as Cache) : {};
  } catch {
    return {};
  }
}

function writeCache(symbol: string, beta: number): void {
  try {
    const c = readCache();
    c[symbol] = { beta, at: Date.now() };
    localStorage.setItem(CACHE_KEY, JSON.stringify(c));
  } catch {
    /* storage unavailable: beta is recomputed next time */
  }
}

export function useBetas(symbols: string[]): Record<string, BetaInfo> {
  const qc = useQueryClient();
  const list = useMemo(() => Array.from(new Set(symbols.filter((s) => s && s !== "NIFTY"))).sort(), [symbols]);
  const results = useQueries({
    queries: list.map((symbol) => ({
      queryKey: ["beta-nifty", symbol],
      queryFn: async (): Promise<number> => {
        const cached = readCache()[symbol];
        if (cached && Date.now() - cached.at < TTL_MS && Number.isFinite(cached.beta)) return cached.beta;
        const [stock, index] = await Promise.all([
          fetchDailyBars(symbol, 400),
          qc.fetchQuery<OHLC[]>({ queryKey: ["daily-bars-1y", "NIFTY"], queryFn: () => fetchDailyBars("NIFTY", 400), staleTime: 12 * 60 * 60 * 1000 }),
        ]);
        const beta = betaFromBars(stock, index);
        if (!Number.isFinite(beta)) throw new Error("Not enough overlapping history");
        writeCache(symbol, beta);
        return beta;
      },
      staleTime: 12 * 60 * 60 * 1000,
      gcTime: 24 * 60 * 60 * 1000,
      retry: 0,
      refetchOnWindowFocus: false,
    })),
  });
  const sig = results.map((r) => `${r.data ?? ""}:${r.isLoading ? 1 : 0}`).join(",");
  return useMemo(() => {
    const out: Record<string, BetaInfo> = { NIFTY: { beta: 1, basis: "index", loading: false } };
    list.forEach((symbol, i) => {
      const r = results[i];
      const b = r?.data;
      out[symbol] = Number.isFinite(b) ? { beta: b as number, basis: "computed", loading: false } : { beta: 1, basis: "assumed", loading: !!r?.isLoading };
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- results identity changes every render; `sig` tracks its data
  }, [list, sig]);
}
