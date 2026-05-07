import { useState, useCallback, useMemo } from "react";
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
  Download, Loader2, CheckCircle2, AlertCircle, Search, CandlestickChart,
  FileDown, Clock, BarChart3, TrendingUp, Database, XCircle, CheckSquare, Square,
} from "lucide-react";
import { fetchHistoricalCandles } from "@/lib/marketApi";
import {
  saveCandleHistory, setMetadata,
  type CandleHistory, type CandleData,
} from "@/lib/localDatabase";

// ── All F&O Stocks + Indices ──
const ALL_SYMBOLS: { symbol: string; securityId: string; segment: string; instrument: string; category: "Index" | "F&O Stock" }[] = [
  // Indices
  { symbol: "NIFTY", securityId: "13", segment: "IDX_I", instrument: "INDEX", category: "Index" },
  { symbol: "BANKNIFTY", securityId: "25", segment: "IDX_I", instrument: "INDEX", category: "Index" },
  { symbol: "FINNIFTY", securityId: "27", segment: "IDX_I", instrument: "INDEX", category: "Index" },
  { symbol: "MIDCPNIFTY", securityId: "442", segment: "IDX_I", instrument: "INDEX", category: "Index" },
  { symbol: "INDIAVIX", securityId: "26", segment: "IDX_I", instrument: "INDEX", category: "Index" },
  { symbol: "SENSEX", securityId: "1", segment: "IDX_I", instrument: "INDEX", category: "Index" },
  // Top F&O Stocks
  { symbol: "RELIANCE", securityId: "2885", segment: "NSE_EQ", instrument: "EQUITY", category: "F&O Stock" },
  { symbol: "TCS", securityId: "11536", segment: "NSE_EQ", instrument: "EQUITY", category: "F&O Stock" },
  { symbol: "HDFCBANK", securityId: "1333", segment: "NSE_EQ", instrument: "EQUITY", category: "F&O Stock" },
  { symbol: "INFY", securityId: "1594", segment: "NSE_EQ", instrument: "EQUITY", category: "F&O Stock" },
  { symbol: "ICICIBANK", securityId: "4963", segment: "NSE_EQ", instrument: "EQUITY", category: "F&O Stock" },
  { symbol: "SBIN", securityId: "3045", segment: "NSE_EQ", instrument: "EQUITY", category: "F&O Stock" },
  { symbol: "BHARTIARTL", securityId: "10604", segment: "NSE_EQ", instrument: "EQUITY", category: "F&O Stock" },
  { symbol: "ITC", securityId: "1660", segment: "NSE_EQ", instrument: "EQUITY", category: "F&O Stock" },
  { symbol: "KOTAKBANK", securityId: "1922", segment: "NSE_EQ", instrument: "EQUITY", category: "F&O Stock" },
  { symbol: "LT", securityId: "11483", segment: "NSE_EQ", instrument: "EQUITY", category: "F&O Stock" },
  { symbol: "AXISBANK", securityId: "5900", segment: "NSE_EQ", instrument: "EQUITY", category: "F&O Stock" },
  { symbol: "HINDUNILVR", securityId: "1394", segment: "NSE_EQ", instrument: "EQUITY", category: "F&O Stock" },
  { symbol: "TATAMOTORS", securityId: "3456", segment: "NSE_EQ", instrument: "EQUITY", category: "F&O Stock" },
  { symbol: "TATASTEEL", securityId: "3499", segment: "NSE_EQ", instrument: "EQUITY", category: "F&O Stock" },
  { symbol: "BAJFINANCE", securityId: "317", segment: "NSE_EQ", instrument: "EQUITY", category: "F&O Stock" },
  { symbol: "SUNPHARMA", securityId: "3351", segment: "NSE_EQ", instrument: "EQUITY", category: "F&O Stock" },
  { symbol: "MARUTI", securityId: "10999", segment: "NSE_EQ", instrument: "EQUITY", category: "F&O Stock" },
  { symbol: "TITAN", securityId: "3506", segment: "NSE_EQ", instrument: "EQUITY", category: "F&O Stock" },
  { symbol: "WIPRO", securityId: "3787", segment: "NSE_EQ", instrument: "EQUITY", category: "F&O Stock" },
  { symbol: "HCLTECH", securityId: "7229", segment: "NSE_EQ", instrument: "EQUITY", category: "F&O Stock" },
  { symbol: "NTPC", securityId: "11630", segment: "NSE_EQ", instrument: "EQUITY", category: "F&O Stock" },
  { symbol: "POWERGRID", securityId: "14977", segment: "NSE_EQ", instrument: "EQUITY", category: "F&O Stock" },
  { symbol: "ONGC", securityId: "2475", segment: "NSE_EQ", instrument: "EQUITY", category: "F&O Stock" },
  { symbol: "JSWSTEEL", securityId: "11723", segment: "NSE_EQ", instrument: "EQUITY", category: "F&O Stock" },
  { symbol: "ASIANPAINT", securityId: "236", segment: "NSE_EQ", instrument: "EQUITY", category: "F&O Stock" },
  { symbol: "ADANIPORTS", securityId: "15083", segment: "NSE_EQ", instrument: "EQUITY", category: "F&O Stock" },
  { symbol: "ULTRACEMCO", securityId: "11532", segment: "NSE_EQ", instrument: "EQUITY", category: "F&O Stock" },
  { symbol: "TECHM", securityId: "13538", segment: "NSE_EQ", instrument: "EQUITY", category: "F&O Stock" },
  { symbol: "INDUSINDBK", securityId: "5258", segment: "NSE_EQ", instrument: "EQUITY", category: "F&O Stock" },
  { symbol: "DRREDDY", securityId: "881", segment: "NSE_EQ", instrument: "EQUITY", category: "F&O Stock" },
  { symbol: "CIPLA", securityId: "694", segment: "NSE_EQ", instrument: "EQUITY", category: "F&O Stock" },
  { symbol: "EICHERMOT", securityId: "910", segment: "NSE_EQ", instrument: "EQUITY", category: "F&O Stock" },
  { symbol: "DIVISLAB", securityId: "10940", segment: "NSE_EQ", instrument: "EQUITY", category: "F&O Stock" },
  { symbol: "BPCL", securityId: "526", segment: "NSE_EQ", instrument: "EQUITY", category: "F&O Stock" },
  { symbol: "COALINDIA", securityId: "20374", segment: "NSE_EQ", instrument: "EQUITY", category: "F&O Stock" },
  { symbol: "APOLLOHOSP", securityId: "157", segment: "NSE_EQ", instrument: "EQUITY", category: "F&O Stock" },
  { symbol: "HEROMOTOCO", securityId: "1348", segment: "NSE_EQ", instrument: "EQUITY", category: "F&O Stock" },
  { symbol: "BRITANNIA", securityId: "547", segment: "NSE_EQ", instrument: "EQUITY", category: "F&O Stock" },
  { symbol: "NESTLEIND", securityId: "17963", segment: "NSE_EQ", instrument: "EQUITY", category: "F&O Stock" },
  { symbol: "HINDALCO", securityId: "1363", segment: "NSE_EQ", instrument: "EQUITY", category: "F&O Stock" },
  { symbol: "VEDL", securityId: "3063", segment: "NSE_EQ", instrument: "EQUITY", category: "F&O Stock" },
  { symbol: "BANKBARODA", securityId: "4668", segment: "NSE_EQ", instrument: "EQUITY", category: "F&O Stock" },
  { symbol: "PNB", securityId: "10666", segment: "NSE_EQ", instrument: "EQUITY", category: "F&O Stock" },
  { symbol: "DLF", securityId: "14732", segment: "NSE_EQ", instrument: "EQUITY", category: "F&O Stock" },
  { symbol: "TRENT", securityId: "1964", segment: "NSE_EQ", instrument: "EQUITY", category: "F&O Stock" },
];

// Timeframe → date range mapping
const TIMEFRAMES = [
  { label: "1 Day", value: "1D", days: 2 },
  { label: "1 Week", value: "1W", days: 10 },
  { label: "1 Month", value: "1M", days: 35 },
  { label: "3 Months", value: "3M", days: 95 },
  { label: "6 Months", value: "6M", days: 185 },
  { label: "1 Year", value: "1Y", days: 370 },
];

// Interval → Dhan API interval code
const INTERVALS = [
  { label: "1 Min", value: "1", minTimeframe: "1D" },
  { label: "5 Min", value: "5", minTimeframe: "1D" },
  { label: "15 Min", value: "15", minTimeframe: "1W" },
  { label: "1 Hour", value: "60", minTimeframe: "1M" },
  { label: "Daily", value: "D", minTimeframe: "1M" },
];

type SymbolStatus = "pending" | "downloading" | "done" | "error" | "skipped";

interface DownloadResult {
  symbol: string;
  status: SymbolStatus;
  candles: number;
  error?: string;
}

export function ChartDataDownloader() {
  const [search, setSearch] = useState("");
  const [selectedSymbols, setSelectedSymbols] = useState<Set<string>>(new Set(ALL_SYMBOLS.map(s => s.symbol)));
  const [timeframe, setTimeframe] = useState("3M");
  const [interval, setInterval] = useState("D");
  const [isDownloading, setIsDownloading] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [results, setResults] = useState<DownloadResult[]>([]);
  const [currentSymbol, setCurrentSymbol] = useState("");

  // Filter symbols by search
  const filteredSymbols = useMemo(() => {
    if (!search) return ALL_SYMBOLS;
    const q = search.toUpperCase();
    return ALL_SYMBOLS.filter(s => s.symbol.includes(q) || s.category.toUpperCase().includes(q));
  }, [search]);

  const selectedCount = selectedSymbols.size;
  const totalSymbols = ALL_SYMBOLS.length;

  const toggleSymbol = (symbol: string) => {
    setSelectedSymbols(prev => {
      const next = new Set(prev);
      if (next.has(symbol)) next.delete(symbol);
      else next.add(symbol);
      return next;
    });
  };

  const selectAll = () => setSelectedSymbols(new Set(ALL_SYMBOLS.map(s => s.symbol)));
  const deselectAll = () => setSelectedSymbols(new Set());
  const selectIndices = () => {
    const indices = ALL_SYMBOLS.filter(s => s.category === "Index").map(s => s.symbol);
    setSelectedSymbols(new Set(indices));
  };

  const getDateRange = () => {
    const tf = TIMEFRAMES.find(t => t.value === timeframe);
    const days = tf?.days || 95;
    const now = new Date();
    const from = new Date(now);
    from.setDate(from.getDate() - days);
    return {
      fromDate: from.toISOString().split("T")[0],
      toDate: now.toISOString().split("T")[0],
    };
  };

  // Export single symbol as CSV
  const exportCSV = useCallback((symbol: string, candles: CandleData[]) => {
    const header = "Date,Time,Open,High,Low,Close,Volume\n";
    const rows = candles.map(c => {
      const d = new Date(c.timestamp);
      return `${d.toLocaleDateString("en-IN")},${d.toLocaleTimeString("en-IN", { hour12: false })},${c.open},${c.high},${c.low},${c.close},${c.volume}`;
    }).join("\n");

    const blob = new Blob([header + rows], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${symbol}_${timeframe}_${interval}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [timeframe, interval]);

  // Batch download
  const handleDownload = async () => {
    const symbols = ALL_SYMBOLS.filter(s => selectedSymbols.has(s.symbol));
    if (symbols.length === 0) {
      toast.error("Select at least one symbol");
      return;
    }

    setIsDownloading(true);
    setResults([]);
    setCurrentIndex(0);

    const { fromDate, toDate } = getDateRange();
    // Send "D" as-is — the proxy will route to /charts/historical for daily candles
    const dhanInterval = interval;
    const newResults: DownloadResult[] = [];

    for (let i = 0; i < symbols.length; i++) {
      const sym = symbols[i];
      setCurrentIndex(i + 1);
      setCurrentSymbol(sym.symbol);

      try {
        const result = await fetchHistoricalCandles(
          sym.securityId,
          sym.segment,
          sym.instrument,
          dhanInterval,
          fromDate,
          toDate,
        );

        const rawData = result?.data || result;
        let candleCount = 0;

        if (rawData?.close && Array.isArray(rawData.close) && rawData.close.length > 0) {
          const candles: CandleData[] = rawData.close.map((_: number, idx: number) => ({
            timestamp: (rawData.timestamp?.[idx] || rawData.start_Time?.[idx] || 0) * 1000,
            open: rawData.open?.[idx] || rawData.close[idx],
            high: rawData.high?.[idx] || rawData.close[idx],
            low: rawData.low?.[idx] || rawData.close[idx],
            close: rawData.close[idx],
            volume: rawData.volume?.[idx] || 0,
            oi: rawData.oi?.[idx],
          }));

          candleCount = candles.length;

          // Store in IndexedDB
          const history: CandleHistory = {
            securityId: sym.securityId,
            symbol: sym.symbol,
            exchangeSegment: sym.segment,
            interval: `${interval}_${timeframe}`,
            candles,
            lastUpdated: Date.now(),
          };
          await saveCandleHistory(history);

          newResults.push({ symbol: sym.symbol, status: "done", candles: candleCount });
        } else {
          newResults.push({ symbol: sym.symbol, status: "skipped", candles: 0, error: "No data returned" });
        }
      } catch (err: any) {
        newResults.push({ symbol: sym.symbol, status: "error", candles: 0, error: err.message || "Fetch failed" });
      }

      setResults([...newResults]);

      // Rate limit: 300ms between requests
      if (i < symbols.length - 1) {
        await new Promise(r => setTimeout(r, 350));
      }
    }

    await setMetadata("lastChartDownload", new Date().toISOString());
    
    const successCount = newResults.filter(r => r.status === "done").length;
    const totalCandles = newResults.reduce((s, r) => s + r.candles, 0);
    toast.success(`Downloaded ${successCount}/${symbols.length} symbols — ${totalCandles.toLocaleString()} candles stored`, { duration: 6000 });
    setIsDownloading(false);
    setCurrentSymbol("");
  };

  // Export all results as combined CSV
  const handleExportAll = () => {
    const successResults = results.filter(r => r.status === "done");
    if (successResults.length === 0) {
      toast.error("No data to export. Run download first.");
      return;
    }
    toast.info(`Export requires downloading from IndexedDB — use per-symbol export for now.`);
  };

  const progressPct = isDownloading ? (currentIndex / Math.max(selectedCount, 1)) * 100 : 0;
  const doneCount = results.filter(r => r.status === "done").length;
  const errorCount = results.filter(r => r.status === "error").length;

  return (
    <Card className="border-primary/20 bg-gradient-to-br from-primary/[0.02] to-transparent">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <CandlestickChart className="h-5 w-5 text-primary" />
          Chart Data Downloader
          <Badge variant="outline" className="text-[9px] h-5 px-1.5 ml-auto">
            {selectedCount}/{totalSymbols} selected
          </Badge>
        </CardTitle>
        <CardDescription className="text-xs">
          Download OHLCV chart data for all F&O stocks and indices. Select timeframe and interval, then batch download to local database for offline charting.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* ── Timeframe & Interval Selectors ── */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-[10px] text-muted-foreground flex items-center gap-1">
              <Clock className="h-3 w-3" /> Timeframe (Date Range)
            </Label>
            <Select value={timeframe} onValueChange={setTimeframe} disabled={isDownloading}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIMEFRAMES.map(tf => (
                  <SelectItem key={tf.value} value={tf.value} className="text-xs">{tf.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-[10px] text-muted-foreground flex items-center gap-1">
              <BarChart3 className="h-3 w-3" /> Candle Interval
            </Label>
            <Select value={interval} onValueChange={setInterval} disabled={isDownloading}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {INTERVALS.map(iv => (
                  <SelectItem key={iv.value} value={iv.value} className="text-xs">{iv.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* ── Symbol Selection ── */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Search symbols..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="h-7 text-xs pl-7"
                disabled={isDownloading}
              />
            </div>
            <Button variant="outline" size="sm" className="h-7 text-[10px] gap-1" onClick={selectAll} disabled={isDownloading}>
              <CheckSquare className="h-3 w-3" /> All
            </Button>
            <Button variant="outline" size="sm" className="h-7 text-[10px] gap-1" onClick={selectIndices} disabled={isDownloading}>
              <TrendingUp className="h-3 w-3" /> Indices
            </Button>
            <Button variant="outline" size="sm" className="h-7 text-[10px] gap-1" onClick={deselectAll} disabled={isDownloading}>
              <Square className="h-3 w-3" /> None
            </Button>
          </div>

          <ScrollArea className="h-[180px] rounded-md border p-2">
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-1">
              {filteredSymbols.map(sym => {
                const result = results.find(r => r.symbol === sym.symbol);
                const statusIcon = result?.status === "done"
                  ? <CheckCircle2 className="h-3 w-3 text-bullish" />
                  : result?.status === "error"
                  ? <XCircle className="h-3 w-3 text-bearish" />
                  : result?.status === "downloading"
                  ? <Loader2 className="h-3 w-3 animate-spin text-primary" />
                  : null;

                return (
                  <label
                    key={sym.symbol}
                    className={`flex items-center gap-1.5 px-2 py-1 rounded text-[11px] cursor-pointer transition-colors border ${
                      selectedSymbols.has(sym.symbol) 
                        ? "bg-primary/5 border-primary/20 text-foreground" 
                        : "border-transparent text-muted-foreground hover:text-foreground"
                    } ${currentSymbol === sym.symbol ? "ring-1 ring-primary" : ""}`}
                  >
                    <Checkbox
                      checked={selectedSymbols.has(sym.symbol)}
                      onCheckedChange={() => toggleSymbol(sym.symbol)}
                      disabled={isDownloading}
                      className="h-3 w-3"
                    />
                    <span className="font-mono font-medium truncate">{sym.symbol}</span>
                    {sym.category === "Index" && (
                      <Badge variant="outline" className="text-[7px] h-3 px-1 shrink-0">IDX</Badge>
                    )}
                    {statusIcon}
                  </label>
                );
              })}
            </div>
          </ScrollArea>
        </div>

        {/* ── Progress ── */}
        {isDownloading && (
          <div className="space-y-2 p-3 rounded-lg bg-card border animate-in fade-in">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium flex items-center gap-1.5">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                Downloading {currentSymbol}...
              </span>
              <span className="text-xs text-muted-foreground font-mono">
                {currentIndex}/{selectedCount} — {Math.round(progressPct)}%
              </span>
            </div>
            <Progress value={progressPct} className="h-1.5" />
            <p className="text-xs text-muted-foreground">
              ✅ {doneCount} done · ❌ {errorCount} failed · ⏳ {selectedCount - currentIndex} remaining
            </p>
          </div>
        )}

        {/* ── Results Summary ── */}
        {!isDownloading && results.length > 0 && (
          <div className="space-y-2 p-3 rounded-lg bg-card border">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium flex items-center gap-1.5">
                <CheckCircle2 className="h-3.5 w-3.5 text-bullish" />
                Download Complete
              </span>
              <Badge variant="outline" className="text-[10px]">
                {doneCount} success · {errorCount} errors · {results.reduce((s, r) => s + r.candles, 0).toLocaleString()} candles
              </Badge>
            </div>
            {errorCount > 0 && (
              <div className="text-xs text-bearish">
                Failed: {results.filter(r => r.status === "error").map(r => r.symbol).join(", ")}
              </div>
            )}
          </div>
        )}

        {/* ── Action Buttons ── */}
        <div className="flex gap-2">
          <Button
            onClick={handleDownload}
            disabled={isDownloading || selectedCount === 0}
            className="flex-1 gap-2"
            size="sm"
          >
            {isDownloading ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Downloading... ({currentIndex}/{selectedCount})
              </>
            ) : (
              <>
                <Download className="h-3.5 w-3.5" />
                Download {selectedCount} Symbols ({timeframe} / {INTERVALS.find(i => i.value === interval)?.label})
              </>
            )}
          </Button>
        </div>

        {/* ── Info ── */}
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">Download Details:</p>
          <div className="grid grid-cols-2 gap-1.5">
            {[
              { icon: <Database className="h-2.5 w-2.5" />, text: "Stored in IndexedDB (offline access)" },
              { icon: <CandlestickChart className="h-2.5 w-2.5" />, text: `${TIMEFRAMES.find(t => t.value === timeframe)?.label} of OHLCV candles` },
              { icon: <BarChart3 className="h-2.5 w-2.5" />, text: `${INTERVALS.find(i => i.value === interval)?.label} interval candles` },
              { icon: <FileDown className="h-2.5 w-2.5" />, text: "Export individual symbols as CSV" },
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
