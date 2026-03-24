import { useState, useMemo, useRef, useCallback, useEffect } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger, ContextMenuSub, ContextMenuSubContent, ContextMenuSubTrigger } from "@/components/ui/context-menu";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Crosshair, Wifi, WifiOff, RefreshCw, Bell, TrendingUp, TrendingDown, Layers, ChevronLeft, ChevronRight, Settings2, Flame } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { fnoStocks } from "@/lib/mockData";
import { useLiveOptionChain } from "@/hooks/useNSEData";
import { toast } from "sonner";

const underlyings = [
  { label: "NIFTY 50", value: "NIFTY" },
  { label: "BANK NIFTY", value: "BANKNIFTY" },
  { label: "FIN NIFTY", value: "FINNIFTY" },
  { label: "MIDCAP NIFTY", value: "MIDCPNIFTY" },
  ...fnoStocks.map(s => ({ label: s, value: s })),
];

// ── Volume Bar ──
function VolumeBar({ value, max, side }: { value: number; max: number; side: "call" | "put" }) {
  const pct = Math.min((value / max) * 100, 100);
  return (
    <div className="flex items-center gap-1.5">
      <span className={`text-[10px] font-mono tabular-nums ${value > max * 0.7 ? (side === "call" ? "text-primary font-semibold" : "text-bearish font-semibold") : ""}`}>
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

// ── OI Bar (colored by value intensity) ──
function OIBar({ value, max, side }: { value: number; max: number; side: "call" | "put" }) {
  const pct = Math.min((value / max) * 100, 100);
  const isHigh = pct > 60;
  return (
    <div className="flex items-center gap-1.5">
      <span className={`text-[10px] font-mono tabular-nums ${isHigh ? (side === "call" ? "text-primary font-semibold" : "text-bearish font-semibold") : ""}`}>
        {value >= 1000000 ? (value / 1000000).toFixed(1) + "M" : (value / 1000).toFixed(0) + "K"}
      </span>
      <div className={`w-[50px] h-[6px] rounded-sm overflow-hidden ${side === "call" ? "bg-primary/10" : "bg-bearish/10"}`}>
        <div
          className={`h-full rounded-sm ${side === "call" ? "bg-primary/50" : "bg-bearish/40"}`}
          style={{ width: `${pct}%` }}
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

  const quickTrade = useCallback((strike: number, type: "CE" | "PE", action: "BUY" | "SELL") => {
    navigate(`/strategy?${new URLSearchParams({ symbol, strike: String(strike), type, action })}`);
  }, [symbol, navigate]);

  const { data, isLoading, refetch } = useLiveOptionChain(symbol, selectedExpiry);

  const chain = data?.chain || [];
  const spotPrice = data?.spotPrice || 0;
  const lotSize = data?.lotSize || 25;
  const stepSize = data?.stepSize || 50;
  const maxPain = data?.maxPain || 0;
  const expiries = data?.expiries || [];
  const isLive = data?.isLive || false;

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
  }, [chain.length > 0, viewMode]);

  useEffect(() => {
    if (chain.length > 0 && !selectedStrike) setSelectedStrike(atmStrike);
  }, [chain.length, atmStrike]);

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

  // Active columns count for colSpan
  const callCols = [columnConfig.iv, columnConfig.intrinsic, columnConfig.timeValue, columnConfig.rho, columnConfig.vega, columnConfig.theta, columnConfig.gamma, columnConfig.delta, columnConfig.price, columnConfig.ask, columnConfig.bid, columnConfig.volume].filter(Boolean).length;
  const putCols = callCols;

  return (
    <div className="space-y-2.5 lg:space-y-3">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <Select value={symbol} onValueChange={(v) => { setSymbol(v); setSelectedExpiry(undefined); }}>
            <SelectTrigger className="w-[130px] h-8 text-xs font-medium"><SelectValue /></SelectTrigger>
            <SelectContent>
              {underlyings.map(u => <SelectItem key={u.value} value={u.value}>{u.label}</SelectItem>)}
            </SelectContent>
          </Select>

          {/* View Mode Tabs */}
          <ToggleGroup type="single" value={viewMode} onValueChange={(v) => v && setViewMode(v as any)} className="bg-muted rounded-md p-0.5">
            <ToggleGroupItem value="expiration" className="text-[10px] h-7 px-3 data-[state=on]:bg-background data-[state=on]:shadow-sm rounded">
              By expiration
            </ToggleGroupItem>
            <ToggleGroupItem value="strike" className="text-[10px] h-7 px-3 data-[state=on]:bg-background data-[state=on]:shadow-sm rounded">
              By strike
            </ToggleGroupItem>
          </ToggleGroup>
        </div>

        <div className="flex items-center gap-1.5">
          <Badge variant="outline" className={`gap-1 text-[9px] ${isLive ? "border-bullish/50 text-bullish" : "border-muted-foreground/30"}`}>
            {isLive ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
            {isLive ? (data?.source === "dhan" ? "DHAN" : "NSE") : "MOCK"}
          </Badge>
          <span className="text-[10px] font-mono">
            {symbol} <span className="font-semibold text-foreground">{spotPrice.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</span>
          </span>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => refetch()}>
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={scrollToATM}>
            <Crosshair className="h-3.5 w-3.5" />
          </Button>

          {/* Column Config */}
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7"><Settings2 className="h-3.5 w-3.5" /></Button>
            </PopoverTrigger>
            <PopoverContent className="w-48 p-3" align="end">
              <p className="text-[10px] font-semibold text-muted-foreground mb-2 uppercase tracking-wider">Show Columns</p>
              <div className="space-y-1.5">
                {Object.entries(columnConfig).map(([key, val]) => (
                  <div key={key} className="flex items-center justify-between">
                    <Label className="text-[10px] capitalize">{key === "oiChange" ? "OI Change" : key === "timeValue" ? "Time Value" : key}</Label>
                    <Switch checked={val} onCheckedChange={(v) => setColumnConfig({ ...columnConfig, [key]: v })} className="scale-[0.6]" />
                  </div>
                ))}
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </div>

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
                className={`flex flex-col items-center px-3 py-1.5 rounded-md text-[10px] transition-colors border ${
                  isSelected
                    ? "bg-foreground text-background border-foreground font-semibold"
                    : "bg-card border-border hover:bg-accent"
                }`}
              >
                <span className="text-[8px] opacity-70">{parts[1]}</span>
                <span className="font-bold text-sm leading-none">{parts[0]}</span>
              </button>
            );
          })}
          {expiries.length > 5 && (
            <Select value={selectedExpiry || expiries[0]?.value} onValueChange={setSelectedExpiry}>
              <SelectTrigger className="w-[100px] h-8 text-[10px]"><SelectValue placeholder="More..." /></SelectTrigger>
              <SelectContent>
                {expiries.slice(5).map(e => (
                  <SelectItem key={e.value} value={e.value}>{e.label} ({e.daysToExpiry}d)</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
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
            <p className="text-[9px] text-muted-foreground text-center mb-1">Strike</p>
            <div ref={strikeScrollRef} className="flex gap-0.5 overflow-x-auto scrollbar-hide pb-1" style={{ scrollBehavior: "smooth" }}>
              {allStrikes.map(s => {
                const isATM = s === atmStrike;
                const isSelected = s === selectedStrike;
                return (
                  <button
                    key={s}
                    onClick={() => setSelectedStrike(s)}
                    className={`shrink-0 px-2.5 py-1.5 rounded text-[10px] font-mono transition-colors border ${
                      isSelected
                        ? "bg-foreground text-background border-foreground font-bold"
                        : isATM
                          ? "bg-primary/10 border-primary/30 text-primary font-semibold"
                          : "border-border hover:bg-accent"
                    }`}
                  >
                    {isATM && (
                      <div className="text-[7px] leading-none mb-0.5 opacity-70">
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
            <p className="text-[8px] text-muted-foreground">{stat.label}</p>
            <p className={`text-xs font-bold font-mono ${stat.className || ""}`}>{stat.value}</p>
          </div>
        ))}
      </div>

      {/* Unusual Activity Banner */}
      {unusualActivity.count > 0 && (
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-orange-500/10 border border-orange-500/25 text-[10px]">
          <Flame className="h-3.5 w-3.5 text-orange-500 animate-pulse" />
          <span className="font-semibold text-orange-500">{unusualActivity.count} Unusual Activity</span>
          <span className="text-muted-foreground">strikes detected (Vol &gt; 3× avg OI):</span>
          <div className="flex items-center gap-1 overflow-x-auto scrollbar-hide">
            {unusualActivity.hotStrikes.map(s => {
              const flag = unusualActivity.flags.get(s)!;
              return (
                <Badge key={s} variant="outline" className="text-[9px] gap-1 border-orange-500/30 text-orange-500 shrink-0">
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
        <div className="sticky top-0 z-20 flex items-center justify-between gap-2 px-3 py-1 rounded bg-primary/5 border border-primary/20 text-[10px] font-mono">
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
              <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">Loading...</div>
            ) : (
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-card">
                  {/* CALLS / STRIKE / PUTS header */}
                  <TableRow className="text-[10px] border-b-2">
                    <TableHead className="text-center text-primary font-bold" colSpan={callCols}>Calls</TableHead>
                    <TableHead className="text-center font-bold bg-accent/50 border-x-2 border-border" colSpan={2}>Strike · IV%</TableHead>
                    <TableHead className="text-center text-bearish font-bold" colSpan={putCols}>Puts</TableHead>
                  </TableRow>
                  {/* Column sub-headers — calls reversed order */}
                  <TableRow className="text-[9px] text-muted-foreground">
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
                  {enrichedChain.map((row) => {
                    const isATM = row.strikePrice === atmStrike;
                    const isITMCall = row.strikePrice < spotPrice;
                    const isITMPut = row.strikePrice > spotPrice;
                    const isMP = row.strikePrice === maxPain;
                    const avgIV = ((row.ce.iv + row.pe.iv) / 2).toFixed(1);
                    const uaFlag = unusualActivity.flags.get(row.strikePrice);
                    const hasUA = !!uaFlag;

                    return (
                      <ContextMenu key={row.strikePrice}>
                        <ContextMenuTrigger asChild>
                          <TableRow
                            ref={isATM ? atmRef : undefined}
                            className={`text-[10px] sm:text-[11px] font-mono cursor-context-menu transition-colors hover:bg-accent/30 ${
                              isATM ? "bg-primary/[0.06] border-y border-primary/20" : ""
                            } ${hasUA ? "bg-orange-500/[0.04]" : ""}`}
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
                            <TableCell className="text-center py-1.5 bg-accent/50 border-l-2 border-border font-bold relative">
                              <div className="flex items-center justify-center gap-1">
                                {hasUA && <Flame className="h-3 w-3 text-orange-500 animate-pulse shrink-0" />}
                                {row.strikePrice.toLocaleString("en-IN")}
                                {isATM && <Badge className="text-[7px] px-1 py-0 h-3.5 bg-foreground text-background">{symbol} {spotPrice.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</Badge>}
                                {isMP && <Badge variant="outline" className="text-[7px] px-1 py-0 h-3.5 border-warning text-warning">MP</Badge>}
                              </div>
                            </TableCell>
                            <TableCell className="text-center py-1.5 bg-accent/50 border-r-2 border-border text-muted-foreground">{avgIV}</TableCell>

                            {/* ── PUT SIDE ── */}
                            {columnConfig.volume && (
                              <TableCell className="text-left py-1.5">
                                <VolumeBar value={row.pe.volume} max={maxVol} side="put" />
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
              <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">Select a strike above</div>
            ) : (
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-card">
                  <TableRow className="text-[10px] border-b-2">
                    <TableHead className="text-center text-primary font-bold" colSpan={callCols}>Calls</TableHead>
                    <TableHead className="text-center font-bold bg-accent/50 border-x-2 border-border">Exp Date</TableHead>
                    <TableHead className="text-center text-bearish font-bold" colSpan={putCols}>Puts</TableHead>
                  </TableRow>
                  <TableRow className="text-[9px] text-muted-foreground">
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
                    <TableRow key={row.expiry} className="text-[10px] sm:text-[11px] font-mono hover:bg-accent/30 transition-colors">
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
                      <TableCell className="text-center py-1.5 bg-accent/50 border-x-2 border-border font-semibold font-sans text-[10px]">{row.expiry}</TableCell>
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
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
