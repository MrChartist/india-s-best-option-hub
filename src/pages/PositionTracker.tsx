import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { simulatePnL, simulateGreeksDecay, fnoStocks, type Position } from "@/lib/mockData";
import {
  getPositions, savePositions, removePosition as storeRemove,
  updatePosition as storeUpdate, clearPositions, createPosition,
  closePosition as storeClose, getClosedPositions, clearClosedPositions,
  getLotSize, getSpotPrice, type ClosedPosition,
  LOT_SIZE_MAP, SPOT_PRICE_MAP,
} from "@/lib/positionStore";
import { Plus, Trash2, DollarSign, Shield, Clock, Activity, BarChart3, Download, Upload, X, Check, RotateCcw, ChevronDown, ChevronUp } from "lucide-react";
import { ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Area, AreaChart, Bar } from "recharts";
import { WhatIfSimulator } from "@/components/WhatIfSimulator";
import { useToast } from "@/hooks/use-toast";

// Available symbols: indices + all F&O stocks
const AVAILABLE_SYMBOLS = [
  "NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY",
  ...fnoStocks.filter(s => !["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY"].includes(s)),
];

// Inline editable cell
function EditableCell({ value, onSave, prefix = "", suffix = "", className = "" }: {
  value: number; onSave: (v: number) => void; prefix?: string; suffix?: string; className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [editVal, setEditVal] = useState(value.toString());
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (editing) inputRef.current?.select(); }, [editing]);

  if (!editing) {
    return (
      <span
        className={`cursor-pointer hover:bg-accent/50 px-1 rounded transition-colors ${className}`}
        onClick={() => { setEditVal(value.toString()); setEditing(true); }}
        title="Click to edit"
      >
        {prefix}{value.toFixed(2)}{suffix}
      </span>
    );
  }

  return (
    <div className="flex items-center gap-0.5">
      <Input
        ref={inputRef}
        type="number"
        value={editVal}
        onChange={e => setEditVal(e.target.value)}
        onKeyDown={e => {
          if (e.key === "Enter") { onSave(Number(editVal)); setEditing(false); }
          if (e.key === "Escape") setEditing(false);
        }}
        onBlur={() => { onSave(Number(editVal)); setEditing(false); }}
        className="h-5 w-[70px] text-[10px] font-mono px-1"
        step="0.05"
      />
    </div>
  );
}

export default function PositionTracker() {
  const { toast } = useToast();
  const [positions, setPositions] = useState<Position[]>(() => getPositions());
  const [closedPositions, setClosedPositions] = useState<ClosedPosition[]>(() => getClosedPositions());
  const [showAddForm, setShowAddForm] = useState(false);
  const [showClosed, setShowClosed] = useState(false);
  const [simSpotOverride, setSimSpotOverride] = useState<string>("");
  const [simSymbol, setSimSymbol] = useState<string>(""); // auto-detect

  // Auto-save to localStorage on every change
  useEffect(() => { savePositions(positions); }, [positions]);

  // ── Add Form State ──
  const [formSymbol, setFormSymbol] = useState("NIFTY");
  const [formType, setFormType] = useState<"CE" | "PE">("CE");
  const [formAction, setFormAction] = useState<"BUY" | "SELL">("SELL");
  const [formStrike, setFormStrike] = useState("24300");
  const [formLots, setFormLots] = useState("1");
  const [formEntry, setFormEntry] = useState("100");
  const [formCmp, setFormCmp] = useState("100");
  const [formExpiry, setFormExpiry] = useState("");

  // Update defaults when symbol changes
  useEffect(() => {
    const spot = getSpotPrice(formSymbol);
    const step = formSymbol === "BANKNIFTY" ? 100 : formSymbol === "MIDCPNIFTY" ? 25 : 50;
    setFormStrike((Math.round(spot / step) * step).toString());
  }, [formSymbol]);

  // ── Derived stats ──
  const stats = useMemo(() => {
    const totalPnl = positions.reduce((s, p) => s + p.pnl, 0);
    const totalDelta = positions.reduce((s, p) => {
      const mult = p.action === "BUY" ? 1 : -1;
      return s + p.delta * mult * p.lots * p.lotSize;
    }, 0);
    const totalTheta = positions.reduce((s, p) => {
      const mult = p.action === "BUY" ? 1 : -1;
      return s + p.theta * mult * p.lots * p.lotSize;
    }, 0);
    const totalVega = positions.reduce((s, p) => s + 8 * p.lots * p.lotSize * (p.action === "BUY" ? 1 : -1), 0);
    const totalInvestment = positions.reduce((s, p) => s + p.entryPrice * p.lots * p.lotSize, 0);
    const totalMargin = positions.filter(p => p.action === "SELL").reduce((s, p) => s + p.entryPrice * p.lots * p.lotSize * 3, 0);
    const winners = positions.filter(p => p.pnl > 0).length;
    const losers = positions.filter(p => p.pnl < 0).length;
    return {
      totalPnl, totalDelta: Math.round(totalDelta),
      totalTheta: Math.round(totalTheta * 100) / 100,
      totalVega: Math.round(totalVega),
      totalInvestment: Math.round(totalInvestment),
      totalMargin: Math.round(totalMargin),
      pnlPercent: totalInvestment > 0 ? Math.round((totalPnl / totalInvestment) * 10000) / 100 : 0,
      winners, losers,
      winRate: positions.length > 0 ? Math.round((winners / positions.length) * 100) : 0,
    };
  }, [positions]);

  // ── Symbol groups for positions ──
  const grouped = useMemo(() => {
    const groups: Record<string, Position[]> = {};
    for (const p of positions) (groups[p.symbol] ||= []).push(p);
    return groups;
  }, [positions]);

  // ── P&L Simulator ──
  const availableSimSymbols = useMemo(() => Object.keys(grouped), [grouped]);
  const activeSimSymbol = simSymbol || availableSimSymbols[0] || "NIFTY";
  const simPositions = positions.filter(p => p.symbol === activeSimSymbol);
  const simSpot = Number(simSpotOverride) || getSpotPrice(activeSimSymbol);
  const pnlSimData = useMemo(() => {
    if (simPositions.length === 0) return [];
    const range: [number, number] = [simSpot * 0.95, simSpot * 1.05];
    return simulatePnL(simPositions, range, 60);
  }, [simPositions, simSpot]);

  // Greeks Decay
  const greeksDecay = useMemo(() => simulateGreeksDecay(positions, 7), [positions]);

  // ── Actions ──
  const handleAddPosition = useCallback(() => {
    const pos = createPosition({
      symbol: formSymbol,
      type: formType,
      action: formAction,
      strike: Number(formStrike),
      lots: Number(formLots),
      entryPrice: Number(formEntry),
      currentPrice: Number(formCmp),
      expiry: formExpiry,
    });
    setPositions(prev => [...prev, pos]);
    toast({ title: "Position Added", description: `${formAction} ${formSymbol} ${formStrike} ${formType}` });
    // Reset form
    setFormEntry("100");
    setFormCmp("100");
    setFormLots("1");
    setShowAddForm(false);
  }, [formSymbol, formType, formAction, formStrike, formLots, formEntry, formCmp, formExpiry, toast]);

  const handleRemove = useCallback((id: string) => {
    setPositions(prev => prev.filter(p => p.id !== id));
    toast({ title: "Position Deleted" });
  }, [toast]);

  const handleClose = useCallback((id: string) => {
    const pos = positions.find(p => p.id === id);
    if (!pos) return;
    const { active, closed } = storeClose(id, pos.currentPrice);
    setPositions(active);
    setClosedPositions(closed);
    toast({
      title: "Position Closed",
      description: `${pos.action} ${pos.symbol} ${pos.strike} ${pos.type} — ₹${pos.pnl.toLocaleString("en-IN")} realized`,
    });
  }, [positions, toast]);

  const handleUpdateCMP = useCallback((id: string, newCmp: number) => {
    setPositions(prev => prev.map(p => {
      if (p.id !== id) return p;
      const mult = p.action === "BUY" ? 1 : -1;
      const pnl = Math.round((newCmp - p.entryPrice) * mult * p.lots * p.lotSize);
      const pnlPercent = p.entryPrice > 0
        ? Math.round(((newCmp - p.entryPrice) / p.entryPrice) * mult * 10000) / 100
        : 0;
      return { ...p, currentPrice: newCmp, pnl, pnlPercent };
    }));
  }, []);

  const handleUpdateLots = useCallback((id: string, newLots: number) => {
    if (newLots < 1) return;
    setPositions(prev => prev.map(p => {
      if (p.id !== id) return p;
      const mult = p.action === "BUY" ? 1 : -1;
      const pnl = Math.round((p.currentPrice - p.entryPrice) * mult * newLots * p.lotSize);
      const pnlPercent = p.entryPrice > 0
        ? Math.round(((p.currentPrice - p.entryPrice) / p.entryPrice) * mult * 10000) / 100
        : 0;
      return { ...p, lots: newLots, pnl, pnlPercent };
    }));
  }, []);

  const handleClearAll = useCallback(() => {
    clearPositions();
    setPositions([]);
    toast({ title: "All positions cleared" });
  }, [toast]);

  const handleLoadDemo = useCallback(() => {
    const { getMockPositions } = require("@/lib/mockData");
    const demo = getMockPositions();
    savePositions(demo);
    setPositions(demo);
    toast({ title: "Demo positions loaded" });
  }, [toast]);

  const handleExport = useCallback(() => {
    const data = JSON.stringify({ active: positions, closed: closedPositions, exportedAt: new Date().toISOString() }, null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `positions_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: "Positions exported" });
  }, [positions, closedPositions, toast]);

  const tooltipStyle = { backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "6px", fontSize: "11px" };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Position Tracker</h1>
          <p className="text-sm text-muted-foreground">
            Live P&L · P&L Simulator · Greeks Decay · Portfolio Risk
            {positions.length > 0 && <Badge variant="outline" className="ml-2 text-[9px]">{positions.length} active</Badge>}
            {closedPositions.length > 0 && <Badge variant="outline" className="ml-1 text-[9px]">{closedPositions.length} closed</Badge>}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <Button variant="outline" size="sm" className="h-7 text-[10px] gap-1" onClick={handleExport}>
            <Download className="h-3 w-3" /> Export
          </Button>
          <Button variant="outline" size="sm" className="h-7 text-[10px] gap-1" onClick={handleLoadDemo}>
            <RotateCcw className="h-3 w-3" /> Demo
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" size="sm" className="h-7 text-[10px] gap-1 text-destructive hover:text-destructive">
                <Trash2 className="h-3 w-3" /> Clear All
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Clear all positions?</AlertDialogTitle>
                <AlertDialogDescription>This will permanently delete all {positions.length} active positions. Closed positions will be kept.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleClearAll}>Delete All</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <Button size="sm" className="h-7 text-[10px] gap-1" onClick={() => setShowAddForm(!showAddForm)}>
            <Plus className="h-3 w-3" /> Add Position
          </Button>
        </div>
      </div>

      {/* Add Position Form */}
      {showAddForm && (
        <Card className="border-primary/30">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">Add New Position</CardTitle>
              <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => setShowAddForm(false)}>
                <X className="h-3 w-3" />
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 md:grid-cols-9 gap-2">
              <div>
                <Label className="text-[9px]">Symbol</Label>
                <Select value={formSymbol} onValueChange={setFormSymbol}>
                  <SelectTrigger className="h-7 text-[10px]"><SelectValue /></SelectTrigger>
                  <SelectContent className="max-h-[200px]">
                    {AVAILABLE_SYMBOLS.map(s => (
                      <SelectItem key={s} value={s} className="text-xs">{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-[9px]">Type</Label>
                <Select value={formType} onValueChange={v => setFormType(v as "CE" | "PE")}>
                  <SelectTrigger className="h-7 text-[10px]"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="CE">CE</SelectItem><SelectItem value="PE">PE</SelectItem></SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-[9px]">Action</Label>
                <Select value={formAction} onValueChange={v => setFormAction(v as "BUY" | "SELL")}>
                  <SelectTrigger className="h-7 text-[10px]"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="BUY">BUY</SelectItem><SelectItem value="SELL">SELL</SelectItem></SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-[9px]">Strike</Label>
                <Input value={formStrike} onChange={e => setFormStrike(e.target.value)} type="number" className="h-7 text-[10px] font-mono" />
              </div>
              <div>
                <Label className="text-[9px]">Lots ({getLotSize(formSymbol)}/lot)</Label>
                <Input value={formLots} onChange={e => setFormLots(e.target.value)} type="number" min={1} className="h-7 text-[10px] font-mono" />
              </div>
              <div>
                <Label className="text-[9px]">Entry ₹</Label>
                <Input value={formEntry} onChange={e => setFormEntry(e.target.value)} type="number" step="0.05" className="h-7 text-[10px] font-mono" />
              </div>
              <div>
                <Label className="text-[9px]">CMP ₹</Label>
                <Input value={formCmp} onChange={e => setFormCmp(e.target.value)} type="number" step="0.05" className="h-7 text-[10px] font-mono" />
              </div>
              <div>
                <Label className="text-[9px]">Expiry</Label>
                <Input value={formExpiry} onChange={e => setFormExpiry(e.target.value)} placeholder="27 Mar" className="h-7 text-[10px]" />
              </div>
              <div className="flex items-end">
                <Button size="sm" className="h-7 text-xs w-full gap-1" onClick={handleAddPosition}>
                  <Check className="h-3 w-3" /> Add
                </Button>
              </div>
            </div>
            <p className="text-[9px] text-muted-foreground mt-1.5">
              Lot size: {getLotSize(formSymbol)} | Total qty: {Number(formLots) * getLotSize(formSymbol)} | Investment: ₹{(Number(formEntry) * Number(formLots) * getLotSize(formSymbol)).toLocaleString("en-IN")}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Portfolio Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2">
        <Card className={stats.totalPnl >= 0 ? "border-bullish/20" : "border-bearish/20"}>
          <CardContent className="pt-3 pb-3 text-center">
            <p className="text-[9px] text-muted-foreground flex items-center justify-center gap-1"><DollarSign className="h-3 w-3" /> Total P&L</p>
            <p className={`text-xl font-bold font-mono ${stats.totalPnl >= 0 ? "text-bullish" : "text-bearish"}`}>
              {stats.totalPnl >= 0 ? "+" : ""}₹{stats.totalPnl.toLocaleString("en-IN")}
            </p>
            <p className={`text-[10px] font-mono ${stats.totalPnl >= 0 ? "text-bullish" : "text-bearish"}`}>{stats.pnlPercent >= 0 ? "+" : ""}{stats.pnlPercent}%</p>
          </CardContent>
        </Card>
        <Card><CardContent className="pt-3 pb-3 text-center">
          <p className="text-[9px] text-muted-foreground">Net Delta</p>
          <p className={`text-lg font-bold font-mono ${stats.totalDelta >= 0 ? "text-bullish" : "text-bearish"}`}>{stats.totalDelta}</p>
        </CardContent></Card>
        <Card><CardContent className="pt-3 pb-3 text-center">
          <p className="text-[9px] text-muted-foreground">Net Theta</p>
          <p className={`text-lg font-bold font-mono ${stats.totalTheta >= 0 ? "text-bullish" : "text-bearish"}`}>₹{stats.totalTheta}/d</p>
        </CardContent></Card>
        <Card><CardContent className="pt-3 pb-3 text-center">
          <p className="text-[9px] text-muted-foreground">Net Vega</p>
          <p className={`text-lg font-bold font-mono ${stats.totalVega >= 0 ? "text-bullish" : "text-bearish"}`}>₹{stats.totalVega}</p>
        </CardContent></Card>
        <Card><CardContent className="pt-3 pb-3 text-center">
          <p className="text-[9px] text-muted-foreground">Investment</p>
          <p className="text-lg font-bold font-mono">₹{(stats.totalInvestment / 1000).toFixed(1)}K</p>
        </CardContent></Card>
        <Card><CardContent className="pt-3 pb-3 text-center">
          <p className="text-[9px] text-muted-foreground">Margin</p>
          <p className="text-lg font-bold font-mono">₹{(stats.totalMargin / 1000).toFixed(0)}K</p>
        </CardContent></Card>
        <Card><CardContent className="pt-3 pb-3 text-center">
          <p className="text-[9px] text-muted-foreground">Win Rate</p>
          <p className={`text-lg font-bold font-mono ${stats.winRate >= 50 ? "text-bullish" : "text-bearish"}`}>{stats.winRate}%</p>
          <p className="text-[9px] text-muted-foreground">{stats.winners}W/{stats.losers}L</p>
        </CardContent></Card>
        <Card><CardContent className="pt-3 pb-3 text-center">
          <p className="text-[9px] text-muted-foreground flex items-center justify-center gap-1"><Shield className="h-3 w-3" /> Risk</p>
          <p className={`text-lg font-bold font-mono ${Math.abs(stats.totalDelta) > 500 ? "text-bearish" : "text-bullish"}`}>
            {Math.abs(stats.totalDelta) > 500 ? "High" : Math.abs(stats.totalDelta) > 200 ? "Med" : "Low"}
          </p>
        </CardContent></Card>
      </div>

      {/* P&L Simulator & Greeks Decay */}
      <Tabs defaultValue="pnl-sim">
        <TabsList>
          <TabsTrigger value="pnl-sim">P&L Simulator</TabsTrigger>
          <TabsTrigger value="greeks-decay">Greeks Decay</TabsTrigger>
        </TabsList>

        <TabsContent value="pnl-sim">
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-sm flex items-center gap-2"><Activity className="h-4 w-4" /> P&L at Expiry — {activeSimSymbol} Positions</CardTitle>
                  <p className="text-[10px] text-muted-foreground">Shows combined P&L across all {activeSimSymbol} legs as spot moves ±5%</p>
                </div>
                <div className="flex items-center gap-2">
                  {availableSimSymbols.length > 1 && (
                    <Select value={activeSimSymbol} onValueChange={v => { setSimSymbol(v); setSimSpotOverride(""); }}>
                      <SelectTrigger className="h-7 w-[120px] text-[10px]"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {availableSimSymbols.map(s => (
                          <SelectItem key={s} value={s} className="text-xs">{s} ({grouped[s]?.length} legs)</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  <Label className="text-[9px]">Spot:</Label>
                  <Input
                    type="number"
                    value={simSpotOverride || simSpot}
                    onChange={e => setSimSpotOverride(e.target.value)}
                    className="w-[100px] h-7 text-xs font-mono"
                  />
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {pnlSimData.length > 0 ? (
                <div className="h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={pnlSimData}>
                      <defs>
                        <linearGradient id="pnlGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="hsl(142 71% 45%)" stopOpacity={0.3} />
                          <stop offset="50%" stopColor="hsl(142 71% 45%)" stopOpacity={0} />
                          <stop offset="50%" stopColor="hsl(0 84% 60%)" stopOpacity={0} />
                          <stop offset="100%" stopColor="hsl(0 84% 60%)" stopOpacity={0.3} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--chart-grid))" />
                      <XAxis dataKey="spotPrice" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} />
                      <YAxis tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} />
                      <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [`₹${v.toLocaleString("en-IN")}`, "P&L"]} />
                      <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" />
                      <ReferenceLine x={simSpot} stroke="hsl(38 92% 50%)" strokeDasharray="3 3" label={{ value: "Spot", fill: "hsl(38 92% 50%)", fontSize: 9 }} />
                      <Area type="monotone" dataKey="totalPnl" stroke="hsl(210 100% 52%)" fill="url(#pnlGrad)" strokeWidth={2} name="Total P&L" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-8">No {activeSimSymbol} positions to simulate. Add positions above.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="greeks-decay">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2"><BarChart3 className="h-4 w-4" /> Greeks Decay Over Time (T to T+7)</CardTitle>
              <p className="text-[10px] text-muted-foreground">How your portfolio P&L and Greeks change as time passes (theta decay effect)</p>
            </CardHeader>
            <CardContent>
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={greeksDecay}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--chart-grid))" />
                    <XAxis dataKey="label" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                    <YAxis yAxisId="pnl" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} />
                    <YAxis yAxisId="delta" orientation="right" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} />
                    <Tooltip contentStyle={tooltipStyle} formatter={(v: number, name: string) => {
                      if (name === "P&L") return [`₹${v.toLocaleString("en-IN")}`, "P&L"];
                      if (name === "Cum Theta") return [`₹${v.toLocaleString("en-IN")}`, "Cum Theta"];
                      return [v, name];
                    }} />
                    <ReferenceLine yAxisId="pnl" y={0} stroke="hsl(var(--muted-foreground))" />
                    <Line yAxisId="pnl" type="monotone" dataKey="totalPnl" stroke="hsl(210 100% 52%)" strokeWidth={2} dot={{ fill: "hsl(210 100% 52%)", r: 3 }} name="P&L" />
                    <Line yAxisId="pnl" type="monotone" dataKey="totalTheta" stroke="hsl(38 92% 50%)" strokeWidth={1.5} strokeDasharray="5 5" dot={false} name="Cum Theta" />
                    <Bar yAxisId="delta" dataKey="totalDelta" fill="hsl(142 71% 45% / 0.3)" radius={[2, 2, 0, 0]} name="Delta" />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* What-If Scenario Simulator */}
      <WhatIfSimulator positions={positions} />

      {/* Active Positions by Symbol */}
      {positions.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground text-sm">No active positions.</p>
            <div className="flex items-center justify-center gap-2 mt-3">
              <Button size="sm" variant="outline" className="text-xs" onClick={() => setShowAddForm(true)}>
                <Plus className="h-3 w-3 mr-1" /> Add Position
              </Button>
              <Button size="sm" variant="outline" className="text-xs" onClick={handleLoadDemo}>
                <RotateCcw className="h-3 w-3 mr-1" /> Load Demo
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        Object.entries(grouped).map(([sym, symPositions]) => {
          const symPnl = symPositions.reduce((s, p) => s + p.pnl, 0);
          return (
            <Card key={sym}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm flex items-center gap-2">
                    {sym}
                    <Badge variant="outline" className="text-[9px]">{symPositions.length} legs</Badge>
                    <Badge variant="outline" className="text-[9px]">Lot: {getLotSize(sym)}</Badge>
                  </CardTitle>
                  <span className={`text-sm font-bold font-mono ${symPnl >= 0 ? "text-bullish" : "text-bearish"}`}>
                    {symPnl >= 0 ? "+" : ""}₹{symPnl.toLocaleString("en-IN")}
                  </span>
                </div>
              </CardHeader>
              <CardContent className="p-0 overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="text-[10px]">
                      <TableHead>Action</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead className="text-right">Strike</TableHead>
                      <TableHead className="text-right">Lots</TableHead>
                      <TableHead className="text-right">Entry ₹</TableHead>
                      <TableHead className="text-right">CMP ₹</TableHead>
                      <TableHead className="text-right">P&L</TableHead>
                      <TableHead className="text-right">P&L%</TableHead>
                      <TableHead className="text-right">Delta</TableHead>
                      <TableHead className="text-right">Theta</TableHead>
                      <TableHead className="text-right">IV</TableHead>
                      <TableHead className="text-center">Expiry</TableHead>
                      <TableHead className="text-center">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {symPositions.map(p => (
                      <TableRow key={p.id} className="text-[11px] font-mono hover:bg-accent/30">
                        <TableCell><Badge variant={p.action === "BUY" ? "default" : "destructive"} className="text-[9px] h-4 px-1.5">{p.action}</Badge></TableCell>
                        <TableCell><Badge variant="outline" className="text-[9px] h-4 px-1.5">{p.type}</Badge></TableCell>
                        <TableCell className="text-right font-bold">{p.strike.toLocaleString("en-IN")}</TableCell>
                        <TableCell className="text-right">
                          <EditableCell value={p.lots} onSave={v => handleUpdateLots(p.id, Math.max(1, Math.round(v)))} />
                        </TableCell>
                        <TableCell className="text-right">{p.entryPrice.toFixed(2)}</TableCell>
                        <TableCell className="text-right">
                          <EditableCell value={p.currentPrice} onSave={v => handleUpdateCMP(p.id, v)} prefix="₹" className="text-primary font-medium" />
                        </TableCell>
                        <TableCell className={`text-right font-bold ${p.pnl >= 0 ? "text-bullish" : "text-bearish"}`}>
                          {p.pnl >= 0 ? "+" : ""}₹{p.pnl.toLocaleString("en-IN")}
                        </TableCell>
                        <TableCell className={`text-right ${p.pnlPercent >= 0 ? "text-bullish" : "text-bearish"}`}>
                          {p.pnlPercent >= 0 ? "+" : ""}{p.pnlPercent.toFixed(1)}%
                        </TableCell>
                        <TableCell className="text-right">{p.delta.toFixed(2)}</TableCell>
                        <TableCell className={`text-right ${p.theta >= 0 ? "text-bullish" : "text-bearish"}`}>{p.theta.toFixed(1)}</TableCell>
                        <TableCell className="text-right">{p.iv.toFixed(1)}%</TableCell>
                        <TableCell className="text-center text-muted-foreground">
                          <div className="flex items-center gap-1 justify-center">
                            <Clock className="h-2.5 w-2.5" /> {p.expiry || "—"}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center justify-center gap-0.5">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-5 px-1.5 text-[9px] text-primary hover:text-primary"
                              onClick={() => handleClose(p.id)}
                              title="Close at CMP"
                            >
                              Close
                            </Button>
                            <Button variant="ghost" size="icon" className="h-5 w-5 text-destructive hover:text-destructive" onClick={() => handleRemove(p.id)} title="Delete">
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          );
        })
      )}

      {/* Closed Positions */}
      {closedPositions.length > 0 && (
        <Card>
          <CardHeader className="pb-2 cursor-pointer" onClick={() => setShowClosed(!showClosed)}>
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-2">
                Closed Positions
                <Badge variant="outline" className="text-[9px]">{closedPositions.length}</Badge>
                <span className={`text-xs font-mono font-bold ${closedPositions.reduce((s, p) => s + p.realizedPnl, 0) >= 0 ? "text-bullish" : "text-bearish"}`}>
                  ₹{closedPositions.reduce((s, p) => s + p.realizedPnl, 0).toLocaleString("en-IN")} realized
                </span>
              </CardTitle>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="sm" className="h-5 text-[9px] text-destructive" onClick={(e) => { e.stopPropagation(); clearClosedPositions(); setClosedPositions([]); }}>
                  Clear
                </Button>
                {showClosed ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </div>
            </div>
          </CardHeader>
          {showClosed && (
            <CardContent className="p-0 overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow className="text-[10px]">
                    <TableHead>Position</TableHead>
                    <TableHead className="text-right">Entry</TableHead>
                    <TableHead className="text-right">Exit</TableHead>
                    <TableHead className="text-right">Lots</TableHead>
                    <TableHead className="text-right">Realized P&L</TableHead>
                    <TableHead className="text-center">Closed On</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {closedPositions.map(p => (
                    <TableRow key={p.id} className="text-[11px] font-mono opacity-70">
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Badge variant={p.action === "BUY" ? "default" : "destructive"} className="text-[8px] h-3.5 px-1">{p.action}</Badge>
                          <span className="font-sans text-[10px]">{p.symbol} {p.strike} {p.type}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">₹{p.entryPrice.toFixed(2)}</TableCell>
                      <TableCell className="text-right">₹{p.exitPrice.toFixed(2)}</TableCell>
                      <TableCell className="text-right">{p.lots}</TableCell>
                      <TableCell className={`text-right font-bold ${p.realizedPnl >= 0 ? "text-bullish" : "text-bearish"}`}>
                        {p.realizedPnl >= 0 ? "+" : ""}₹{p.realizedPnl.toLocaleString("en-IN")}
                      </TableCell>
                      <TableCell className="text-center text-muted-foreground">{p.exitDate}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          )}
        </Card>
      )}
    </div>
  );
}
