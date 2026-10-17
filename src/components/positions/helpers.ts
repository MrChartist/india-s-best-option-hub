/** Non-component helpers shared by the Positions and Paper Trading pages. */
import { useCallback, useState } from "react";
import type { OptionData } from "@/lib/mockData";

// ── Feeds ──

export interface FeedSnapshot {
  key: string;
  symbol: string;
  /** The expiry that was requested (ISO). */
  expiry: string;
  /** True when the chain returned is for the requested expiry, so its quotes can be used. */
  expiryMatch: boolean;
  spot: number;
  chain: OptionData[];
  /** "dhan" | "nse" | "cache" | "sample" | "none" ... */
  source: string;
  isLive: boolean;
  stale: boolean;
  asOf: number;
  reason?: string;
  loading: boolean;
  error: boolean;
}

export const feedKey = (symbol: string, expiry: string) => `${symbol}|${expiry}`;

/** Quotes that can be shown as market prices (not generated sample data). */
export function isRealFeed(f: FeedSnapshot | undefined): boolean {
  return !!f && !f.loading && f.source !== "sample" && f.source !== "none" && f.chain.length > 0;
}

/** Map of feed snapshots plus a stable reporter for <ChainFeed onUpdate>. */
export function useChainFeeds(): [Record<string, FeedSnapshot>, (s: FeedSnapshot) => void] {
  const [feeds, setFeeds] = useState<Record<string, FeedSnapshot>>({});
  const report = useCallback((s: FeedSnapshot) => setFeeds((prev) => ({ ...prev, [s.key]: s })), []);
  return [feeds, report];
}

/** Best spot per symbol across feeds (live/cached sources preferred over sample). */
export function spotsFromFeeds(feeds: Record<string, FeedSnapshot>): Record<string, { spot: number; source: string; isLive: boolean; asOf: number }> {
  const out: Record<string, { spot: number; source: string; isLive: boolean; asOf: number }> = {};
  for (const f of Object.values(feeds)) {
    if (!(f.spot > 0)) continue;
    const cur = out[f.symbol];
    const better = !cur || (cur.source === "sample" && f.source !== "sample") || ((cur.source === "sample") === (f.source === "sample") && f.asOf > cur.asOf);
    if (better) out[f.symbol] = { spot: f.spot, source: f.source, isLive: f.isLive, asOf: f.asOf };
  }
  return out;
}

// ── Display ──

export type QuoteSource = "live" | "delayed" | "sample" | "manual" | "entry" | "none";

export function feedSourceToQuote(source: string, isLive: boolean): QuoteSource {
  if (source === "sample") return "sample";
  if (source === "none" || !source) return "none";
  return isLive ? "live" : "delayed";
}

/** Tailwind text class for a signed number. */
export function signedClass(v: number): string {
  if (!Number.isFinite(v) || Math.abs(v) < 1e-9) return "text-muted-foreground";
  return v > 0 ? "text-bullish" : "text-bearish";
}

export function downloadText(filename: string, text: string, type = "application/json"): boolean {
  try {
    const blob = new Blob([text], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  } catch {
    return false;
  }
}

/** "+₹1,234" / "−₹560" / "₹0" (rupees, no decimals by default). */
export function signedINR(v: number, decimals = 0): string {
  if (!Number.isFinite(v)) return "—";
  const abs = new Intl.NumberFormat("en-IN", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(Math.abs(v));
  const rounded = Math.round(Math.abs(v) * 10 ** decimals);
  if (rounded === 0) return `₹${abs}`;
  return `${v > 0 ? "+" : "−"}₹${abs}`;
}
