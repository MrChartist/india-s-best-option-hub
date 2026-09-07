import { useState, useCallback, useEffect, useMemo, Suspense } from "react";
import { Outlet, useOutletContext } from "react-router-dom";
import { NavLink } from "@/components/NavLink";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Card, CardContent } from "@/components/ui/card";
import { Wifi, WifiOff, RefreshCw, Loader2, Keyboard } from "lucide-react";
import { useLiveOptionChain } from "@/hooks/useMarketData";
import { getMaxPain } from "@/lib/oiUtils";
import type { OptionData } from "@/lib/mockData";

const SYMBOL_STORAGE_KEY = "optionsdesk_oi_symbol";

function getInitialSymbol(): string {
  try {
    const saved = localStorage.getItem(SYMBOL_STORAGE_KEY);
    if (saved) return saved;
  } catch { /* ignore */ }
  return "NIFTY";
}

export interface OIAnalysisContext {
  symbol: string;
  chain: OptionData[];
  spotPrice: number;
  stepSize: number;
  lotSize: number;
  isLive: boolean;
  afterHours: boolean;
  hasData: boolean;
  maxPain: number;
  expiry: string;
}

/** Sub-pages read the shared symbol + live chain via this instead of re-fetching. */
export function useOIAnalysisContext() {
  return useOutletContext<OIAnalysisContext>();
}

// Splits what used to be one 750-line, 11-tab page into focused sections.
// IV Percentile / IV Term Structure / Gamma Exposure were pulled — deferred to
// a future version — so there's no "IV & Gamma" section here for now.
const SUB_NAV = [
  { title: "Overview", url: "/oi-analysis", end: true },
  { title: "Trending OI", url: "/oi-analysis/trending-oi", end: false },
  { title: "Strike Analysis", url: "/oi-analysis/strike-analysis", end: false },
  { title: "Delta Tracker", url: "/oi-analysis/delta-tracker", end: false },
];

export default function OIAnalysisLayout() {
  // The page-transition wrapper in DashboardLayout keys on pathname, so this layout
  // remounts on every sub-nav click — plain useState wouldn't survive that. Persist
  // to localStorage instead so the chosen symbol carries across Overview/Trending OI/etc.
  const [symbol, setSymbolState] = useState<string>(getInitialSymbol);
  const setSymbol = useCallback((next: string) => {
    setSymbolState(next);
    try { localStorage.setItem(SYMBOL_STORAGE_KEY, next); } catch { /* ignore */ }
  }, []);

  const { data: liveData, refetch, isLoading } = useLiveOptionChain(symbol);
  const chain = useMemo(() => liveData?.chain ?? [], [liveData]);
  const spotPrice = liveData?.spotPrice ?? 0;
  const stepSize = liveData?.stepSize ?? 50;
  const lotSize = liveData?.lotSize ?? 25;
  const isLive = liveData?.isLive ?? false;
  const afterHours = liveData?.afterHours ?? false;
  const expiry = liveData?.expiries?.[0]?.value ?? "";
  const hasData = chain.length > 0;
  const handleRefetch = useCallback(() => refetch(), [refetch]);
  const maxPain = useMemo(() => getMaxPain(chain), [chain]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key.toLowerCase() === "r" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        handleRefetch();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleRefetch]);

  const context: OIAnalysisContext = { symbol, chain, spotPrice, stepSize, lotSize, isLive, afterHours, hasData, maxPain, expiry };

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border/80 bg-card/90 px-4 py-3 shadow-card">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">OI <span className="font-serif italic font-medium">Analysis</span></h1>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Badge variant="outline" className={`gap-1 text-xs ${isLive ? "border-bullish text-bullish" : afterHours ? "border-warning/50 text-warning" : "border-destructive/50 text-destructive"}`}>
                {isLive ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
                {isLive ? "LIVE" : afterHours ? "CLOSED" : "OFFLINE"}
              </Badge>
              {(isLive || afterHours) && spotPrice > 0 && (
                <span className="text-xs font-mono text-muted-foreground">
                  Spot: <span className="text-foreground font-medium">{spotPrice.toLocaleString("en-IN")}</span>
                  {maxPain > 0 && <> · Max Pain: <span className="text-warning font-medium">{maxPain.toLocaleString("en-IN")}</span></>}
                  {afterHours && <span className="text-warning/60 ml-1">(Last Close)</span>}
                </span>
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 lg:justify-end">
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground transition-colors hover:bg-primary/5 hover:text-primary" title="Keyboard Shortcuts">
                  <kbd className="rounded border border-border/60 bg-background/80 px-1.5 py-0.5 font-mono text-xs font-semibold shadow-sm">?</kbd>
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-64 p-4" align="end">
                <p className="text-xs font-semibold text-muted-foreground mb-3 uppercase tracking-wider flex items-center gap-2">
                  <Keyboard className="h-3.5 w-3.5" />
                  Keyboard Shortcuts
                </p>
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between items-center"><span className="text-muted-foreground">Refresh Data</span><kbd className="px-1.5 py-0.5 rounded bg-muted border font-mono">R</kbd></div>
                  <div className="flex justify-between items-center"><span className="text-muted-foreground">Command Palette</span><kbd className="px-1.5 py-0.5 rounded bg-muted border font-mono">/</kbd></div>
                </div>
              </PopoverContent>
            </Popover>

            <Button variant="outline" size="sm" className="h-8 gap-1.5 bg-background/70 transition-colors hover:border-primary/50 hover:text-primary" onClick={handleRefetch} disabled={isLoading}>
              {isLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              <span className="text-xs">Refresh</span>
            </Button>
            <Select value={symbol} onValueChange={setSymbol}>
              <SelectTrigger className="h-8 w-[150px] bg-background/70 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="NIFTY">NIFTY</SelectItem>
                <SelectItem value="BANKNIFTY">BANKNIFTY</SelectItem>
                <SelectItem value="FINNIFTY">FINNIFTY</SelectItem>
                <SelectItem value="MIDCPNIFTY">MIDCPNIFTY</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Sub-nav between the four OI Analysis sections */}
        <div className="mt-3 flex flex-wrap gap-1 border-t border-border/60 pt-3">
          {SUB_NAV.map(item => (
            <NavLink
              key={item.url}
              to={item.url}
              end={item.end}
              className="rounded-md px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
              activeClassName="bg-primary/10 text-primary font-semibold shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.16)]"
            >
              {item.title}
            </NavLink>
          ))}
        </div>
      </div>

      {afterHours && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-warning/10 border border-warning/20 text-warning">
          <WifiOff className="h-4 w-4 shrink-0" />
          <p className="text-xs font-medium">
            Market Closed — {hasData ? "Showing last available OI data from closing session" : "No cached data available. Data will populate when market opens."}
          </p>
        </div>
      )}

      {!hasData && !isLoading && !afterHours && (
        <Card className="border-dashed border-border/50 bg-card/30">
          <CardContent className="py-12 space-y-5">
            <div className="text-center">
              <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-muted/50 mb-3 animate-pulse">
                <WifiOff className="h-7 w-7 text-muted-foreground/40" />
              </div>
              <p className="text-base font-semibold text-foreground">Waiting for OI Analysis Data</p>
              <p className="text-xs text-muted-foreground mt-1.5 max-w-md mx-auto leading-relaxed">
                Data refreshes automatically during market hours. Check that the proxy server is running on port <code className="font-mono text-primary/70 bg-primary/10 px-1 rounded">4002</code>.
              </p>
            </div>
            <div className="flex items-end justify-center gap-1.5 h-[100px] px-8">
              {[35, 60, 45, 80, 55, 70, 40, 65, 50, 75, 38, 62, 48, 72, 42].map((h, i) => (
                <div
                  key={i}
                  className="flex-1 rounded-t-sm animate-pulse"
                  style={{
                    height: `${h}%`,
                    backgroundColor: i < 7 ? 'hsl(var(--bearish) / 0.15)' : 'hsl(var(--bullish) / 0.15)',
                    animationDelay: `${i * 80}ms`,
                  }}
                />
              ))}
            </div>
            <div className="flex justify-center gap-6 text-xs text-muted-foreground/50">
              <div className="flex items-center gap-1.5">
                <div className="w-1.5 h-1.5 rounded-full bg-bullish/40" />
                NSE: 09:15 — 15:30 IST
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-1.5 h-1.5 rounded-full bg-primary/40" />
                Auto-refresh: Every 3s
              </div>
            </div>
            <div className="text-center pt-2">
              <Button variant="outline" size="sm" className="gap-1.5 hover:text-primary hover:border-primary/50 transition-colors" onClick={handleRefetch}>
                <RefreshCw className="h-3.5 w-3.5" /> Retry Connection
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {isLoading && !isLive && (
        <Card>
          <CardContent className="py-12 text-center">
            <Loader2 className="h-8 w-8 text-primary animate-spin mx-auto mb-3" />
            <p className="text-sm font-medium text-muted-foreground">Loading Option Chain...</p>
          </CardContent>
        </Card>
      )}

      <Suspense fallback={
        <div className="py-16 text-center">
          <Loader2 className="h-6 w-6 text-primary animate-spin mx-auto" />
        </div>
      }>
        <Outlet context={context} />
      </Suspense>
    </div>
  );
}
