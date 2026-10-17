import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import {
  Database, Download, Trash2, CheckCircle2, Clock, BarChart3,
  Loader2, AlertCircle, Radio, Layers, CandlestickChart, TrendingUp, History, Scissors,
} from "lucide-react";
import { fetchInstrumentMaster, fetchHistoricalCandles, fetchFnOStocks, parseNSEFnOStocks } from "@/lib/marketApi";
import {
  saveInstruments, savePriceSnapshots, saveCandleHistory, getDatabaseStats,
  clearAllData, clearSnapshotData, setMetadata, type DatabaseStats, type Instrument,
  type CandleHistory, type CandleData, type PriceSnapshot,
} from "@/lib/localDatabase";
import { getSnapshotStats, pruneSnapshots } from "@/lib/snapshotStore";
import { invalidateLocalPriceCache } from "@/hooks/useMarketData";
import { SECURITY_MAP } from "@/hooks/useChartData";
import { formatTimeIST, formatDateIST } from "@/lib/options";
import { useQueryClient } from "@tanstack/react-query";

type UpdatePhase = "idle" | "instruments" | "prices" | "candles" | "fno-candles" | "done" | "error";

interface UpdateProgress {
  phase: UpdatePhase;
  current: number;
  total: number;
  message: string;
}

type CandleTarget = { securityId: string; symbol: string; segment: string; instrument: string };

const target = (symbol: string): CandleTarget => {
  const ref = SECURITY_MAP[symbol];
  return { securityId: ref.secId, symbol, segment: ref.exchSeg, instrument: ref.instrument };
};

// Indices to fetch 5-minute candles for
const INDEX_CANDLE_TARGETS: CandleTarget[] = ["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "INDIAVIX", "SENSEX"].map(target);

// Large F&O stocks to also fetch candle history for (ids from the shared, de-duplicated map)
const FNO_STOCK_CANDLE_TARGETS: CandleTarget[] = [
  "RELIANCE", "TCS", "HDFCBANK", "INFY", "ICICIBANK", "SBIN", "BHARTIARTL", "ITC", "TATAMOTORS", "BAJFINANCE",
].map(target);

interface SnapshotInfo { count: number; symbols: string[]; recording: boolean; lastTs: number | null }

export function DatabaseManager() {
  const queryClient = useQueryClient();
  const [stats, setStats] = useState<DatabaseStats | null>(null);
  const [progress, setProgress] = useState<UpdateProgress>({
    phase: "idle", current: 0, total: 0, message: "",
  });
  const [isUpdating, setIsUpdating] = useState(false);
  const [dbError, setDbError] = useState<string | null>(null);
  const [snapInfo, setSnapInfo] = useState<SnapshotInfo | null>(null);

  const loadStats = useCallback(async () => {
    try {
      const [s, snaps] = await Promise.all([getDatabaseStats(), getSnapshotStats()]);
      setStats(s);
      setSnapInfo(snaps);
      setDbError(null);
    } catch {
      setDbError("This browser blocked local storage (IndexedDB). Offline data is unavailable.");
    }
  }, []);

  // Load stats on mount
  useEffect(() => {
    loadStats();
  }, [loadStats]);

  const handleUpdateDatabase = async () => {
    setIsUpdating(true);

    try {
      // ── Phase 1: Download Instrument Master ──
      setProgress({ phase: "instruments", current: 0, total: 1, message: "Downloading instrument master..." });

      const result = await fetchInstrumentMaster();
      const instruments: Instrument[] = result.instruments || [];

      if (instruments.length === 0) {
        throw new Error("No instruments received from Dhan API");
      }

      setProgress({ phase: "instruments", current: 50, total: 100, message: `Saving ${instruments.length.toLocaleString()} instruments...` });

      // Save in batches to avoid blocking UI
      const BATCH_SIZE = 2000;
      for (let i = 0; i < instruments.length; i += BATCH_SIZE) {
        const batch = instruments.slice(i, i + BATCH_SIZE);
        await saveInstruments(batch);
        setProgress({
          phase: "instruments",
          current: Math.round(((i + batch.length) / instruments.length) * 100),
          total: 100,
          message: `Saved ${Math.min(i + BATCH_SIZE, instruments.length).toLocaleString()} / ${instruments.length.toLocaleString()} instruments`,
        });
      }

      await setMetadata("lastInstrumentUpdate", new Date().toISOString());

      // ── Phase 2: Save Price Snapshots from NSE data (if available) ──
      setProgress({ phase: "prices", current: 0, total: 100, message: "Fetching F&O price snapshots from NSE..." });

      try {
        const now = Date.now();
        const priceSnapshots: PriceSnapshot[] = parseNSEFnOStocks(await fetchFnOStocks()).map((d) => ({
          securityId: d.symbol,
          symbol: d.symbol,
          ltp: d.ltp,
          open: d.open,
          high: d.high,
          low: d.low,
          close: d.previousClose,
          change: d.change,
          changePercent: d.changePercent,
          volume: d.volume,
          oi: d.openInterest ?? 0,
          timestamp: now,
        }));
        if (priceSnapshots.length > 0) {
          await savePriceSnapshots(priceSnapshots);
          await setMetadata("lastPriceUpdate", new Date().toISOString());
        }
        setProgress({ phase: "prices", current: 100, total: 100, message: `Saved ${priceSnapshots.length} price snapshots` });
      } catch {
        setProgress({ phase: "prices", current: 100, total: 100, message: "Price snapshots skipped (NSE unavailable)" });
      }

      // ── Phase 3: Download Historical Candles for Indices ──
      const allCandleTargets = [...INDEX_CANDLE_TARGETS, ...FNO_STOCK_CANDLE_TARGETS];
      setProgress({ phase: "candles", current: 0, total: allCandleTargets.length, message: "Downloading historical candles..." });

      let successCount = 0;
      for (let i = 0; i < allCandleTargets.length; i++) {
        const target = allCandleTargets[i];
        const isIndex = i < INDEX_CANDLE_TARGETS.length;
        setProgress({
          phase: i < INDEX_CANDLE_TARGETS.length ? "candles" : "fno-candles",
          current: i,
          total: allCandleTargets.length,
          message: `Fetching ${target.symbol} ${isIndex ? "index" : "stock"} candles...`,
        });

        try {
          const candleResult = await fetchHistoricalCandles(
            target.securityId,
            target.segment,
            target.instrument,
            "5", // 5-minute candles
          );

          const cd = candleResult?.data;
          const times = cd?.timestamp ?? [];
          if (cd && times.length > 0) {
            const candles: CandleData[] = [];
            times.forEach((ts, idx) => {
              const close = cd.close?.[idx];
              const t = typeof ts === "number" ? ts : Date.parse(ts) / 1000;
              if (close == null || !Number.isFinite(t)) return;
              candles.push({
                timestamp: t > 1e12 ? t : t * 1000,
                open: cd.open?.[idx] ?? close,
                high: cd.high?.[idx] ?? close,
                low: cd.low?.[idx] ?? close,
                close,
                volume: cd.volume?.[idx] ?? 0,
                oi: cd.oi?.[idx] ?? undefined,
              });
            });

            const history: CandleHistory = {
              securityId: target.securityId,
              symbol: target.symbol,
              exchangeSegment: target.segment,
              interval: "5",
              candles,
              lastUpdated: Date.now(),
            };

            if (candles.length > 0) {
              await saveCandleHistory(history);
              successCount++;
            }
          }
        } catch {
          /* skip this symbol; the summary shows how many succeeded */
        }

        // Small delay between requests to avoid rate limiting
        if (i < allCandleTargets.length - 1) {
          await new Promise((r) => setTimeout(r, 400));
        }
      }

      await setMetadata("lastCandleUpdate", new Date().toISOString());

      // ── Done ──
      // Invalidate all caches so hook refreshes pull from IndexedDB
      invalidateLocalPriceCache();
      queryClient.invalidateQueries({ queryKey: ["nse-indices"] });
      queryClient.invalidateQueries({ queryKey: ["nse-fno-stocks"] });
      queryClient.invalidateQueries({ queryKey: ["stored-candles"] });

      setProgress({ phase: "done", current: 100, total: 100, message: "Database updated successfully!" });
      toast.success(
        `Database updated: ${instruments.length.toLocaleString()} instruments, ${successCount} candle charts stored`,
        { duration: 5000 }
      );
      await loadStats();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Update failed";
      setProgress({ phase: "error", current: 0, total: 0, message });
      toast.error(`Database update failed: ${message}`);
    } finally {
      setIsUpdating(false);
      setTimeout(() => {
        setProgress({ phase: "idle", current: 0, total: 0, message: "" });
      }, 8000);
    }
  };

  const handleClearDatabase = async () => {
    try {
      await clearAllData();
      invalidateLocalPriceCache();
      queryClient.invalidateQueries();
      await loadStats();
      toast.info("Local database cleared");
    } catch (err) {
      toast.error(`Clear failed: ${err instanceof Error ? err.message : "unknown error"}`);
    }
  };

  const handlePruneSnapshots = async () => {
    try {
      const n = await pruneSnapshots(30);
      await loadStats();
      toast.success(n > 0 ? `Removed ${n.toLocaleString("en-IN")} snapshots older than 30 days` : "No snapshots older than 30 days");
    } catch {
      toast.error("Could not prune snapshots");
    }
  };

  const handleClearSnapshots = async () => {
    try {
      await clearSnapshotData();
      queryClient.invalidateQueries({ queryKey: ["chain-snapshots"] });
      await loadStats();
      toast.info("Snapshot history cleared");
    } catch {
      toast.error("Could not clear snapshot history");
    }
  };

  const formatDate = (iso: string | null) => {
    if (!iso) return "Never";
    const d = new Date(iso);
    return Number.isFinite(d.getTime()) ? `${formatDateIST(d)}, ${formatTimeIST(d)}` : "Never";
  };

  const overallProgress = progress.phase === "instruments"
    ? (progress.current * 0.4)
    : progress.phase === "prices"
    ? 40 + (progress.current * 0.15)
    : progress.phase === "candles"
    ? 55 + ((progress.current / Math.max(progress.total, 1)) * 20)
    : progress.phase === "fno-candles"
    ? 75 + ((progress.current / Math.max(progress.total, 1)) * 25)
    : progress.phase === "done" ? 100 : 0;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex flex-wrap items-center gap-2">
          <Database className="h-5 w-5 text-primary" aria-hidden />
          Market database
          {stats && stats.instruments > 0 && (
            <Badge variant="outline" className="text-[11px] h-5 px-1.5 border-bullish/30 text-bullish gap-1">
              <Radio className="h-2 w-2" />
              {stats.instruments.toLocaleString()} instruments
            </Badge>
          )}
        </CardTitle>
        <CardDescription className="text-xs">
          Download and store F&O instruments, prices, and candle history locally for instant access.
          Data persists offline in IndexedDB and powers charts, watchlist, and analytics.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {dbError && (
          <p role="alert" className="text-xs text-bearish flex items-center gap-1.5">
            <AlertCircle className="h-3.5 w-3.5" aria-hidden /> {dbError}
          </p>
        )}

        {/* Stats Grid */}
        {stats && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <StatCard
              icon={<Layers className="h-3.5 w-3.5" />}
              label="Instruments"
              value={stats.instruments > 0 ? stats.instruments.toLocaleString() : "—"}
              sub={formatDate(stats.lastInstrumentUpdate)}
            />
            <StatCard
              icon={<BarChart3 className="h-3.5 w-3.5" />}
              label="Prices"
              value={stats.prices > 0 ? stats.prices.toLocaleString() : "—"}
              sub={formatDate(stats.lastPriceUpdate)}
            />
            <StatCard
              icon={<CandlestickChart className="h-3.5 w-3.5" />}
              label="Candle charts"
              value={stats.candles > 0 ? stats.candles.toLocaleString() : "—"}
              sub={formatDate(stats.lastCandleUpdate)}
            />
          </div>
        )}

        {/* Progress Bar */}
        {progress.phase !== "idle" && (
          <div className="space-y-2 p-3 rounded-lg bg-card border">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium flex items-center gap-1.5">
                {progress.phase === "done" ? (
                  <CheckCircle2 className="h-3.5 w-3.5 text-bullish" />
                ) : progress.phase === "error" ? (
                  <AlertCircle className="h-3.5 w-3.5 text-destructive" />
                ) : (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                )}
                {progress.phase === "instruments" && "Step 1/4: Instruments"}
                {progress.phase === "prices" && "Step 2/4: Price Snapshots"}
                {progress.phase === "candles" && "Step 3/4: Index Candles"}
                {progress.phase === "fno-candles" && "Step 4/4: F&O Stock Candles"}
                {progress.phase === "done" && "Complete"}
                {progress.phase === "error" && "Error"}
              </span>
              <span className="text-xs text-muted-foreground font-mono">{Math.round(overallProgress)}%</span>
            </div>
            <Progress value={overallProgress} className={`h-1.5 ${progress.phase === "error" ? "[&>div]:bg-destructive" : progress.phase === "done" ? "[&>div]:bg-bullish" : ""}`} />
            <p className="text-xs text-muted-foreground">{progress.message}</p>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex gap-2">
          <Button
            onClick={handleUpdateDatabase}
            disabled={isUpdating}
            className="flex-1 gap-2"
            size="sm"
          >
            {isUpdating ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Updating...
              </>
            ) : (
              <>
                <Download className="h-3.5 w-3.5" />
                {stats && stats.instruments > 0 ? "Update Database" : "Download Database"}
              </>
            )}
          </Button>

          {stats && stats.instruments > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleClearDatabase}
              className="text-muted-foreground hover:text-destructive gap-1.5"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Clear
            </Button>
          )}
        </div>

        {/* Snapshot recorder history */}
        {snapInfo && (
          <div className="p-3 rounded-lg border border-border bg-card space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <History className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
              <span className="text-xs font-medium">Option-chain snapshots</span>
              <Badge variant="outline" className={snapInfo.recording ? "text-bullish border-bullish/30" : ""}>
                {snapInfo.recording ? "Recording" : "Idle"}
              </Badge>
              <span className="text-xs text-muted-foreground tabular-nums ml-auto">
                {snapInfo.count.toLocaleString("en-IN")} saved
                {snapInfo.lastTs ? ` · last ${formatTimeIST(snapInfo.lastTs)}` : ""}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              {snapInfo.symbols.length > 0
                ? `Symbols: ${snapInfo.symbols.join(", ")}. Recorded in this browser only while a page with the recorder is open during market hours.`
                : "No snapshots yet. Pages that use the recorder save the live chain every minute during market hours."}
            </p>
            {snapInfo.count > 0 && (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5" onClick={handlePruneSnapshots}>
                  <Scissors className="h-3 w-3" aria-hidden /> Remove older than 30 days
                </Button>
                <Button size="sm" variant="ghost" className="h-7 text-xs gap-1.5 text-muted-foreground hover:text-destructive" onClick={handleClearSnapshots}>
                  <Trash2 className="h-3 w-3" aria-hidden /> Clear snapshots
                </Button>
              </div>
            )}
          </div>
        )}

        {/* What gets downloaded */}
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">What gets stored:</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            {[
              { icon: <Layers className="h-2.5 w-2.5" />, text: "NSE F&O instrument master" },
              { icon: <TrendingUp className="h-2.5 w-2.5" />, text: "F&O price snapshot (NSE)" },
              { icon: <CandlestickChart className="h-2.5 w-2.5" />, text: "3-day index candles (5 min)" },
              { icon: <BarChart3 className="h-2.5 w-2.5" />, text: "Top 10 F&O stock candles" },
            ].map((item, i) => (
              <div key={i} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                {item.icon}
                <span>{item.text}</span>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function StatCard({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub: string }) {
  return (
    <div className="p-2.5 rounded-lg bg-card border">
      <div className="flex items-center gap-1.5 text-muted-foreground mb-1">
        {icon}
        <span className="text-xs font-medium">{label}</span>
      </div>
      <p className="text-sm font-bold font-mono">{value}</p>
      <p className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-1">
        <Clock className="h-2.5 w-2.5" />
        {sub}
      </p>
    </div>
  );
}
