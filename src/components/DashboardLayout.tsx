import { useState, useEffect, useCallback, useMemo } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Bell, ExternalLink, Plane, RefreshCw, Search, Settings, Timer, Wifi, WifiOff } from "lucide-react";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { Button } from "@/components/ui/button";
import { StatusFooter } from "@/components/StatusFooter";
import { CommandPalette } from "@/components/CommandPalette";
import { AlertSystem } from "@/components/AlertSystem";
import { AlertEngine } from "@/components/AlertEngine";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { useAllIndices, useExpiryList, useLiveIndices, useMarketStatus } from "@/hooks/useMarketData";
import { getBrokerInfo, getDhanCredentials, useBrokerConfig } from "@/lib/brokerConfig";
import { alertStore, countArmed, useAlertPanelOpen, useAlertState } from "@/lib/alerts";
import { cn } from "@/lib/utils";

/** Ticks every 30s on its own so the rest of the layout doesn't re-render. */
function Clock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);
  return (
    <span className="num hidden font-mono text-xs text-muted-foreground md:inline">
      {now.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false })} IST
    </span>
  );
}

function formatCountdown(targetIso: string, now: number): string | null {
  const diff = new Date(`${targetIso}T15:30:00+05:30`).getTime() - now;
  if (!Number.isFinite(diff) || diff <= 0) return null;
  const d = Math.floor(diff / 86_400_000);
  const h = Math.floor((diff % 86_400_000) / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  return d > 0 ? `${d}d ${h}h` : `${h}h ${m}m`;
}

export default function DashboardLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const [searchOpen, setSearchOpen] = useState(false);
  const alertsOpen = useAlertPanelOpen();
  const { alerts } = useAlertState();
  const armedAlerts = countArmed(alerts);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [tick, setTick] = useState(() => Date.now());

  // Live data hooks
  const { data: indicesResult } = useLiveIndices();
  const { data: marketResult } = useMarketStatus();
  const { data: allIndicesData } = useAllIndices();
  const { data: niftyExpiry } = useExpiryList("NIFTY");

  const indices = indicesResult?.data || [];
  const isLiveData = indicesResult?.isLive || false;
  const isMarketOpen = marketResult?.isOpen || false;
  const giftNifty = marketResult?.giftNifty || null;
  const liveVix = allIndicesData?.vix;

  // Broker status
  const { active: activeBroker } = useBrokerConfig();
  const brokerInfo = activeBroker ? getBrokerInfo(activeBroker.brokerId) : undefined;
  const hasDhanKeys = !!getDhanCredentials(activeBroker);

  useKeyboardShortcuts({
    onToggleSearch: () => setSearchOpen(true),
    onToggleAlerts: () => alertStore.setPanelOpen(true),
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
      if (e.key.toLowerCase() === "r" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const target = e.target as HTMLElement;
        if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;
        handleQuickRefresh();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleQuickRefresh]);

  useEffect(() => {
    const id = setInterval(() => setTick(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  // Countdown to the *actual* nearest NIFTY expiry from the exchange list (no hard-coded weekday)
  const expiryCountdown = useMemo(() => {
    const nearest = niftyExpiry?.expiries?.[0]?.value;
    return nearest ? formatCountdown(nearest, tick) : null;
  }, [niftyExpiry, tick]);

  const vixUp = (liveVix?.changePercent ?? 0) >= 0;

  return (
    <SidebarProvider>
      <AlertEngine />
      <div className="relative flex h-svh w-full overflow-hidden bg-transparent">
        <AppSidebar />

        <div className="relative z-10 flex min-w-0 flex-1 flex-col gap-3 p-3 md:pl-1">
          {/* ── Floating toolbar ── */}
          <header className="glass-panel flex min-h-14 shrink-0 items-center gap-2 rounded-2xl px-3">
            <SidebarTrigger className="h-8 w-8 rounded-full text-muted-foreground hover:bg-foreground/[0.08] hover:text-foreground" />

            {/* Live ticker */}
            <div className="mr-2 hidden min-w-0 flex-1 items-center gap-5 overflow-hidden xl:flex">
              {indices.slice(0, 4).map((idx: any, i: number) => {
                const pos = idx.change >= 0;
                return (
                  <div key={idx.symbol} className={cn("shrink-0 items-baseline gap-2", i === 3 ? "hidden 2xl:flex" : "flex")}>
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{idx.symbol}</span>
                    <span className="num font-mono text-[13px] font-semibold">
                      {idx.ltp.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                    </span>
                    <span className={cn("num font-mono text-xs font-medium", pos ? "text-bullish" : "text-bearish")}>
                      {pos ? "+" : ""}{idx.changePercent.toFixed(2)}%
                    </span>
                  </div>
                );
              })}

              <div className="flex shrink-0 items-baseline gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">VIX</span>
                <span className={cn("num font-mono text-[13px] font-semibold", vixUp ? "text-bearish" : "text-bullish")}>
                  {liveVix ? liveVix.value.toFixed(2) : "--"}
                </span>
                {liveVix && (
                  <span className={cn("num font-mono text-xs font-medium", vixUp ? "text-bearish" : "text-bullish")}>
                    {vixUp ? "+" : ""}{liveVix.changePercent.toFixed(2)}%
                  </span>
                )}
              </div>

              {giftNifty && giftNifty.lastPrice > 0 && (
                <div className="flex shrink-0 items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1">
                  <Plane className="h-3 w-3 text-primary" />
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-primary">GIFT</span>
                  <span className="num font-mono text-xs font-semibold">{giftNifty.lastPrice.toLocaleString("en-IN")}</span>
                  <span className={cn("num font-mono text-xs font-medium", giftNifty.change >= 0 ? "text-bullish" : "text-bearish")}>
                    {giftNifty.change >= 0 ? "+" : ""}{giftNifty.change.toFixed(0)}
                  </span>
                </div>
              )}
            </div>

            {/* Controls */}
            <div className="ml-auto flex shrink-0 items-center gap-1">
              {/* Search pill */}
              <button
                onClick={() => setSearchOpen(true)}
                className="glass-control hidden h-9 items-center gap-2 rounded-full px-3.5 text-sm text-muted-foreground transition-colors hover:text-foreground sm:flex"
                aria-label="Search"
              >
                <Search className="h-3.5 w-3.5" />
                <span className="hidden lg:inline">Search</span>
                <kbd className="ml-1 hidden rounded-md bg-foreground/[0.07] px-1.5 py-0.5 font-mono text-[10px] lg:inline">⌘K</kbd>
              </button>
              <Button variant="ghost" size="icon" className="h-9 w-9 sm:hidden" onClick={() => setSearchOpen(true)} aria-label="Search">
                <Search className="h-4 w-4" />
              </Button>

              {/* Data status */}
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    className={cn(
                      "flex h-9 items-center gap-1.5 rounded-full px-3 text-xs font-semibold transition-colors",
                      isLiveData ? "bg-bullish/15 text-bullish hover:bg-bullish/25" : "bg-foreground/[0.07] text-muted-foreground hover:bg-foreground/[0.12]",
                    )}
                  >
                    {isLiveData ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
                    <span className="hidden sm:inline">{isLiveData ? "LIVE" : "OFFLINE"}</span>
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-72 p-4" align="end">
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <div className={cn("h-2.5 w-2.5 rounded-full", isLiveData ? "animate-pulse bg-bullish" : "bg-muted-foreground/50")} />
                      <p className="text-sm font-semibold">{isLiveData ? "Live data connected" : "Data unavailable"}</p>
                    </div>

                    <div className="space-y-2 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Proxy server</span>
                        <Badge variant="outline" className={cn("h-5 text-[11px]", isLiveData ? "border-bullish/40 text-bullish" : "border-destructive/40 text-destructive")}>
                          {isLiveData ? "Connected" : "Offline"}
                        </Badge>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Active broker</span>
                        <span className="font-medium">{brokerInfo?.name ?? "None"}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Dhan live feed</span>
                        <Badge variant="outline" className={cn("h-5 text-[11px]", hasDhanKeys ? "border-bullish/40 text-bullish" : "border-warning/40 text-warning")}>
                          {hasDhanKeys ? "Keys set" : "Not set"}
                        </Badge>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Source</span>
                        <span className="font-medium">{isLiveData ? "Dhan / NSE / TradingView" : "—"}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Last refresh</span>
                        <span className="num font-mono">{lastRefresh.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
                      </div>
                    </div>

                    {!hasDhanKeys && (
                      <Button variant="outline" size="sm" className="h-9 w-full gap-1.5 text-xs" onClick={() => navigate("/broker-settings")}>
                        <Settings className="h-3.5 w-3.5" />
                        Configure broker
                        <ExternalLink className="ml-auto h-3 w-3" />
                      </Button>
                    )}

                    {!isLiveData && (
                      <p className="text-xs leading-relaxed text-muted-foreground">
                        Run <code className="rounded bg-foreground/10 px-1">npm run dev</code> to start Vite and the proxy together.
                      </p>
                    )}
                  </div>
                </PopoverContent>
              </Popover>

              {expiryCountdown && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="hidden h-9 items-center gap-1.5 rounded-full bg-warning/12 px-3 text-warning sm:flex" style={{ backgroundColor: "hsl(var(--warning) / 0.12)" }}>
                      <Timer className="h-3.5 w-3.5" />
                      <span className="num font-mono text-xs font-semibold">{expiryCountdown}</span>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="text-xs">Time to nearest NIFTY expiry (3:30 PM IST)</TooltipContent>
                </Tooltip>
              )}

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-9 w-9" onClick={handleQuickRefresh} aria-label="Refresh data">
                    <RefreshCw className={cn("h-4 w-4", isRefreshing && "animate-spin")} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">Refresh <kbd className="ml-1 rounded bg-foreground/10 px-1 font-mono">R</kbd></TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="relative h-9 w-9" onClick={() => alertStore.setPanelOpen(true)} aria-label="Alerts">
                    <Bell className="h-4 w-4" />
                    {armedAlerts > 0 && (
                      <span className="num absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-warning px-1 font-mono text-[10px] font-bold text-warning-foreground">
                        {armedAlerts}
                      </span>
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">Alerts <kbd className="ml-1 rounded bg-foreground/10 px-1 font-mono">A</kbd></TooltipContent>
              </Tooltip>

              <div className="mx-1.5 hidden h-5 w-px bg-border sm:block" />

              <div className="hidden items-center gap-1.5 sm:flex">
                <span className="relative flex h-2 w-2">
                  {isMarketOpen && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-bullish opacity-60" />}
                  <span className={cn("relative inline-flex h-2 w-2 rounded-full", isMarketOpen ? "bg-bullish" : "bg-muted-foreground/50")} />
                </span>
                <span className="text-xs font-semibold tracking-wide text-muted-foreground">{isMarketOpen ? "OPEN" : "CLOSED"}</span>
              </div>
              <Clock />
            </div>
          </header>

          <main className="min-h-0 flex-1 overflow-auto rounded-2xl px-0.5 pb-1">
            <div className="page-transition" key={location.pathname}>
              <Outlet />
            </div>
          </main>

          <StatusFooter />
        </div>
      </div>

      <CommandPalette open={searchOpen} onOpenChange={setSearchOpen} />
      <AlertSystem open={alertsOpen} onOpenChange={(o) => alertStore.setPanelOpen(o)} />
    </SidebarProvider>
  );
}
