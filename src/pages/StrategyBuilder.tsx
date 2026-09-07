import { useState, useMemo, useEffect, useCallback } from "react";
import { useLiveIndices } from "@/hooks/useMarketData";
import { useSearchParams } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import { Plus, Save, Trash2, TrendingUp, TrendingDown, Minus, Zap, Shield, Target, Keyboard } from "lucide-react";
import { getPresetStrategies, calculatePayoff, calculateGreeks, estimateMargin, estimateProbOfProfit, type StrategyLeg } from "@/lib/mockData";
import { getSpotPrice, getLotSize, getStepSize, createPosition, savePositions, getPositions } from "@/lib/positionStore";
import { isLiveTradingEnabled } from "@/lib/brokerConfig";
import { mapLegsToPendingTrades, mapLegsToBasketLegs } from "@/lib/strategyLegMapper";
import { previewBasket, type BasketPreview } from "@/lib/basketApi";
import { saveBasket } from "@/lib/basketStore";
import { PayoffMultiDTE } from "@/components/PayoffMultiDTE";
import { PositionSizeCalculator } from "@/components/PositionSizeCalculator";
import { TradeConfirmDialog, type PendingTrade } from "@/components/TradeConfirmDialog";
import { SaveBasketDialog } from "@/components/SaveBasketDialog";
import { GreekCard } from "@/components/GreekCard";
import { CopyTradeButton } from "@/components/CopyTradeButton";
import { toast } from "sonner";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

const outlookIcons = {
  Bullish: <TrendingUp className="h-3 w-3 text-bullish" />,
  Bearish: <TrendingDown className="h-3 w-3 text-bearish" />,
  Neutral: <Minus className="h-3 w-3 text-warning" />,
  Volatile: <Zap className="h-3 w-3 text-primary" />,
};

const riskColors = {
  Low: "text-bullish",
  Medium: "text-warning",
  High: "text-bearish",
  Unlimited: "text-bearish",
};

export default function StrategyBuilder() {
  const [searchParams] = useSearchParams();
  const { data: indicesResult } = useLiveIndices();
  // Quick Trade (from Option Chain) passes the underlying via ?symbol=... — this
  // was previously ignored, so e.g. a BANKNIFTY quick-trade would silently use
  // NIFTY's spot price, lot size and strike step, corrupting the whole leg.
  const activeSymbol = searchParams.get("symbol") || "NIFTY";
  const livePrice = indicesResult?.data?.find((i: any) => i.symbol === activeSymbol)?.ltp;
  const spotPrice = livePrice || getSpotPrice(activeSymbol);
  const lotSize = getLotSize(activeSymbol);
  const stepSize = getStepSize(activeSymbol);

  const presets = useMemo(() => getPresetStrategies(spotPrice, stepSize), [spotPrice, stepSize]);
  const [legs, setLegs] = useState<StrategyLeg[]>(presets[0].legs);
  const [selectedPreset, setSelectedPreset] = useState(presets[0].name);
  const selectedStrategy = presets.find(p => p.name === selectedPreset);

  // Quick trade from option chain.
  // IMPORTANT: this must NOT depend on spotPrice/stepSize — those change on every
  // live price tick (websocket/polling), and previously being listed as deps meant
  // this effect re-ran every few seconds, silently wiping out any legs the user had
  // manually added/edited and resetting back to a single quick-traded leg. It should
  // only re-run when the actual navigation (query string) changes.
  useEffect(() => {
    const strike = searchParams.get("strike");
    const type = searchParams.get("type") as "CE" | "PE" | null;
    const action = searchParams.get("action") as "BUY" | "SELL" | null;
    if (strike && type && action) {
      const s = Number(strike);
      if (!Number.isFinite(s) || s <= 0) return;
      const passedPremium = Number(searchParams.get("premium"));
      let premium: number;
      if (Number.isFinite(passedPremium) && passedPremium > 0) {
        // Real premium supplied by the caller (e.g. option chain LTP).
        premium = passedPremium;
      } else {
        // Fallback: no real premium available — approximate from distance-to-ATM.
        // This is only an estimate; callers should pass ?premium=<ltp> when possible.
        const atm = Math.round(spotPrice / stepSize) * stepSize;
        const distFromATM = Math.abs(s - atm) / stepSize;
        premium = Math.max(5, 150 * Math.exp(-distFromATM * 0.2));
      }
      setLegs([{ type, action, strike: s, lots: 1, premium: Math.round(premium * 100) / 100 }]);
      setSelectedPreset("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const handlePreset = (name: string) => {
    const p = presets.find(s => s.name === name);
    if (p) { setLegs(p.legs); setSelectedPreset(name); }
  };

  const addLeg = () => {
    const atm = Math.round(spotPrice / stepSize) * stepSize;
    setLegs([...legs, { type: "CE", action: "BUY", strike: atm, lots: 1, premium: 100 }]);
    setSelectedPreset("");
  };

  const removeLeg = (i: number) => {
    setLegs(legs.filter((_, idx) => idx !== i));
    setSelectedPreset("");
  };

  const updateLeg = (i: number, field: keyof StrategyLeg, value: string | number) => {
    // Immutable update (previous version mutated the leg object in place, which
    // is a React anti-pattern) + guard against NaN/invalid input silently
    // corrupting the payoff/margin/greeks math downstream.
    setLegs(prev => prev.map((leg, idx) => {
      if (idx !== i) return leg;
      switch (field) {
        case "action":
          return { ...leg, action: value as "BUY" | "SELL" };
        case "type":
          return { ...leg, type: value as "CE" | "PE" };
        case "strike": {
          const n = Number(value);
          return Number.isFinite(n) && n > 0 ? { ...leg, strike: n } : leg;
        }
        case "lots": {
          const n = Math.max(1, Math.round(Number(value)) || 1);
          return { ...leg, lots: n };
        }
        case "premium": {
          const n = Number(value);
          return Number.isFinite(n) && n >= 0 ? { ...leg, premium: n } : leg;
        }
        default:
          return leg;
      }
    }));
    setSelectedPreset("");
  };

  const payoffData = useMemo(() => {
    const range: number[] = [];
    const center = Math.round(spotPrice / stepSize) * stepSize;
    for (let s = center - stepSize * 25; s <= center + stepSize * 25; s += stepSize / 2) range.push(s);
    return calculatePayoff(legs, lotSize, range);
  }, [legs, lotSize, spotPrice, stepSize]);

  const stats = useMemo(() => {
    // Analytical slope of P&L as spot -> +infinity: only CE legs contribute (a PE's
    // intrinsic value flattens to 0 for very high spot, so it drops out of the tail).
    // If this is non-zero, profit or loss on the upside is genuinely unbounded —
    // the finite chart range below cannot capture the true max, so it must be
    // reported as "Unlimited" rather than whatever value happens to sit at the
    // edge of the plotted window.
    let rightSlope = 0;
    for (const leg of legs) {
      if (leg.type !== "CE") continue;
      rightSlope += (leg.action === "BUY" ? 1 : -1) * leg.lots * lotSize;
    }
    const maxProfitUnlimited = rightSlope > 0;
    const maxLossUnlimited = rightSlope < 0;

    // Spot has a hard floor at 0 (unlike the upside). Evaluate that boundary
    // explicitly so a naked/uncovered short put's true worst case — which can sit
    // well outside the arbitrary ±25-strike plotted window — isn't understated.
    const zeroSpotPnl = calculatePayoff(legs, lotSize, [0])[0]?.pnl ?? 0;
    const allPnls = [...payoffData.map(d => d.pnl), zeroSpotPnl];
    const maxProfit = Math.max(...allPnls);
    const maxLoss = Math.min(...allPnls);

    const breakevens = payoffData.filter((d, i) => {
      if (i === 0) return false;
      return (payoffData[i - 1].pnl < 0 && d.pnl >= 0) || (payoffData[i - 1].pnl >= 0 && d.pnl < 0);
    }).map(d => d.spot);

    const netPremium = legs.reduce((s, l) => s + (l.action === "BUY" ? -1 : 1) * l.premium * l.lots * lotSize, 0);
    const margin = estimateMargin(legs, lotSize, spotPrice);
    const probOfProfit = estimateProbOfProfit(legs, lotSize, spotPrice, 14, 7);

    let totalDelta = 0, totalGamma = 0, totalTheta = 0, totalVega = 0;
    for (const leg of legs) {
      const g = calculateGreeks(spotPrice, leg.strike, 7, 14, 6.5);
      const mult = (leg.action === "BUY" ? 1 : -1) * leg.lots * lotSize;
      totalDelta += (leg.type === "CE" ? g.delta.call : g.delta.put) * mult;
      totalTheta += (leg.type === "CE" ? g.theta.call : g.theta.put) * mult;
      // BUG FIX: these previously used Math.abs(mult), which meant a SHORT position
      // (e.g. Short Straddle, Iron Condor, Jade Lizard) always added POSITIVE gamma
      // and vega to the total — the exact opposite of reality. Short options are
      // always net short gamma (losses accelerate in fast markets) and net short
      // vega (lose money when IV rises); the sign must follow the same BUY/SELL
      // `mult` as delta and theta do.
      totalGamma += g.gamma * mult;
      totalVega += g.vega * mult;
    }

    const riskReward = maxProfitUnlimited
      ? "∞"
      : maxLossUnlimited
        ? "0.00"
        : maxLoss !== 0
          ? Math.abs(maxProfit / maxLoss).toFixed(2)
          : "∞";

    return {
      maxProfit, maxLoss, maxProfitUnlimited, maxLossUnlimited, breakevens, netPremium, margin, probOfProfit,
      riskReward,
      totalDelta: Math.round(totalDelta * 100) / 100,
      totalGamma: Math.round(totalGamma * 100) / 100,
      totalTheta: Math.round(totalTheta * 100) / 100,
      totalVega: Math.round(totalVega * 100) / 100,
    };
  }, [legs, payoffData, lotSize, spotPrice]);

  // Paper-fill the whole strategy in one confirmed step — no expiry tracking
  // exists in Strategy Builder today, so paper positions land with expiry ""
  // (createPosition/daysToExpiry already fall back gracefully for that).
  const [pendingLegs, setPendingLegs] = useState<PendingTrade[] | null>(null);
  const [placingLegs, setPlacingLegs] = useState(false);
  // Decided per-click, carried alongside pendingLegs — same reasoning as
  // OptionChain.tsx's tradeMode: a paper click must never resolve against a
  // live-mode confirm handler if Live Trading is toggled mid-flow.
  const [tradeMode, setTradeMode] = useState<"paper" | "live">("paper");

  const handleAddStrategyToPositions = useCallback(() => {
    if (legs.length === 0) return;
    // 1CLIQ-TRADE-SPEC.md §9's "StrategyBuilder seam": the leg -> PendingTrade
    // mapping now lives in strategyLegMapper.ts, shared with "Save as Basket".
    setTradeMode(isLiveTradingEnabled() ? "live" : "paper");
    setPendingLegs(mapLegsToPendingTrades(legs, activeSymbol, lotSize));
  }, [legs, activeSymbol, lotSize]);

  const handleConfirmAddStrategy = useCallback(() => {
    if (!pendingLegs) return;
    setPlacingLegs(true);
    try {
      if (tradeMode === "live") {
        // Strategy Builder legs never carry a resolved broker security id —
        // there is no chain lookup in this page, only the payoff/greeks model
        // (StrategyLeg has no securityId field at all). Rather than let the
        // "LIVE — REAL MONEY" dialog imply a real order went out when nothing
        // could, this says so plainly and falls back to paper — the same
        // honest-refusal pattern as useQuickOrder.ts's live branch. Real live
        // execution for a multi-leg strategy is "Save as Basket" -> deploy,
        // which DOES resolve real security ids via basket-deploy.
        toast.warning(
          "Live Trading is on, but these legs have no resolved broker contract yet — added as paper positions instead.",
          { description: "Use \"Save as Basket\" to resolve real contracts and deploy live.", duration: 8000 },
        );
      }
      const newPositions = pendingLegs.map((t) => createPosition({
        symbol: t.symbol, type: t.optionType, action: t.action, strike: t.strike,
        entryPrice: t.price, lots: t.lots, lotSize: t.lotSize, expiry: "",
      }));
      savePositions([...getPositions(), ...newPositions]);
      toast.success(`${newPositions.length}-leg strategy added as paper positions`, { description: "View it in Position Tracker." });
    } catch (e) {
      toast.error(`Could not add positions: ${(e as Error).message}`);
    } finally {
      setPlacingLegs(false);
      setPendingLegs(null);
    }
  }, [pendingLegs, tradeMode]);

  // "Save as Basket" (spec §9) — resolve via basket-deploy for a preview
  // step, THEN persist locally. basket-deploy never places an order.
  const [basketPreview, setBasketPreview] = useState<BasketPreview | null>(null);
  const [resolvingBasket, setResolvingBasket] = useState(false);
  const [savingBasket, setSavingBasket] = useState(false);

  const handleSaveAsBasket = useCallback(async () => {
    if (legs.length === 0) return;
    setResolvingBasket(true);
    try {
      const preview = await previewBasket(activeSymbol, mapLegsToBasketLegs(legs));
      setBasketPreview(preview);
    } catch (e) {
      toast.error(`Could not resolve basket: ${(e as Error).message}`);
    } finally {
      setResolvingBasket(false);
    }
  }, [legs, activeSymbol]);

  const handleConfirmSaveBasket = useCallback((name: string) => {
    if (!basketPreview) return;
    setSavingBasket(true);
    try {
      saveBasket({ name, symbol: activeSymbol, legs: mapLegsToBasketLegs(legs) });
      toast.success(`Basket "${name}" saved.`, {
        description: basketPreview.blockedForLive
          ? `${basketPreview.blockedLegIds.length} leg(s) are paper-only until a broker contract resolves.`
          : "All legs resolved live-deployable.",
      });
      setBasketPreview(null);
    } catch (e) {
      toast.error(`Could not save basket: ${(e as Error).message}`);
    } finally {
      setSavingBasket(false);
    }
  }, [basketPreview, legs, activeSymbol]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Strategy <span className="font-serif italic font-medium">Builder</span></h1>
          <p className="text-sm text-muted-foreground">Build multi-leg strategies · Payoff analysis · Risk metrics</p>
        </div>

        {/* Shortcuts Info */}
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-primary transition-colors" title="Keyboard Shortcuts">
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
              <div className="flex justify-between items-center"><span className="text-muted-foreground">Add Leg</span><kbd className="px-1.5 py-0.5 rounded bg-muted border font-mono">N</kbd></div>
              <div className="flex justify-between items-center"><span className="text-muted-foreground">Toggle Action</span><kbd className="px-1.5 py-0.5 rounded bg-muted border font-mono">Space</kbd></div>
            </div>
          </PopoverContent>
        </Popover>
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        {/* Legs Config */}
        <Card className="lg:col-span-1">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">Strategy</CardTitle>
              <Select value={selectedPreset} onValueChange={handlePreset}>
                <SelectTrigger className="w-[140px] h-7 text-xs"><SelectValue placeholder="Preset..." /></SelectTrigger>
                <SelectContent>
                  {presets.map(p => (
                    <SelectItem key={p.name} value={p.name}>
                      <div className="flex items-center gap-1.5">
                        {outlookIcons[p.outlook]}
                        <span>{p.name}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {selectedStrategy && (
              <div className="text-xs mt-1.5 leading-relaxed text-muted-foreground">
                <div className="flex gap-2 mb-1">
                  <Badge variant="outline" className="text-xs gap-1 h-4">
                    {outlookIcons[selectedStrategy.outlook]} {selectedStrategy.outlook}
                  </Badge>
                  <Badge variant="outline" className={`text-xs h-4 ${riskColors[selectedStrategy.riskLevel]}`}>
                    <Shield className="h-2.5 w-2.5" /> {selectedStrategy.riskLevel} Risk
                  </Badge>
                </div>
                {selectedStrategy.description}
              </div>
            )}
          </CardHeader>
          <CardContent className="space-y-3">
            {legs.map((leg, i) => (
              <div key={i} className="p-2.5 rounded-md bg-accent/50 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <Badge variant={leg.action === "BUY" ? "default" : "destructive"} className="text-xs h-4 px-1.5">{leg.action}</Badge>
                    <Badge variant="outline" className="text-xs h-4 px-1.5">{leg.type}</Badge>
                    <span className="text-xs text-muted-foreground">×{leg.lots}</span>
                  </div>
                  <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => removeLeg(i)}>
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Select value={leg.action} onValueChange={v => updateLeg(i, "action", v)}>
                    <SelectTrigger className="h-6 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="BUY">BUY</SelectItem><SelectItem value="SELL">SELL</SelectItem></SelectContent>
                  </Select>
                  <Select value={leg.type} onValueChange={v => updateLeg(i, "type", v)}>
                    <SelectTrigger className="h-6 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="CE">CE</SelectItem><SelectItem value="PE">PE</SelectItem></SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div><Label className="text-xs">Strike</Label><Input type="number" value={leg.strike} onChange={e => updateLeg(i, "strike", Number(e.target.value))} className="h-6 text-xs font-mono" /></div>
                  <div><Label className="text-xs">Lots</Label><Input type="number" value={leg.lots} onChange={e => updateLeg(i, "lots", Number(e.target.value))} className="h-6 text-xs font-mono" min={1} /></div>
                  <div><Label className="text-xs">₹ Prem</Label><Input type="number" value={leg.premium} onChange={e => updateLeg(i, "premium", Number(e.target.value))} className="h-6 text-xs font-mono" /></div>
                </div>
                <div className={`text-xs font-mono text-right ${leg.action === "BUY" ? "text-bearish" : "text-bullish"}`}>
                  {leg.action === "BUY" ? "Cost" : "Credit"}: ₹{(leg.premium * leg.lots * lotSize).toLocaleString("en-IN")}
                  <span className="text-muted-foreground ml-1">({leg.lots}×{lotSize}×{leg.premium})</span>
                </div>
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={addLeg} className="w-full h-7 text-xs">
              <Plus className="h-3 w-3 mr-1" /> Add Leg
            </Button>
          </CardContent>
        </Card>

        {/* Payoff Chart & Stats */}
        <div className="lg:col-span-2 space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-sm">Payoff at Expiry</CardTitle></CardHeader>
            <CardContent>
              <div className="h-[320px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={payoffData}>
                    <defs>
                      <linearGradient id="profitGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="hsl(var(--bullish))" stopOpacity={0.3} />
                        <stop offset="100%" stopColor="hsl(var(--bullish))" stopOpacity={0.02} />
                      </linearGradient>
                      <linearGradient id="lossGrad" x1="0" y1="1" x2="0" y2="0">
                        <stop offset="0%" stopColor="hsl(var(--bearish))" stopOpacity={0.25} />
                        <stop offset="100%" stopColor="hsl(var(--bearish))" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--chart-grid))" />
                    <XAxis
                      dataKey="spot"
                      tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }}
                      tickFormatter={(v) => v.toLocaleString("en-IN")}
                    />
                    <YAxis
                      tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }}
                      tickFormatter={(v) => `₹${(v / 1000).toFixed(v >= 1000 || v <= -1000 ? 0 : 1)}K`}
                    />
                    <RechartsTooltip
                      contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px", fontSize: "11px", boxShadow: "0 4px 12px rgba(0,0,0,0.15)" }}
                      formatter={(value: number) => [`₹${value.toLocaleString("en-IN")}`, "P&L"]}
                      labelFormatter={(label) => `Spot: ${Number(label).toLocaleString("en-IN")}`}
                    />
                    <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" strokeWidth={1.5} strokeOpacity={0.6} />
                    <ReferenceLine
                      x={spotPrice}
                      stroke="hsl(var(--primary))"
                      strokeDasharray="6 4"
                      strokeWidth={1.5}
                      label={{ value: `● SPOT ${spotPrice.toLocaleString("en-IN")}`, fill: "hsl(var(--primary))", fontSize: 9, position: "top" }}
                    />
                    {stats.breakevens.map((be, i) => (
                      <ReferenceLine
                        key={i}
                        x={be}
                        stroke="hsl(var(--warning))"
                        strokeDasharray="4 3"
                        strokeWidth={1.5}
                        label={{ value: `BE: ${be.toLocaleString("en-IN")}`, fill: "hsl(var(--warning))", fontSize: 8, position: "insideTopRight" }}
                      />
                    ))}
                    {/* Profit zone (green) */}
                    <Area type="monotone" dataKey="pnl" stroke="none" fill="url(#profitGrad)" baseValue={0} />
                    {/* Loss zone (red) — uses negative clip */}
                    <Area type="monotone" dataKey="pnl" stroke="none" fill="url(#lossGrad)" baseValue={0} />
                    {/* Main P&L line */}
                    <Area type="monotone" dataKey="pnl" stroke="hsl(var(--primary))" fill="none" strokeWidth={2.5} dot={false} activeDot={{ r: 4, fill: "hsl(var(--primary))", stroke: "hsl(var(--background))", strokeWidth: 2 }} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          {/* Key Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Card className="bg-bullish/5 border-bullish/20"><CardContent className="p-4">
              <p className="text-xs text-muted-foreground flex items-center gap-1.5"><TrendingUp className="h-3 w-3" /> Max Profit</p>
              <p className="text-xl font-semibold font-mono text-bullish">
                {stats.maxProfitUnlimited ? "Unlimited" : `₹${stats.maxProfit.toLocaleString("en-IN")}`}
              </p>
            </CardContent></Card>
            <Card className="bg-bearish/5 border-bearish/20"><CardContent className="p-4">
              <p className="text-xs text-muted-foreground flex items-center gap-1.5"><TrendingDown className="h-3 w-3" /> Max Loss</p>
              <p className="text-xl font-semibold font-mono text-bearish">
                {stats.maxLossUnlimited ? "Unlimited" : `₹${stats.maxLoss.toLocaleString("en-IN")}`}
              </p>
            </CardContent></Card>
            <Card><CardContent className="p-4">
              <p className="text-xs text-muted-foreground flex items-center gap-1.5"><Target className="h-3 w-3" /> Risk:Reward</p>
              <p className="text-xl font-semibold font-mono">{stats.riskReward}</p>
            </CardContent></Card>
            <Card><CardContent className="p-4">
              <p className="text-xs text-muted-foreground flex items-center gap-1.5"><Zap className="h-3 w-3" /> Prob. of Profit</p>
              <p className={`text-xl font-semibold font-mono ${stats.probOfProfit > 50 ? "text-bullish" : "text-bearish"}`}>{stats.probOfProfit}%</p>
            </CardContent></Card>
          </div>

          <PositionSizeCalculator maxLoss={stats.maxLoss} maxLossUnlimited={stats.maxLossUnlimited} />

          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" className="gap-1.5" onClick={handleAddStrategyToPositions} disabled={legs.length === 0}>
              <Plus className="h-3.5 w-3.5" /> Add {legs.length}-Leg Strategy to Position Tracker (Paper)
            </Button>
            <Button variant="outline" size="sm" className="gap-1.5" onClick={handleSaveAsBasket} disabled={legs.length === 0 || resolvingBasket}>
              <Save className="h-3.5 w-3.5" /> {resolvingBasket ? "Resolving..." : "Save as Basket"}
            </Button>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Card><CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Net Premium</p>
              <p className={`text-sm font-semibold font-mono ${stats.netPremium >= 0 ? "text-bullish" : "text-bearish"}`}>
                {stats.netPremium >= 0 ? "Credit" : "Debit"} ₹{Math.abs(stats.netPremium).toLocaleString("en-IN")}
              </p>
            </CardContent></Card>
            <Card><CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Est. Margin</p>
              <p className="text-sm font-semibold font-mono">₹{stats.margin.toLocaleString("en-IN")}</p>
            </CardContent></Card>
            <Card><CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Breakevens</p>
              <p className="text-xs font-mono">{stats.breakevens.length > 0 ? stats.breakevens.map(b => b.toLocaleString("en-IN")).join(", ") : "None"}</p>
            </CardContent></Card>
            <Card><CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Lot Size</p>
              <p className="text-sm font-semibold font-mono">{lotSize} × {legs.reduce((s, l) => s + l.lots, 0)} lots</p>
            </CardContent></Card>
          </div>

          {/* Multi-DTE Payoff */}
          <PayoffMultiDTE legs={legs} spotPrice={spotPrice} lotSize={lotSize} stepSize={stepSize} daysToExpiry={7} />

          {/* Combined Greeks — Visual Dashboard */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm">Position Greeks</CardTitle>
                <CopyTradeButton legs={legs} stats={stats} spotPrice={spotPrice} lotSize={lotSize} selectedPreset={selectedPreset} />
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-4 gap-3">
                <GreekCard
                  label="Delta (Δ)"
                  value={stats.totalDelta}
                  description={stats.totalDelta >= 0 ? "Net Long" : "Net Short"}
                  color={stats.totalDelta >= 0 ? "bullish" : "bearish"}
                  tooltip="Directional exposure. +1 = fully long, -1 = fully short."
                />
                <GreekCard
                  label="Gamma (Γ)"
                  value={stats.totalGamma}
                  description={stats.totalGamma > 0 ? "Long Gamma" : "Short Gamma"}
                  color={stats.totalGamma > 0 ? "bullish" : "bearish"}
                  tooltip="Rate of delta change. Long gamma = profits accelerate with movement."
                />
                <GreekCard
                  label="Theta (Θ)"
                  value={stats.totalTheta}
                  description="₹/day decay"
                  color={stats.totalTheta >= 0 ? "bullish" : "bearish"}
                  tooltip="Time decay. Negative = you lose money daily, Positive = you earn daily."
                />
                <GreekCard
                  label="Vega (ν)"
                  value={stats.totalVega}
                  description="per 1% IV"
                  color="neutral"
                  tooltip="IV sensitivity. Positive = profits when volatility rises."
                />
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <TradeConfirmDialog
        trade={pendingLegs}
        mode={tradeMode}
        busy={placingLegs}
        onConfirm={handleConfirmAddStrategy}
        onCancel={() => setPendingLegs(null)}
      />

      <SaveBasketDialog
        preview={basketPreview}
        defaultName={selectedPreset || "Custom Strategy"}
        busy={savingBasket}
        onConfirm={handleConfirmSaveBasket}
        onCancel={() => setBasketPreview(null)}
      />
    </div>
  );
}

