import { useState, useMemo, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import {
  Download, Loader2, CheckCircle2, Search, CandlestickChart, FileDown, Clock, BarChart3,
  TrendingUp, Database, XCircle, CheckSquare, Square, MinusCircle, StopCircle,
} from "lucide-react";
import { fetchHistoricalCandles, fetchYahooChart } from "@/lib/marketApi";
import { saveCandleHistory, setMetadata, type CandleHistory, type CandleData } from "@/lib/localDatabase";
import { SECURITY_MAP, istDaysAgo } from "@/hooks/useChartData";
import { istTimestamp } from "@/lib/snapshotStore";
import type { ColumnarCandlesDTO } from "@/lib/types/market";

interface SymbolRow {
  symbol: string;
  securityId: string;
  segment: string;
  instrument: string;
  category: "Index" | "F&O stock";
}

const ALL_SYMBOLS: SymbolRow[] = Object.entries(SECURITY_MAP).map(([symbol, ref]) => ({
  symbol,
  securityId: ref.secId,
  segment: ref.exchSeg,
  instrument: ref.instrument,
  category: ref.exchSeg === "IDX_I" ? "Index" : "F&O stock",
}));

const TIMEFRAMES = [
  { label: "1 day", value: "1D", days: 2 },
  { label: "1 week", value: "1W", days: 10 },
  { label: "1 month", value: "1M", days: 35 },
  { label: "3 months", value: "3M", days: 95 },
  { label: "6 months", value: "6M", days: 185 },
  { label: "1 year", value: "1Y", days: 370 },
];

const INTERVALS = [
  { label: "1 min", value: "1" },
  { label: "5 min", value: "5" },
  { label: "15 min", value: "15" },
  { label: "1 hour", value: "60" },
  { label: "Daily", value: "D" },
];

type SymbolStatus = "done" | "error" | "skipped";

interface DownloadResult {
  symbol: string;
  status: SymbolStatus;
  candles: number;
  source?: "yahoo" | "dhan";
  error?: string;
}

/** Convert a columnar payload to stored candles (ms timestamps, null gaps dropped). */
function toCandles(raw: ColumnarCandlesDTO): CandleData[] {
  const closes = raw.close ?? [];
  const times = raw.timestamp ?? raw.start_Time ?? [];
  const out: CandleData[] = [];
  for (let i = 0; i < closes.length; i++) {
    const close = closes[i];
    if (close == null || !Number.isFinite(close)) continue;
    const t = times[i];
    const tsNum = typeof t === "number" ? t : typeof t === "string" ? new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(t) ? t : `${t.replace(" ", "T")}+05:30`).getTime() : NaN;
    if (!Number.isFinite(tsNum)) continue;
    out.push({
      timestamp: tsNum > 1e12 ? tsNum : tsNum * 1000,
      open: raw.open?.[i] ?? close,
      high: raw.high?.[i] ?? close,
      low: raw.low?.[i] ?? close,
      close,
      volume: raw.volume?.[i] ?? 0,
      oi: raw.oi?.[i] ?? undefined,
    });
  }
  return out.sort((a, b) => a.timestamp - b.timestamp);
}

function candlesToCSV(rows: Array<{ symbol: string; candles: CandleData[] }>): string {
  const lines = ["symbol,time_ist,open,high,low,close,volume,oi"];
  for (const r of rows) {
    for (const c of r.candles) lines.push([r.symbol, istTimestamp(c.timestamp), c.open, c.high, c.low, c.close, c.volume, c.oi ?? ""].join(","));
  }
  return lines.join("\n");
}

function downloadText(filename: string, text: string) {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ChartDataDownloader() {
  const [search, setSearch] = useState("");
  const [selectedSymbols, setSelectedSymbols] = useState<Set<string>>(() => new Set(ALL_SYMBOLS.filter((s) => s.category === "Index").map((s) => s.symbol)));
  const [timeframe, setTimeframe] = useState("3M");
  const [interval, setIntervalValue] = useState("D");
  const [isDownloading, setIsDownloading] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [results, setResults] = useState<DownloadResult[]>([]);
  const [currentSymbol, setCurrentSymbol] = useState("");
  const candleStore = useRef(new Map<string, CandleData[]>());
  const cancelRef = useRef(false);

  const filteredSymbols = useMemo(() => {
    if (!search) return ALL_SYMBOLS;
    const q = search.toUpperCase();
    return ALL_SYMBOLS.filter((s) => s.symbol.includes(q) || s.category.toUpperCase().includes(q));
  }, [search]);

  const selectedCount = selectedSymbols.size;
  const intervalLabel = INTERVALS.find((i) => i.value === interval)?.label ?? interval;
  const timeframeLabel = TIMEFRAMES.find((t) => t.value === timeframe)?.label ?? timeframe;
  const intradayTooLong = interval !== "D" && ["6M", "1Y"].includes(timeframe);

  const toggleSymbol = (symbol: string) => {
    setSelectedSymbols((prev) => {
      const next = new Set(prev);
      if (next.has(symbol)) next.delete(symbol);
      else next.add(symbol);
      return next;
    });
  };

  const handleDownload = async () => {
    const symbols = ALL_SYMBOLS.filter((s) => selectedSymbols.has(s.symbol));
    if (symbols.length === 0) {
      toast.error("Select at least one symbol");
      return;
    }
    cancelRef.current = false;
    setIsDownloading(true);
    setResults([]);
    setCurrentIndex(0);
    candleStore.current.clear();

    const days = TIMEFRAMES.find((t) => t.value === timeframe)?.days ?? 95;
    const fromDate = istDaysAgo(days);
    const toDate = istDaysAgo(0);
    const newResults: DownloadResult[] = [];

    for (let i = 0; i < symbols.length; i++) {
      if (cancelRef.current) break;
      const sym = symbols[i];
      setCurrentIndex(i + 1);
      setCurrentSymbol(sym.symbol);
      let raw: ColumnarCandlesDTO | null = null;
      let source: "yahoo" | "dhan" | undefined;
      let lastError = "";

      try {
        const y = await fetchYahooChart(sym.symbol, interval, fromDate, toDate);
        if ((y?.data?.close ?? []).some((v) => v != null)) {
          raw = y.data;
          source = "yahoo";
        }
      } catch (e) {
        lastError = e instanceof Error ? e.message : "Yahoo failed";
      }
      if (!raw) {
        try {
          const d = await fetchHistoricalCandles(sym.securityId, sym.segment, sym.instrument, interval, fromDate, toDate);
          if ((d?.data?.close ?? []).some((v) => v != null)) {
            raw = d.data;
            source = "dhan";
          }
        } catch (e) {
          lastError = e instanceof Error ? e.message : "Dhan failed";
        }
      }

      if (raw) {
        const candles = toCandles(raw);
        try {
          const history: CandleHistory = {
            securityId: sym.securityId,
            symbol: sym.symbol,
            exchangeSegment: sym.segment,
            interval: `${interval}_${timeframe}`,
            candles,
            lastUpdated: Date.now(),
          };
          await saveCandleHistory(history);
          candleStore.current.set(sym.symbol, candles);
          newResults.push({ symbol: sym.symbol, status: "done", candles: candles.length, source });
        } catch (e) {
          newResults.push({ symbol: sym.symbol, status: "error", candles: 0, error: e instanceof Error ? e.message : "Could not save" });
        }
      } else {
        newResults.push({ symbol: sym.symbol, status: lastError ? "error" : "skipped", candles: 0, error: lastError || "No candles from Yahoo or Dhan" });
      }
      setResults([...newResults]);
      if (i < symbols.length - 1) await new Promise((r) => setTimeout(r, 350));
    }

    try {
      await setMetadata("lastChartDownload", new Date().toISOString());
    } catch {
      /* metadata is best-effort */
    }
    const ok = newResults.filter((r) => r.status === "done").length;
    const total = newResults.reduce((s, r) => s + r.candles, 0);
    if (cancelRef.current) toast.info(`Stopped after ${newResults.length} symbols`);
    else toast.success(`Saved ${ok} of ${symbols.length} symbols, ${total.toLocaleString("en-IN")} candles`, { duration: 6000 });
    setIsDownloading(false);
    setCurrentSymbol("");
  };

  const exportOne = (symbol: string) => {
    const candles = candleStore.current.get(symbol);
    if (!candles?.length) return;
    downloadText(`${symbol}_${timeframe}_${interval}.csv`, candlesToCSV([{ symbol, candles }]));
  };

  const exportAll = () => {
    const rows = [...candleStore.current.entries()].map(([symbol, candles]) => ({ symbol, candles }));
    if (rows.length === 0) {
      toast.error("Nothing to export yet. Run a download first.");
      return;
    }
    downloadText(`candles_${timeframe}_${interval}_${istDaysAgo(0)}.csv`, candlesToCSV(rows));
  };

  const progressPct = isDownloading ? (currentIndex / Math.max(selectedCount, 1)) * 100 : 0;
  const doneCount = results.filter((r) => r.status === "done").length;
  const errorCount = results.filter((r) => r.status === "error").length;
  const skippedCount = results.filter((r) => r.status === "skipped").length;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex flex-wrap items-center gap-2">
          <CandlestickChart className="h-5 w-5 text-primary" aria-hidden />
          Chart data downloader
          <Badge variant="outline" className="ml-auto">{selectedCount}/{ALL_SYMBOLS.length} selected</Badge>
        </CardTitle>
        <CardDescription className="text-xs">
          Save OHLCV candles for indices and large F&O stocks to this browser for offline charts. Yahoo Finance is tried first; Dhan is used when Yahoo has nothing.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="cdd-timeframe" className="text-xs text-muted-foreground flex items-center gap-1">
              <Clock className="h-3 w-3" aria-hidden /> Date range
            </Label>
            <Select value={timeframe} onValueChange={setTimeframe} disabled={isDownloading}>
              <SelectTrigger id="cdd-timeframe" className="h-9 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {TIMEFRAMES.map((tf) => <SelectItem key={tf.value} value={tf.value} className="text-xs">{tf.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cdd-interval" className="text-xs text-muted-foreground flex items-center gap-1">
              <BarChart3 className="h-3 w-3" aria-hidden /> Candle interval
            </Label>
            <Select value={interval} onValueChange={setIntervalValue} disabled={isDownloading}>
              <SelectTrigger id="cdd-interval" className="h-9 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {INTERVALS.map((iv) => <SelectItem key={iv.value} value={iv.value} className="text-xs">{iv.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        {intradayTooLong && (
          <p className="text-xs text-warning">Intraday candles are limited to about 90 days by Dhan and 60 days by Yahoo, so older bars will be missing.</p>
        )}

        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[160px]">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" aria-hidden />
              <Input placeholder="Search symbols" aria-label="Search symbols" value={search} onChange={(e) => setSearch(e.target.value)} className="h-8 text-xs pl-7" disabled={isDownloading} />
            </div>
            <Button variant="outline" size="sm" className="h-8 text-xs gap-1" onClick={() => setSelectedSymbols(new Set(ALL_SYMBOLS.map((s) => s.symbol)))} disabled={isDownloading}>
              <CheckSquare className="h-3 w-3" aria-hidden /> All
            </Button>
            <Button variant="outline" size="sm" className="h-8 text-xs gap-1" onClick={() => setSelectedSymbols(new Set(ALL_SYMBOLS.filter((s) => s.category === "Index").map((s) => s.symbol)))} disabled={isDownloading}>
              <TrendingUp className="h-3 w-3" aria-hidden /> Indices
            </Button>
            <Button variant="outline" size="sm" className="h-8 text-xs gap-1" onClick={() => setSelectedSymbols(new Set())} disabled={isDownloading}>
              <Square className="h-3 w-3" aria-hidden /> None
            </Button>
          </div>

          <ScrollArea className="h-[180px] rounded-md border border-border p-2">
            {filteredSymbols.length === 0 ? (
              <p className="text-xs text-muted-foreground p-2">No symbols match "{search}".</p>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-1">
                {filteredSymbols.map((sym) => {
                  const result = results.find((r) => r.symbol === sym.symbol);
                  return (
                    <label
                      key={sym.symbol}
                      className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-xs cursor-pointer border transition-colors ${
                        selectedSymbols.has(sym.symbol) ? "bg-primary/5 border-primary/20 text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
                      } ${currentSymbol === sym.symbol ? "ring-1 ring-primary" : ""}`}
                    >
                      <Checkbox checked={selectedSymbols.has(sym.symbol)} onCheckedChange={() => toggleSymbol(sym.symbol)} disabled={isDownloading} aria-label={`Select ${sym.symbol}`} />
                      <span className="font-medium truncate">{sym.symbol}</span>
                      {sym.category === "Index" && <span className="text-[10px] text-muted-foreground">IDX</span>}
                      {result?.status === "done" && <CheckCircle2 className="h-3 w-3 text-bullish ml-auto shrink-0" aria-label="Saved" />}
                      {result?.status === "error" && <XCircle className="h-3 w-3 text-bearish ml-auto shrink-0" aria-label="Failed" />}
                      {result?.status === "skipped" && <MinusCircle className="h-3 w-3 text-muted-foreground ml-auto shrink-0" aria-label="No data" />}
                    </label>
                  );
                })}
              </div>
            )}
          </ScrollArea>
        </div>

        {isDownloading && (
          <div className="space-y-2 p-3 rounded-lg bg-card border border-border" aria-live="polite">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium flex items-center gap-1.5">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" aria-hidden />
                Downloading {currentSymbol}
              </span>
              <span className="text-xs text-muted-foreground tabular-nums">{currentIndex}/{selectedCount} · {Math.round(progressPct)}%</span>
            </div>
            <Progress value={progressPct} className="h-1.5" />
            <p className="text-xs text-muted-foreground">{doneCount} saved · {errorCount} failed · {skippedCount} without data</p>
          </div>
        )}

        {!isDownloading && results.length > 0 && (
          <div className="space-y-2 p-3 rounded-lg bg-card border border-border">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-medium flex items-center gap-1.5">
                <CheckCircle2 className="h-3.5 w-3.5 text-bullish" aria-hidden /> Download finished
              </span>
              <span className="text-xs text-muted-foreground tabular-nums">
                {doneCount} saved · {errorCount} failed · {results.reduce((s, r) => s + r.candles, 0).toLocaleString("en-IN")} candles
              </span>
            </div>
            <ul className="max-h-40 overflow-y-auto divide-y divide-border text-xs">
              {results.map((r) => (
                <li key={r.symbol} className="flex items-center gap-2 py-1">
                  <span className="font-medium w-28 truncate">{r.symbol}</span>
                  {r.status === "done" ? (
                    <>
                      <span className="text-muted-foreground tabular-nums">{r.candles.toLocaleString("en-IN")} candles</span>
                      <Badge variant="outline" className="uppercase">{r.source}</Badge>
                      <Button variant="ghost" size="sm" className="h-6 px-2 ml-auto text-xs gap-1" onClick={() => exportOne(r.symbol)} aria-label={`Export ${r.symbol} as CSV`}>
                        <FileDown className="h-3 w-3" aria-hidden /> CSV
                      </Button>
                    </>
                  ) : (
                    <span className={r.status === "error" ? "text-bearish truncate" : "text-muted-foreground truncate"}>{r.error}</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex flex-col sm:flex-row gap-2">
          {isDownloading ? (
            <Button onClick={() => (cancelRef.current = true)} variant="outline" className="flex-1 gap-2" size="sm">
              <StopCircle className="h-3.5 w-3.5" aria-hidden /> Stop after this symbol
            </Button>
          ) : (
            <Button onClick={handleDownload} disabled={selectedCount === 0} className="flex-1 gap-2" size="sm">
              <Download className="h-3.5 w-3.5" aria-hidden />
              Download {selectedCount} symbols ({timeframeLabel}, {intervalLabel})
            </Button>
          )}
          <Button onClick={exportAll} variant="outline" size="sm" className="gap-2" disabled={isDownloading || doneCount === 0}>
            <FileDown className="h-3.5 w-3.5" aria-hidden /> Export all CSV
          </Button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5"><Database className="h-3 w-3" aria-hidden /> Stored in this browser (IndexedDB)</span>
          <span className="flex items-center gap-1.5"><Clock className="h-3 w-3" aria-hidden /> Dates and CSV times are in IST</span>
        </div>
      </CardContent>
    </Card>
  );
}
