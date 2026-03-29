import { useState, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { useFnOStocks, useLiveIndices } from "@/hooks/useMarketData";
import { useWebSocketStatus } from "@/hooks/useWebSocket";
import { useNavigate } from "react-router-dom";
import { Search, Star, TrendingUp, TrendingDown, ExternalLink, Radio, Loader2, Plus, X } from "lucide-react";

const STORAGE_KEY = "optionsdesk_watchlist";
const DEFAULT_WATCHLIST = ["NIFTY", "BANKNIFTY", "RELIANCE", "TCS", "HDFCBANK", "INFY", "ICICIBANK", "SBIN", "TATAMOTORS", "BAJFINANCE", "ADANIENT", "LT", "KOTAKBANK", "ITC", "HINDUNILVR"];

function getSavedWatchlist(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : DEFAULT_WATCHLIST;
  } catch {
    return DEFAULT_WATCHLIST;
  }
}

function saveWatchlist(symbols: string[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(symbols));
}

export default function Watchlist() {
  const navigate = useNavigate();
  const [watchedSymbols, setWatchedSymbols] = useState<string[]>(() => getSavedWatchlist());
  const [search, setSearch] = useState("");
  const [addSymbol, setAddSymbol] = useState("");
  const { data: fnoData, isLoading } = useFnOStocks();
  const { data: indicesResult } = useLiveIndices();
  const wsConnected = useWebSocketStatus();

  const allStocks = fnoData?.allStocks || [];
  const indices = indicesResult?.data || [];
  const isLive = fnoData?.isLive || false;

  // Build watchlist rows from live F&O data + indices
  const watchlistRows = useMemo(() => {
    return watchedSymbols
      .map((sym) => {
        // Check F&O stocks first
        const stock = allStocks.find((s) => s.symbol === sym);
        if (stock) {
          return {
            symbol: stock.symbol,
            ltp: stock.ltp,
            change: stock.change,
            changePercent: stock.changePercent,
            open: stock.open,
            high: stock.high,
            low: stock.low,
            volume: stock.volume || 0,
            oi: stock.openInterest || 0,
            oiChange: stock.oiChange || 0,
            isLive: true,
          };
        }
        // Check indices (NIFTY, BANKNIFTY, etc.)
        const idx = indices.find((i: any) => i.symbol === sym);
        if (idx) {
          return {
            symbol: idx.symbol,
            ltp: idx.ltp,
            change: idx.change,
            changePercent: idx.changePercent,
            open: idx.open || idx.ltp,
            high: idx.high || idx.ltp,
            low: idx.low || idx.ltp,
            volume: 0,
            oi: 0,
            oiChange: 0,
            isLive: true,
          };
        }
        // Symbol not found — show placeholder
        return {
          symbol: sym,
          ltp: 0,
          change: 0,
          changePercent: 0,
          open: 0,
          high: 0,
          low: 0,
          volume: 0,
          oi: 0,
          oiChange: 0,
          isLive: false,
        };
      })
      .filter((row) => {
        if (!search) return true;
        return row.symbol.includes(search.toUpperCase());
      });
  }, [watchedSymbols, allStocks, indices, search]);

  // All available F&O symbols for autocomplete
  const availableSymbols = useMemo(() => {
    return allStocks
      .map((s) => s.symbol)
      .filter((sym) => !watchedSymbols.includes(sym))
      .sort();
  }, [allStocks, watchedSymbols]);

  const addToWatchlist = () => {
    const sym = addSymbol.toUpperCase().trim();
    if (sym && !watchedSymbols.includes(sym)) {
      const updated = [...watchedSymbols, sym];
      setWatchedSymbols(updated);
      saveWatchlist(updated);
      setAddSymbol("");
    }
  };

  const removeFromWatchlist = (sym: string) => {
    const updated = watchedSymbols.filter((s) => s !== sym);
    setWatchedSymbols(updated);
    saveWatchlist(updated);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            Watchlist
            {isLive && (
              <Badge variant="outline" className="text-[9px] h-5 px-1.5 border-bullish/30 text-bullish">
                <Radio className="h-2 w-2 mr-1 animate-pulse" />
                LIVE
              </Badge>
            )}
          </h1>
          <p className="text-sm text-muted-foreground">
            {watchedSymbols.length} symbols · {isLive ? "Real-time NSE data" : "Waiting for data..."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input placeholder="Filter..." value={search} onChange={e => setSearch(e.target.value)} className="pl-8 h-8 w-[140px] text-xs" />
          </div>
          <Input
            placeholder="Add symbol..."
            value={addSymbol}
            onChange={e => setAddSymbol(e.target.value)}
            onKeyDown={e => e.key === "Enter" && addToWatchlist()}
            className="h-8 w-[130px] text-xs"
            list="available-symbols"
          />
          <datalist id="available-symbols">
            {availableSymbols.slice(0, 20).map((sym) => (
              <option key={sym} value={sym} />
            ))}
          </datalist>
          <Button variant="outline" size="sm" className="h-8 text-xs gap-1" onClick={addToWatchlist}>
            <Plus className="h-3 w-3" /> Add
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-0 overflow-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-12 gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm">Loading live data...</span>
            </div>
          ) : (
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-card">
                <TableRow className="text-[10px]">
                  <TableHead className="w-8"></TableHead>
                  <TableHead>Symbol</TableHead>
                  <TableHead className="text-right">LTP</TableHead>
                  <TableHead className="text-right">Change</TableHead>
                  <TableHead className="text-right">Chg%</TableHead>
                  <TableHead className="text-right">Open</TableHead>
                  <TableHead className="text-right">High</TableHead>
                  <TableHead className="text-right">Low</TableHead>
                  <TableHead className="text-right">Volume</TableHead>
                  <TableHead className="text-right">OI</TableHead>
                  <TableHead className="text-right">OI Chg</TableHead>
                  <TableHead className="text-center">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {watchlistRows.map(w => (
                  <TableRow key={w.symbol} className="text-[11px] font-mono hover:bg-accent/50">
                    <TableCell>
                      <Star
                        className="h-3 w-3 text-warning fill-warning cursor-pointer hover:opacity-60 transition-opacity"
                        onClick={() => removeFromWatchlist(w.symbol)}
                      />
                    </TableCell>
                    <TableCell className="font-sans font-medium">{w.symbol}</TableCell>
                    <TableCell className="text-right">
                      {w.ltp > 0 ? `₹${w.ltp.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—"}
                    </TableCell>
                    <TableCell className={`text-right ${w.change >= 0 ? "text-bullish" : "text-bearish"}`}>
                      {w.ltp > 0 ? `${w.change >= 0 ? "+" : ""}${w.change.toFixed(2)}` : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      {w.ltp > 0 ? (
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${w.changePercent >= 0 ? "bg-bullish/10 text-bullish" : "bg-bearish/10 text-bearish"}`}>
                          {w.changePercent >= 0 ? "+" : ""}{w.changePercent.toFixed(2)}%
                        </span>
                      ) : "—"}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {w.open > 0 ? w.open.toLocaleString("en-IN", { maximumFractionDigits: 2 }) : "—"}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {w.high > 0 ? w.high.toLocaleString("en-IN", { maximumFractionDigits: 2 }) : "—"}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {w.low > 0 ? w.low.toLocaleString("en-IN", { maximumFractionDigits: 2 }) : "—"}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {w.volume > 0 ? `${(w.volume / 100000).toFixed(1)}L` : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      {w.oi > 0 ? `${(w.oi / 100000).toFixed(1)}L` : "—"}
                    </TableCell>
                    <TableCell className={`text-right ${(w.oiChange || 0) >= 0 ? "text-bullish" : "text-bearish"}`}>
                      {w.oiChange !== 0 ? `${w.oiChange >= 0 ? "+" : ""}${(w.oiChange / 100000).toFixed(1)}L` : "—"}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-center gap-1">
                        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => navigate(`/option-chain?symbol=${w.symbol}`)}>
                          <ExternalLink className="h-3 w-3" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-destructive" onClick={() => removeFromWatchlist(w.symbol)}>
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {watchlistRows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={12} className="text-center py-8 text-muted-foreground text-sm">
                      {search ? "No symbols match your filter" : "Add symbols to your watchlist to track them here"}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
