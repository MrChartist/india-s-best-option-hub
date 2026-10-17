import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { Outlet, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { StatusFooter } from "@/components/StatusFooter";
import { CommandPalette } from "@/components/CommandPalette";
import { AlertSystem } from "@/components/AlertSystem";
import { SHORTCUT_HELP, useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { useSnapshotRecorder } from "@/hooks/useSnapshotRecorder";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useLiveIndices, useMarketStatus, useAllIndices } from "@/hooks/useMarketData";
import { useQueryClient } from "@tanstack/react-query";
import { getActiveBroker } from "@/lib/brokerConfig";
import type { IndexData } from "@/lib/mockData";
import {
  dteLabel,
  formatDateIST,
  formatTimeIST,
  getExpiries,
  getMarketSession,
  nextSessionChange,
  type MarketSession,
} from "@/lib/options";
import { cn } from "@/lib/utils";
import { Search, Bell, Timer, RefreshCw, Plane, Settings, ExternalLink } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";

const EXPIRY_SYMBOL = "NIFTY";

/** Chains recorded app-wide during market hours so flow, OI replay, IV and PCR history accrue on any page. */
const RECORD_SYMBOLS = [{ symbol: "NIFTY" }, { symbol: "BANKNIFTY" }, { symbol: "SENSEX" }];

function ShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>Press "g" then a letter to jump to a page. Shortcuts are ignored while typing.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          {SHORTCUT_HELP.map((group) => (
            <section key={group.category} className={group.category === "Navigation" ? "sm:row-span-2" : undefined}>
              <h3 className="mb-1.5 text-label uppercase text-muted-foreground">{group.category}</h3>
              <ul className="space-y-1">
                {group.items.map((item) => (
                  <li key={item.description} className="flex items-center justify-between gap-3 text-sm">
                    <span className="text-foreground/90">{item.description}</span>
                    <span className="flex shrink-0 gap-1">
                      {item.keys.map((k) => (
                        <kbd key={k} className="min-w-[1.5rem] rounded border border-border bg-muted px-1.5 py-0.5 text-center font-mono text-xs">
                          {k.length === 1 ? k.toUpperCase() : k}
                        </kbd>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

const SESSION_META: Record<MarketSession, { label: string; short: string; tone: "open" | "edge" | "shut" }> = {
  "pre-open": { label: "Pre-open session", short: "Pre-open", tone: "edge" },
  open: { label: "Market open", short: "Open", tone: "open" },
  closing: { label: "Closing session", short: "Closing", tone: "edge" },
  closed: { label: "Market closed", short: "Closed", tone: "shut" },
  holiday: { label: "Exchange holiday", short: "Holiday", tone: "shut" },
  weekend: { label: "Weekend", short: "Weekend", tone: "shut" },
};

const TONE_DOT: Record<"open" | "edge" | "shut", string> = {
  open: "bg-bullish",
  edge: "bg-warning",
  shut: "bg-muted-foreground/60",
};

/** Re-renders on a fixed interval; keeps ticking state out of the layout. */
function useNow(intervalMs: number): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

/** Leaf component: the only part of the header that re-renders every second. */
function ISTClock() {
  const now = useNow(1000);
  return (
    <time
      dateTime={now.toISOString()}
      className="hidden font-num text-xs font-medium tabular-nums text-muted-foreground md:inline"
      aria-label={`Indian Standard Time ${formatTimeIST(now)}`}
    >
      {formatTimeIST(now, { seconds: true })}
    </time>
  );
}

/** Leaf component: countdown to the nearest NIFTY expiry (15:30 IST), refreshed each minute. */
function ExpiryCountdown() {
  const now = useNow(60_000);
  const next = useMemo(() => getExpiries(EXPIRY_SYMBOL, now, 1)[0], [now]);
  if (!next) return null;
  const label = dteLabel(next.date, now);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className="hidden h-7 items-center gap-1.5 rounded-capsule border border-border bg-card/70 px-2.5 text-xs sm:flex"
          tabIndex={0}
          aria-label={`Next ${EXPIRY_SYMBOL} expiry ${formatDateIST(next.date)}, ${label}`}
        >
          <Timer className="h-3.5 w-3.5 text-warning" aria-hidden="true" />
          <span className="hidden text-label uppercase text-muted-foreground lg:inline">{EXPIRY_SYMBOL} exp</span>
          <span className="font-num font-semibold tabular-nums text-foreground">{label}</span>
        </div>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {EXPIRY_SYMBOL} {next.type} expiry · {formatDateIST(next.date)}, 15:30 IST
      </TooltipContent>
    </Tooltip>
  );
}

function TickerItem({ label, value, changePct, invert = false }: { label: string; value: string; changePct?: number; invert?: boolean }) {
  const hasChange = typeof changePct === "number" && Number.isFinite(changePct);
  const up = hasChange && (changePct as number) >= 0;
  const good = invert ? !up : up;
  return (
    <div className="flex shrink-0 items-center gap-1.5 px-3 first:pl-0 last:pr-0">
      <span className="text-label uppercase text-muted-foreground">{label}</span>
      <span className="font-num text-xs font-semibold tabular-nums">{value}</span>
      {hasChange && (
        <span className={cn("font-num text-xs font-medium tabular-nums", good ? "text-bullish" : "text-bearish")}>
          {up ? "▲" : "▼"} {Math.abs(changePct as number).toFixed(2)}%
        </span>
      )}
    </div>
  );
}


/** Query-key roots holding live market data; the R / refresh button only touches these. */
const LIVE_QUERY_KEYS = new Set<string>([
  "nse-indices",
  "nse-all-indices",
  "nse-market-status",
  "live-option-chain",
  "chain-multi",
  "chain-by-expiry",
  "chain-snapshot",
  "oi-secondary-chain",
  "sb-chain",
  "snapshot-recorder-chain",
  "screener",
  "sparkline",
  "flow-oi-spurts",
  "proxy-health",
]);

export default function DashboardLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const [searchOpen, setSearchOpen] = useState(false);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const [isRefreshing, setIsRefreshing] = useState(false);
  const sessionNow = useNow(30_000);

  // Live data hooks
  const { data: indicesResult } = useLiveIndices();
  const { data: marketResult } = useMarketStatus();
  const { data: allIndicesData } = useAllIndices();

  const indices: IndexData[] = indicesResult?.data || [];
  const isLiveData = indicesResult?.isLive || false;
  const giftNifty = marketResult?.giftNifty || null;
  const liveVix = allIndicesData?.vix;

  const session = getMarketSession(sessionNow);
  const sessionMeta = SESSION_META[session];
  const nextChange = nextSessionChange(sessionNow);

  // Check broker config
  const activeBroker = getActiveBroker();
  const hasDhanKeys = Boolean(
    activeBroker?.brokerId === "dhan" && activeBroker.values.clientId && activeBroker.values.accessToken,
  );

  useKeyboardShortcuts({
    onToggleSearch: () => setSearchOpen(true),
    onToggleAlerts: () => setAlertsOpen(true),
    onShowShortcuts: () => setShortcutsOpen(true),
  });
  useSnapshotRecorder(RECORD_SYMBOLS);

  // Quick refresh: invalidate live-market queries only. Slow-moving data
  // (instrument master, multi-year histories, IV backfills) is left alone.
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (refreshTimerRef.current !== null) clearTimeout(refreshTimerRef.current);
    },
    [],
  );
  const handleQuickRefresh = useCallback(async () => {
    setIsRefreshing(true);
    await queryClient.invalidateQueries({
      predicate: (q) => typeof q.queryKey[0] === "string" && LIVE_QUERY_KEYS.has(q.queryKey[0]),
    });
    setLastRefresh(new Date());
    if (refreshTimerRef.current !== null) clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = setTimeout(() => {
      refreshTimerRef.current = null;
      setIsRefreshing(false);
    }, 800);
  }, [queryClient]);

  // Keyboard shortcut: R for refresh. Pages with their own R handler (Option
  // Chain, OI Analysis) call preventDefault; those listeners may be registered
  // after this one, so check defaultPrevented once dispatch has finished.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.key === "r" || e.key === "R") && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (e.defaultPrevented) return;
        const target = e.target as HTMLElement;
        if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable) return;
        setTimeout(() => {
          if (!e.defaultPrevented) void handleQuickRefresh();
        }, 0);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleQuickRefresh]);

  const showTicker = indices.length > 0 || Boolean(liveVix);

  return (
    <SidebarProvider>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <div className="relative flex h-svh w-full overflow-hidden bg-background">
        <div className="bg-noise" aria-hidden="true" />

        <AppSidebar />
        <div className="relative z-10 flex min-w-0 flex-1 flex-col overflow-hidden">
          {/* Top bar */}
          <header className="glass-nav sticky top-0 z-30 flex min-h-12 shrink-0 items-center gap-2 px-2.5 sm:px-3">
            <SidebarTrigger className="h-8 w-8 shrink-0" aria-label="Toggle sidebar" />

            {/* Ticker capsule: live indices */}
            <div className="hidden min-w-0 flex-1 lg:flex">
              {showTicker && (
                <div
                  className="flex h-8 min-w-0 items-center divide-x divide-border overflow-hidden rounded-capsule border border-border bg-card/70 px-3.5 shadow-card"
                  aria-label="Market ticker"
                  role="group"
                >
                  {indices.slice(0, 3).map((idx) => (
                    <TickerItem
                      key={idx.symbol}
                      label={idx.symbol}
                      value={idx.ltp.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      changePct={idx.changePercent}
                    />
                  ))}
                  <TickerItem
                    label="VIX"
                    value={liveVix ? liveVix.value.toFixed(2) : "—"}
                    changePct={liveVix?.changePercent}
                    invert
                  />
                  {giftNifty && giftNifty.lastPrice > 0 && (
                    <div className="hidden shrink-0 items-center gap-1.5 px-3 last:pr-0 xl:flex">
                      <Plane className="h-3 w-3 text-primary-ink" aria-hidden="true" />
                      <span className="text-label uppercase text-primary-ink">GIFT</span>
                      <span className="font-num text-xs font-semibold tabular-nums">
                        {giftNifty.lastPrice.toLocaleString("en-IN")}
                      </span>
                      <span
                        className={cn(
                          "font-num text-xs font-medium tabular-nums",
                          giftNifty.change >= 0 ? "text-bullish" : "text-bearish",
                        )}
                      >
                        {giftNifty.change >= 0 ? "▲" : "▼"} {Math.abs(giftNifty.change).toFixed(0)}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Controls */}
            <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-1.5">
              {/* One status pill: market session + data feed */}
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="flex h-7 items-center gap-2 rounded-capsule border border-border bg-card/70 px-2.5 text-xs font-semibold transition-colors duration-fast hover:border-primary/40 focus-visible:outline-none focus-visible:shadow-ember"
                    aria-label={`${sessionMeta.label}. Data feed ${isLiveData ? "live" : "offline"}. Open status details`}
                  >
                    <span className="relative flex h-2 w-2" aria-hidden="true">
                      {sessionMeta.tone === "open" && (
                        <span className="absolute inset-0 animate-ping rounded-full bg-bullish opacity-40 motion-reduce:hidden" />
                      )}
                      <span className={cn("relative h-2 w-2 rounded-full", TONE_DOT[sessionMeta.tone])} />
                    </span>
                    <span className="text-foreground">{sessionMeta.short}</span>
                    <span className="h-3 w-px bg-border" aria-hidden="true" />
                    <span className="flex items-center gap-1 text-muted-foreground">
                      <span
                        className={cn("h-1.5 w-1.5 rounded-full", isLiveData ? "bg-bullish" : "bg-bearish")}
                        aria-hidden="true"
                      />
                      <span className="hidden sm:inline">{isLiveData ? "Live" : "Offline"}</span>
                    </span>
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-72 p-3.5" align="end">
                  <div className="space-y-3">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span className={cn("h-2.5 w-2.5 rounded-full", TONE_DOT[sessionMeta.tone])} aria-hidden="true" />
                        <p className="text-sm font-semibold">{sessionMeta.label}</p>
                      </div>
                      <p className="pl-[18px] text-xs text-muted-foreground">
                        NSE · {nextChange.label} · {formatTimeIST(sessionNow)}
                      </p>
                    </div>

                    <div className="space-y-1.5 border-t border-border pt-3 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Data feed</span>
                        <Badge variant={isLiveData ? "bullish" : "bearish"}>{isLiveData ? "Live" : "Offline"}</Badge>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Dhan API keys</span>
                        <Badge variant={hasDhanKeys ? "bullish" : "warning"}>{hasDhanKeys ? "Configured" : "Not set"}</Badge>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Source</span>
                        <span className="font-medium">{isLiveData ? "Dhan / NSE / TradingView" : "None"}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Last refresh</span>
                        <span className="font-num tabular-nums">{formatTimeIST(lastRefresh, { seconds: true })}</span>
                      </div>
                    </div>

                    {!hasDhanKeys && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 w-full gap-1.5 text-xs"
                        onClick={() => navigate("/broker-settings")}
                      >
                        <Settings className="h-3 w-3" aria-hidden="true" />
                        Configure broker keys
                        <ExternalLink className="ml-auto h-3 w-3" aria-hidden="true" />
                      </Button>
                    )}

                    {!isLiveData && (
                      <p className="text-xs leading-relaxed text-muted-foreground">
                        Run <code className="rounded bg-muted px-1 text-xs">npm run dev</code> to start Vite and the
                        proxy server, or add Dhan API keys for live data.
                      </p>
                    )}
                  </div>
                </PopoverContent>
              </Popover>

              <ExpiryCountdown />

              <div className="hidden h-4 w-px bg-border sm:block" aria-hidden="true" />

              {/* Refresh */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={handleQuickRefresh}
                    aria-label="Refresh all data"
                  >
                    <RefreshCw className={cn("h-3.5 w-3.5", isRefreshing && "animate-spin")} aria-hidden="true" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  Refresh <kbd className="ml-1 rounded bg-muted px-1 text-micro">R</kbd>
                </TooltipContent>
              </Tooltip>

              {/* Search */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => setSearchOpen(true)}
                    aria-label="Search pages and symbols"
                  >
                    <Search className="h-3.5 w-3.5" aria-hidden="true" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  Search <kbd className="ml-1 rounded bg-muted px-1 text-micro">Ctrl K</kbd>
                </TooltipContent>
              </Tooltip>

              {/* Alerts */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => setAlertsOpen(true)}
                    aria-label="Open alerts"
                  >
                    <Bell className="h-3.5 w-3.5" aria-hidden="true" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Alerts</TooltipContent>
              </Tooltip>

              <ISTClock />
            </div>
          </header>

          <main id="main" tabIndex={-1} className="flex-1 overflow-auto p-2.5 focus:outline-none focus-visible:shadow-none sm:p-3 lg:p-4">
            <div className="page-transition" key={location.pathname}>
              <Outlet />
            </div>
          </main>

          <StatusFooter />
        </div>
      </div>

      <CommandPalette open={searchOpen} onOpenChange={setSearchOpen} onShowShortcuts={() => setShortcutsOpen(true)} />
      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
      <AlertSystem open={alertsOpen} onOpenChange={setAlertsOpen} />
    </SidebarProvider>
  );
}
