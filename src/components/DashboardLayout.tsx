import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { Outlet } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { CommandPalette } from "@/components/CommandPalette";
import { AlertSystem } from "@/components/AlertSystem";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { useLiveIndices, useMarketStatus, useAllIndices } from "@/hooks/useMarketData";
import { useQueryClient } from "@tanstack/react-query";
import { getActiveBroker } from "@/lib/brokerConfig";
import { Search, Bell, Timer, RefreshCw, Wifi, WifiOff, Plane, Settings, Zap, ExternalLink } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";

export default function DashboardLayout() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchOpen, setSearchOpen] = useState(false);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [timeToExpiry, setTimeToExpiry] = useState("");
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Live data hooks
  const { data: indicesResult } = useLiveIndices();
  const { data: marketResult } = useMarketStatus();
  const { data: allIndicesData } = useAllIndices();

  const indices = indicesResult?.data || [];
  const isLiveData = indicesResult?.isLive || false;
  const isMarketOpen = marketResult?.isOpen || false;
  const giftNifty = marketResult?.giftNifty || null;
  const liveVix = allIndicesData?.vix;

  // Check broker config
  const activeBroker = getActiveBroker();
  const hasDhanKeys = activeBroker?.brokerId === "dhan" && activeBroker.values.clientId && activeBroker.values.accessToken;

  useKeyboardShortcuts({
    onToggleSearch: () => setSearchOpen(true),
    onToggleAlerts: () => setAlertsOpen(true),
  });

  // Quick refresh — invalidate ALL queries
  const handleQuickRefresh = useCallback(async () => {
    setIsRefreshing(true);
    await queryClient.invalidateQueries();
    setLastRefresh(new Date());
    setTimeout(() => setIsRefreshing(false), 800);
  }, [queryClient]);

  // Keyboard shortcut: R for refresh
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "r" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const target = e.target as HTMLElement;
        if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;
        handleQuickRefresh();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleQuickRefresh]);

  useEffect(() => {
    const updateTimer = () => {
      const now = new Date();
      const target = new Date(now);
      target.setHours(15, 30, 0, 0);
      const dayOfWeek = now.getDay();
      const daysUntilThursday = ((4 - dayOfWeek) + 7) % 7 || 7;
      if (!(dayOfWeek === 4 && now < target)) {
        target.setDate(target.getDate() + daysUntilThursday);
      }
      const diff = target.getTime() - now.getTime();
      const days = Math.floor(diff / (1000 * 60 * 60 * 24));
      const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      setTimeToExpiry(`${days}d ${hours}h ${mins}m`);
    };
    updateTimer();
    const interval = setInterval(updateTimer, 60000);
    return () => clearInterval(interval);
  }, []);

  const now = new Date();

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-background">
        <AppSidebar />
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Top Bar */}
          <header className="h-9 flex items-center border-b border-border px-2 sm:px-3 shrink-0 bg-card/60 glass">
            <SidebarTrigger className="mr-2 h-6 w-6" />

            {/* Live Ticker — real-time from useLiveIndices */}
            <div className="flex items-center gap-4 overflow-hidden flex-1 mr-2">
              {indices.slice(0, 4).map((idx: any) => {
                const pos = idx.change >= 0;
                return (
                  <div key={idx.symbol} className="flex items-center gap-1.5 shrink-0">
                    <span className="text-2xs text-muted-foreground font-medium uppercase tracking-wider">{idx.symbol}</span>
                    <span className="text-[11px] font-mono font-semibold tabular-nums">{idx.ltp.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</span>
                    <span className={`text-2xs font-mono font-medium tabular-nums ${pos ? "text-bullish" : "text-bearish"}`}>
                      {pos ? "+" : ""}{idx.changePercent.toFixed(2)}%
                    </span>
                  </div>
                );
              })}

              {/* VIX */}
              <div className="flex items-center gap-1.5 shrink-0">
                <span className="text-2xs text-muted-foreground font-medium uppercase tracking-wider">VIX</span>
                <span className={`text-[11px] font-mono font-semibold tabular-nums ${(liveVix?.changePercent ?? 0) >= 0 ? "text-bearish" : "text-bullish"}`}>
                  {liveVix ? liveVix.value.toFixed(2) : "--"}
                </span>
                {liveVix && (
                  <span className={`text-2xs font-mono font-medium tabular-nums ${liveVix.changePercent >= 0 ? "text-bearish" : "text-bullish"}`}>
                    {liveVix.changePercent >= 0 ? "+" : ""}{liveVix.changePercent.toFixed(2)}%
                  </span>
                )}
              </div>

              {/* GIFT Nifty — shown when available */}
              {giftNifty && giftNifty.lastPrice > 0 && (
                <div className="flex items-center gap-1.5 shrink-0 px-1.5 py-0.5 rounded bg-primary/5 border border-primary/10">
                  <Plane className="h-2.5 w-2.5 text-primary" />
                  <span className="text-2xs text-primary font-medium uppercase tracking-wider">GIFT</span>
                  <span className="text-[11px] font-mono font-semibold tabular-nums">{giftNifty.lastPrice.toLocaleString("en-IN")}</span>
                  <span className={`text-2xs font-mono font-medium tabular-nums ${giftNifty.change >= 0 ? "text-bullish" : "text-bearish"}`}>
                    {giftNifty.change >= 0 ? "+" : ""}{giftNifty.change.toFixed(0)}
                  </span>
                </div>
              )}
            </div>

            {/* Controls */}
            <div className="flex items-center gap-1 shrink-0">
              {/* Data source badge — CLICKABLE with status popover */}
              <Popover>
                <PopoverTrigger asChild>
                  <button className={`flex items-center gap-1 h-5 px-1.5 rounded-md border text-[9px] font-medium transition-all cursor-pointer hover:opacity-80 ${
                    isLiveData
                      ? "border-bullish/50 text-bullish bg-bullish/5"
                      : "border-muted-foreground/30 text-muted-foreground bg-muted/30"
                  }`}>
                    {isLiveData ? <Wifi className="h-2.5 w-2.5" /> : <WifiOff className="h-2.5 w-2.5" />}
                    {isLiveData ? "LIVE" : "OFFLINE"}
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-64 p-3" align="end">
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <div className={`h-2.5 w-2.5 rounded-full ${isLiveData ? "bg-bullish animate-pulse" : "bg-muted-foreground/50"}`} />
                      <p className="text-xs font-semibold">{isLiveData ? "Live Data Connected" : "Data Unavailable"}</p>
                    </div>

                    <div className="space-y-1.5 text-[10px]">
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Proxy Server</span>
                        <Badge variant="outline" className={`text-[9px] h-4 ${isLiveData ? "border-bullish/50 text-bullish" : "border-destructive/50 text-destructive"}`}>
                          {isLiveData ? "Connected" : "Offline"}
                        </Badge>
                      </div>

                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Dhan API Keys</span>
                        <Badge variant="outline" className={`text-[9px] h-4 ${hasDhanKeys ? "border-bullish/50 text-bullish" : "border-warning/50 text-warning"}`}>
                          {hasDhanKeys ? "Configured" : "Not Set"}
                        </Badge>
                      </div>

                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Data Source</span>
                        <span className="font-medium">{isLiveData ? "Dhan / NSE / TradingView" : "Offline"}</span>
                      </div>

                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Last Refresh</span>
                        <span className="font-mono">{lastRefresh.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
                      </div>
                    </div>

                    {!hasDhanKeys && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full h-7 text-[10px] gap-1.5"
                        onClick={() => navigate("/broker-settings")}
                      >
                        <Settings className="h-3 w-3" />
                        Configure Broker Keys
                        <ExternalLink className="h-2.5 w-2.5 ml-auto" />
                      </Button>
                    )}

                    {!isLiveData && (
                      <p className="text-[9px] text-muted-foreground leading-relaxed">
                        Run <code className="bg-muted px-1 rounded text-[8px]">npm run dev</code> to start both Vite + proxy server, or configure Dhan API keys for live data.
                      </p>
                    )}
                  </div>
                </PopoverContent>
              </Popover>

              <div className="w-px h-4 bg-border mx-0.5" />

              {/* Quick Refresh */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className={`h-6 w-6 hover:bg-primary/5 ${isRefreshing ? "text-primary" : ""}`}
                    onClick={handleQuickRefresh}
                  >
                    <RefreshCw className={`h-3 w-3 ${isRefreshing ? "animate-spin" : ""}`} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">
                  Refresh All Data <kbd className="ml-1 text-2xs font-mono bg-muted px-1 rounded">R</kbd>
                </TooltipContent>
              </Tooltip>

              <div className="w-px h-4 bg-border mx-0.5" />

              {/* Expiry Timer */}
              <div className="flex items-center gap-1 px-1.5">
                <Timer className="h-2.5 w-2.5 text-warning" />
                <span className="text-2xs font-mono text-warning tabular-nums">{timeToExpiry}</span>
              </div>

              <div className="w-px h-4 bg-border mx-0.5" />

              {/* Search */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-6 w-6 hover:bg-primary/5" onClick={() => setSearchOpen(true)}>
                    <Search className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">Search <kbd className="ml-1 text-2xs font-mono bg-muted px-1 rounded">/</kbd></TooltipContent>
              </Tooltip>

              {/* Alerts */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-6 w-6 relative hover:bg-primary/5" onClick={() => setAlertsOpen(true)}>
                    <Bell className="h-3.5 w-3.5" />
                    <span className="absolute top-0.5 right-0.5 h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">Alerts</TooltipContent>
              </Tooltip>

              <div className="w-px h-4 bg-border mx-0.5" />

              {/* Market Status */}
              <div className="flex items-center gap-1.5">
                <div className="relative">
                  <span className={`block h-1.5 w-1.5 rounded-full ${isMarketOpen ? "bg-bullish" : "bg-muted-foreground/50"}`} />
                  {isMarketOpen && <span className="absolute inset-0 h-1.5 w-1.5 rounded-full bg-bullish animate-ping opacity-50" />}
                </div>
                <span className="text-2xs text-muted-foreground font-medium tracking-wide">
                  {isMarketOpen ? "LIVE" : "CLOSED"}
                </span>
              </div>
              <span className="text-2xs text-muted-foreground font-mono tabular-nums ml-1">
                {now.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
              </span>
            </div>
          </header>

          <main className="flex-1 overflow-auto p-2.5 sm:p-3 lg:p-4">
            <Outlet />
          </main>
        </div>
      </div>

      <CommandPalette open={searchOpen} onOpenChange={setSearchOpen} />
      <AlertSystem open={alertsOpen} onOpenChange={setAlertsOpen} />
    </SidebarProvider>
  );
}
