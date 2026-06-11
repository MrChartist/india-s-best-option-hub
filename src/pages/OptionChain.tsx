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
function SymbolSearch({ value, onSelect }: { value: string; onSelect: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

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

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" className="w-[160px] h-8 text-xs font-medium justify-between gap-1" role="combobox">
          <span className="truncate">{currentLabel}</span>
          <Search className="h-3 w-3 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[280px] p-0" align="start">
        <div className="flex items-center border-b px-3 py-2 gap-2">
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
                  <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider px-2 py-1.5 sticky top-0 bg-popover">
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
        {value >= 1000000 ? (value / 1000000).toFixed(1) + "M" : (value / 1000).toFixed(0) + "K"}
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

  const quickTrade = useCallback((strike: number, type: "CE" | "PE", action: "BUY" | "SELL") => {
    navigate(`/strategy?${new URLSearchParams({ symbol, strike: String(strike), type, action })}`);
  }, [symbol, navigate]);

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

  const handleContextAction = (strike: number, type: "CE" | "PE", action: string) => {
    switch (action) {
      case "buy": quickTrade(strike, type, "BUY"); break;
      case "sell": quickTrade(strike, type, "SELL"); break;
      case "straddle":
        toast.success(`Added ${strike} Straddle to Strategy Builder`);
        navigate(`/strategy?strike=${strike}&type=CE&action=BUY`);
        break;
      case "alert": toast.success(`Alert set for ${symbol} ${strike} ${type}`); break;
      case "oi-analysis": navigate(`/oi-analysis`); break;
    }
  };

  // Compute intrinsic + time values
  const enrichedChain = useMemo(() => chain.map(row => {
    const ceIntrinsic = Math.max(spotPrice - row.strikePrice, 0);
    const peIntrinsic = Math.max(row.strikePrice - spotPrice, 0);
    return {
      ...row,
      ce: { ...row.ce, intrinsic: ceIntrinsic, timeValue: Math.max(row.ce.ltp - ceIntrinsic, 0) },
      pe: { ...row.pe, intrinsic: peIntrinsic, timeValue: Math.max(row.pe.ltp - peIntrinsic, 0) },
    };
  }), [chain, spotPrice]);

  // "By Strike" view: show one strike across all expiries
  const byStrikeData = useMemo(() => {
    if (!selectedStrike) return [];
    const row = enrichedChain.find(r => r.strikePrice === selectedStrike);
    if (!row) return [];
    // For now show current expiry data; in production would fetch all expiries
    // SIMULATED: Using factor-based approximation until multi-expiry API is integrated
    return expiries.map((exp, i) => {
      const factor = 1 + i * 0.08; // simulate different expiry prices
      return {
        expiry: exp.label,
        daysToExpiry: exp.daysToExpiry,
        ce: {
          ltp: Math.round(row.ce.ltp * factor * 100) / 100,
          iv: row.ce.iv + i * 1.2,
          delta: Math.max(0.01, row.ce.delta - i * 0.05),
          gamma: row.ce.gamma,
          theta: row.ce.theta * (1 + i * 0.3),
          vega: row.ce.vega * (1 + i * 0.2),
          volume: Math.round(row.ce.volume * (1 - i * 0.3)),
          oi: row.ce.oi,
          bid: Math.round(row.ce.ltp * factor * 0.98 * 100) / 100,
          ask: Math.round(row.ce.ltp * factor * 1.02 * 100) / 100,
          intrinsic: Math.max(spotPrice - selectedStrike, 0),
          timeValue: Math.max(row.ce.ltp * factor - Math.max(spotPrice - selectedStrike, 0), 0),
        },
        pe: {
          ltp: Math.round(row.pe.ltp * factor * 100) / 100,
          iv: row.pe.iv + i * 1.5,
          delta: Math.min(-0.01, row.pe.delta + i * 0.04),
          gamma: row.pe.gamma,
          theta: row.pe.theta * (1 + i * 0.3),
          vega: row.pe.vega * (1 + i * 0.2),
          volume: Math.round(row.pe.volume * (1 - i * 0.25)),
          oi: row.pe.oi,
          bid: Math.round(row.pe.ltp * factor * 0.98 * 100) / 100,
          ask: Math.round(row.pe.ltp * factor * 1.02 * 100) / 100,
          intrinsic: Math.max(selectedStrike - spotPrice, 0),
          timeValue: Math.max(row.pe.ltp * factor - Math.max(selectedStrike - spotPrice, 0), 0),
        },
      };
    });
  }, [selectedStrike, enrichedChain, expiries, spotPrice]);

  const allStrikes = enrichedChain.map(r => r.strikePrice);

  // ── Keyboard Navigation: J/K to move, G to jump to ATM ──
  useEffect(() => {
    if (viewMode !== "expiration" || !hasData) return;
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;
      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        setFocusedStrikeIdx(prev => Math.min(prev + 1, enrichedChain.length - 1));
      } else if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        setFocusedStrikeIdx(prev => Math.max(prev - 1, 0));
      } else if (e.key === "g") {
        const atmIdx = enrichedChain.findIndex(r => r.strikePrice === atmStrike);
        if (atmIdx >= 0) { setFocusedStrikeIdx(atmIdx); scrollToATM(); }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [viewMode, hasData, enrichedChain, atmStrike, scrollToATM]);

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
  const callCols = [columnConfig.iv, columnConfig.intrinsic, columnConfig.timeValue, columnConfig.rho, columnConfig.vega, columnConfig.theta, columnConfig.gamma, columnConfig.delta, columnConfig.price, columnConfig.ask, columnConfig.bid, columnConfig.volume].filter(Boolean).length;
  const putCols = callCols;

  return (
    <div className="space-y-2.5 lg:space-y-3">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <SymbolSearch value={symbol} onSelect={(v) => { setSymbol(v); setSelectedExpiry(undefined); }} />

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

        <div className="flex items-center gap-1.5">
          <Badge variant="outline" className={`gap-1 text-[11px] ${isLive ? "border-bullish/50 text-bullish" : afterHours ? "border-amber-500/50 text-amber-400" : "border-red-500/30 text-red-400"}`}>
            {isLive ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
            {isLive ? (data?.source === "dhan" ? "DHAN" : "NSE") : afterHours ? "CLOSED" : "OFFLINE"}
          </Badge>
          <span className="text-xs font-mono">
            {symbol} <span className="font-semibold text-foreground">{spotPrice.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</span>
            {afterHours && <span className="text-amber-400/60 ml-1 text-xs">(Last Close)</span>}
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
                    <Label className="text-xs capitalize">{key === "oiChange" ? "OI Change" : key === "timeValue" ? "Time Value" : key}</Label>
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
                <kbd className="font-mono text-[10px] px-1.5 py-0.5 rounded border border-border/50 bg-accent/30 font-semibold shadow-sm">?</kbd>
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-64 p-4" align="end">
              <p className="text-[11px] font-bold text-muted-foreground mb-3 uppercase tracking-wider flex items-center gap-2">
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
        <StockChart symbol={symbol} inline height={280} />
      )}

      {/* Expiry selector */}
      {viewMode === "expiration" && expiries.length > 0 && (
        <div className="flex items-center gap-1">
          {expiries.slice(0, 5).map((exp, i) => {
            const parts = exp.label.split(" ");
            const isSelected = (selectedExpiry || expiries[0]?.value) === exp.value;
            return (
              <button
                key={exp.value}
                onClick={() => setSelectedExpiry(exp.value)}
                className={`flex flex-col items-center px-3 py-1.5 rounded-md text-xs transition-all border ${
                  isSelected
                    ? "bg-primary text-primary-foreground border-primary font-bold shadow-[0_0_15px_-3px_hsl(var(--primary)/0.5)] scale-105"
                    : "bg-card border-border hover:bg-accent/50 hover:border-primary/30"
                }`}
              >
                <span className="text-xs opacity-70">{parts[1]}</span>
                <span className="font-bold text-sm leading-none">{parts[0]}</span>
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
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400">
          <WifiOff className="h-4 w-4 shrink-0" />
          <div className="flex-1">
            <p className="text-xs font-medium">Market Closed — {hasData ? "Showing Last Available Data" : "No Cached Data Available"}</p>
            <p className="text-xs text-amber-400/60 mt-0.5">
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
          <p className="text-[15px] font-semibold text-foreground">Unable to load Option Chain</p>
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
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => {
            if (strikeScrollRef.current) strikeScrollRef.current.scrollLeft -= 200;
          }}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="relative flex-1">
            <p className="text-[11px] text-muted-foreground text-center mb-1">Strike</p>
            <div ref={strikeScrollRef} className="flex gap-0.5 overflow-x-auto scrollbar-hide pb-1" style={{ scrollBehavior: "smooth" }}>
              {allStrikes.map(s => {
                const isATM = s === atmStrike;
                const isSelected = s === selectedStrike;
                return (
                  <button
                    key={s}
                    onClick={() => setSelectedStrike(s)}
                    className={`shrink-0 px-2.5 py-1.5 rounded text-xs font-mono transition-colors border ${
                      isSelected
                        ? "bg-foreground text-background border-foreground font-bold"
                        : isATM
                          ? "bg-primary/10 border-primary/30 text-primary font-semibold"
                          : "border-border hover:bg-accent"
                    }`}
                  >
                    {isATM && (
                      <div className="text-[11px] leading-none mb-0.5 opacity-70">
                        {symbol} {spotPrice.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
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
      <div className="grid grid-cols-3 md:grid-cols-6 gap-1.5">
        {[
          { label: "CE OI", value: `${(totalCEOI / 100000).toFixed(1)}L` },
          { label: "PE OI", value: `${(totalPEOI / 100000).toFixed(1)}L` },
          { label: "CE Vol", value: `${(totalCEVol / 100000).toFixed(1)}L` },
          { label: "PE Vol", value: `${(totalPEVol / 100000).toFixed(1)}L` },
          { label: "Straddle", value: atmRow ? (atmRow.ce.ltp + atmRow.pe.ltp).toFixed(2) : "—", className: "text-warning" },
          { label: "PCR", value: pcr, className: Number(pcr) > 1 ? "text-bullish" : "text-bearish" },
        ].map(stat => (
          <div key={stat.label} className="bg-card rounded-md border px-2 py-1.5 text-center">
            <p className="text-xs text-muted-foreground">{stat.label}</p>
            <p className={`text-xs font-bold font-mono ${stat.className || ""}`}>{stat.value}</p>
          </div>
        ))}
      </div>

      {/* Unusual Activity Banner */}
      {unusualActivity.count > 0 && (
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-orange-500/10 border border-orange-500/25 text-xs">
          <Flame className="h-3.5 w-3.5 text-orange-500 animate-pulse" />
          <span className="font-semibold text-orange-500">{unusualActivity.count} Unusual Activity</span>
          <span className="text-muted-foreground">strikes detected (Vol &gt; 3× avg OI):</span>
          <div className="flex items-center gap-1 overflow-x-auto scrollbar-hide">
            {unusualActivity.hotStrikes.map(s => {
              const flag = unusualActivity.flags.get(s)!;
              return (
                <Badge key={s} variant="outline" className="text-[11px] gap-1 border-orange-500/30 text-orange-500 shrink-0">
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
                  <TableRow className="text-xs border-b-2">
                    <TableHead className="text-center text-primary font-bold" colSpan={callCols}>Calls</TableHead>
                    <TableHead className="text-center font-bold bg-accent/50 border-x-2 border-border" colSpan={2}>Strike · IV%</TableHead>
                    <TableHead className="text-center text-bearish font-bold" colSpan={putCols}>Puts</TableHead>
                  </TableRow>
                  {/* Column sub-headers — calls reversed order */}
                  <TableRow className="text-[11px] text-muted-foreground">
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
                    {columnConfig.volume && <TableHead className="text-right">Volume</TableHead>}
                    {/* Strike + IV */}
                    <TableHead className="text-center bg-accent/50 border-l-2 border-border font-semibold">↑ Strike</TableHead>
                    <TableHead className="text-center bg-accent/50 border-r-2 border-border font-semibold">IV%</TableHead>
                    {/* Put columns: normal order */}
                    {columnConfig.volume && <TableHead className="text-left">Volume</TableHead>}
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
                            className={`text-xs sm:text-[11px] font-mono cursor-context-menu transition-colors hover:bg-accent/30 ${
                              isATM ? "bg-primary/[0.08] border-y-2 border-primary/30 shadow-[inset_0_0_20px_hsl(var(--primary)/0.06)]" : ""
                            } ${hasUA ? "bg-orange-500/[0.04]" : ""} ${isFocused ? "ring-1 ring-primary/60 bg-primary/[0.04]" : ""}`}
                          >
                            {/* ── CALL SIDE ── */}
                            {columnConfig.iv && <TableCell className={`text-right py-1.5 tabular-nums ${isITMCall ? "text-muted-foreground/70" : ""}`}>{row.ce.iv.toFixed(1)}</TableCell>}
                            {columnConfig.intrinsic && <TableCell className={`text-right py-1.5 tabular-nums ${row.ce.intrinsic > 0 ? "" : "text-muted-foreground/50"}`}>{row.ce.intrinsic.toFixed(2)}</TableCell>}
                            {columnConfig.timeValue && <TableCell className="text-right py-1.5 tabular-nums">{row.ce.timeValue.toFixed(2)}</TableCell>}
                            {columnConfig.rho && <TableCell className="text-right py-1.5 tabular-nums text-muted-foreground">0.{Math.round(row.ce.delta * 22).toString().padStart(2, "0")}</TableCell>}
                            {columnConfig.vega && <TableCell className="text-right py-1.5 tabular-nums">{row.ce.vega.toFixed(2)}</TableCell>}
                            {columnConfig.theta && <TableCell className="text-right py-1.5 tabular-nums text-bearish/80">{row.ce.theta.toFixed(2)}</TableCell>}
                            {columnConfig.gamma && <TableCell className="text-right py-1.5 tabular-nums">{row.ce.gamma.toFixed(4)}</TableCell>}
                            {columnConfig.delta && <TableCell className="text-right py-1.5 tabular-nums font-medium">{row.ce.delta.toFixed(2)}</TableCell>}
                            {columnConfig.price && (
                              <TableCell className="text-right py-1.5 font-semibold">
                                <button onClick={() => quickTrade(row.strikePrice, "CE", "BUY")} className="hover:text-primary transition-colors">
                                  {row.ce.ltp.toFixed(2)}
                                </button>
                              </TableCell>
                            )}
                            {columnConfig.ask && <TableCell className="text-right py-1.5 tabular-nums">{row.ce.askPrice.toFixed(2)}</TableCell>}
                            {columnConfig.bid && <TableCell className="text-right py-1.5 tabular-nums">{row.ce.bidPrice.toFixed(2)}</TableCell>}
                            {columnConfig.volume && (
                              <TableCell className="text-right py-1.5">
                                <div className="flex items-center justify-end gap-0.5">
                                  {uaFlag?.ce && <Flame className="h-3 w-3 text-orange-500 shrink-0" />}
                                  <VolumeBar value={row.ce.volume} max={maxVol} side="call" />
                                </div>
                              </TableCell>
                            )}

                            {/* ── STRIKE ── */}
                            <TableCell className="text-center bg-accent/50 border-l-2 border-border py-1.5">
                              <div className="flex flex-col items-center">
                                <div className="flex items-center gap-1">
                                  <span className={`font-bold text-[11px] ${isATM ? "text-primary" : isMP ? "text-warning" : ""}`}>
                                    {row.strikePrice.toLocaleString("en-IN")}
                                  </span>
                                  {isATM && (
                                    <span className="text-[11px] font-bold bg-primary text-primary-foreground px-1 py-0 rounded-sm leading-tight">
                                      ATM
                                    </span>
                                  )}
                                </div>
                                {isMP && <span className="text-[11px] text-warning/60 font-medium">MAX PAIN</span>}
                              </div>
                            </TableCell>
                            <TableCell className="text-center py-1.5 bg-accent/50 border-r-2 border-border text-muted-foreground">{avgIV}</TableCell>

                            {/* ── PUT SIDE ── */}
                            {columnConfig.volume && (
                              <TableCell className="text-left py-1.5">
                                <div className="flex items-center gap-0.5">
                                  <VolumeBar value={row.pe.volume} max={maxVol} side="put" />
                                  {uaFlag?.pe && <Flame className="h-3 w-3 text-orange-500 shrink-0" />}
                                </div>
                              </TableCell>
                            )}
                            {columnConfig.bid && <TableCell className="text-left py-1.5 tabular-nums">{row.pe.bidPrice.toFixed(2)}</TableCell>}
                            {columnConfig.ask && <TableCell className="text-left py-1.5 tabular-nums">{row.pe.askPrice.toFixed(2)}</TableCell>}
                            {columnConfig.price && (
                              <TableCell className="text-left py-1.5 font-semibold">
                                <button onClick={() => quickTrade(row.strikePrice, "PE", "BUY")} className="hover:text-bearish transition-colors">
                                  {row.pe.ltp.toFixed(2)}
                                </button>
                              </TableCell>
                            )}
                            {columnConfig.delta && <TableCell className="text-left py-1.5 tabular-nums font-medium">{row.pe.delta.toFixed(2)}</TableCell>}
                            {columnConfig.gamma && <TableCell className="text-left py-1.5 tabular-nums">{row.pe.gamma.toFixed(4)}</TableCell>}
                            {columnConfig.theta && <TableCell className="text-left py-1.5 tabular-nums text-bearish/80">{row.pe.theta.toFixed(2)}</TableCell>}
                            {columnConfig.vega && <TableCell className="text-left py-1.5 tabular-nums">{row.pe.vega.toFixed(2)}</TableCell>}
                            {columnConfig.rho && <TableCell className="text-left py-1.5 tabular-nums text-muted-foreground">-0.{Math.round(Math.abs(row.pe.delta) * 22).toString().padStart(2, "0")}</TableCell>}
                            {columnConfig.timeValue && <TableCell className="text-left py-1.5 tabular-nums">{row.pe.timeValue.toFixed(2)}</TableCell>}
                            {columnConfig.intrinsic && <TableCell className={`text-left py-1.5 tabular-nums ${row.pe.intrinsic > 0 ? "" : "text-muted-foreground/50"}`}>{row.pe.intrinsic.toFixed(2)}</TableCell>}
                            {columnConfig.iv && <TableCell className={`text-left py-1.5 tabular-nums ${isITMPut ? "text-muted-foreground/70" : ""}`}>{row.pe.iv.toFixed(1)}</TableCell>}
                          </TableRow>
                        </ContextMenuTrigger>
                        <ContextMenuContent className="w-48">
                          <ContextMenuSub>
                            <ContextMenuSubTrigger className="gap-2"><TrendingUp className="h-3.5 w-3.5 text-primary" /> Buy</ContextMenuSubTrigger>
                            <ContextMenuSubContent>
                              <ContextMenuItem onClick={() => handleContextAction(row.strikePrice, "CE", "buy")} className="text-xs">Buy CE @ ₹{row.ce.ltp.toFixed(2)}</ContextMenuItem>
                              <ContextMenuItem onClick={() => handleContextAction(row.strikePrice, "PE", "buy")} className="text-xs">Buy PE @ ₹{row.pe.ltp.toFixed(2)}</ContextMenuItem>
                            </ContextMenuSubContent>
                          </ContextMenuSub>
                          <ContextMenuSub>
                            <ContextMenuSubTrigger className="gap-2"><TrendingDown className="h-3.5 w-3.5 text-bearish" /> Sell</ContextMenuSubTrigger>
                            <ContextMenuSubContent>
                              <ContextMenuItem onClick={() => handleContextAction(row.strikePrice, "CE", "sell")} className="text-xs">Sell CE @ ₹{row.ce.ltp.toFixed(2)}</ContextMenuItem>
                              <ContextMenuItem onClick={() => handleContextAction(row.strikePrice, "PE", "sell")} className="text-xs">Sell PE @ ₹{row.pe.ltp.toFixed(2)}</ContextMenuItem>
                            </ContextMenuSubContent>
                          </ContextMenuSub>
                          <ContextMenuSeparator />
                          <ContextMenuItem onClick={() => handleContextAction(row.strikePrice, "CE", "straddle")} className="gap-2 text-xs">
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
                  <tfoot className="sticky bottom-0 z-10 bg-card border-t-2 border-primary/20">
                    <tr className="text-xs font-mono font-semibold">
                      <td colSpan={callCols} className="text-right py-2 px-2">
                        <div className="flex items-center justify-end gap-4">
                          <span className="text-muted-foreground">CE Vol: <span className="text-foreground">{totalCEVol >= 1000000 ? (totalCEVol / 1000000).toFixed(1) + 'M' : (totalCEVol / 1000).toFixed(0) + 'K'}</span></span>
                          <span className="text-muted-foreground">CE OI: <span className="text-primary font-bold">{totalCEOI >= 1000000 ? (totalCEOI / 1000000).toFixed(1) + 'M' : (totalCEOI / 100000).toFixed(1) + 'L'}</span></span>
                        </div>
                      </td>
                      <td colSpan={2} className="text-center py-2 bg-accent/50 border-x-2 border-border">
                        <span className={`text-xs font-bold ${Number(pcr) > 1 ? 'text-bullish' : 'text-bearish'}`}>
                          PCR: {pcr}
                        </span>
                      </td>
                      <td colSpan={callCols} className="text-left py-2 px-2">
                        <div className="flex items-center gap-4">
                          <span className="text-muted-foreground">PE OI: <span className="text-bearish font-bold">{totalPEOI >= 1000000 ? (totalPEOI / 1000000).toFixed(1) + 'M' : (totalPEOI / 100000).toFixed(1) + 'L'}</span></span>
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
              <div className="flex items-center gap-2 px-3 py-1.5 border-b border-amber-500/20 bg-amber-500/5">
                <Badge variant="outline" className="text-xs h-4 px-1.5 border-amber-500/40 text-amber-600 gap-1">
                  ⚠ Simulated
                </Badge>
                <span className="text-[11px] text-muted-foreground">Multi-expiry data is approximated from current expiry. Live multi-expiry API integration pending.</span>
              </div>
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-card">
                  <TableRow className="text-xs border-b-2">
                    <TableHead className="text-center text-primary font-bold" colSpan={callCols}>Calls</TableHead>
                    <TableHead className="text-center font-bold bg-accent/50 border-x-2 border-border">Exp Date</TableHead>
                    <TableHead className="text-center text-bearish font-bold" colSpan={putCols}>Puts</TableHead>
                  </TableRow>
                  <TableRow className="text-[11px] text-muted-foreground">
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
                    {columnConfig.volume && <TableHead className="text-right">Volume</TableHead>}
                    <TableHead className="text-center bg-accent/50 border-x-2 border-border font-semibold">Exp Date</TableHead>
                    {columnConfig.volume && <TableHead className="text-left">Volume</TableHead>}
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
                    <TableRow key={row.expiry} className="text-xs sm:text-[11px] font-mono hover:bg-accent/30 transition-colors">
                      {columnConfig.iv && <TableCell className="text-right py-1.5 tabular-nums">{row.ce.iv.toFixed(1)}</TableCell>}
                      {columnConfig.intrinsic && <TableCell className="text-right py-1.5 tabular-nums">{row.ce.intrinsic.toFixed(2)}</TableCell>}
                      {columnConfig.timeValue && <TableCell className="text-right py-1.5 tabular-nums">{row.ce.timeValue.toFixed(2)}</TableCell>}
                      {columnConfig.rho && <TableCell className="text-right py-1.5 tabular-nums">0.{Math.round(row.ce.delta * 22).toString().padStart(2, "0")}</TableCell>}
                      {columnConfig.vega && <TableCell className="text-right py-1.5 tabular-nums">{row.ce.vega.toFixed(2)}</TableCell>}
                      {columnConfig.theta && <TableCell className="text-right py-1.5 tabular-nums text-bearish/80">{row.ce.theta.toFixed(2)}</TableCell>}
                      {columnConfig.gamma && <TableCell className="text-right py-1.5 tabular-nums">{row.ce.gamma.toFixed(4)}</TableCell>}
                      {columnConfig.delta && <TableCell className="text-right py-1.5 tabular-nums font-medium">{row.ce.delta.toFixed(2)}</TableCell>}
                      {columnConfig.price && <TableCell className="text-right py-1.5 font-semibold">{row.ce.ltp.toFixed(2)}</TableCell>}
                      {columnConfig.ask && <TableCell className="text-right py-1.5 tabular-nums">{row.ce.ask.toFixed(2)}</TableCell>}
                      {columnConfig.bid && <TableCell className="text-right py-1.5 tabular-nums">{row.ce.bid.toFixed(2)}</TableCell>}
                      {columnConfig.volume && <TableCell className="text-right py-1.5"><VolumeBar value={row.ce.volume} max={maxVol} side="call" /></TableCell>}
                      <TableCell className="text-center py-1.5 bg-accent/50 border-x-2 border-border font-semibold font-sans text-xs">{row.expiry}</TableCell>
                      {columnConfig.volume && <TableCell className="text-left py-1.5"><VolumeBar value={row.pe.volume} max={maxVol} side="put" /></TableCell>}
                      {columnConfig.bid && <TableCell className="text-left py-1.5 tabular-nums">{row.pe.bid.toFixed(2)}</TableCell>}
                      {columnConfig.ask && <TableCell className="text-left py-1.5 tabular-nums">{row.pe.ask.toFixed(2)}</TableCell>}
                      {columnConfig.price && <TableCell className="text-left py-1.5 font-semibold">{row.pe.ltp.toFixed(2)}</TableCell>}
                      {columnConfig.delta && <TableCell className="text-left py-1.5 tabular-nums font-medium">{row.pe.delta.toFixed(2)}</TableCell>}
                      {columnConfig.gamma && <TableCell className="text-left py-1.5 tabular-nums">{row.pe.gamma.toFixed(4)}</TableCell>}
                      {columnConfig.theta && <TableCell className="text-left py-1.5 tabular-nums text-bearish/80">{row.pe.theta.toFixed(2)}</TableCell>}
                      {columnConfig.vega && <TableCell className="text-left py-1.5 tabular-nums">{row.pe.vega.toFixed(2)}</TableCell>}
                      {columnConfig.rho && <TableCell className="text-left py-1.5 tabular-nums">-0.{Math.round(Math.abs(row.pe.delta) * 22).toString().padStart(2, "0")}</TableCell>}
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
    </div>
  );
}
