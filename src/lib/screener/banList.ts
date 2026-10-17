/**
 * F&O ban list and MWPL hooks.
 *
 * - useBanData(): full data for the screener (ban list, MWPL table, observed history), with a
 *   labelled sample fallback when the proxy has nothing.
 * - useBanList(): the small public contract other pages (watchlist, dashboard) import. It never
 *   returns sample symbols: when live data is missing it returns empty lists and
 *   source "unavailable", so no fake ban badge can appear elsewhere in the app.
 */
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { proxyGet, type ProxySource } from "@/lib/api/proxyClient";
import { istDateString } from "@/lib/options";
import {
  mergeBanHistory,
  nearBanList,
  parseBanPayload,
  parseMwplPayload,
  type BanHistory,
  type BanListData,
  type MwplRow,
} from "./ban";
import { sampleBanList, sampleMwpl } from "./sample";

export type FeedSource = ProxySource | "sample";

export interface FeedMeta {
  source: FeedSource;
  asOf: number;
  stale: boolean;
  reason?: string;
}

const HISTORY_KEY = "mc_screener_ban_history_v1";

function readHistory(): BanHistory {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((x) => parseBanPayload(x))
      .filter((x): x is BanListData => !!x && !!x.date);
  } catch {
    return [];
  }
}

function writeHistory(h: BanHistory): void {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(h));
  } catch {
    /* storage blocked: history simply is not kept */
  }
}

export function useBanListQuery() {
  return useQuery({
    queryKey: ["screener", "ban-list"],
    queryFn: async ({ signal }): Promise<{ data: BanListData; meta: FeedMeta }> => {
      const env = await proxyGet<unknown>("/api/x/ban-list", undefined, { signal, timeoutMs: 15000 });
      const parsed = parseBanPayload(env.data);
      if (parsed) return { data: parsed, meta: env.meta };
      return {
        data: sampleBanList(istDateString()),
        meta: { source: "sample", asOf: Date.now(), stale: true, reason: env.meta.reason || "Ban list unavailable" },
      };
    },
    staleTime: 10 * 60000,
    refetchInterval: 30 * 60000,
    retry: 1,
  });
}

export function useMwplQuery() {
  return useQuery({
    queryKey: ["screener", "mwpl"],
    queryFn: async ({ signal }): Promise<{ data: MwplRow[]; meta: FeedMeta }> => {
      const env = await proxyGet<unknown>("/api/x/mwpl", undefined, { signal, timeoutMs: 20000 });
      const rows = parseMwplPayload(env.data);
      if (rows.length > 0) return { data: rows, meta: env.meta };
      return { data: sampleMwpl(), meta: { source: "sample", asOf: Date.now(), stale: true, reason: env.meta.reason || "MWPL file unavailable" } };
    },
    staleTime: 30 * 60000,
    refetchInterval: 60 * 60000,
    retry: 1,
  });
}

export interface BanData {
  ban: BanListData | null;
  banMeta: FeedMeta | null;
  mwpl: MwplRow[];
  mwplMeta: FeedMeta | null;
  /** Ban lists observed on this device, oldest first (live data only). */
  history: BanHistory;
  isLoading: boolean;
  isError: boolean;
}

export function useBanData(): BanData {
  const banQ = useBanListQuery();
  const mwplQ = useMwplQuery();
  const [history, setHistory] = useState<BanHistory>(() => readHistory());

  const ban = banQ.data?.data ?? null;
  const banIsLive = !!banQ.data && banQ.data.meta.source !== "sample";
  useEffect(() => {
    if (!ban || !banIsLive || !ban.date) return;
    setHistory((h) => {
      const next = mergeBanHistory(h, ban);
      writeHistory(next);
      return next;
    });
  }, [ban, banIsLive]);

  return {
    ban,
    banMeta: banQ.data?.meta ?? null,
    mwpl: mwplQ.data?.data ?? [],
    mwplMeta: mwplQ.data?.meta ?? null,
    history,
    isLoading: banQ.isLoading || mwplQ.isLoading,
    isError: banQ.isError && mwplQ.isError,
  };
}

/**
 * Public contract for the watchlist and dashboard streams.
 * `source` is the ban-list feed source ("nse", "cache", …) or "unavailable".
 */
export function useBanList(): { banned: string[]; nearBan: Array<{ symbol: string; mwplPct: number }>; isLoading: boolean; source: string } {
  const banQ = useBanListQuery();
  const mwplQ = useMwplQuery();
  return useMemo(() => {
    const banLive = banQ.data && banQ.data.meta.source !== "sample" ? banQ.data : null;
    const mwplLive = mwplQ.data && mwplQ.data.meta.source !== "sample" ? mwplQ.data.data : [];
    const banned = banLive ? banLive.data.symbols : [];
    return {
      banned,
      nearBan: nearBanList(mwplLive, banned),
      isLoading: banQ.isLoading || mwplQ.isLoading,
      source: banLive ? banLive.meta.source : banQ.isLoading ? "loading" : "unavailable",
    };
  }, [banQ.data, banQ.isLoading, mwplQ.data, mwplQ.isLoading]);
}
