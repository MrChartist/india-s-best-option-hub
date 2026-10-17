import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Flame, Loader2, RefreshCw, SearchX, TableProperties, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/PageHeader";
import { BuildupBadge } from "@/components/ui/buildup-badge";
import { buildSampleChainData, useLiveOptionChain } from "@/hooks/useMarketData";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { cn } from "@/lib/utils";
import { SEQUENCE_TIMEOUT_MS } from "@/hooks/useKeyboardShortcuts";
import { routeForShortcut } from "@/lib/routes";
import { fetchLiveOptionChain } from "@/lib/marketApi";
import type { OptionData } from "@/lib/mockData";
import {
  LOT_SIZE_HISTORY,
  dteLabel,
  formatCompactIN,
  formatDateIST,
  formatStrike,
  getContractSpec,
  getLotSize,
  normalizeExpiry,
  type OptionType,
  type Side,
} from "@/lib/options";
import { ChainToolbar, type ChainViewMode } from "@/components/option-chain/ChainToolbar";
import { ChainSummaryBar } from "@/components/option-chain/ChainSummaryBar";
import { ChainTable } from "@/components/option-chain/ChainTable";
import { BasketDrawer } from "@/components/option-chain/BasketDrawer";
import { StrikeAlertDialog } from "@/components/option-chain/StrikeAlertDialog";
import { ByStrikeView } from "@/components/option-chain/ByStrikeView";
import { visibleColumns } from "@/components/option-chain/columns";
import {
  buildChainModel,
  buildupCounts,
  chainToCSV,
  deltaTargets,
  oneSigmaPoints,
  sliceAroundATM,
  type RowView,
  type StrikeRange,
} from "@/components/option-chain/chainModel";
import {
  addLegs,
  buildIronFly,
  buildStraddle,
  buildStrangle,
  legFromRow,
  readBasketSent,
  recordBasketSent,
  removeLegs,
  sendUrl,
  type BasketLeg,
  type BasketSent,
  type SendTarget,
} from "@/components/option-chain/basket";
import { gammaBadgeMap, safeGammaLevels } from "@/components/option-chain/gammaLevels";
import { chainChartLevels } from "@/components/option-chain/chartOverlays";
import { useLatestCallback, useStableBadgeMap, useStableRows } from "@/components/option-chain/stableRows";
import { useBasket, useStrikeAlerts } from "@/components/option-chain/hooks";
import {
  DELTA_VIEW_KEY,
  MOBILE_BREAKPOINT,
  MOBILE_COLUMNS_KEY,
  MOBILE_DEFAULT_PRESET,
  readBool,
  readColumnPrefs,
  readRange,
  writeBool,
  writeColumnPrefs,
  writeRange,
  type ColumnPrefs,
} from "@/components/option-chain/preferences";
import { downloadText as saveText } from "@/lib/download";
import { ALL_SYMBOLS, canonicalSymbol } from "@/components/option-chain/symbols";

const SKELETON_ROWS = Array.from({ length: 12 }, (_, n) => `skeleton-row-${n + 1}`);

// The price chart pulls in lightweight-charts: load it only when the chart is opened.
const StockChart = lazy(() => import("@/components/StockChart").then((m) => ({ default: m.StockChart })));

function downloadText(filename: string, text: string, type = "text/csv") {
  if (!saveText(filename, text, type)) toast.error("Could not start the download in this browser");
}

/** True for an index or stock in the F&O universe (static catalogue or specs loaded from the proxy). */
function isKnownFnoSymbol(symbol: string): boolean {
  return ALL_SYMBOLS.some((s) => s.value === symbol) || !!getContractSpec(symbol);
}

function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}

/** Up to five catalogue symbols closest to a mistyped one (prefix matches first, then edit distance). */
function nearestSymbols(input: string, n = 5): string[] {
  const q = input.toUpperCase();
  return ALL_SYMBOLS.map((s) => s.value)
    .map((v) => ({ v, d: v.startsWith(q) || q.startsWith(v) ? 0 : v.includes(q) ? 1 : editDistance(q, v) + 1 }))
    .sort((a, b) => a.d - b.d || a.v.localeCompare(b.v))
    .slice(0, n)
    .map((x) => x.v);
}

/** First expiry (ISO) on which the current lot size applies. */
function lotEffectiveFrom(symbol: string, expiry: string): string | undefined {
  const hist = LOT_SIZE_HISTORY[symbol];
  if (hist && hist.length > 0) {
    const applicable = hist.filter((h) => !expiry || h.from <= expiry);
    if (applicable.length > 0) return applicable[applicable.length - 1].from;
  }
  return getContractSpec(symbol)?.effectiveFrom;
}

/** window.innerWidth, updated on resize (0 when there is no window). */
function useViewportWidth(): number {
  const [w, setW] = useState(() => (typeof window === "undefined" ? 0 : window.innerWidth));
  useEffect(() => {
    if (typeof window === "undefined") return;
    const on = () => setW(window.innerWidth);
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return w;
}

/** True while the element has more content to the right than it shows (horizontal scroll cue). */
function useCanScrollRight(ref: RefObject<HTMLElement>, deps: unknown[]): boolean {
  const [more, setMore] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) {
      setMore(false);
      return;
    }
    const update = () => setMore(el.scrollWidth - el.clientWidth - el.scrollLeft > 4);
    update();
    el.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null;
    ro?.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      ro?.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return more;
}

function isTypingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  const el = t;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable || !!el.closest("[role=dialog],[role=menu],[role=listbox]");
}

export default function OptionChain() {
  useDocumentTitle("Option Chain");
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();

  // ── URL is the source of truth for symbol and expiry ──
  const symbol = canonicalSymbol(searchParams.get("symbol"));
  // A typo in a deep link must not turn into a convincing fake chain.
  const unknownSymbol = !isKnownFnoSymbol(symbol);
  const urlExpiryRaw = searchParams.get("expiry");
  const urlExpiry = urlExpiryRaw ? normalizeExpiry(urlExpiryRaw) || undefined : undefined;

  const setSymbol = useCallback(
    (s: string) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.set("symbol", s);
        next.delete("expiry");
        return next;
      }, { replace: true });
    },
    [setSearchParams],
  );
  const setExpiry = useCallback(
    (e: string) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.set("symbol", symbol);
        next.set("expiry", e);
        return next;
      }, { replace: true });
    },
    [setSearchParams, symbol],
  );

  // Canonicalise ?symbol= (e.g. ZOMATO → ETERNAL) without adding a history entry.
  useEffect(() => {
    const raw = searchParams.get("symbol");
    if (raw && raw !== symbol) {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.set("symbol", symbol);
        return next;
      }, { replace: true });
    }
  }, [searchParams, symbol, setSearchParams]);

  // ── Preferences ──
  const [viewMode, setViewMode] = useState<ChainViewMode>("expiration");
  const [desktopPrefs, setDesktopPrefs] = useState<ColumnPrefs>(() => readColumnPrefs());
  const [mobilePrefs, setMobilePrefs] = useState<ColumnPrefs>(() => readColumnPrefs(MOBILE_COLUMNS_KEY, MOBILE_DEFAULT_PRESET));
  const [range, setRangeState] = useState<StrikeRange>(() => readRange());
  const [deltaView, setDeltaViewState] = useState<boolean>(() => readBool(DELTA_VIEW_KEY));
  const [showChart, setShowChart] = useState(false);
  const setRange = useCallback((r: StrikeRange) => { setRangeState(r); writeRange(r); }, []);
  const setDeltaView = useCallback((v: boolean) => { setDeltaViewState(v); writeBool(DELTA_VIEW_KEY, v); }, []);

  // ── Data ──
  const { data, isLoading, isError, error, refetch, isFetching, dataUpdatedAt } = useLiveOptionChain(symbol, urlExpiry);
  const expiries = useMemo(() => (unknownSymbol ? [] : data?.expiries ?? []), [data, unknownSymbol]);
  const expiry = data?.expiry || urlExpiry || expiries[0]?.value || "";
  const lotSize = data?.lotSize ?? getLotSize(symbol, expiry) ?? 0;
  const isSample = data?.source === "sample";

  const model = useMemo(
    () => buildChainModel(unknownSymbol ? [] : data?.chain ?? [], { spot: data?.spotPrice ?? 0, expiry, lotSize, symbol, maxPain: data?.maxPain }),
    [data, expiry, lotSize, symbol, unknownSymbol],
  );
  const hasData = model.rows.length > 0;
  // Stable identities: only rows whose quotes changed re-render on each poll.
  const rows = useStableRows(useMemo(() => sliceAroundATM(model.rows, model.atmStrike, range), [model, range]));
  // Phones (below 640px) keep their own column set, compact by default (LTP and OI only).
  const viewportW = useViewportWidth();
  const isMobile = viewportW > 0 && viewportW < MOBILE_BREAKPOINT;
  const columnPrefs = isMobile ? mobilePrefs : desktopPrefs;
  const setColumnPrefs = useCallback(
    (p: ColumnPrefs) => {
      if (isMobile) {
        setMobilePrefs(p);
        writeColumnPrefs(p, MOBILE_COLUMNS_KEY);
      } else {
        setDesktopPrefs(p);
        writeColumnPrefs(p);
      }
    },
    [isMobile],
  );
  // On narrow desktop viewports the two-sided table cannot fit every column: drop the secondary
  // ones (OI bar below xl, IV below md) unless that would leave too little to read.
  const columns = useMemo(() => {
    let ids = columnPrefs.visible;
    if (isMobile) return visibleColumns(ids);
    const drop = (id: string) => {
      if (ids.length > 4 && ids.includes(id as (typeof ids)[number])) ids = ids.filter((x) => x !== id);
    };
    if (viewportW > 0 && viewportW < 1280) drop("oiBar");
    if (viewportW > 0 && viewportW < 768) drop("iv");
    return visibleColumns(ids);
  }, [columnPrefs.visible, viewportW, isMobile]);
  const deltas = useMemo(() => deltaTargets(model.rows), [model]);
  const sigmaPoints = useMemo(() => oneSigmaPoints(model), [model]);
  const gammaLevels = useMemo(() => (data && data.chain.length > 0 ? safeGammaLevels(data.chain, data.spotPrice, expiry, lotSize) : null), [data, expiry, lotSize]);
  const gammaMap = useStableBadgeMap(useMemo(() => gammaBadgeMap(gammaLevels, model.rows.map((r) => r.strike)), [gammaLevels, model]));
  const buildup = useMemo(() => buildupCounts(model.rows), [model]);

  // ── Basket ──
  const { legs, setLegs } = useBasket();
  const [basketOpen, setBasketOpen] = useState(false);
  const lotSizeFor = useCallback((s: string, e: string) => getLotSize(s, e) ?? (s === symbol ? lotSize : 0), [symbol, lotSize]);

  const addToBasket = useCallback(
    (newLegs: BasketLeg[], label: string) => {
      if (newLegs.length === 0) {
        toast.error("Could not build that position from this chain");
        return;
      }
      setLegs((prev) => addLegs(prev, newLegs));
      toast.success(`${label} added to basket`, {
        description: isSample ? "Priced from sample data" : `${newLegs.length} ${newLegs.length === 1 ? "leg" : "legs"} at mid / LTP`,
        action: { label: "View", onClick: () => setBasketOpen(true) },
      });
    },
    [setLegs, isSample],
  );

  const rowByStrike = useCallback((k: number): RowView | undefined => model.rows.find((r) => r.strike === k), [model]);
  const legCtx = useMemo(() => ({ symbol, expiry }), [symbol, expiry]);

  // Stable identity (reads the latest model) so memoised rows do not re-render on every poll.
  const onTrade = useLatestCallback((strike: number, type: OptionType, side: Side) => {
    const row = rowByStrike(strike);
    if (!row) return;
    addToBasket([legFromRow(row, type, side, legCtx)], `${side === "BUY" ? "Buy" : "Sell"} ${formatStrike(strike)} ${type}`);
  });
  const onStraddle = useCallback(
    (strike: number, side: Side) => addToBasket(buildStraddle(model.rows, strike, side, legCtx), `${side === "BUY" ? "Long" : "Short"} ${formatStrike(strike)} straddle`),
    [model, addToBasket, legCtx],
  );
  const onStrangle = useCallback(
    (strike: number, side: Side) => addToBasket(buildStrangle(model.rows, strike, sigmaPoints, side, legCtx), `${side === "BUY" ? "Long" : "Short"} ±1σ strangle`),
    [model, sigmaPoints, addToBasket, legCtx],
  );
  const onIronFly = useCallback((strike: number) => addToBasket(buildIronFly(model.rows, strike, legCtx), `Short ${formatStrike(strike)} iron fly`), [model, addToBasket, legCtx]);
  const [lastSent, setLastSent] = useState<BasketSent | null>(() => readBasketSent());
  // Hand a group of legs to the builder or paper trading, then mark them sent and clear them.
  const sendLegs = useCallback(
    (target: SendTarget, group: BasketLeg[]) => {
      if (group.length === 0) return;
      setBasketOpen(false);
      setLastSent(recordBasketSent(target, group));
      setLegs((prev) => removeLegs(prev, group));
      navigate(sendUrl(target, group));
    },
    [navigate, setLegs],
  );

  // ── Alerts ──
  const { alerts, addAlert, deleteAlert } = useStrikeAlerts(symbol, expiry, model.rows, dataUpdatedAt);
  const [alertState, setAlertState] = useState<{ open: boolean; strike: number | null; type: OptionType }>({ open: false, strike: null, type: "CE" });
  const onAlert = useCallback((strike: number, type: OptionType) => setAlertState({ open: true, strike, type }), []);
  const onOIAnalysis = useCallback(
    (strike: number) => navigate(`/oi-analysis?${new URLSearchParams({ symbol, expiry, strike: String(strike) })}`),
    [navigate, symbol, expiry],
  );
  const onOpenContract = useCallback(
    (strike: number, type: OptionType) => {
      if (!expiry) return;
      navigate(`/contract/${encodeURIComponent(symbol)}/${expiry}/${strike}/${type}`);
    },
    [navigate, symbol, expiry],
  );

  // ── Focus, keyboard and scrolling ──
  const tableRef = useRef<HTMLDivElement>(null);
  const tableScrollsRight = useCanScrollRight(tableRef, [hasData, viewMode, columns, rows.length]);
  const [focusedStrike, setFocusedStrike] = useState<number | null>(null);
  const [focusedSide, setFocusedSide] = useState<OptionType>("CE");
  const onFocusRow = useCallback((strike: number, side: OptionType) => {
    setFocusedStrike(strike);
    setFocusedSide(side);
  }, []);

  useEffect(() => {
    setFocusedStrike(null);
  }, [symbol, expiry]);

  const scrollToStrike = useCallback((strike: number, mode: "centre" | "nearest") => {
    const box = tableRef.current;
    const tr = box?.querySelector<HTMLTableRowElement>(`tr[data-strike="${strike}"]`);
    if (!box || !tr) return;
    const boxRect = box.getBoundingClientRect();
    const r = tr.getBoundingClientRect();
    const head = box.querySelector("thead")?.getBoundingClientRect().height ?? 0;
    const foot = box.querySelector("tfoot")?.getBoundingClientRect().height ?? 0;
    const top = r.top - boxRect.top + box.scrollTop;
    if (mode === "centre") {
      box.scrollTop = Math.max(0, top - (box.clientHeight + head - foot) / 2 + r.height / 2);
      return;
    }
    const visTop = box.scrollTop + head;
    const visBottom = box.scrollTop + box.clientHeight - foot;
    if (top < visTop) box.scrollTop = top - head - 4;
    else if (top + r.height > visBottom) box.scrollTop = top + r.height - box.clientHeight + foot + 4;
  }, []);

  // Centre ATM only on the first load per symbol + expiry.
  const centred = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (viewMode !== "expiration" || !hasData || !Number.isFinite(model.atmStrike)) return;
    const key = `${symbol}|${expiry}`;
    if (centred.current.has(key)) return;
    centred.current.add(key);
    const id = window.requestAnimationFrame(() => {
      scrollToStrike(model.atmStrike, "centre");
      // When the table is wider than the screen (phones), centre the strike column sideways too.
      const box = tableRef.current;
      const th = box?.querySelector<HTMLElement>(`tr[data-strike="${model.atmStrike}"] th`);
      if (box && th && box.scrollWidth > box.clientWidth) box.scrollLeft = Math.max(0, th.offsetLeft - (box.clientWidth - th.offsetWidth) / 2);
    });
    return () => window.cancelAnimationFrame(id);
  }, [viewMode, hasData, model.atmStrike, symbol, expiry, scrollToStrike]);

  useEffect(() => {
    if (focusedStrike !== null) scrollToStrike(focusedStrike, "nearest");
  }, [focusedStrike, scrollToStrike]);

  const centreATM = useCallback(() => {
    if (viewMode === "expiration" && Number.isFinite(model.atmStrike)) {
      setFocusedStrike(model.atmStrike);
      scrollToStrike(model.atmStrike, "centre");
    }
  }, [viewMode, model.atmStrike, scrollToStrike]);

  const dialogsOpen = basketOpen || alertState.open;
  // Time of the last plain "g" press. The app-wide "g <key>" navigation chords
  // (useKeyboardShortcuts) must win over the chain's single-key actions, so the key right after a
  // "g" is left alone when it completes a route chord ("g s" navigates, it does not add a SELL).
  const lastG = useRef<number | null>(null);
  useEffect(() => {
    if (viewMode !== "expiration") return;
    const handler = (e: KeyboardEvent) => {
      if (e.defaultPrevented || dialogsOpen || e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(e.target)) return;
      const gAt = lastG.current;
      lastG.current = null;
      if (gAt !== null && Date.now() - gAt <= SEQUENCE_TIMEOUT_MS && !e.shiftKey && routeForShortcut(e.key)) return;
      const strikes = rows.map((r) => r.strike);
      const idx = focusedStrike !== null ? strikes.indexOf(focusedStrike) : -1;
      const move = (d: number) => {
        e.preventDefault();
        if (strikes.length === 0) return;
        const start = idx >= 0 ? idx : Math.max(0, strikes.indexOf(model.atmStrike));
        const nextIdx = idx >= 0 ? Math.min(strikes.length - 1, Math.max(0, start + d)) : start;
        setFocusedStrike(strikes[nextIdx]);
      };
      const focusedRow = focusedStrike !== null ? rowByStrike(focusedStrike) : undefined;
      switch (e.key) {
        case "r":
        case "R":
          e.preventDefault();
          void refetch();
          toast.message("Refreshing chain…", { duration: 1200 });
          return;
        case "j":
          move(1);
          return;
        case "k":
          move(-1);
          return;
        case "ArrowDown":
          if (idx >= 0) move(1);
          return;
        case "ArrowUp":
          if (idx >= 0) move(-1);
          return;
        case "ArrowLeft":
          if (idx >= 0) { e.preventDefault(); setFocusedSide("CE"); }
          return;
        case "ArrowRight":
          if (idx >= 0) { e.preventDefault(); setFocusedSide("PE"); }
          return;
        case "g":
          // No preventDefault: the global handler ignores defaultPrevented events and must still
          // see this "g" to start a navigation chord. Shift+G stays with the global Greeks toggle.
          if (e.shiftKey) return;
          lastG.current = Date.now();
          centreATM();
          return;
        case "Escape":
          if (idx >= 0) setFocusedStrike(null);
          return;
        case "a":
        case "A":
        case "b":
        case "B":
        case "s":
        case "S": {
          e.preventDefault();
          if (!focusedRow) {
            toast.message("Focus a strike first", { description: "Click a row or press J / K." });
            return;
          }
          const k = e.key.toLowerCase();
          if (k === "a") onTrade(focusedRow.strike, e.shiftKey ? "PE" : "CE", "BUY");
          else onTrade(focusedRow.strike, focusedSide, k === "b" ? "BUY" : "SELL");
          return;
        }
        default:
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [viewMode, dialogsOpen, rows, focusedStrike, focusedSide, model.atmStrike, rowByStrike, refetch, centreATM, onTrade]);

  // ── By-strike selection ──
  const [selectedStrike, setSelectedStrike] = useState<number | null>(null);
  useEffect(() => setSelectedStrike(null), [symbol]);

  // ── Downloads ──
  const downloadCSV = useCallback(() => {
    if (!hasData) {
      toast.error("No chain to export yet");
      return;
    }
    downloadText(`${symbol}_${expiry || "chain"}${isSample ? "_SAMPLE" : ""}_option_chain.csv`, chainToCSV(model.rows));
    toast.success(`Exported ${model.rows.length} strikes`);
  }, [hasData, symbol, expiry, isSample, model.rows]);

  const [snapshotBusy, setSnapshotBusy] = useState<string | null>(null);
  const downloadSnapshot = useCallback(
    async (exp: string) => {
      setSnapshotBusy(exp);
      try {
        let chain: OptionData[] = [];
        let spot = 0;
        let sample = false;
        try {
          const live = await queryClient.fetchQuery({ queryKey: ["chain-snapshot", symbol, exp], queryFn: () => fetchLiveOptionChain(symbol, exp), staleTime: 15000 });
          chain = live.chain;
          spot = live.spotPrice;
        } catch {
          const s = await buildSampleChainData(symbol, exp, "Snapshot fallback");
          chain = s.chain;
          spot = s.spotPrice;
          sample = true;
        }
        if (chain.length === 0) throw new Error("The feed returned an empty chain");
        const m = buildChainModel(chain, { spot, expiry: exp, lotSize: getLotSize(symbol, exp) ?? lotSize, symbol });
        downloadText(`${symbol}_${exp}${sample ? "_SAMPLE" : ""}_snapshot.csv`, chainToCSV(m.rows));
        if (sample) toast.warning("Live chain unavailable: downloaded a labelled sample snapshot");
        else toast.success(`Snapshot saved: ${m.rows.length} strikes`);
      } catch (err) {
        toast.error(`Snapshot failed: ${err instanceof Error ? err.message : "unknown error"}`);
      } finally {
        setSnapshotBusy(null);
      }
    },
    [queryClient, symbol, lotSize],
  );

  // ── Derived volume spikes (volume > 3× the side's average OI) ──
  const spikes = useMemo(() => {
    if (!hasData) return [] as Array<{ strike: number; ce: boolean; pe: boolean }>;
    const n = model.rows.length;
    const avgCe = model.totals.ceOi / n || 1;
    const avgPe = model.totals.peOi / n || 1;
    return model.rows
      .map((r) => ({ strike: r.strike, ce: r.ce.leg.volume > avgCe * 3 && r.ce.leg.volume > 0, pe: r.pe.leg.volume > avgPe * 3 && r.pe.leg.volume > 0 }))
      .filter((x) => x.ce || x.pe)
      .slice(0, 12);
  }, [hasData, model]);

  const dte = expiry ? dteLabel(expiry) : "—";

  // ── Price-chart overlays (derived from this chain) ──
  const chartLevels = useMemo(
    () => (hasData ? chainChartLevels({ maxPain: model.maxPain, maxOiStrike: model.maxOiStrike, gamma: gammaLevels }) : []),
    [hasData, model.maxPain, model.maxOiStrike, gammaLevels],
  );
  const chartCone = useMemo(() => {
    const anchor = Number.isFinite(model.forward) && model.forward > 0 ? model.forward : model.spot;
    if (!hasData || !expiry || !(model.atmIv > 0) || !(anchor > 0)) return undefined;
    return { expiry, anchor, iv: model.atmIv / 100 };
  }, [hasData, expiry, model.forward, model.spot, model.atmIv]);
  const spikeRef = useRef<HTMLDivElement>(null);
  const spikesOverflow = useCanScrollRight(spikeRef, [spikes.length, viewMode]);

  return (
    <div className="space-y-3 pb-4">
      <PageHeader
        icon={TableProperties}
        eyebrow="Chain & OI"
        title="Option Chain"
        description="NSE and BSE chain with Greeks, OI build-up, probabilities and a basket that hands off to the Strategy Builder or Paper Trading."
      />

      <ChainToolbar
        symbol={symbol}
        onSymbol={setSymbol}
        viewMode={viewMode}
        onViewMode={setViewMode}
        expiries={expiries}
        expiry={expiry}
        onExpiry={setExpiry}
        range={range}
        onRange={setRange}
        deltaView={deltaView}
        onDeltaView={setDeltaView}
        columnPrefs={columnPrefs}
        onColumnPrefs={setColumnPrefs}
        basketCount={legs.length}
        onOpenBasket={() => setBasketOpen(true)}
        onRefresh={() => void refetch()}
        isFetching={isFetching}
        onCentreATM={centreATM}
        showChart={showChart}
        onToggleChart={() => setShowChart((v) => !v)}
        onDownloadCSV={downloadCSV}
        onDownloadSnapshot={(e) => void downloadSnapshot(e)}
        snapshotBusy={snapshotBusy}
      />

      {showChart && !unknownSymbol && (
        <section aria-label={`${symbol} price chart with option levels`} className="rounded-card border border-border bg-card p-3 shadow-card">
          <Suspense
            fallback={
              <div className="flex h-[280px] items-center justify-center gap-2 text-sm text-muted-foreground" role="status">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading chart…
              </div>
            }
          >
            <StockChart
              symbol={symbol}
              inline
              height={280}
              levels={chartLevels}
              expectedMoveCone={chartCone}
              overlayNote={
                isSample
                  ? "Levels and cone are derived from the sample chain, not market data."
                  : `Levels and cone derived from the ${expiry ? formatDateIST(expiry) : ""} chain (walls from GEX when available, else highest OI).`
              }
            />
          </Suspense>
        </section>
      )}
      {!isSample && data?.afterHours && hasData && (
        <div role="status" className="flex items-start gap-2 rounded-tile border border-border bg-surface px-3 py-2 text-muted-foreground">
          <WifiOff className="mt-0.5 h-4 w-4 shrink-0" />
          <p className="text-xs">
            <span className="font-semibold text-foreground">Market closed.</span> Showing the last session's chain{data.cachedAt ? `, saved ${Math.max(1, Math.round((Date.now() - data.cachedAt) / 60000))} min ago` : ""}. OI, PCR and max pain reflect the closing picture.
          </p>
        </div>
      )}

      {unknownSymbol ? (
        <div role="alert" className="flex flex-col items-center justify-center gap-2 rounded-card border border-dashed border-border bg-card px-4 py-16 text-center">
          <SearchX className="h-10 w-10 text-muted-foreground opacity-40" aria-hidden="true" />
          <p className="font-semibold">Unknown F&amp;O symbol &ldquo;{symbol}&rdquo;</p>
          <p className="max-w-sm text-xs text-muted-foreground">
            {symbol} is not in the NSE or BSE derivatives list, so there is no option chain to show. Check the spelling, or pick one of these:
          </p>
          <div className="mt-2 flex flex-wrap justify-center gap-1.5">
            {nearestSymbols(symbol).map((s) => (
              <Button key={s} variant="outline" size="sm" onClick={() => setSymbol(s)}>
                {s}
              </Button>
            ))}
          </div>
        </div>
      ) : isError && !data ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-card border border-dashed border-border bg-card py-16 text-center">
          <WifiOff className="h-10 w-10 text-muted-foreground opacity-40" />
          <p className="font-semibold">Could not load the {symbol} chain</p>
          <p className="max-w-sm text-xs text-muted-foreground">{error instanceof Error ? error.message : "The data source did not respond."}</p>
          <Button variant="outline" size="sm" onClick={() => void refetch()} className="mt-2">
            <RefreshCw /> Try again
          </Button>
        </div>
      ) : (
        <>
          {hasData && (
            <ChainSummaryBar
              symbol={symbol}
              model={model}
              lotSize={lotSize}
              lotEffectiveFrom={lotEffectiveFrom(symbol, expiry)}
              dte={dte}
              gamma={gammaLevels}
              buildup={buildup}
              source={{ source: data?.source ?? "none", asOf: data?.asOf, stale: data?.stale, isLive: data?.isLive, reason: data?.reason }}
            />
          )}

          {viewMode === "expiration" && spikes.length > 0 && (
            <div className="flex items-center gap-2 rounded-tile border border-primary/25 bg-wash-brand/60 px-3 py-1.5 text-xs">
              <Flame className="h-3.5 w-3.5 shrink-0 text-primary-ink" aria-hidden="true" />
              <span className="shrink-0 font-semibold text-primary-ink">Volume spikes</span>
              <Badge variant="neutral" className="shrink-0" title="Volume above 3× the average OI on that side. Derived, not trade-level flow.">Derived</Badge>
              <div
                ref={spikeRef}
                role="group"
                aria-label="Strikes with volume spikes"
                className={cn(
                  "flex min-w-0 flex-1 items-center gap-1 overflow-x-auto py-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
                  spikesOverflow && "[mask-image:linear-gradient(to_right,black_calc(100%-2rem),transparent)]",
                )}
              >
                {spikes.map((s) => (
                  <button
                    key={s.strike}
                    type="button"
                    onClick={() => {
                      setFocusedStrike(s.strike);
                      scrollToStrike(s.strike, "centre");
                    }}
                    className="shrink-0 rounded-chip border border-border bg-card px-1.5 py-0.5 tabular-nums hover:bg-accent focus-visible:shadow-ember focus-visible:outline-none"
                  >
                    {formatStrike(s.strike)} {s.ce && <span className="text-bearish">CE</span>}
                    {s.ce && s.pe && "+"}
                    {s.pe && <span className="text-bullish">PE</span>}
                  </button>
                ))}
              </div>
            </div>
          )}

          {viewMode === "expiration" ? (
            <section className="overflow-hidden rounded-card border border-border bg-card shadow-card" aria-busy={isLoading}>
              {isLoading && !data ? (
                <div className="space-y-2 p-4" aria-label="Loading chain">
                  {SKELETON_ROWS.map((id) => (
                    <div key={id} className="flex items-center gap-2">
                      <Skeleton className="h-6 flex-1" />
                      <Skeleton className="h-6 w-20" />
                      <Skeleton className="h-6 flex-1" />
                    </div>
                  ))}
                </div>
              ) : !hasData ? (
                <div className="flex flex-col items-center justify-center gap-2 py-16 text-center text-muted-foreground">
                  <WifiOff className="h-10 w-10 opacity-40" />
                  <p className="font-semibold text-foreground">No strikes for {symbol} {expiry ? `(${expiry})` : ""}</p>
                  <p className="max-w-sm text-xs">The source returned an empty chain. Try another expiry, or check that the proxy is running on port 4002.</p>
                  <Button variant="outline" size="sm" className="mt-2" onClick={() => void refetch()}>
                    <RefreshCw /> Retry
                  </Button>
                </div>
              ) : (
                <>
                  <div className="relative">
                  <ChainTable
                    ref={tableRef}
                    symbol={symbol}
                    expiry={expiry}
                    model={model}
                    rows={rows}
                    columns={columns}
                    deltaView={deltaView}
                    deltas={deltas}
                    gammaMap={gammaMap}
                    focusedStrike={focusedStrike}
                    focusedSide={focusedSide}
                    onFocusRow={onFocusRow}
                    sigmaPoints={sigmaPoints}
                    onTrade={onTrade}
                    onStraddle={onStraddle}
                    onStrangle={onStrangle}
                    onIronFly={onIronFly}
                    onAlert={onAlert}
                    onOIAnalysis={onOIAnalysis}
                    onOpenContract={onOpenContract}
                  />
                  {/* Right-edge fade: the table scrolls sideways when the put side does not fit. */}
                  <div
                    aria-hidden="true"
                    className={cn(
                      "pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-card to-transparent transition-opacity duration-fast",
                      tableScrollsRight ? "opacity-100" : "opacity-0",
                    )}
                  />
                  </div>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border bg-surface px-3 py-2 text-[11px] text-muted-foreground">
                    <span>
                      Showing {rows.length} of {model.rows.length} strikes · step {model.step}
                    </span>
                    <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-[3px] border border-border bg-[hsl(var(--wash-itm))]" aria-hidden="true" /> In the money</span>
                    <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-[3px] bg-wash-brand/30 ring-1 ring-primary/55" aria-hidden="true" /> ATM</span>
                    <span className="inline-flex items-center gap-1">
                      <span className="inline-flex h-[14px] items-center rounded-chip bg-wash-warning px-1 text-[9px] font-bold leading-none text-warning" aria-hidden="true">MP</span> Max pain
                    </span>
                    {columns.some((c) => c.id === "buildup") && (
                      <span className="inline-flex flex-wrap items-center gap-1" aria-label="OI build-up: LB long build-up, SB short build-up, SC short covering, LU long unwinding">
                        {(["LB", "SB", "SC", "LU"] as const).map((k) => (
                          <BuildupBadge key={k} kind={k} variant="compact" className="h-4 text-[10px]" />
                        ))}
                        <span>build-up</span>
                      </span>
                    )}
                    {deltaView && <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-[3px] bg-wash-info" aria-hidden="true" /> 16Δ / 30Δ</span>}
                    {gammaMap.size > 0 && <span>CW call wall · PW put wall · AG abs. gamma · FLIP gamma flip</span>}
                    <span className="hidden md:inline">Right-click a row for straddles, alerts, the contract page and OI analysis.</span>
                    <span>Premium traded total {formatCompactIN(model.totals.cePremium + model.totals.pePremium, { symbol: true })}</span>
                  </div>
                </>
              )}
            </section>
          ) : (
            <ByStrikeView
              symbol={symbol}
              expiries={expiries}
              strikes={model.rows.map((r) => r.strike)}
              atmStrike={model.atmStrike}
              selectedStrike={selectedStrike}
              onSelectStrike={setSelectedStrike}
              mainSource={data?.source ?? "none"}
              fallbackLotSize={lotSize}
            />
          )}
        </>
      )}

      <p className="text-center text-[11px] text-muted-foreground">
        Data for education and research. Not investment advice. IV and Greeks marked with a dotted underline are computed locally (Black-76 on the chain forward); probabilities assume a lognormal distribution.
      </p>

      <BasketDrawer open={basketOpen} onOpenChange={setBasketOpen} legs={legs} onChange={setLegs} lotSizeFor={lotSizeFor} onSend={sendLegs} lastSent={lastSent} />
      <StrikeAlertDialog
        open={alertState.open}
        onOpenChange={(open) => setAlertState((s) => ({ ...s, open }))}
        symbol={symbol}
        expiry={expiry}
        strike={alertState.strike}
        defaultType={alertState.type}
        rows={model.rows}
        alerts={alerts}
        onSave={addAlert}
        onDelete={deleteAlert}
      />
    </div>
  );
}
