import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import {
  Database, Download, RefreshCw, Trash2, CheckCircle2, Clock, HardDrive, BarChart3,
  Loader2, AlertCircle, Radio, Layers, CandlestickChart, TrendingUp,
} from "lucide-react";
import { fetchInstrumentMaster, fetchHistoricalCandles } from "@/lib/marketApi";
import {
  saveInstruments, savePriceSnapshots, saveCandleHistory, getDatabaseStats,
  clearAllData, setMetadata, type DatabaseStats, type Instrument,
  type CandleHistory, type CandleData,
} from "@/lib/localDatabase";
import { invalidateLocalPriceCache } from "@/hooks/useMarketData";
import { useQueryClient } from "@tanstack/react-query";

type UpdatePhase = "idle" | "instruments" | "prices" | "candles" | "fno-candles" | "done" | "error";

interface UpdateProgress {
  phase: UpdatePhase;
  current: number;
  total: number;
  message: string;
}

// Index instruments to fetch historical candles for
const INDEX_CANDLE_TARGETS = [
  { securityId: "13", symbol: "NIFTY", segment: "IDX_I", instrument: "INDEX" },
  { securityId: "25", symbol: "BANKNIFTY", segment: "IDX_I", instrument: "INDEX" },
  { securityId: "27", symbol: "FINNIFTY", segment: "IDX_I", instrument: "INDEX" },
  { securityId: "442", symbol: "MIDCPNIFTY", segment: "IDX_I", instrument: "INDEX" },
  { securityId: "26", symbol: "INDIAVIX", segment: "IDX_I", instrument: "INDEX" },
];

// Top F&O stocks to also fetch candle history for
const FNO_STOCK_CANDLE_TARGETS = [
  { securityId: "2885", symbol: "RELIANCE", segment: "NSE_EQ", instrument: "EQUITY" },
  { securityId: "11536", symbol: "TCS", segment: "NSE_EQ", instrument: "EQUITY" },
  { securityId: "1333", symbol: "HDFCBANK", segment: "NSE_EQ", instrument: "EQUITY" },
  { securityId: "11915", symbol: "INFY", segment: "NSE_EQ", instrument: "EQUITY" },
  { securityId: "4963", symbol: "ICICIBANK", segment: "NSE_EQ", instrument: "EQUITY" },
  { securityId: "3045", symbol: "SBIN", segment: "NSE_EQ", instrument: "EQUITY" },
  { securityId: "11723", symbol: "BHARTIARTL", segment: "NSE_EQ", instrument: "EQUITY" },
  { securityId: "1660", symbol: "ITC", segment: "NSE_EQ", instrument: "EQUITY" },
  { securityId: "10999", symbol: "TATAMOTORS", segment: "NSE_EQ", instrument: "EQUITY" },
  { securityId: "5258", symbol: "BAJFINANCE", segment: "NSE_EQ", instrument: "EQUITY" },
];

export function DatabaseManager() {
  const queryClient = useQueryClient();
  const [stats, setStats] = useState<DatabaseStats | null>(null);
  const [progress, setProgress] = useState<UpdateProgress>({
    phase: "idle", current: 0, total: 0, message: "",
  });
  const [isUpdating, setIsUpdating] = useState(false);

  // Load stats on mount
  useEffect(() => {
    loadStats();
  }, []);

  const loadStats = useCallback(async () => {
    try {
      const s = await getDatabaseStats();
      setStats(s);
    } catch (err) {
      console.warn("Failed to load DB stats:", err);
    }
  }, []);

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
        const nseRes = await fetch("http://localhost:4002/api/nse-proxy?endpoint=equity-derivatives");
        if (nseRes.ok) {
          const nseData = await nseRes.json();
          if (nseData?.data) {
            const priceSnapshots = nseData.data
              .filter((d: any) => d.symbol && d.lastPrice > 0)
              .map((d: any) => ({
                securityId: d.identifier || d.symbol,
                symbol: d.symbol,
                ltp: d.lastPrice,
                open: d.open || d.lastPrice,
                high: d.dayHigh || d.lastPrice,
                low: d.dayLow || d.lastPrice,
                close: d.previousClose || d.lastPrice,
                change: d.change || 0,
                changePercent: d.pChange || 0,
                volume: d.totalTradedVolume || 0,
                oi: d.openInterest || 0,
                timestamp: Date.now(),
              }));

            if (priceSnapshots.length > 0) {
              await savePriceSnapshots(priceSnapshots);
              await setMetadata("lastPriceUpdate", new Date().toISOString());
            }
            setProgress({ phase: "prices", current: 100, total: 100, message: `Saved ${priceSnapshots.length} price snapshots` });
          }
        }
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

          if (candleResult?.data?.timestamp?.length > 0) {
            const candles: CandleData[] = candleResult.data.timestamp.map((ts: number, idx: number) => ({
              timestamp: ts * 1000, // Convert epoch seconds to ms
              open: candleResult.data.open[idx],
              high: candleResult.data.high[idx],
              low: candleResult.data.low[idx],
              close: candleResult.data.close[idx],
              volume: candleResult.data.volume[idx],
              oi: candleResult.data.oi?.[idx],
            }));

            const history: CandleHistory = {
              securityId: target.securityId,
              symbol: target.symbol,
              exchangeSegment: target.segment,
              interval: "5",
              candles,
              lastUpdated: Date.now(),
            };

            await saveCandleHistory(history);
            successCount++;
          }
        } catch (err) {
          console.warn(`Failed to fetch candles for ${target.symbol}:`, err);
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
    } catch (err: any) {
      setProgress({ phase: "error", current: 0, total: 0, message: err.message || "Update failed" });
      toast.error(`Database update failed: ${err.message}`);
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
    } catch (err: any) {
      toast.error(`Clear failed: ${err.message}`);
    }
  };

  const formatDate = (iso: string | null) => {
    if (!iso) return "Never";
    const d = new Date(iso);
    return d.toLocaleDateString("en-IN", {
      day: "numeric", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
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
    <Card className="border-primary/20 bg-gradient-to-br from-primary/[0.02] to-transparent">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Database className="h-5 w-5 text-primary" />
          Market Database
          {stats && stats.instruments > 0 && (
            <Badge variant="outline" className="text-[9px] h-5 px-1.5 border-bullish/30 text-bullish gap-1">
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
        {/* Stats Grid */}
        {stats && (
          <div className="grid grid-cols-3 gap-3">
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
              label="Candle Charts"
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
                {progress.phase === "done" && "Complete!"}
                {progress.phase === "error" && "Error"}
              </span>
              <span className="text-[10px] text-muted-foreground font-mono">{Math.round(overallProgress)}%</span>
            </div>
            <Progress value={overallProgress} className={`h-1.5 ${progress.phase === "error" ? "[&>div]:bg-destructive" : progress.phase === "done" ? "[&>div]:bg-bullish" : ""}`} />
            <p className="text-[10px] text-muted-foreground">{progress.message}</p>
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

        {/* What gets downloaded */}
        <div className="space-y-1.5">
          <p className="text-[10px] font-medium text-muted-foreground">What gets stored:</p>
          <div className="grid grid-cols-2 gap-1.5">
            {[
              { icon: <Layers className="h-2.5 w-2.5" />, text: "NSE F&O instrument master" },
              { icon: <TrendingUp className="h-2.5 w-2.5" />, text: "Live F&O price snapshots" },
              { icon: <CandlestickChart className="h-2.5 w-2.5" />, text: "2-day index candles (5m)" },
              { icon: <BarChart3 className="h-2.5 w-2.5" />, text: "Top 10 F&O stock candles" },
            ].map((item, i) => (
              <div key={i} className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
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
        <span className="text-[10px] font-medium">{label}</span>
      </div>
      <p className="text-sm font-bold font-mono">{value}</p>
      <p className="text-[9px] text-muted-foreground mt-0.5 flex items-center gap-1">
        <Clock className="h-2.5 w-2.5" />
        {sub}
      </p>
    </div>
  );
}
