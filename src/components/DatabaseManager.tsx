import { useState, useEffect, useCallback, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import {
  Database, Download, Trash2, CheckCircle2, Clock, BarChart3,
  Loader2, AlertCircle, Radio, Layers, CandlestickChart, TrendingUp, History, Scissors,
  HardDrive, ShieldCheck, Server, PauseCircle, Minimize2,
} from "lucide-react";
import { fetchInstrumentMaster, fetchHistoricalCandles, fetchFnOStocks, parseNSEFnOStocks } from "@/lib/marketApi";
import {
  saveInstruments, savePriceSnapshots, saveCandleHistory, getDatabaseStats,
  clearAllData, clearSnapshotData, setMetadata, type DatabaseStats, type Instrument,
  type CandleHistory, type CandleData, type PriceSnapshot,
} from "@/lib/localDatabase";
import { compactSnapshots, getSnapshotStats, pruneSnapshots } from "@/lib/snapshotStore";
import { QUOTA_PAUSE_RATIO, clearQuotaPause, refreshStorageHealth, type StorageHealth } from "@/lib/history/storageHealth";
import { useStorageHealth } from "@/hooks/useLocalDatabase";
import { proxyGet, useProxyStatus } from "@/lib/api/proxyClient";
import { invalidateLocalPriceCache } from "@/hooks/useMarketData";
import { SECURITY_MAP } from "@/hooks/useChartData";
import { formatTimeIST, formatDateIST, formatNumberIN, formatPct } from "@/lib/options";
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

interface ServerRecorderStatus {
  enabled: boolean;
  running: boolean;
  symbols: string[];
  intervalSec: number;
  inWindow: boolean;
  lastWriteAt: number | null;
  writes: number;
  lastError: string | null;
}

/** Bytes in Indian-friendly binary units: 820 KB, 14.2 MB, 1.31 GB. */
function formatBytes(n: number | null | undefined): string {
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0) return "—";
  if (n < 1024) return `${Math.round(n)} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${formatNumberIN(v, v >= 100 ? 0 : 1)} ${units[i]}`;
}


export function DatabaseManager() {
  const queryClient = useQueryClient();
  const [stats, setStats] = useState<DatabaseStats | null>(null);
  const [progress, setProgress] = useState<UpdateProgress>({
    phase: "idle", current: 0, total: 0, message: "",
  });
  const [isUpdating, setIsUpdating] = useState(false);
  const [dbError, setDbError] = useState<string | null>(null);
  const [snapInfo, setSnapInfo] = useState<SnapshotInfo | null>(null);
  const storage = useStorageHealth();
  const proxy = useProxyStatus();
  const [serverRec, setServerRec] = useState<ServerRecorderStatus | null>(null);
  // Aborts the bulk update loop on unmount so it stops fetching and setting state.
  const updateAbort = useRef<AbortController | null>(null);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      updateAbort.current?.abort();
      if (resetTimer.current) clearTimeout(resetTimer.current);
    },
    [],
  );

  useEffect(() => {
    if (proxy.status !== "online") {
      setServerRec(null);
      return;
    }
    let alive = true;
    void proxyGet<ServerRecorderStatus>("/api/x/snapshots/status", undefined, { timeoutMs: 5000 }).then((env) => {
      if (alive) setServerRec(env.data && typeof env.data.enabled === "boolean" ? env.data : null);
    });
    return () => {
      alive = false;
    };
  }, [proxy.status]);

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
    updateAbort.current?.abort();
    const ctrl = new AbortController();
    updateAbort.current = ctrl;
    const { signal } = ctrl;
    const checkAborted = () => {
      if (signal.aborted) throw new DOMException("Update cancelled", "AbortError");
    };
    if (resetTimer.current) {
      clearTimeout(resetTimer.current);
      resetTimer.current = null;
    }
    setIsUpdating(true);

    try {
      // ── Phase 1: Download Instrument Master ──
      setProgress({ phase: "instruments", current: 0, total: 1, message: "Downloading instrument master..." });

      const result = await fetchInstrumentMaster();
      checkAborted();
      const instruments: Instrument[] = result.instruments || [];

      if (instruments.length === 0) {
        throw new Error("No instruments received from Dhan API");
      }

      setProgress({ phase: "instruments", current: 50, total: 100, message: `Saving ${formatNumberIN(instruments.length)} instruments...` });

      // Save in batches to avoid blocking UI
      const BATCH_SIZE = 2000;
      for (let i = 0; i < instruments.length; i += BATCH_SIZE) {
        checkAborted();
        const batch = instruments.slice(i, i + BATCH_SIZE);
        await saveInstruments(batch);
        setProgress({
          phase: "instruments",
          current: Math.round(((i + batch.length) / instruments.length) * 100),
          total: 100,
          message: `Saved ${formatNumberIN(Math.min(i + BATCH_SIZE, instruments.length))} / ${formatNumberIN(instruments.length)} instruments`,
        });
      }

      await setMetadata("lastInstrumentUpdate", new Date().toISOString());

      // ── Phase 2: Save Price Snapshots from NSE data (if available) ──
      checkAborted();
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
        setProgress({ phase: "prices", current: 100, total: 100, message: `Saved ${formatNumberIN(priceSnapshots.length)} price snapshots` });
      } catch {
        setProgress({ phase: "prices", current: 100, total: 100, message: "Price snapshots skipped (NSE unavailable)" });
      }

      // ── Phase 3: Download Historical Candles for Indices ──
      const allCandleTargets = [...INDEX_CANDLE_TARGETS, ...FNO_STOCK_CANDLE_TARGETS];
      setProgress({ phase: "candles", current: 0, total: allCandleTargets.length, message: "Downloading historical candles..." });

      let successCount = 0;
      for (let i = 0; i < allCandleTargets.length; i++) {
        checkAborted();
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
          await new Promise<void>((resolve) => {
            const t = setTimeout(resolve, 400);
            signal.addEventListener("abort", () => { clearTimeout(t); resolve(); }, { once: true });
          });
        }
      }

      checkAborted();
      if (successCount > 0) await setMetadata("lastCandleUpdate", new Date().toISOString());

      // ── Done ──
      // Invalidate all caches so hook refreshes pull from IndexedDB
      invalidateLocalPriceCache();
      queryClient.invalidateQueries({ queryKey: ["nse-indices"] });
      queryClient.invalidateQueries({ queryKey: ["nse-fno-stocks"] });
      queryClient.invalidateQueries({ queryKey: ["stored-candles"] });

      const instrumentText = `${formatNumberIN(instruments.length)} instruments`;
      if (successCount === 0) {
        setProgress({
          phase: "done",
          current: 100,
          total: 100,
          message: `Instruments saved, but no candle charts could be downloaded (0 of ${allCandleTargets.length}).`,
        });
        toast.warning(`Database partly updated: ${instrumentText}, but 0 of ${allCandleTargets.length} candle charts downloaded`, {
          duration: 6000,
        });
      } else {
        setProgress({ phase: "done", current: 100, total: 100, message: "Database updated successfully!" });
        toast.success(
          `Database updated: ${instrumentText}, ${formatNumberIN(successCount)} of ${allCandleTargets.length} candle charts stored`,
          { duration: 5000 },
        );
      }
      await loadStats();
    } catch (err) {
      if (signal.aborted) return;
      const message = err instanceof Error ? err.message : "Update failed";
      setProgress({ phase: "error", current: 0, total: 0, message });
      toast.error(`Database update failed: ${message}`);
    } finally {
      if (!signal.aborted) {
        setIsUpdating(false);
        resetTimer.current = setTimeout(() => {
          resetTimer.current = null;
          setProgress({ phase: "idle", current: 0, total: 0, message: "" });
        }, 8000);
      }
      if (updateAbort.current === ctrl) updateAbort.current = null;
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
      await refreshStorageHealth();
      await loadStats();
      toast.success(n > 0 ? `Removed ${formatNumberIN(n)} snapshots older than 30 days` : "No snapshots older than 30 days");
    } catch {
      toast.error("Could not prune snapshots");
    }
  };

  const handleCompactSnapshots = async () => {
    try {
      const { dropped } = await compactSnapshots();
      await refreshStorageHealth();
      await loadStats();
      toast.success(dropped > 0 ? `Compacted finished days to 5-minute bars (${formatNumberIN(dropped)} snapshots removed)` : "Finished days are already compact");
    } catch {
      toast.error("Could not compact snapshots");
    }
  };

  const handleClearSnapshots = async () => {
    try {
      await clearSnapshotData();
      clearQuotaPause();
      queryClient.invalidateQueries({ queryKey: ["chain-snapshots"] });
      await refreshStorageHealth();
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
              {formatNumberIN(stats.instruments)} instruments
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
              value={stats.instruments > 0 ? formatNumberIN(stats.instruments) : "—"}
              sub={formatDate(stats.lastInstrumentUpdate)}
            />
            <StatCard
              icon={<BarChart3 className="h-3.5 w-3.5" />}
              label="Prices"
              value={stats.prices > 0 ? formatNumberIN(stats.prices) : "—"}
              sub={formatDate(stats.lastPriceUpdate)}
            />
            <StatCard
              icon={<CandlestickChart className="h-3.5 w-3.5" />}
              label="Candle charts"
              value={stats.candles > 0 ? formatNumberIN(stats.candles) : "—"}
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

        {/* Browser storage usage and quota */}
        <StorageUsage health={storage} />

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
                {formatNumberIN(snapInfo.count)} saved
                {snapInfo.lastTs ? ` · last ${formatTimeIST(snapInfo.lastTs)}` : ""}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              {snapInfo.symbols.length > 0
                ? `Symbols: ${snapInfo.symbols.join(", ")}. Recorded in this browser while a page with the recorder is open during market hours; finished days are kept as 5-minute bars for 30 days.`
                : "No snapshots yet. Pages that use the recorder save the live chain every minute during market hours. Sample data is never recorded."}
            </p>
            {storage.paused && (
              <p role="alert" className="flex items-start gap-1.5 text-xs text-warning">
                <PauseCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                {storage.pauseReason === "quota-error"
                  ? "Recording is paused: the browser refused a write because storage is full. Remove old snapshots or clear them to resume."
                  : `Recording is paused: this site is using over ${Math.round(QUOTA_PAUSE_RATIO * 100)}% of its storage quota. Remove old snapshots to resume.`}
              </p>
            )}
            {serverRec && (
              <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                <Server className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                {serverRec.enabled
                  ? `Proxy recorder on for ${serverRec.symbols.join(", ")} every ${serverRec.intervalSec}s${serverRec.lastWriteAt ? `, last write ${formatTimeIST(serverRec.lastWriteAt)}` : ""}. Pages backfill today's gaps from it automatically.${serverRec.lastError ? ` Last error: ${serverRec.lastError}` : ""}`
                  : "Proxy recorder is off. Start the proxy with RECORD_SYMBOLS=NIFTY,BANKNIFTY to keep history even when this tab is closed."}
              </p>
            )}
            {snapInfo.count > 0 && (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5" onClick={handlePruneSnapshots}>
                  <Scissors className="h-3 w-3" aria-hidden /> Remove older than 30 days
                </Button>
                <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5" onClick={handleCompactSnapshots}>
                  <Minimize2 className="h-3 w-3" aria-hidden /> Compact old days
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
            ].map((item) => (
              <div key={item.text} className="flex items-center gap-1.5 text-xs text-muted-foreground">
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

function StorageUsage({ health }: { health: StorageHealth }) {
  if (!health.supported) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <HardDrive className="h-3.5 w-3.5" aria-hidden /> This browser does not report storage usage. Recording continues, and a full disk is handled if it happens.
      </p>
    );
  }
  const pct = health.ratio !== null ? health.ratio * 100 : null;
  const near = pct !== null && pct >= QUOTA_PAUSE_RATIO * 100;
  const warn = pct !== null && pct >= QUOTA_PAUSE_RATIO * 100 * 0.75;
  return (
    <div className="p-3 rounded-lg border border-border bg-card space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <HardDrive className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
        <span className="text-xs font-medium">Browser storage</span>
        {health.persisted === true ? (
          <Badge variant="bullish" title="The browser will not evict this site's data under storage pressure">
            <ShieldCheck aria-hidden /> Persistent
          </Badge>
        ) : health.persisted === false ? (
          <Badge variant="neutral" title="The browser may clear this site's data if the disk runs low">Best effort</Badge>
        ) : null}
        <span className="ml-auto text-xs tabular-nums text-muted-foreground">
          {health.usage !== null ? `${formatBytes(health.usage)} of ${formatBytes(health.quota)}` : "Measuring…"}
          {pct !== null ? ` · ${formatPct(pct, { decimals: pct < 1 ? 2 : 1 })}` : ""}
        </span>
      </div>
      <Progress
        value={pct ?? 0}
        aria-label="Share of the browser storage quota in use"
        className={`h-1.5 ${near ? "[&>div]:bg-destructive" : warn ? "[&>div]:bg-warning" : ""}`}
      />
      {near ? (
        <p role="alert" className="flex items-center gap-1.5 text-xs text-bearish">
          <AlertCircle className="h-3.5 w-3.5" aria-hidden /> Over {Math.round(QUOTA_PAUSE_RATIO * 100)}% of the quota is used, so snapshot recording is paused until space is freed.
        </p>
      ) : warn ? (
        <p className="text-xs text-warning">Storage is filling up. Recording pauses automatically at {Math.round(QUOTA_PAUSE_RATIO * 100)}% of the quota.</p>
      ) : null}
      {health.lastError && health.lastErrorAt ? (
        <p className="text-xs text-muted-foreground">Last write error at {formatTimeIST(health.lastErrorAt)}: {health.lastError}</p>
      ) : null}
    </div>
  );
}
