import { useState, useMemo, useRef, useCallback, useEffect } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger, ContextMenuSub, ContextMenuSubContent, ContextMenuSubTrigger } from "@/components/ui/context-menu";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Crosshair, Wifi, WifiOff, RefreshCw, Bell, TrendingUp, TrendingDown, Layers, ChevronLeft, ChevronRight, Settings2, Flame, Search, X, Download, BarChart3, ChevronDown, ChevronUp, History, Keyboard } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useLiveOptionChain } from "@/hooks/useMarketData";
import { StockChart } from "@/components/StockChart";
import { calculateGreeks } from "@/lib/mockData";
import { createPosition, savePositions, getPositions } from "@/lib/positionStore";
import { isLiveTradingEnabled } from "@/lib/brokerConfig";
import { placeOrder } from "@/lib/marketApi";
import { armLive } from "@/lib/liveArm";
import { TradeConfirmDialog, type PendingTrade } from "@/components/TradeConfirmDialog";
import { toast } from "sonner";

const PROXY_BASE = import.meta.env.VITE_PROXY_URL || "http://localhost:4002";

// ── Symbol categories for organized browsing ──
const SYMBOL_CATEGORIES: { label: string; symbols: { label: string; value: string }[] }[] = [
  {
    label: "Indices",
    symbols: [
      { label: "NIFTY 50", value: "NIFTY" },
      { label: "BANK NIFTY", value: "BANKNIFTY" },
      { label: "FIN NIFTY", value: "FINNIFTY" },
      { label: "MIDCAP NIFTY", value: "MIDCPNIFTY" },
    ],
  },
  {
    label: "Nifty 50 Stocks",
    symbols: [
      "RELIANCE", "TCS", "HDFCBANK", "INFY", "ICICIBANK", "HINDUNILVR",
      "SBIN", "BHARTIARTL", "ITC", "KOTAKBANK", "LT", "AXISBANK",
      "ASIANPAINT", "MARUTI", "TATAMOTORS", "SUNPHARMA", "TITAN",
      "WIPRO", "ULTRACEMCO", "BAJFINANCE", "HCLTECH", "NTPC",
      "POWERGRID", "ONGC", "ADANIENT", "ADANIPORTS", "COALINDIA",
      "DRREDDY", "NESTLEIND", "CIPLA", "BAJAJFINSV", "GRASIM",
      "JSWSTEEL", "BRITANNIA", "TECHM", "INDUSINDBK",
      "HINDALCO", "M&M", "APOLLOHOSP", "EICHERMOT", "DIVISLAB",
      "BPCL", "HEROMOTOCO", "TATASTEEL", "SBILIFE", "HDFCLIFE",
      "SHRIRAMFIN", "TRENT", "BAJAJ-AUTO",
    ].map(s => ({ label: s, value: s })),
  },
  {
    label: "Banking & Finance",
    symbols: [
      "BANKBARODA", "PNB", "CANBK", "IDFCFIRSTB", "FEDERALBNK",
      "BANDHANBNK", "RBLBANK", "AUBANK", "MANAPPURAM", "MUTHOOTFIN",
      "CHOLAFIN", "LICHSGFIN", "CANFINHOME", "ICICIGI", "ICICIPRULI",
      "HDFCAMC", "SBICARD", "RECLTD", "PFC",
    ].map(s => ({ label: s, value: s })),
  },
  {
    label: "IT & Technology",
    symbols: [
      "LTIM", "MPHASIS", "COFORGE", "PERSISTENT", "LTTS",
      "HAPPSTMNDS", "TATAELXSI", "DIXON",
    ].map(s => ({ label: s, value: s })),
  },
  {
    label: "Pharma & Healthcare",
    symbols: [
      "TORNTPHARM", "LUPIN", "AUROPHARMA", "BIOCON", "ALKEM",
      "IPCALAB", "LALPATHLAB", "METROPOLIS", "ABBOTINDIA", "SYNGENE", "GLENMARK",
    ].map(s => ({ label: s, value: s })),
  },
  {
    label: "Auto & Ancillary",
    symbols: [
      "ASHOKLEY", "ESCORTS", "TVSMOTOR", "MRF", "MOTHERSON",
      "EXIDEIND", "BALKRISIND", "BHARATFORG",
    ].map(s => ({ label: s, value: s })),
  },
  {
    label: "Metals & Mining",
    symbols: [
      "VEDL", "JINDALSTEL", "SAIL", "NMDC", "NATIONALUM",
      "MOIL", "HINDALCO", "TATASTEEL",
    ].map(s => ({ label: s, value: s })),
  },
  {
    label: "Energy & Oil",
    symbols: [
      "IOC", "GAIL", "PETRONET", "IGL", "MGL", "PIIND", "NHPC", "TATAPOWER",
    ].map(s => ({ label: s, value: s })),
  },
  {
    label: "Defence & PSU",
    symbols: [
      "HAL", "BEL", "BHEL", "IRCTC", "IRFC", "RVNL", "CONCOR", "SUZLON",
    ].map(s => ({ label: s, value: s })),
  },
  {
    label: "Infra & Capital Goods",
    symbols: [
      "SIEMENS", "ABB", "CUMMINSIND", "VOLTAS", "HAVELLS",
      "CROMPTON", "POLYCAB", "ADANIGREEN", "ADANITRANS",
    ].map(s => ({ label: s, value: s })),
  },
  {
    label: "FMCG & Consumer",
    symbols: [
      "GODREJCP", "DABUR", "MARICO", "COLPAL", "EMAMILTD", "UBL",
      "PAGEIND", "BATAINDIA", "JUBLFOOD",
    ].map(s => ({ label: s, value: s })),
  },
  {
    label: "Real Estate",
    symbols: [
      "DLF", "GODREJPROP", "OBEROIRLTY", "PRESTIGE", "BRIGADE", "PHOENIXLTD",
    ].map(s => ({ label: s, value: s })),
  },
  {
    label: "New Age & Others",
    symbols: [
      "ZOMATO", "PAYTM", "NYKAA", "POLICYBZR", "DELHIVERY", "INDIGO",
      "MCX", "PVRINOX", "SUNTV", "ZEEL", "IDEA",
    ].map(s => ({ label: s, value: s })),
  },
];

// Flat list for search
const ALL_SYMBOLS = SYMBOL_CATEGORIES.flatMap(cat => cat.symbols);

// ── Searchable Symbol Selector Component ──
function SymbolSearch({ value, onSelect, openSignal }: { value: string; onSelect: (v: string) => void; openSignal?: number }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const didMountRef = useRef(false);

  const filtered = useMemo(() => {
    if (!search) return SYMBOL_CATEGORIES;
    const q = search.toUpperCase();
    return SYMBOL_CATEGORIES
      .map(cat => ({
        ...cat,
        symbols: cat.symbols.filter(s =>
          s.value.includes(q) || s.label.toUpperCase().includes(q)
        ),
      }))
      .filter(cat => cat.symbols.length > 0);
  }, [search]);

  const currentLabel = ALL_SYMBOLS.find(s => s.value === value)?.label || value;

  useEffect(() => {
    if (open && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open]);

  // Let the parent open this popover programmatically (⌘K / Ctrl+K shortcut).
  // Skip the initial mount so it doesn't pop open on first render.
  useEffect(() => {
    if (!didMountRef.current) { didMountRef.current = true; return; }
    if (openSignal !== undefined) setOpen(true);
  }, [openSignal]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" className="w-[160px] h-8 text-xs font-medium justify-between gap-1.5" role="combobox">
          <span className="truncate">{currentLabel}</span>
          <Search className="h-3 w-3 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[280px] p-0" align="start">
        <div className="flex items-center border-b border-border/70 px-3 py-2 gap-2">
          <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <Input
            ref={inputRef}
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search F&O symbols..."
            className="h-7 border-0 p-0 text-xs focus-visible:ring-0 shadow-none"
          />
          {search && (
            <Button variant="ghost" size="icon" className="h-5 w-5 shrink-0" onClick={() => setSearch("")}>
              <X className="h-3 w-3" />
            </Button>
          )}
        </div>
        <ScrollArea className="h-[320px]">
          <div className="p-1">
            {filtered.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-4">No symbols found</p>
            ) : (
              filtered.map(cat => (
                <div key={cat.label}>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-2 py-1.5 sticky top-0 bg-popover">
                    {cat.label}
                  </p>
                  <div className="grid grid-cols-3 gap-0.5">
                    {cat.symbols.map(s => (
                      <button
                        key={s.value}
                        onClick={() => { onSelect(s.value); setOpen(false); setSearch(""); }}
                        className={`text-xs px-2 py-1.5 rounded text-left transition-colors hover:bg-accent ${
                          s.value === value ? "bg-primary/10 text-primary font-semibold" : ""
                        }`}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}

// ── Volume Bar ──
function VolumeBar({ value, max, side }: { value: number; max: number; side: "call" | "put" }) {
  const pct = Math.min((value / max) * 100, 100);
  return (
    <div className="flex items-center gap-1.5">
      <span className={`text-xs font-mono tabular-nums ${value > max * 0.7 ? (side === "call" ? "text-primary font-semibold" : "text-bearish font-semibold") : ""}`}>
        {value >= 1000000 ? (value / 1000000).toFixed(1) + "M" : value >= 1000 ? (value / 1000).toFixed(0) + "K" : value.toLocaleString("en-IN")}
      </span>
      <div className="w-[50px] h-[6px] rounded-sm bg-muted/40 overflow-hidden">
        <div
          className={`h-full rounded-sm transition-all ${side === "call" ? "bg-primary/60" : "bg-bearish/50"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

// ── OI Bar (colored by value intensity with smooth animations) ──
function OIBar({ value, max, side }: { value: number; max: number; side: "call" | "put" }) {
  const pct = Math.min((value / max) * 100, 100);
  const isHigh = pct > 60;
  const isMega = pct > 85;
  const opacity = 0.25 + (pct / 100) * 0.65; // Scale from 0.25 to 0.9
  return (
    <div className="flex items-center gap-1.5 group" title={`${value.toLocaleString("en-IN")} (${pct.toFixed(1)}% of max)`}>
      <span className={`text-xs font-mono tabular-nums transition-colors ${isHigh ? (side === "call" ? "text-primary font-semibold" : "text-bearish font-semibold") : ""}`}>
        {value >= 1000000 ? (value / 1000000).toFixed(1) + "M" : value >= 1000 ? (value / 1000).toFixed(0) + "K" : value.toLocaleString("en-IN")}
      </span>
      <div className={`w-[55px] h-[7px] rounded-sm overflow-hidden ${side === "call" ? "bg-primary/8" : "bg-bearish/8"}`}>
        <div
          className={`h-full rounded-sm transition-all duration-500 ease-out ${
            side === "call"
              ? isMega ? "bg-primary shadow-[0_0_6px_hsl(var(--primary)/0.4)]" : "bg-primary"
              : isMega ? "bg-bearish shadow-[0_0_6px_hsl(var(--bearish)/0.4)]" : "bg-bearish"
          }`}
          style={{ width: `${pct}%`, opacity }}
        />
      </div>
    </div>
  );
}

// ── Real Black-Scholes Rho ──
// Previously this column was a placeholder derived from delta (0.{delta*22}) instead of an
// actual Greek, which is misleading on a terminal used for real trading decisions. Rho isn't
// supplied by either the Dhan or NSE option-chain feeds, but calculateGreeks() (used elsewhere
// for What-If/Payoff analysis) already implements it — reuse it here with a 6.5% risk-free
// rate assumption, matching the convention used in StrategyBuilder.tsx.
function computeRho(spot: number, strike: number, daysToExpiry: number, iv: number, side: "call" | "put"): number {
  if (!spot || !strike || !iv || iv <= 0) return 0;
  const g = calculateGreeks(spot, strike, Math.max(daysToExpiry, 0.5), iv, 6.5);
  const v = side === "call" ? g.rho.call : g.rho.put;
  return Number.isFinite(v) ? v : 0;
}

export default function OptionChain() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [symbol, setSymbol] = useState(searchParams.get("symbol") || "NIFTY");
  const [selectedExpiry, setSelectedExpiry] = useState<string | undefined>(undefined);
  const [viewMode, setViewMode] = useState<"expiration" | "strike">("expiration");
  const [selectedStrike, setSelectedStrike] = useState<number | null>(null);
  const [columnConfig, setColumnConfig] = useState({
    iv: true, delta: true, gamma: false, theta: false, vega: false, rho: false,
    intrinsic: false, timeValue: false, bid: true, ask: true, price: true,
    volume: true, oi: true, oiChange: true,
  });
  const atmRef = useRef<HTMLTableRowElement>(null);
  const strikeScrollRef = useRef<HTMLDivElement>(null);
  const [showChart, setShowChart] = useState(false);
  const [isDownloadingPast, setIsDownloadingPast] = useState(false);
  const [focusedStrikeIdx, setFocusedStrikeIdx] = useState<number>(-1);
  const [searchOpenSignal, setSearchOpenSignal] = useState(0);

  const quickTrade = useCallback((strike: number, type: "CE" | "PE", action: "BUY" | "SELL", premium?: number) => {
    const params: Record<string, string> = { symbol, strike: String(strike), type, action };
    if (premium && Number.isFinite(premium) && premium > 0) params.premium = String(premium);
    navigate(`/strategy-builder?${new URLSearchParams(params)}`);
  }, [symbol, navigate]);

  // Switching symbols must drop stale strike/focus state from the previous underlying —
  // otherwise "By Strike" view kept showing/matching a strike price from the OLD symbol
  // (e.g. a BANKNIFTY strike surviving a switch to NIFTY), and the keyboard-focused row
  // index could point at an unrelated strike in the new chain.
  const handleSymbolSelect = useCallback((v: string) => {
    setSymbol(v);
    setSelectedExpiry(undefined);
    setSelectedStrike(null);
    setFocusedStrikeIdx(-1);
  }, []);

  const { data, isLoading, refetch } = useLiveOptionChain(symbol, selectedExpiry);

  const chain = useMemo(() => data?.chain ?? [], [data]);
  const expiries = useMemo(() => data?.expiries ?? [], [data]);
  const spotPrice = data?.spotPrice ?? 0;
  const lotSize = data?.lotSize ?? 25;
  const stepSize = data?.stepSize ?? 50;
  const maxPain = data?.maxPain ?? 0;
  const isLive = data?.isLive ?? false;
  const afterHours = data?.afterHours ?? false;
  const hasData = chain.length > 0;

  // Quick trade — immediate fill (paper) or a real order (live), as opposed to
  // `quickTrade` above which plans a trade in Strategy Builder. Paper vs live
  // is decided per-click (see handleContextAction) and carried on the pending
  // trade's mode, not on component state, so a paper click never accidentally
  // resolves against a live-mode confirm handler or vice versa.
  const [pendingTrade, setPendingTrade] = useState<PendingTrade | null>(null);
  const [tradeMode, setTradeMode] = useState<"paper" | "live">("paper");
  const [placingTrade, setPlacingTrade] = useState(false);

  const handleQuickFill = useCallback((strike: number, optionType: "CE" | "PE", action: "BUY" | "SELL", price: number) => {
    setTradeMode("paper");
    setPendingTrade({ symbol, strike, optionType, action, lots: 1, price, lotSize });
  }, [symbol, lotSize]);

  const handleLiveOrderClick = useCallback((strike: number, optionType: "CE" | "PE", action: "BUY" | "SELL", price: number, securityId?: string, exchangeSegment?: string) => {
    if (!securityId) {
      toast.info("Live order unavailable for this row (no Dhan security ID — likely showing NSE fallback data). Falling back to paper.", { duration: 5000 });
      handleQuickFill(strike, optionType, action, price);
      return;
    }
    setTradeMode("live");
    setPendingTrade({ symbol, strike, optionType, action, lots: 1, price, lotSize, securityId, exchangeSegment });
  }, [symbol, lotSize, handleQuickFill]);

  const handleConfirmTrade = useCallback(async () => {
    if (!pendingTrade) return;
    setPlacingTrade(true);
    try {
      if (tradeMode === "live") {
        // The token is what makes this call type-check at all — see liveArm.ts.
        // requireOneClick is false: this path already showed a confirm dialog.
        const { token, message } = armLive(false);
        if (!token) throw new Error(message || "Live trading gate refused this order.");

        const result = await placeOrder({
          transactionType: pendingTrade.action,
          exchangeSegment: pendingTrade.exchangeSegment || "NSE_FNO",
          productType: "INTRADAY",
          orderType: "LIMIT",
          validity: "DAY",
          securityId: pendingTrade.securityId!,
          lots: pendingTrade.lots,
          price: pendingTrade.price,
        }, token);
        // Report the size the SERVER resolved, not what this page assumed — the
        // two can differ when the local lot-size table is stale.
        const sizeNote = result.quantity ? ` · qty ${result.quantity} (lot ${result.resolvedLotSize})` : "";
        toast.success(`Order placed: ${result.orderId} (${result.orderStatus})${sizeNote}`, {
          description: `${pendingTrade.action} ${pendingTrade.symbol} ${pendingTrade.strike} ${pendingTrade.optionType}`,
          action: { label: "View Orders", onClick: () => navigate("/orders") },
        });
      } else {
        const position = createPosition({
          symbol: pendingTrade.symbol,
          type: pendingTrade.optionType,
          action: pendingTrade.action,
          strike: pendingTrade.strike,
          entryPrice: pendingTrade.price,
          lots: pendingTrade.lots,
          lotSize: pendingTrade.lotSize,
          expiry: selectedExpiry || expiries[0]?.value || "",
        });
        savePositions([...getPositions(), position]);
        toast.success(`Paper position added: ${pendingTrade.action} ${pendingTrade.symbol} ${pendingTrade.strike} ${pendingTrade.optionType}`, {
          description: "View it in Position Tracker.",
          action: { label: "View", onClick: () => navigate("/position-tracker") },
        });
      }
    } catch (e) {
      // Dhan's real rejection message (e.g. the static-IP block) surfaces here verbatim.
      toast.error(`${tradeMode === "live" ? "Order failed" : "Could not add paper position"}: ${(e as Error).message}`, { duration: 8000 });
    } finally {
      setPlacingTrade(false);
      setPendingTrade(null);
    }
  }, [pendingTrade, tradeMode, selectedExpiry, expiries, navigate]);

  const atmStrike = useMemo(() => Math.round(spotPrice / stepSize) * stepSize, [spotPrice, stepSize]);
  const totalCEOI = chain.reduce((s, o) => s + o.ce.oi, 0);
  const totalPEOI = chain.reduce((s, o) => s + o.pe.oi, 0);
  const pcr = totalCEOI > 0 ? (totalPEOI / totalCEOI).toFixed(2) : "0";
  const maxOI = Math.max(...chain.map(o => Math.max(o.ce.oi, o.pe.oi)), 1);
  const maxVol = Math.max(...chain.map(o => Math.max(o.ce.volume, o.pe.volume)), 1);
  const totalCEVol = chain.reduce((s, o) => s + o.ce.volume, 0);
  const totalPEVol = chain.reduce((s, o) => s + o.pe.volume, 0);
  const atmRow = chain.find(o => o.strikePrice === atmStrike);

  // ── Unusual Activity Detection: volume > 3x average OI ratio ──
  const unusualActivity = useMemo(() => {
    if (chain.length === 0) return { flags: new Map<number, { ce: boolean; pe: boolean }>(), count: 0, hotStrikes: [] as number[] };
    const avgCEOI = totalCEOI / chain.length || 1;
    const avgPEOI = totalPEOI / chain.length || 1;
    const flags = new Map<number, { ce: boolean; pe: boolean }>();
    const hotStrikes: number[] = [];
    chain.forEach(row => {
      const ceUnusual = row.ce.volume > avgCEOI * 3 && row.ce.volume > 50000;
      const peUnusual = row.pe.volume > avgPEOI * 3 && row.pe.volume > 50000;
      if (ceUnusual || peUnusual) {
        flags.set(row.strikePrice, { ce: ceUnusual, pe: peUnusual });
        hotStrikes.push(row.strikePrice);
      }
    });
    return { flags, count: flags.size, hotStrikes };
  }, [chain, totalCEOI, totalPEOI]);

  useEffect(() => {
    if (chain.length > 0 && atmRef.current && viewMode === "expiration") {
      setTimeout(() => atmRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 300);
    }
  }, [chain.length, viewMode]);

  useEffect(() => {
    if (chain.length > 0 && !selectedStrike) setSelectedStrike(atmStrike);
  }, [chain.length, atmStrike, selectedStrike]);

  const scrollToATM = useCallback(() => {
    if (viewMode === "expiration") {
      atmRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    } else {
      setSelectedStrike(atmStrike);
    }
  }, [viewMode, atmStrike]);

  const handleContextAction = (strike: number, type: "CE" | "PE", action: string, premium?: number, securityId?: string, exchangeSegment?: string) => {
    switch (action) {
      case "buy": quickTrade(strike, type, "BUY", premium); break;
      case "sell": quickTrade(strike, type, "SELL", premium); break;
      case "quickfill-buy": handleQuickFill(strike, type, "BUY", premium ?? 0); break;
      case "quickfill-sell": handleQuickFill(strike, type, "SELL", premium ?? 0); break;
      case "liveorder-buy": handleLiveOrderClick(strike, type, "BUY", premium ?? 0, securityId, exchangeSegment); break;
      case "liveorder-sell": handleLiveOrderClick(strike, type, "SELL", premium ?? 0, securityId, exchangeSegment); break;
      case "straddle":
        toast.success(`Added ${strike} Straddle to Strategy Builder`);
        quickTrade(strike, "CE", "BUY", premium);
        break;
      case "alert": toast.success(`Alert set for ${symbol} ${strike} ${type}`); break;
      case "oi-analysis": navigate(`/oi-analysis`); break;
    }
  };

  // Days-to-expiry for the currently selected expiry (used for real Greeks calc below)
  const currentDTE = useMemo(
    () => expiries.find(e => e.value === (selectedExpiry || expiries[0]?.value))?.daysToExpiry ?? 7,
    [expiries, selectedExpiry]
  );

  // Compute intrinsic + time values + real rho
  const enrichedChain = useMemo(() => chain.map(row => {
    const ceIntrinsic = Math.max(spotPrice - row.strikePrice, 0);
    const peIntrinsic = Math.max(row.strikePrice - spotPrice, 0);
    return {
      ...row,
      ce: {
        ...row.ce, intrinsic: ceIntrinsic, timeValue: Math.max(row.ce.ltp - ceIntrinsic, 0),
        rho: computeRho(spotPrice, row.strikePrice, currentDTE, row.ce.iv, "call"),
      },
      pe: {
        ...row.pe, intrinsic: peIntrinsic, timeValue: Math.max(row.pe.ltp - peIntrinsic, 0),
        rho: computeRho(spotPrice, row.strikePrice, currentDTE, row.pe.iv, "put"),
      },
    };
  }), [chain, spotPrice, currentDTE]);

  // "By Strike" view: the same strike across the nearest real expiries. Only
  // fetched once this tab is actually open (enabled gate below) — mirrors the
  // multi-expiry-fetch approach MultiExpiryOI.tsx already uses for OI overlays,
  // just pivoted to one strike's row instead of OI-by-strike.
  const strikeViewActive = viewMode === "strike";
  const { data: byStrikeChain0 } = useLiveOptionChain(symbol, expiries[0]?.value, strikeViewActive && !!expiries[0]);
  const { data: byStrikeChain1 } = useLiveOptionChain(symbol, expiries[1]?.value, strikeViewActive && !!expiries[1]);
  const { data: byStrikeChain2 } = useLiveOptionChain(symbol, expiries[2]?.value, strikeViewActive && !!expiries[2]);
  const { data: byStrikeChain3 } = useLiveOptionChain(symbol, expiries[3]?.value, strikeViewActive && !!expiries[3]);

  const byStrikeData = useMemo(() => {
    if (!selectedStrike) return [];
    const chainsByExpiry = [byStrikeChain0, byStrikeChain1, byStrikeChain2, byStrikeChain3];
    return expiries.slice(0, 4).flatMap((exp, i) => {
      const expiryChain = chainsByExpiry[i];
      const row = expiryChain?.chain.find(r => r.strikePrice === selectedStrike);
      if (!expiryChain || !row) return [];
      const rowSpot = expiryChain.spotPrice || spotPrice;
      return [{
        expiry: exp.label,
        daysToExpiry: exp.daysToExpiry,
        ce: {
          ...row.ce,
          intrinsic: Math.max(rowSpot - selectedStrike, 0),
          timeValue: Math.max(row.ce.ltp - Math.max(rowSpot - selectedStrike, 0), 0),
          rho: computeRho(rowSpot, selectedStrike, exp.daysToExpiry, row.ce.iv, "call"),
        },
        pe: {
          ...row.pe,
          intrinsic: Math.max(selectedStrike - rowSpot, 0),
          timeValue: Math.max(row.pe.ltp - Math.max(selectedStrike - rowSpot, 0), 0),
          rho: computeRho(rowSpot, selectedStrike, exp.daysToExpiry, row.pe.iv, "put"),
        },
      }];
    });
  }, [selectedStrike, expiries, byStrikeChain0, byStrikeChain1, byStrikeChain2, byStrikeChain3, spotPrice]);

  const allStrikes = enrichedChain.map(r => r.strikePrice);

  // ── Keyboard Navigation: J/K to move, G to jump to ATM, R to refresh, ⌘K to search, A to add ──
  // NOTE: the shortcuts popover (below) has always advertised ⌘K / R / A, but only J/K/G were
  // ever wired up — the rest were dead. Implemented here so the UI isn't lying about what it does.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;

      // Global shortcuts — work regardless of view mode
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpenSignal(s => s + 1);
        return;
      }
      if (e.key.toLowerCase() === "r" && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        refetch();
        return;
      }

      if (viewMode !== "expiration" || !hasData) return;

      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        setFocusedStrikeIdx(prev => Math.min(prev + 1, enrichedChain.length - 1));
      } else if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        setFocusedStrikeIdx(prev => Math.max(prev - 1, 0));
      } else if (e.key === "g") {
        const atmIdx = enrichedChain.findIndex(r => r.strikePrice === atmStrike);
        if (atmIdx >= 0) { setFocusedStrikeIdx(atmIdx); scrollToATM(); }
      } else if (e.key.toLowerCase() === "a") {
        e.preventDefault();
        const idx = focusedStrikeIdx >= 0 ? focusedStrikeIdx : enrichedChain.findIndex(r => r.strikePrice === atmStrike);
        const row = enrichedChain[idx];
        if (row) quickTrade(row.strikePrice, "CE", "BUY", row.ce.ltp);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [viewMode, hasData, enrichedChain, atmStrike, scrollToATM, refetch, focusedStrikeIdx, quickTrade]);

  // ── CSV Download: Export current option chain ──
  const downloadCSV = useCallback(() => {
    if (enrichedChain.length === 0) {
      toast.error("No data to export");
      return;
    }
    const expLabel = expiries.find(e => e.value === (selectedExpiry || expiries[0]?.value))?.label || "current";
    const headers = ["Strike","CE_LTP","CE_IV","CE_Delta","CE_Gamma","CE_Theta","CE_Vega","CE_OI","CE_Volume","CE_Bid","CE_Ask","PE_LTP","PE_IV","PE_Delta","PE_Gamma","PE_Theta","PE_Vega","PE_OI","PE_Volume","PE_Bid","PE_Ask"];
    const rows = enrichedChain.map(r => [
      r.strikePrice, r.ce.ltp, r.ce.iv, r.ce.delta, r.ce.gamma, r.ce.theta, r.ce.vega, r.ce.oi, r.ce.volume, r.ce.bidPrice, r.ce.askPrice,
      r.pe.ltp, r.pe.iv, r.pe.delta, r.pe.gamma, r.pe.theta, r.pe.vega, r.pe.oi, r.pe.volume, r.pe.bidPrice, r.pe.askPrice,
    ].join(","));
    const csv = [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${symbol}_${expLabel.replace(/\s+/g, "_")}_option_chain.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${enrichedChain.length} strikes to CSV`);
  }, [enrichedChain, symbol, expiries, selectedExpiry]);

  // ── Download Past Option Chain from Dhan API ──
  const downloadPastOC = useCallback(async (pastExpiry: string) => {
    setIsDownloadingPast(true);
    try {
      const res = await fetch(`${PROXY_BASE}/api/dhan-proxy?endpoint=option-chain&symbol=${symbol}&expiry=${pastExpiry}`, {
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) throw new Error(`API error: ${res.status}`);
      const json = await res.json();
      const chainData = json?.data || json;

      // Parse Dhan option chain response into CSV
      if (chainData && typeof chainData === "object") {
        const headers = ["Strike","CE_LTP","CE_IV","CE_OI","CE_Volume","CE_Delta","CE_Bid","CE_Ask","PE_LTP","PE_IV","PE_OI","PE_Volume","PE_Delta","PE_Bid","PE_Ask"];
        const rows: string[] = [];
        
        // Dhan returns data keyed by strike price
        const oc = chainData.oc || chainData;
        if (Array.isArray(oc)) {
          oc.forEach((row: any) => {
            rows.push([
              row.strikePrice || row.strike_price || "",
              row.ce_ltp || row.call_ltp || "",
              row.ce_iv || row.call_iv || "",
              row.ce_oi || row.call_oi || "",
              row.ce_volume || row.call_volume || "",
              row.ce_delta || "",
              row.ce_bid || "",
              row.ce_ask || "",
              row.pe_ltp || row.put_ltp || "",
              row.pe_iv || row.put_iv || "",
              row.pe_oi || row.put_oi || "",
              row.pe_volume || row.put_volume || "",
              row.pe_delta || "",
              row.pe_bid || "",
              row.pe_ask || "",
            ].join(","));
          });
        }

        if (rows.length === 0) {
          // Fallback: dump raw JSON as CSV
          const blob = new Blob([JSON.stringify(chainData, null, 2)], { type: "application/json" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `${symbol}_${pastExpiry}_option_chain_raw.json`;
          a.click();
          URL.revokeObjectURL(url);
          toast.success(`Downloaded raw option chain data for ${pastExpiry}`);
        } else {
          const csv = [headers.join(","), ...rows].join("\n");
          const blob = new Blob([csv], { type: "text/csv" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `${symbol}_${pastExpiry}_option_chain.csv`;
          a.click();
          URL.revokeObjectURL(url);
          toast.success(`Exported ${rows.length} strikes for ${pastExpiry}`);
        }
      }
    } catch (err: any) {
      toast.error(`Failed to download: ${err.message}`);
    } finally {
      setIsDownloadingPast(false);
    }
  }, [symbol]);

  // Active columns count for colSpan
  const callCols = [columnConfig.iv, columnConfig.intrinsic, columnConfig.timeValue, columnConfig.rho, columnConfig.vega, columnConfig.theta, columnConfig.gamma, columnConfig.delta, columnConfig.price, columnConfig.ask, columnConfig.bid, columnConfig.oiChange, columnConfig.oi, columnConfig.volume].filter(Boolean).length;
  const putCols = callCols;

  return (
    <div className="space-y-3">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <SymbolSearch value={symbol} onSelect={handleSymbolSelect} openSignal={searchOpenSignal} />

          {/* View Mode Tabs */}
          <ToggleGroup type="single" value={viewMode} onValueChange={(v) => v && setViewMode(v as any)} className="bg-muted rounded-md p-0.5">
            <ToggleGroupItem value="expiration" className="text-xs h-7 px-3 data-[state=on]:bg-background data-[state=on]:shadow-sm rounded">
              By expiration
            </ToggleGroupItem>
            <ToggleGroupItem value="strike" className="text-xs h-7 px-3 data-[state=on]:bg-background data-[state=on]:shadow-sm rounded">
              By strike
            </ToggleGroupItem>
          </ToggleGroup>
        </div>

        <div className="flex items-center gap-2">
          <Badge variant="outline" className={`gap-1 text-xs ${isLive ? "border-bullish/50 text-bullish" : afterHours ? "border-warning/50 text-warning" : "border-destructive/40 text-destructive"}`}>
            {isLive ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
            {isLive ? (data?.source === "nse" ? "NSE" : data?.source?.toUpperCase() || "DHAN") : afterHours ? "CLOSED" : "OFFLINE"}
          </Badge>
          <span className="text-xs font-mono">
            {symbol} <span className="font-semibold text-foreground">{spotPrice.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            {afterHours && <span className="text-warning/60 ml-1 text-xs">(Last Close)</span>}
          </span>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => refetch()}>
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={scrollToATM}>
            <Crosshair className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setShowChart(v => !v)} title="Toggle Price Chart">
            <BarChart3 className={`h-3.5 w-3.5 ${showChart ? "text-primary" : ""}`} />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={downloadCSV} title="Download CSV">
            <Download className="h-3.5 w-3.5" />
          </Button>

          {/* Download Past OC Data */}
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7" title="Download Past Option Chain">
                <History className="h-3.5 w-3.5" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-56 p-3" align="end">
              <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider">Download Past Expiry</p>
              <div className="space-y-1">
                {expiries.map(exp => (
                  <button
                    key={exp.value}
                    onClick={() => downloadPastOC(exp.value)}
                    disabled={isDownloadingPast}
                    className="w-full text-left px-2 py-1.5 rounded text-xs hover:bg-accent transition-colors flex items-center justify-between"
                  >
                    <span>{exp.label} ({exp.daysToExpiry}d)</span>
                    <Download className="h-3 w-3 text-muted-foreground" />
                  </button>
                ))}
              </div>
            </PopoverContent>
          </Popover>

        {/* Column Config */}
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7"><Settings2 className="h-3.5 w-3.5" /></Button>
            </PopoverTrigger>
            <PopoverContent className="w-48 p-3" align="end">
              <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider">Show Columns</p>
              <div className="space-y-1.5">
                {Object.entries(columnConfig).map(([key, val]) => (
                  <div key={key} className="flex items-center justify-between">
                    <Label className="text-xs capitalize">{key === "oiChange" ? "OI Change" : key === "oi" ? "OI" : key === "timeValue" ? "Time Value" : key}</Label>
                    <Switch checked={val} onCheckedChange={(v) => setColumnConfig({ ...columnConfig, [key]: v })} className="scale-[0.6]" />
                  </div>
                ))}
              </div>
            </PopoverContent>
          </Popover>

          {/* Shortcuts Info */}
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-primary transition-colors" title="Keyboard Shortcuts">
                <kbd className="font-mono text-xs px-1.5 py-0.5 rounded border border-border/50 bg-accent/30 font-semibold shadow-sm">?</kbd>
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-64 p-4" align="end">
              <p className="text-xs font-semibold text-muted-foreground mb-3 uppercase tracking-wider flex items-center gap-2">
                <Keyboard className="h-3.5 w-3.5" />
                Keyboard Shortcuts
              </p>
              <div className="space-y-2 text-xs">
                <div className="flex justify-between items-center"><span className="text-muted-foreground">Focus Search</span><kbd className="px-1.5 py-0.5 rounded bg-muted border font-mono">⌘K</kbd></div>
                <div className="flex justify-between items-center"><span className="text-muted-foreground">Refresh Data</span><kbd className="px-1.5 py-0.5 rounded bg-muted border font-mono">R</kbd></div>
                <div className="flex justify-between items-center"><span className="text-muted-foreground">Next Strike</span><kbd className="px-1.5 py-0.5 rounded bg-muted border font-mono">J</kbd></div>
                <div className="flex justify-between items-center"><span className="text-muted-foreground">Prev Strike</span><kbd className="px-1.5 py-0.5 rounded bg-muted border font-mono">K</kbd></div>
                <div className="flex justify-between items-center"><span className="text-muted-foreground">Add to Strategy</span><kbd className="px-1.5 py-0.5 rounded bg-muted border font-mono">A</kbd></div>
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </div>

      {/* Price Chart (collapsible) */}
      {showChart && (
        <StockChart
          symbol={symbol}
          inline
          height={280}
          chain={chain}
          spotPrice={spotPrice}
          lotSize={lotSize}
          daysToExpiry={currentDTE}
        />
      )}

      {/* Expiry selector */}
      {viewMode === "expiration" && expiries.length > 0 && (
        <div className="flex items-center gap-1.5">
          {expiries.slice(0, 5).map((exp, i) => {
            const parts = exp.label.split(" ");
            const isSelected = (selectedExpiry || expiries[0]?.value) === exp.value;
            return (
              <button
                key={exp.value}
                onClick={() => setSelectedExpiry(exp.value)}
                className={`flex flex-col items-center px-3 py-1.5 rounded-md text-xs transition-colors duration-200 border ${
                  isSelected
                    ? "bg-primary text-primary-foreground border-primary font-semibold"
                    : "bg-card border-border hover:bg-accent/50 hover:border-primary/30"
                }`}
              >
                <span className="text-xs opacity-70">{parts[1]}</span>
                <span className="font-semibold text-sm leading-none">{parts[0]}</span>
              </button>
            );
          })}
          {expiries.length > 5 && (
            <Select value={selectedExpiry || expiries[0]?.value} onValueChange={setSelectedExpiry}>
              <SelectTrigger className="w-[100px] h-8 text-xs"><SelectValue placeholder="More..." /></SelectTrigger>
              <SelectContent>
                {expiries.slice(5).map(e => (
                  <SelectItem key={e.value} value={e.value}>{e.label} ({e.daysToExpiry}d)</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      )}

      {/* After-Hours Banner */}
      {afterHours && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-warning/10 border border-warning/20 text-warning">
          <WifiOff className="h-4 w-4 shrink-0" />
          <div className="flex-1">
            <p className="text-xs font-medium">Market Closed — {hasData ? "Showing Last Available Data" : "No Cached Data Available"}</p>
            <p className="text-xs text-warning/60 mt-0.5">
              {hasData
                ? "Data is from the last market session. PCR, Max Pain, and OI values reflect closing snapshot."
                : "Option chain data will be available once the market opens (9:15 AM IST) or when the proxy has cached data."}
              {data?.cachedAt && ` Cached ${Math.round((Date.now() - data.cachedAt) / 60000)} min ago.`}
            </p>
          </div>
        </div>
      )}

      {/* Empty State: No data and not loading */}
      {!hasData && !afterHours && data !== undefined && (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground border border-dashed border-border/50 rounded-lg bg-card/30">
          <WifiOff className="h-10 w-10 mb-3 opacity-40 animate-pulse" />
          <p className="text-base font-semibold text-foreground">Unable to load Option Chain</p>
          <p className="text-xs mt-1.5 max-w-sm text-center leading-relaxed">
            Check that the proxy server is running on port <code className="font-mono text-primary/70 bg-primary/10 px-1 rounded">4002</code> and Dhan credentials are configured in <code className="font-mono text-primary/70 bg-primary/10 px-1 rounded">.env</code>
          </p>
          <Button variant="outline" size="sm" className="mt-5 gap-1.5 hover:text-primary hover:border-primary/50 transition-colors" onClick={() => refetch()}>
            <RefreshCw className="h-3.5 w-3.5" />
            Retry Connection
          </Button>
        </div>
      )}

      {/* Strike Scroller for "By Strike" view */}
      {viewMode === "strike" && allStrikes.length > 0 && (
        <div className="flex items-center gap-1.5">
          <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => {
            if (strikeScrollRef.current) strikeScrollRef.current.scrollLeft -= 200;
          }}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="relative flex-1">
            <p className="text-xs text-muted-foreground text-center mb-1">Strike</p>
            <div ref={strikeScrollRef} className="flex gap-0.5 overflow-x-auto scrollbar-hide pb-1" style={{ scrollBehavior: "smooth" }}>
              {allStrikes.map(s => {
                const isATM = s === atmStrike;
                const isSelected = s === selectedStrike;
                return (
                  <button
                    key={s}
                    onClick={() => setSelectedStrike(s)}
                    className={`shrink-0 px-2.5 py-1.5 rounded text-xs font-mono transition-colors duration-200 border ${
                      isSelected
                        ? "bg-foreground text-background border-foreground font-semibold"
                        : isATM
                          ? "bg-primary/10 border-primary/30 text-primary font-semibold"
                          : "border-border hover:bg-accent"
                    }`}
                  >
                    {isATM && (
                      <div className="text-xs leading-none mb-0.5 opacity-70">
                        {symbol} {spotPrice.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </div>
                    )}
                    {s.toLocaleString("en-IN")}
                  </button>
                );
              })}
            </div>
          </div>
          <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => {
            if (strikeScrollRef.current) strikeScrollRef.current.scrollLeft += 200;
          }}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}

      {/* Summary Stats */}
      <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
        {[
          { label: "CE OI", value: `${(totalCEOI / 100000).toFixed(1)}L` },
          { label: "PE OI", value: `${(totalPEOI / 100000).toFixed(1)}L` },
          { label: "CE Vol", value: `${(totalCEVol / 100000).toFixed(1)}L` },
          { label: "PE Vol", value: `${(totalPEVol / 100000).toFixed(1)}L` },
          { label: "Straddle", value: atmRow ? (atmRow.ce.ltp + atmRow.pe.ltp).toFixed(2) : "—", className: "text-warning" },
          { label: "PCR", value: pcr, className: Number(pcr) > 1 ? "text-bullish" : "text-bearish" },
        ].map(stat => (
          <Card key={stat.label}>
            <CardContent className="p-4 text-center">
              <p className="text-xs text-muted-foreground">{stat.label}</p>
              <p className={`text-xs font-semibold font-mono ${stat.className || ""}`}>{stat.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Unusual Activity Banner */}
      {unusualActivity.count > 0 && (
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-warning/10 border border-warning/25 text-xs">
          <Flame className="h-3.5 w-3.5 text-warning animate-pulse" />
          <span className="font-semibold text-warning">{unusualActivity.count} Unusual Activity</span>
          <span className="text-muted-foreground">strikes detected (Vol &gt; 3× avg OI):</span>
          <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-hide">
            {unusualActivity.hotStrikes.map(s => {
              const flag = unusualActivity.flags.get(s)!;
              return (
                <Badge key={s} variant="outline" className="h-4 text-xs gap-1 border-warning/30 text-warning shrink-0">
                  {s.toLocaleString("en-IN")}
                  {flag.ce && <span className="text-primary">CE</span>}
                  {flag.ce && flag.pe && <span className="text-muted-foreground">+</span>}
                  {flag.pe && <span className="text-bearish">PE</span>}
                </Badge>
              );
            })}
          </div>
        </div>
      )}

      {/* Sticky ATM Bar */}
      {atmRow && viewMode === "expiration" && (
        <div className="sticky top-0 z-20 flex items-center justify-between gap-2 px-3 py-1 rounded bg-primary/5 border border-primary/20 text-xs font-mono">
          <div className="flex items-center gap-3">
            <span className="font-sans font-semibold text-primary">ATM {atmStrike}</span>
            <span>CE: <span className="text-primary font-medium">{atmRow.ce.ltp.toFixed(2)}</span></span>
            <span>PE: <span className="text-bearish font-medium">{atmRow.pe.ltp.toFixed(2)}</span></span>
            <span>Straddle: <span className="text-warning font-medium">{(atmRow.ce.ltp + atmRow.pe.ltp).toFixed(2)}</span></span>
          </div>
          <div className="flex items-center gap-3 text-muted-foreground">
            <span>MP: <span className="text-warning">{maxPain.toLocaleString("en-IN")}</span></span>
            <span>IV: {((atmRow.ce.iv + atmRow.pe.iv) / 2).toFixed(1)}%</span>
          </div>
        </div>
      )}

      {/* ═══ BY EXPIRATION VIEW ═══ */}
      {viewMode === "expiration" && (
        <Card>
          <CardContent className="p-0 overflow-auto max-h-[65vh]">
            {isLoading ? (
              <div className="p-4 space-y-2">
                {Array.from({ length: 12 }).map((_, i) => (
                  <div key={i} className="flex gap-2 items-center">
                    <div className="flex-1 h-6 skeleton-shimmer rounded bg-muted/20" style={{ animationDelay: `${i * 60}ms` }} />
                    <div className="w-16 h-6 skeleton-shimmer rounded bg-primary/5" />
                    <div className="flex-1 h-6 skeleton-shimmer rounded bg-muted/20" style={{ animationDelay: `${i * 60 + 30}ms` }} />
                  </div>
                ))}
              </div>
            ) : (
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-card">
                  {/* CALLS / STRIKE / PUTS header */}
                  <TableRow className="text-xs border-b border-border/70">
                    <TableHead className="text-center text-primary font-semibold" colSpan={callCols}>Calls</TableHead>
                    <TableHead className="text-center font-semibold bg-accent/50 border-x border-border/70" colSpan={2}>Strike · IV%</TableHead>
                    <TableHead className="text-center text-bearish font-semibold" colSpan={putCols}>Puts</TableHead>
                  </TableRow>
                  {/* Column sub-headers — calls reversed order */}
                  <TableRow className="text-xs text-muted-foreground">
                    {/* Call columns: reversed — leftmost is least important */}
                    {columnConfig.iv && <TableHead className="text-right">IV%</TableHead>}
                    {columnConfig.intrinsic && <TableHead className="text-right">Intr.</TableHead>}
                    {columnConfig.timeValue && <TableHead className="text-right">Time</TableHead>}
                    {columnConfig.rho && <TableHead className="text-right">Rho</TableHead>}
                    {columnConfig.vega && <TableHead className="text-right">Vega</TableHead>}
                    {columnConfig.theta && <TableHead className="text-right">Theta</TableHead>}
                    {columnConfig.gamma && <TableHead className="text-right">Gamma</TableHead>}
                    {columnConfig.delta && <TableHead className="text-right">Delta</TableHead>}
                    {columnConfig.price && <TableHead className="text-right font-semibold text-primary">Price</TableHead>}
                    {columnConfig.ask && <TableHead className="text-right">Ask</TableHead>}
                    {columnConfig.bid && <TableHead className="text-right">Bid</TableHead>}
                    {columnConfig.oiChange && <TableHead className="text-right">OI Chg</TableHead>}
                    {columnConfig.oi && <TableHead className="text-right">OI</TableHead>}
                    {columnConfig.volume && <TableHead className="text-right">Volume</TableHead>}
                    {/* Strike + IV */}
                    <TableHead className="text-center bg-accent/50 border-l border-border/70 font-semibold">↑ Strike</TableHead>
                    <TableHead className="text-center bg-accent/50 border-r border-border/70 font-semibold">IV%</TableHead>
                    {/* Put columns: normal order */}
                    {columnConfig.volume && <TableHead className="text-left">Volume</TableHead>}
                    {columnConfig.oi && <TableHead className="text-left">OI</TableHead>}
                    {columnConfig.oiChange && <TableHead className="text-left">OI Chg</TableHead>}
                    {columnConfig.bid && <TableHead className="text-left">Bid</TableHead>}
                    {columnConfig.ask && <TableHead className="text-left">Ask</TableHead>}
                    {columnConfig.price && <TableHead className="text-left font-semibold text-bearish">Price</TableHead>}
                    {columnConfig.delta && <TableHead className="text-left">Delta</TableHead>}
                    {columnConfig.gamma && <TableHead className="text-left">Gamma</TableHead>}
                    {columnConfig.theta && <TableHead className="text-left">Theta</TableHead>}
                    {columnConfig.vega && <TableHead className="text-left">Vega</TableHead>}
                    {columnConfig.rho && <TableHead className="text-left">Rho</TableHead>}
                    {columnConfig.timeValue && <TableHead className="text-left">Time</TableHead>}
                    {columnConfig.intrinsic && <TableHead className="text-left">Intr.</TableHead>}
                    {columnConfig.iv && <TableHead className="text-left">IV%</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {enrichedChain.map((row, idx) => {
                    const isATM = row.strikePrice === atmStrike;
                    const isITMCall = row.strikePrice < spotPrice;
                    const isITMPut = row.strikePrice > spotPrice;
                    const isMP = row.strikePrice === maxPain;
                    const avgIV = ((row.ce.iv + row.pe.iv) / 2).toFixed(1);
                    const uaFlag = unusualActivity.flags.get(row.strikePrice);
                    const hasUA = !!uaFlag;

                    const isFocused = idx === focusedStrikeIdx;

                    return (
                      <ContextMenu key={row.strikePrice}>
                        <ContextMenuTrigger asChild>
                          <TableRow
                            ref={isATM ? atmRef : undefined}
                            className={`text-xs font-mono cursor-context-menu transition-colors duration-200 hover:bg-accent/30 ${
                              isATM ? "atm-glow bg-primary/[0.08]" : ""
                            } ${hasUA ? "bg-warning/[0.04]" : ""} ${isFocused ? "ring-1 ring-primary/60 bg-primary/[0.04]" : ""}`}
                          >
                            {/* ── CALL SIDE ── */}
                            {columnConfig.iv && <TableCell className={`text-right py-1.5 tabular-nums ${isITMCall ? "text-muted-foreground/70" : ""}`}>{row.ce.iv.toFixed(1)}</TableCell>}
                            {columnConfig.intrinsic && <TableCell className={`text-right py-1.5 tabular-nums ${row.ce.intrinsic > 0 ? "" : "text-muted-foreground/50"}`}>{row.ce.intrinsic.toFixed(2)}</TableCell>}
                            {columnConfig.timeValue && <TableCell className="text-right py-1.5 tabular-nums">{row.ce.timeValue.toFixed(2)}</TableCell>}
                            {columnConfig.rho && <TableCell className="text-right py-1.5 tabular-nums text-muted-foreground">{row.ce.rho.toFixed(2)}</TableCell>}
                            {columnConfig.vega && <TableCell className="text-right py-1.5 tabular-nums">{row.ce.vega.toFixed(2)}</TableCell>}
                            {columnConfig.theta && <TableCell className="text-right py-1.5 tabular-nums text-bearish/80">{row.ce.theta.toFixed(2)}</TableCell>}
                            {columnConfig.gamma && <TableCell className="text-right py-1.5 tabular-nums">{row.ce.gamma.toFixed(4)}</TableCell>}
                            {columnConfig.delta && <TableCell className="text-right py-1.5 tabular-nums font-medium">{row.ce.delta.toFixed(2)}</TableCell>}
                            {columnConfig.price && (
                              <TableCell className="text-right py-1.5 font-semibold">
                                <button onClick={() => quickTrade(row.strikePrice, "CE", "BUY", row.ce.ltp)} className="hover:text-primary transition-colors">
                                  {row.ce.ltp.toFixed(2)}
                                </button>
                              </TableCell>
                            )}
                            {columnConfig.ask && <TableCell className="text-right py-1.5 tabular-nums">{row.ce.askPrice.toFixed(2)}</TableCell>}
                            {columnConfig.bid && <TableCell className="text-right py-1.5 tabular-nums">{row.ce.bidPrice.toFixed(2)}</TableCell>}
                            {columnConfig.oiChange && (
                              <TableCell className={`text-right py-1.5 tabular-nums ${row.ce.oiChange > 0 ? "text-bullish" : row.ce.oiChange < 0 ? "text-bearish" : "text-muted-foreground"}`}>
                                {row.ce.oiChange > 0 ? "+" : ""}{Math.abs(row.ce.oiChange) >= 100000 ? (row.ce.oiChange / 100000).toFixed(1) + "L" : (row.ce.oiChange / 1000).toFixed(0) + "K"}
                              </TableCell>
                            )}
                            {columnConfig.oi && <TableCell className="text-right py-1.5"><OIBar value={row.ce.oi} max={maxOI} side="call" /></TableCell>}
                            {columnConfig.volume && (
                              <TableCell className="text-right py-1.5">
                                <div className="flex items-center justify-end gap-0.5">
                                  {uaFlag?.ce && <Flame className="h-3 w-3 text-warning shrink-0" />}
                                  <VolumeBar value={row.ce.volume} max={maxVol} side="call" />
                                </div>
                              </TableCell>
                            )}

                            {/* ── STRIKE ── */}
                            <TableCell className="text-center bg-accent/50 border-l border-border/70 py-1.5">
                              <div className="flex flex-col items-center">
                                <div className="flex items-center gap-1.5">
                                  <span className={`font-semibold text-xs ${isATM ? "text-primary" : isMP ? "text-warning" : ""}`}>
                                    {row.strikePrice.toLocaleString("en-IN")}
                                  </span>
                                  {isATM && (
                                    <span className="text-xs font-semibold bg-primary text-primary-foreground px-1.5 py-0 rounded-full leading-tight">
                                      ATM
                                    </span>
                                  )}
                                </div>
                                {isMP && <span className="text-xs text-warning/60 font-medium">MAX PAIN</span>}
                              </div>
                            </TableCell>
                            <TableCell className="text-center py-1.5 bg-accent/50 border-r border-border/70 text-muted-foreground">{avgIV}</TableCell>

                            {/* ── PUT SIDE ── */}
                            {columnConfig.volume && (
                              <TableCell className="text-left py-1.5">
                                <div className="flex items-center gap-0.5">
                                  <VolumeBar value={row.pe.volume} max={maxVol} side="put" />
                                  {uaFlag?.pe && <Flame className="h-3 w-3 text-warning shrink-0" />}
                                </div>
                              </TableCell>
                            )}
                            {columnConfig.oi && <TableCell className="text-left py-1.5"><OIBar value={row.pe.oi} max={maxOI} side="put" /></TableCell>}
                            {columnConfig.oiChange && (
                              <TableCell className={`text-left py-1.5 tabular-nums ${row.pe.oiChange > 0 ? "text-bullish" : row.pe.oiChange < 0 ? "text-bearish" : "text-muted-foreground"}`}>
                                {row.pe.oiChange > 0 ? "+" : ""}{Math.abs(row.pe.oiChange) >= 100000 ? (row.pe.oiChange / 100000).toFixed(1) + "L" : (row.pe.oiChange / 1000).toFixed(0) + "K"}
                              </TableCell>
                            )}
                            {columnConfig.bid && <TableCell className="text-left py-1.5 tabular-nums">{row.pe.bidPrice.toFixed(2)}</TableCell>}
                            {columnConfig.ask && <TableCell className="text-left py-1.5 tabular-nums">{row.pe.askPrice.toFixed(2)}</TableCell>}
                            {columnConfig.price && (
                              <TableCell className="text-left py-1.5 font-semibold">
                                <button onClick={() => quickTrade(row.strikePrice, "PE", "BUY", row.pe.ltp)} className="hover:text-bearish transition-colors">
                                  {row.pe.ltp.toFixed(2)}
                                </button>
                              </TableCell>
                            )}
                            {columnConfig.delta && <TableCell className="text-left py-1.5 tabular-nums font-medium">{row.pe.delta.toFixed(2)}</TableCell>}
                            {columnConfig.gamma && <TableCell className="text-left py-1.5 tabular-nums">{row.pe.gamma.toFixed(4)}</TableCell>}
                            {columnConfig.theta && <TableCell className="text-left py-1.5 tabular-nums text-bearish/80">{row.pe.theta.toFixed(2)}</TableCell>}
                            {columnConfig.vega && <TableCell className="text-left py-1.5 tabular-nums">{row.pe.vega.toFixed(2)}</TableCell>}
                            {columnConfig.rho && <TableCell className="text-left py-1.5 tabular-nums text-muted-foreground">{row.pe.rho.toFixed(2)}</TableCell>}
                            {columnConfig.timeValue && <TableCell className="text-left py-1.5 tabular-nums">{row.pe.timeValue.toFixed(2)}</TableCell>}
                            {columnConfig.intrinsic && <TableCell className={`text-left py-1.5 tabular-nums ${row.pe.intrinsic > 0 ? "" : "text-muted-foreground/50"}`}>{row.pe.intrinsic.toFixed(2)}</TableCell>}
                            {columnConfig.iv && <TableCell className={`text-left py-1.5 tabular-nums ${isITMPut ? "text-muted-foreground/70" : ""}`}>{row.pe.iv.toFixed(1)}</TableCell>}
                          </TableRow>
                        </ContextMenuTrigger>
                        <ContextMenuContent className="w-48">
                          <ContextMenuSub>
                            <ContextMenuSubTrigger className="gap-2"><TrendingUp className="h-3.5 w-3.5 text-primary" /> Buy</ContextMenuSubTrigger>
                            <ContextMenuSubContent>
                              <ContextMenuItem onClick={() => handleContextAction(row.strikePrice, "CE", "buy", row.ce.ltp)} className="text-xs">Plan in Strategy Builder: CE @ ₹{row.ce.ltp.toFixed(2)}</ContextMenuItem>
                              <ContextMenuItem onClick={() => handleContextAction(row.strikePrice, "PE", "buy", row.pe.ltp)} className="text-xs">Plan in Strategy Builder: PE @ ₹{row.pe.ltp.toFixed(2)}</ContextMenuItem>
                              <ContextMenuSeparator />
                              <ContextMenuItem onClick={() => handleContextAction(row.strikePrice, "CE", "quickfill-buy", row.ce.ltp)} className="text-xs">Quick Fill (Paper): CE @ ₹{row.ce.ltp.toFixed(2)}</ContextMenuItem>
                              <ContextMenuItem onClick={() => handleContextAction(row.strikePrice, "PE", "quickfill-buy", row.pe.ltp)} className="text-xs">Quick Fill (Paper): PE @ ₹{row.pe.ltp.toFixed(2)}</ContextMenuItem>
                              {isLiveTradingEnabled() && (
                                <>
                                  <ContextMenuSeparator />
                                  <ContextMenuItem onClick={() => handleContextAction(row.strikePrice, "CE", "liveorder-buy", row.ce.ltp, row.ce.securityId, row.ce.exchangeSegment)} className="text-xs text-bearish">⚠ LIVE Order: CE @ ₹{row.ce.ltp.toFixed(2)}</ContextMenuItem>
                                  <ContextMenuItem onClick={() => handleContextAction(row.strikePrice, "PE", "liveorder-buy", row.pe.ltp, row.pe.securityId, row.pe.exchangeSegment)} className="text-xs text-bearish">⚠ LIVE Order: PE @ ₹{row.pe.ltp.toFixed(2)}</ContextMenuItem>
                                </>
                              )}
                            </ContextMenuSubContent>
                          </ContextMenuSub>
                          <ContextMenuSub>
                            <ContextMenuSubTrigger className="gap-2"><TrendingDown className="h-3.5 w-3.5 text-bearish" /> Sell</ContextMenuSubTrigger>
                            <ContextMenuSubContent>
                              <ContextMenuItem onClick={() => handleContextAction(row.strikePrice, "CE", "sell", row.ce.ltp)} className="text-xs">Plan in Strategy Builder: CE @ ₹{row.ce.ltp.toFixed(2)}</ContextMenuItem>
                              <ContextMenuItem onClick={() => handleContextAction(row.strikePrice, "PE", "sell", row.pe.ltp)} className="text-xs">Plan in Strategy Builder: PE @ ₹{row.pe.ltp.toFixed(2)}</ContextMenuItem>
                              <ContextMenuSeparator />
                              <ContextMenuItem onClick={() => handleContextAction(row.strikePrice, "CE", "quickfill-sell", row.ce.ltp)} className="text-xs">Quick Fill (Paper): CE @ ₹{row.ce.ltp.toFixed(2)}</ContextMenuItem>
                              <ContextMenuItem onClick={() => handleContextAction(row.strikePrice, "PE", "quickfill-sell", row.pe.ltp)} className="text-xs">Quick Fill (Paper): PE @ ₹{row.pe.ltp.toFixed(2)}</ContextMenuItem>
                              {isLiveTradingEnabled() && (
                                <>
                                  <ContextMenuSeparator />
                                  <ContextMenuItem onClick={() => handleContextAction(row.strikePrice, "CE", "liveorder-sell", row.ce.ltp, row.ce.securityId, row.ce.exchangeSegment)} className="text-xs text-bearish">⚠ LIVE Order: CE @ ₹{row.ce.ltp.toFixed(2)}</ContextMenuItem>
                                  <ContextMenuItem onClick={() => handleContextAction(row.strikePrice, "PE", "liveorder-sell", row.pe.ltp, row.pe.securityId, row.pe.exchangeSegment)} className="text-xs text-bearish">⚠ LIVE Order: PE @ ₹{row.pe.ltp.toFixed(2)}</ContextMenuItem>
                                </>
                              )}
                            </ContextMenuSubContent>
                          </ContextMenuSub>
                          <ContextMenuSeparator />
                          <ContextMenuItem onClick={() => handleContextAction(row.strikePrice, "CE", "straddle", row.ce.ltp)} className="gap-2 text-xs">
                            <Layers className="h-3.5 w-3.5" /> Build Straddle ({(row.ce.ltp + row.pe.ltp).toFixed(1)})
                          </ContextMenuItem>
                          <ContextMenuItem onClick={() => handleContextAction(row.strikePrice, "CE", "alert")} className="gap-2 text-xs">
                            <Bell className="h-3.5 w-3.5" /> Set Alert
                          </ContextMenuItem>
                        </ContextMenuContent>
                      </ContextMenu>
                    );
                  })}
                </TableBody>
                {/* ── Sticky Summary Footer ── */}
                {hasData && (
                  <tfoot className="sticky bottom-0 z-10 bg-card border-t border-primary/20">
                    <tr className="text-xs font-mono font-semibold">
                      <td colSpan={callCols} className="text-right py-2 px-2">
                        <div className="flex items-center justify-end gap-4">
                          <span className="text-muted-foreground">CE Vol: <span className="text-foreground">{totalCEVol >= 1000000 ? (totalCEVol / 1000000).toFixed(1) + 'M' : (totalCEVol / 1000).toFixed(0) + 'K'}</span></span>
                          <span className="text-muted-foreground">CE OI: <span className="text-primary font-semibold">{totalCEOI >= 1000000 ? (totalCEOI / 1000000).toFixed(1) + 'M' : (totalCEOI / 100000).toFixed(1) + 'L'}</span></span>
                        </div>
                      </td>
                      <td colSpan={2} className="text-center py-2 bg-accent/50 border-x border-border/70">
                        <span className={`text-xs font-semibold ${Number(pcr) > 1 ? 'text-bullish' : 'text-bearish'}`}>
                          PCR: {pcr}
                        </span>
                      </td>
                      <td colSpan={callCols} className="text-left py-2 px-2">
                        <div className="flex items-center gap-4">
                          <span className="text-muted-foreground">PE OI: <span className="text-bearish font-semibold">{totalPEOI >= 1000000 ? (totalPEOI / 1000000).toFixed(1) + 'M' : (totalPEOI / 100000).toFixed(1) + 'L'}</span></span>
                          <span className="text-muted-foreground">PE Vol: <span className="text-foreground">{totalPEVol >= 1000000 ? (totalPEVol / 1000000).toFixed(1) + 'M' : (totalPEVol / 1000).toFixed(0) + 'K'}</span></span>
                        </div>
                      </td>
                    </tr>
                  </tfoot>
                )}
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      {/* ═══ BY STRIKE VIEW ═══ */}
      {viewMode === "strike" && (
        <Card>
          <CardContent className="p-0 overflow-auto">
            {byStrikeData.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-40 text-muted-foreground gap-2">
                <Crosshair className="h-8 w-8 opacity-20" />
                <p className="text-sm">Select a strike price above to compare across expiries</p>
                <p className="text-xs opacity-60">Use the strike selector in the header bar</p>
              </div>
            ) : (
              <>
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-card">
                  <TableRow className="text-xs border-b border-border/70">
                    <TableHead className="text-center text-primary font-semibold" colSpan={callCols}>Calls</TableHead>
                    <TableHead className="text-center font-semibold bg-accent/50 border-x border-border/70">Exp Date</TableHead>
                    <TableHead className="text-center text-bearish font-semibold" colSpan={putCols}>Puts</TableHead>
                  </TableRow>
                  <TableRow className="text-xs text-muted-foreground">
                    {columnConfig.iv && <TableHead className="text-right">IV%</TableHead>}
                    {columnConfig.intrinsic && <TableHead className="text-right">Intr.</TableHead>}
                    {columnConfig.timeValue && <TableHead className="text-right">Time</TableHead>}
                    {columnConfig.rho && <TableHead className="text-right">Rho</TableHead>}
                    {columnConfig.vega && <TableHead className="text-right">Vega</TableHead>}
                    {columnConfig.theta && <TableHead className="text-right">Theta</TableHead>}
                    {columnConfig.gamma && <TableHead className="text-right">Gamma</TableHead>}
                    {columnConfig.delta && <TableHead className="text-right">Delta</TableHead>}
                    {columnConfig.price && <TableHead className="text-right font-semibold text-primary">Price</TableHead>}
                    {columnConfig.ask && <TableHead className="text-right">Ask</TableHead>}
                    {columnConfig.bid && <TableHead className="text-right">Bid</TableHead>}
                    {columnConfig.oiChange && <TableHead className="text-right">OI Chg</TableHead>}
                    {columnConfig.oi && <TableHead className="text-right">OI</TableHead>}
                    {columnConfig.volume && <TableHead className="text-right">Volume</TableHead>}
                    <TableHead className="text-center bg-accent/50 border-x border-border/70 font-semibold">Exp Date</TableHead>
                    {columnConfig.volume && <TableHead className="text-left">Volume</TableHead>}
                    {columnConfig.oi && <TableHead className="text-left">OI</TableHead>}
                    {columnConfig.oiChange && <TableHead className="text-left">OI Chg</TableHead>}
                    {columnConfig.bid && <TableHead className="text-left">Bid</TableHead>}
                    {columnConfig.ask && <TableHead className="text-left">Ask</TableHead>}
                    {columnConfig.price && <TableHead className="text-left font-semibold text-bearish">Price</TableHead>}
                    {columnConfig.delta && <TableHead className="text-left">Delta</TableHead>}
                    {columnConfig.gamma && <TableHead className="text-left">Gamma</TableHead>}
                    {columnConfig.theta && <TableHead className="text-left">Theta</TableHead>}
                    {columnConfig.vega && <TableHead className="text-left">Vega</TableHead>}
                    {columnConfig.rho && <TableHead className="text-left">Rho</TableHead>}
                    {columnConfig.timeValue && <TableHead className="text-left">Time</TableHead>}
                    {columnConfig.intrinsic && <TableHead className="text-left">Intr.</TableHead>}
                    {columnConfig.iv && <TableHead className="text-left">IV%</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {byStrikeData.map((row) => (
                    <TableRow key={row.expiry} className="text-xs font-mono hover:bg-accent/30 transition-colors duration-200">
                      {columnConfig.iv && <TableCell className="text-right py-1.5 tabular-nums">{row.ce.iv.toFixed(1)}</TableCell>}
                      {columnConfig.intrinsic && <TableCell className="text-right py-1.5 tabular-nums">{row.ce.intrinsic.toFixed(2)}</TableCell>}
                      {columnConfig.timeValue && <TableCell className="text-right py-1.5 tabular-nums">{row.ce.timeValue.toFixed(2)}</TableCell>}
                      {columnConfig.rho && <TableCell className="text-right py-1.5 tabular-nums">{row.ce.rho.toFixed(2)}</TableCell>}
                      {columnConfig.vega && <TableCell className="text-right py-1.5 tabular-nums">{row.ce.vega.toFixed(2)}</TableCell>}
                      {columnConfig.theta && <TableCell className="text-right py-1.5 tabular-nums text-bearish/80">{row.ce.theta.toFixed(2)}</TableCell>}
                      {columnConfig.gamma && <TableCell className="text-right py-1.5 tabular-nums">{row.ce.gamma.toFixed(4)}</TableCell>}
                      {columnConfig.delta && <TableCell className="text-right py-1.5 tabular-nums font-medium">{row.ce.delta.toFixed(2)}</TableCell>}
                      {columnConfig.price && <TableCell className="text-right py-1.5 font-semibold">{row.ce.ltp.toFixed(2)}</TableCell>}
                      {columnConfig.ask && <TableCell className="text-right py-1.5 tabular-nums">{row.ce.askPrice.toFixed(2)}</TableCell>}
                      {columnConfig.bid && <TableCell className="text-right py-1.5 tabular-nums">{row.ce.bidPrice.toFixed(2)}</TableCell>}
                      {columnConfig.oiChange && (
                        <TableCell className={`text-right py-1.5 tabular-nums ${row.ce.oiChange > 0 ? "text-bullish" : row.ce.oiChange < 0 ? "text-bearish" : "text-muted-foreground"}`}>
                          {row.ce.oiChange > 0 ? "+" : ""}{Math.abs(row.ce.oiChange) >= 100000 ? (row.ce.oiChange / 100000).toFixed(1) + "L" : (row.ce.oiChange / 1000).toFixed(0) + "K"}
                        </TableCell>
                      )}
                      {columnConfig.oi && <TableCell className="text-right py-1.5"><OIBar value={row.ce.oi} max={maxOI} side="call" /></TableCell>}
                      {columnConfig.volume && <TableCell className="text-right py-1.5"><VolumeBar value={row.ce.volume} max={maxVol} side="call" /></TableCell>}
                      <TableCell className="text-center py-1.5 bg-accent/50 border-x border-border/70 font-semibold font-sans text-xs">{row.expiry}</TableCell>
                      {columnConfig.volume && <TableCell className="text-left py-1.5"><VolumeBar value={row.pe.volume} max={maxVol} side="put" /></TableCell>}
                      {columnConfig.oi && <TableCell className="text-left py-1.5"><OIBar value={row.pe.oi} max={maxOI} side="put" /></TableCell>}
                      {columnConfig.oiChange && (
                        <TableCell className={`text-left py-1.5 tabular-nums ${row.pe.oiChange > 0 ? "text-bullish" : row.pe.oiChange < 0 ? "text-bearish" : "text-muted-foreground"}`}>
                          {row.pe.oiChange > 0 ? "+" : ""}{Math.abs(row.pe.oiChange) >= 100000 ? (row.pe.oiChange / 100000).toFixed(1) + "L" : (row.pe.oiChange / 1000).toFixed(0) + "K"}
                        </TableCell>
                      )}
                      {columnConfig.bid && <TableCell className="text-left py-1.5 tabular-nums">{row.pe.bidPrice.toFixed(2)}</TableCell>}
                      {columnConfig.ask && <TableCell className="text-left py-1.5 tabular-nums">{row.pe.askPrice.toFixed(2)}</TableCell>}
                      {columnConfig.price && <TableCell className="text-left py-1.5 font-semibold">{row.pe.ltp.toFixed(2)}</TableCell>}
                      {columnConfig.delta && <TableCell className="text-left py-1.5 tabular-nums font-medium">{row.pe.delta.toFixed(2)}</TableCell>}
                      {columnConfig.gamma && <TableCell className="text-left py-1.5 tabular-nums">{row.pe.gamma.toFixed(4)}</TableCell>}
                      {columnConfig.theta && <TableCell className="text-left py-1.5 tabular-nums text-bearish/80">{row.pe.theta.toFixed(2)}</TableCell>}
                      {columnConfig.vega && <TableCell className="text-left py-1.5 tabular-nums">{row.pe.vega.toFixed(2)}</TableCell>}
                      {columnConfig.rho && <TableCell className="text-left py-1.5 tabular-nums">{row.pe.rho.toFixed(2)}</TableCell>}
                      {columnConfig.timeValue && <TableCell className="text-left py-1.5 tabular-nums">{row.pe.timeValue.toFixed(2)}</TableCell>}
                      {columnConfig.intrinsic && <TableCell className="text-left py-1.5 tabular-nums">{row.pe.intrinsic.toFixed(2)}</TableCell>}
                      {columnConfig.iv && <TableCell className="text-left py-1.5 tabular-nums">{row.pe.iv.toFixed(1)}</TableCell>}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              </>
            )}
          </CardContent>
        </Card>
      )}

      <TradeConfirmDialog
        trade={pendingTrade}
        mode={tradeMode}
        busy={placingTrade}
        onConfirm={handleConfirmTrade}
        onCancel={() => setPendingTrade(null)}
      />
    </div>
  );
}
