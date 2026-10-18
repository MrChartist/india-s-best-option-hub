import { lazy, Suspense, useState, useEffect, useCallback, useMemo, useRef, type RefObject } from "react";
import { useNavigate } from "react-router-dom";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { Link, Outlet, useLocation } from "react-router-dom";
import { MrChartistMark } from "@/components/brand/MrChartistLogo";
import { BRAND } from "@/lib/brand/links";
import { Button } from "@/components/ui/button";
import { StatusFooter } from "@/components/StatusFooter";
import { SampleBanner } from "@/components/SampleBanner";
import { SHORTCUT_HELP, isMacPlatform, modKeyLabel, useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { findRoute } from "@/lib/routes";
import { probeProxy, useProxyStatus } from "@/lib/api/proxyClient";
import { startMarketWS } from "@/lib/websocketClient";
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

// The alert engine (and the snapshot store it feeds) loads after first paint, out of the main chunk.
const AlertSystem = lazy(() => import("@/components/AlertSystem"));
import { Search, Bell, Timer, RefreshCw, Plane, Settings, ExternalLink } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";

const EXPIRY_SYMBOL = "NIFTY";

/** Chains recorded app-wide during market hours so flow, OI replay, IV and PCR history accrue on any page. */
const RECORD_SYMBOLS = [{ symbol: "NIFTY" }, { symbol: "BANKNIFTY" }, { symbol: "SENSEX" }];

// The command palette (cmdk, the F&O universe, route search) is only fetched on the first ⌘K or
// search click; hovering or focusing the search button warms the chunk.
const loadCommandPalette = () => import("@/components/CommandPalette").then((m) => ({ default: m.CommandPalette }));
const CommandPalette = lazy(loadCommandPalette);

// The snapshot recorder and its IndexedDB store load through a dynamic import, and only once the
// proxy is reachable: it records live chains only, so there is nothing to do in sample mode.
const SnapshotRecorderHost = lazy(() =>
  import("@/hooks/useSnapshotRecorder").then(({ useSnapshotRecorder }) => ({
    default: function SnapshotRecorder() {
      useSnapshotRecorder(RECORD_SYMBOLS);
      return null;
    },
  })),
);

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
              <h3 className="mb-1.5 font-sans text-label text-muted-foreground">{group.category}</h3>
              <ul className="space-y-1">
                {group.items.map((item) => (
                  <li key={item.description} className="flex items-center justify-between gap-3 text-body">
                    <span className="text-foreground/90">{item.description}</span>
                    <span className="flex shrink-0 gap-1">
                      {item.keys.map((k) => (
                        <kbd key={k} className="min-w-[1.375rem] rounded-chip bg-control px-1 py-px text-center font-sans text-body-sm shadow-control">
                          {k === "Ctrl" && isMacPlatform() ? "⌘" : k.length === 1 ? k.toUpperCase() : k}
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
      className="hidden pl-1 font-num text-body-sm tabular-nums text-muted-foreground 2xl:inline"
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
          className="hidden h-7 items-center gap-1.5 rounded-pill px-2 text-body-sm transition-colors duration-fast hover:bg-control-track sm:flex"
          tabIndex={0}
          aria-label={`${EXPIRY_SYMBOL} exp ${label}: next expiry ${formatDateIST(next.date)}`}
        >
          <Timer className="h-3.5 w-3.5 text-warning" aria-hidden="true" />
          <span className="hidden text-muted-foreground lg:inline">{EXPIRY_SYMBOL} expiry</span>
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
    <div className="flex shrink-0 items-center gap-1.5 px-2.5 first:pl-0 last:pr-0">
      <span className="text-label text-muted-foreground">{label}</span>
      <span className="font-num text-body-sm font-semibold tabular-nums">{value}</span>
      {hasChange && (
        <span className={cn("font-num text-body-sm font-medium tabular-nums", good ? "text-bullish" : "text-bearish")}>
          {up ? "▲" : "▼"} {Math.abs(changePct as number).toFixed(2)}%
        </span>
      )}
    </div>
  );
}

/**
 * Mail-style toolbar title: true once the page's own header ([data-page-header]) has scrolled
 * out of the content area, so the title is never shown twice. Pages without a PageHeader
 * always show it.
 */
function usePageHeaderHidden(mainRef: RefObject<HTMLElement>, pathname: string): boolean {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    const main = mainRef.current;
    if (!main) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const header = main.querySelector<HTMLElement>("[data-page-header]");
      if (!header) {
        setHidden(true);
        return;
      }
      setHidden(header.getBoundingClientRect().bottom <= main.getBoundingClientRect().top + 4);
    };
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(measure);
    };
    // Lazy pages mount their header after the route changes; re-measure when the DOM settles.
    const observer = new MutationObserver(schedule);
    observer.observe(main, { childList: true, subtree: true });
    main.addEventListener("scroll", schedule, { passive: true });
    schedule();
    return () => {
      observer.disconnect();
      main.removeEventListener("scroll", schedule);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [mainRef, pathname]);
  return hidden;
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
  const [paletteMounted, setPaletteMounted] = useState(false);
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

  const openSearch = useCallback(() => {
    setPaletteMounted(true);
    setSearchOpen(true);
  }, []);

  useKeyboardShortcuts({
    onToggleSearch: openSearch,
    onToggleAlerts: () => setAlertsOpen(true),
    onShowShortcuts: () => setShortcutsOpen(true),
  });

  // Proxy reachability: probe once on mount (the banner resolves even before any query runs), and
  // open the live WebSocket feed only once the gate says the proxy is up.
  const proxy = useProxyStatus();
  const proxyOnline = proxy.status === "online";
  useEffect(() => {
    void probeProxy();
  }, []);
  useEffect(() => {
    if (proxyOnline) startMarketWS();
  }, [proxyOnline]);

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
  const mainRef = useRef<HTMLElement>(null);
  const headerHidden = usePageHeaderHidden(mainRef, location.pathname);
  // <main> is the scroll container, so the browser never resets it on navigation. Start each
  // new page at the top, unless the URL targets an anchor (the page scrolls to it itself).
  useEffect(() => {
    if (location.hash) return;
    const main = mainRef.current;
    if (main) main.scrollTop = 0;
  }, [location.pathname, location.hash]);
  const pageTitle = findRoute(location.pathname)?.title ?? "";
  const searchHint = modKeyLabel("K");

  return (
    <SidebarProvider>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <div className="relative flex h-svh w-full overflow-hidden bg-window-backdrop">
        <AppSidebar />
        {/* The content "window": inset beside the sidebar material on desktop, edge to edge on phones. */}
        <div className="relative z-10 flex min-w-0 flex-1 flex-col overflow-hidden bg-window md:my-2 md:mr-2 md:rounded-panel md:shadow-window">
          {/* Unified toolbar */}
          <header className="mac-toolbar sticky top-0 z-30 flex h-[52px] shrink-0 items-center gap-1.5 px-2.5 sm:px-3">
            <SidebarTrigger className="h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground [&_svg]:size-4" aria-label="Toggle sidebar" />
            {/* Phones: the sidebar (and its logo) is a drawer, so show the mark in the toolbar. */}
            <Link
              to="/"
              aria-label={`${BRAND.productFull}: dashboard`}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-pill text-foreground focus-visible:shadow-focus focus-visible:outline-none md:hidden"
            >
              <MrChartistMark size={20} decorative />
            </Link>

            {/* Title block: fades in once the page header scrolls away, so the title is never shown twice. */}
            <div
              aria-hidden="true"
              className={cn(
                "min-w-0 flex-1 pl-1 transition-opacity duration-base ease-out md:flex-initial md:shrink",
                headerHidden ? "opacity-100" : "pointer-events-none opacity-0",
              )}
            >
              <p className="truncate text-lead font-semibold leading-tight text-foreground">{pageTitle}</p>
              <p className="hidden truncate text-body-sm leading-tight text-muted-foreground xl:block">
                {sessionMeta.label} · {isLiveData ? "Live" : proxy.sampleMode ? "Sample data" : "Offline"}
              </p>
            </div>

            {/* Ticker: live indices as one toolbar item group */}
            <div className="hidden min-w-0 flex-1 justify-center xl:flex">
              {showTicker && (
                <div
                  className="flex h-7 min-w-0 items-center divide-x divide-separator overflow-hidden rounded-pill bg-control-track px-2.5"
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
                    <div className="hidden shrink-0 items-center gap-1.5 px-2.5 last:pr-0 2xl:flex">
                      <Plane className="h-3 w-3 text-primary-ink" aria-hidden="true" />
                      <span className="text-label text-primary-ink">GIFT</span>
                      <span className="font-num text-body-sm font-semibold tabular-nums">
                        {giftNifty.lastPrice.toLocaleString("en-IN")}
                      </span>
                      <span
                        className={cn(
                          "font-num text-body-sm font-medium tabular-nums",
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
            <div className="ml-auto flex shrink-0 items-center gap-0.5 sm:gap-1">
              {/* One status pill: market session + data feed */}
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="flex h-7 items-center gap-2 rounded-pill px-2 text-body-sm font-medium transition-colors duration-fast hover:bg-control-track focus-visible:outline-none focus-visible:shadow-focus data-[state=open]:bg-control-track"
                  >
                    <span className="relative flex h-2 w-2" aria-hidden="true">
                      {sessionMeta.tone === "open" && (
                        <span className="absolute inset-0 animate-ping rounded-full bg-bullish opacity-40 motion-reduce:hidden" />
                      )}
                      <span className={cn("relative h-2 w-2 rounded-full", TONE_DOT[sessionMeta.tone])} />
                    </span>
                    <span className="text-foreground">{sessionMeta.short}</span>
                    <span className="h-3 w-[var(--hairline)] bg-separator-strong" aria-hidden="true" />
                    <span className="flex items-center gap-1 text-muted-foreground">
                      <span
                        className={cn("h-1.5 w-1.5 rounded-full", isLiveData ? "bg-bullish" : "bg-bearish")}
                        aria-hidden="true"
                      />
                      <span className="sr-only sm:not-sr-only">{isLiveData ? "Live" : "Offline"}</span>
                    </span>
                    {/* Accessible name = visible text plus this, so it always contains what is shown. */}
                    <span className="sr-only">{`: ${sessionMeta.label}, data feed ${isLiveData ? "live" : "offline"}. Open status details`}</span>
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-72 p-3.5" align="end">
                  <div className="space-y-3">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span className={cn("h-2.5 w-2.5 rounded-full", TONE_DOT[sessionMeta.tone])} aria-hidden="true" />
                        <p className="text-headline">{sessionMeta.label}</p>
                      </div>
                      <p className="pl-[18px] text-body-sm text-muted-foreground">
                        NSE · {nextChange.label} · {formatTimeIST(sessionNow)}
                      </p>
                    </div>

                    <div className="hairline-t space-y-1.5 pt-3 text-body-sm">
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Proxy</span>
                        <Badge variant={proxyOnline ? "bullish" : proxy.status === "unknown" ? "warning" : "bearish"}>
                          {proxyOnline ? "Reachable" : proxy.status === "unknown" ? "Checking" : proxy.sampleMode ? "Sample mode" : "Offline"}
                        </Badge>
                      </div>
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
                        variant="secondary"
                        className="w-full"
                        onClick={() => navigate("/broker-settings")}
                      >
                        <Settings aria-hidden="true" />
                        Configure broker keys
                        <ExternalLink className="ml-auto !size-3" aria-hidden="true" />
                      </Button>
                    )}

                    {!isLiveData && (
                      <p className="text-body-sm leading-relaxed text-muted-foreground">
                        Run <code className="rounded-chip bg-control-track px-1 text-body-sm">npm run dev</code> to start Vite and the
                        proxy server, or add Dhan API keys for live data.
                      </p>
                    )}
                  </div>
                </PopoverContent>
              </Popover>

              <ExpiryCountdown />

              {/* Refresh */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" onClick={handleQuickRefresh} aria-label="Refresh all data">
                    <RefreshCw className={cn("text-muted-foreground", isRefreshing && "animate-spin")} strokeWidth={1.75} aria-hidden="true" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  Refresh <kbd className="ml-1 font-sans text-muted-foreground">R</kbd>
                </TooltipContent>
              </Tooltip>

              {/* Alerts */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" onClick={() => setAlertsOpen(true)} aria-label="Open alerts">
                    <Bell className="text-muted-foreground" strokeWidth={1.75} aria-hidden="true" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Alerts</TooltipContent>
              </Tooltip>

              {/* Search: a macOS search field on desktop, an icon button on phones. Both open the palette. */}
              <button
                type="button"
                onClick={openSearch}
                onPointerEnter={() => void loadCommandPalette()}
                onFocus={() => void loadCommandPalette()}
                aria-keyshortcuts="Control+K Meta+K /"
                className="relative ml-1 flex h-7 shrink-0 items-center gap-1.5 rounded-pill text-body text-muted-foreground transition-colors duration-fast focus-visible:shadow-focus focus-visible:outline-none max-md:w-7 max-md:justify-center max-md:hover:bg-control-track md:w-44 md:bg-control-track md:px-2 md:hover:text-foreground lg:w-56 [@media(pointer:coarse)]:after:absolute [@media(pointer:coarse)]:after:-inset-1.5 [@media(pointer:coarse)]:after:content-['']"
              >
                <Search className="h-4 w-4 shrink-0 md:h-3.5 md:w-3.5" strokeWidth={2} aria-hidden="true" />
                {/* Accessible name "Search pages and symbols" starts with the visible word (WCAG 2.5.3). */}
                <span className="flex-1 text-left max-md:sr-only">Search</span>
                <span className="sr-only"> pages and symbols</span>
                <kbd className="hidden font-sans text-micro text-muted-foreground md:inline" aria-hidden="true">
                  {searchHint}
                </kbd>
              </button>

              <ISTClock />
            </div>
          </header>

          <SampleBanner />

          <main
            id="main"
            ref={mainRef}
            tabIndex={-1}
            className="flex-1 overflow-auto px-3 py-3 focus:outline-none focus-visible:shadow-none sm:px-4 lg:px-5 lg:py-4"
          >
            <div className="page-transition" key={location.pathname}>
              <Outlet />
            </div>
          </main>

          <StatusFooter />
        </div>
      </div>

      {paletteMounted && (
        <Suspense fallback={null}>
          <CommandPalette open={searchOpen} onOpenChange={setSearchOpen} onShowShortcuts={() => setShortcutsOpen(true)} />
        </Suspense>
      )}
      {proxyOnline && (
        <Suspense fallback={null}>
          <SnapshotRecorderHost />
        </Suspense>
      )}
      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
      <Suspense fallback={null}>
        <AlertSystem open={alertsOpen} onOpenChange={setAlertsOpen} />
      </Suspense>
    </SidebarProvider>
  );
}
