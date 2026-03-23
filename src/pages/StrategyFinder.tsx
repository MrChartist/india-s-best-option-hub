import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useNavigate } from "react-router-dom";
import { Search, ArrowUpDown, TrendingUp, TrendingDown, Minus, Filter, Zap, ChevronDown, ChevronUp, Layers } from "lucide-react";
import { calculatePayoff, calculateGreeks, estimateMargin, estimateProbOfProfit, type StrategyLeg } from "@/lib/mockData";

// ── Types ──

interface StrategyResult {
  id: string;
  expiry: string;
  daysToExpiry: number;
  strategyType: string;
  legs: StrategyLeg[];
  formula: { strike: number; type: "CE" | "PE"; action: "BUY" | "SELL" }[];
  maxProfit: number;
  maxLoss: number;
  rewardRisk: number;
  breakevens: number[];
  theoPrice: number;
  bid: number;
  ask: number;
  bidAskSpread: string;
  expPayoff: number;
  outlook: "Bullish" | "Bearish" | "Neutral" | "Volatile";
}

type SortKey = "rewardRisk" | "maxProfit" | "maxLoss" | "bidAskSpread" | "expPayoff" | "daysToExpiry";

// ── Strategy Generation Logic ──

function generateStrategies(
  spotPrice: number,
  stepSize: number,
  lotSize: number,
  expiryLabel: string,
  daysToExpiry: number,
  priceRange: [number, number],
  strategyTypes: string[],
): StrategyResult[] {
  const results: StrategyResult[] = [];
  const atm = Math.round(spotPrice / stepSize) * stepSize;
  const lowTarget = spotPrice * (1 + priceRange[0] / 100);
  const highTarget = spotPrice * (1 + priceRange[1] / 100);

  const strikesNear = Array.from({ length: 11 }, (_, i) => atm + (i - 5) * stepSize);

  const ivBase = 14;

  function premium(strike: number, type: "CE" | "PE"): number {
    const dist = Math.abs(strike - spotPrice) / stepSize;
    const intrinsic = type === "CE" ? Math.max(spotPrice - strike, 0) : Math.max(strike - spotPrice, 0);
    const timeVal = Math.max(5, (150 - dist * 15) * Math.sqrt(daysToExpiry / 30));
    return Math.round((intrinsic + timeVal) * 100) / 100;
  }

  // Long Call
  if (strategyTypes.includes("all") || strategyTypes.includes("long_call")) {
    strikesNear.forEach(s => {
      const prem = premium(s, "CE");
      const legs: StrategyLeg[] = [{ type: "CE", action: "BUY", strike: s, lots: 1, premium: prem }];
      const range = Array.from({ length: 50 }, (_, i) => atm - 12 * stepSize + i * stepSize);
      const payoff = calculatePayoff(legs, lotSize, range);
      const maxProfit = Math.max(...payoff.map(d => d.pnl));
      const maxLoss = Math.min(...payoff.map(d => d.pnl));
      const breakevens = payoff.filter((d, i) => i > 0 && (payoff[i-1].pnl < 0 && d.pnl >= 0)).map(d => d.spot);

      results.push({
        id: `lc-${s}`,
        expiry: expiryLabel,
        daysToExpiry,
        strategyType: "Long Call",
        legs,
        formula: [{ strike: s, type: "CE", action: "BUY" }],
        maxProfit,
        maxLoss,
        rewardRisk: maxLoss !== 0 ? Math.abs(maxProfit / maxLoss) : 99,
        breakevens,
        theoPrice: prem,
        bid: Math.round((prem - 1.5) * 100) / 100,
        ask: Math.round((prem + 1.5) * 100) / 100,
        bidAskSpread: ((3 / prem) * 100).toFixed(2) + "%",
        expPayoff: Math.round(Math.max(highTarget - s, 0) * lotSize - prem * lotSize),
        outlook: "Bullish",
      });
    });
  }

  // Short Put
  if (strategyTypes.includes("all") || strategyTypes.includes("short_put")) {
    strikesNear.filter(s => s <= atm).forEach(s => {
      const prem = premium(s, "PE");
      const legs: StrategyLeg[] = [{ type: "PE", action: "SELL", strike: s, lots: 1, premium: prem }];
      const range = Array.from({ length: 50 }, (_, i) => atm - 12 * stepSize + i * stepSize);
      const payoff = calculatePayoff(legs, lotSize, range);
      const maxProfit = Math.max(...payoff.map(d => d.pnl));
      const maxLoss = Math.min(...payoff.map(d => d.pnl));
      const breakevens = payoff.filter((d, i) => i > 0 && (payoff[i-1].pnl < 0 && d.pnl >= 0)).map(d => d.spot);

      results.push({
        id: `sp-${s}`,
        expiry: expiryLabel,
        daysToExpiry,
        strategyType: "Short Put",
        legs,
        formula: [{ strike: s, type: "PE", action: "SELL" }],
        maxProfit,
        maxLoss,
        rewardRisk: maxLoss !== 0 ? Math.abs(maxProfit / maxLoss) : 0,
        breakevens,
        theoPrice: -prem,
        bid: Math.round((-prem - 1) * 100) / 100,
        ask: Math.round((-prem + 1) * 100) / 100,
        bidAskSpread: ((2 / prem) * 100).toFixed(2) + "%",
        expPayoff: Math.round(spotPrice >= s ? prem * lotSize : (spotPrice - s + prem) * lotSize),
        outlook: "Bullish",
      });
    });
  }

  // Bull Call Spread
  if (strategyTypes.includes("all") || strategyTypes.includes("bull_call_spread")) {
    for (let i = 0; i < strikesNear.length - 1; i++) {
      for (let j = i + 1; j < Math.min(i + 3, strikesNear.length); j++) {
        const s1 = strikesNear[i], s2 = strikesNear[j];
        const p1 = premium(s1, "CE"), p2 = premium(s2, "CE");
        const legs: StrategyLeg[] = [
          { type: "CE", action: "BUY", strike: s1, lots: 1, premium: p1 },
          { type: "CE", action: "SELL", strike: s2, lots: 1, premium: p2 },
        ];
        const range = Array.from({ length: 50 }, (_, i) => atm - 12 * stepSize + i * stepSize);
        const payoff = calculatePayoff(legs, lotSize, range);
        const maxProfit = Math.max(...payoff.map(d => d.pnl));
        const maxLoss = Math.min(...payoff.map(d => d.pnl));
        const breakevens = payoff.filter((d, i) => i > 0 && (payoff[i-1].pnl < 0 && d.pnl >= 0)).map(d => d.spot);

        results.push({
          id: `bcs-${s1}-${s2}`,
          expiry: expiryLabel,
          daysToExpiry,
          strategyType: "Bull Call Spread",
          legs,
          formula: [
            { strike: s1, type: "CE", action: "BUY" },
            { strike: s2, type: "CE", action: "SELL" },
          ],
          maxProfit,
          maxLoss,
          rewardRisk: maxLoss !== 0 ? Math.abs(maxProfit / maxLoss) : 99,
          breakevens,
          theoPrice: Math.round((p1 - p2) * 100) / 100,
          bid: Math.round((p1 - p2 - 1.5) * 100) / 100,
          ask: Math.round((p1 - p2 + 1.5) * 100) / 100,
          bidAskSpread: (3 / Math.abs(p1 - p2) * 100).toFixed(2) + "%",
          expPayoff: Math.round(Math.min(Math.max(highTarget - s1, 0), s2 - s1) * lotSize - (p1 - p2) * lotSize),
          outlook: "Bullish",
        });
      }
    }
  }

  // Bull Put Spread
  if (strategyTypes.includes("all") || strategyTypes.includes("bull_put_spread")) {
    for (let i = 0; i < strikesNear.length - 1; i++) {
      for (let j = i + 1; j < Math.min(i + 3, strikesNear.length); j++) {
        const s1 = strikesNear[i], s2 = strikesNear[j];
        const p1 = premium(s1, "PE"), p2 = premium(s2, "PE");
        const legs: StrategyLeg[] = [
          { type: "PE", action: "BUY", strike: s1, lots: 1, premium: p1 },
          { type: "PE", action: "SELL", strike: s2, lots: 1, premium: p2 },
        ];
        const range = Array.from({ length: 50 }, (_, i) => atm - 12 * stepSize + i * stepSize);
        const payoff = calculatePayoff(legs, lotSize, range);
        const maxProfit = Math.max(...payoff.map(d => d.pnl));
        const maxLoss = Math.min(...payoff.map(d => d.pnl));
        const breakevens = payoff.filter((d, i) => i > 0 && (payoff[i-1].pnl < 0 && d.pnl >= 0)).map(d => d.spot);

        results.push({
          id: `bps-${s1}-${s2}`,
          expiry: expiryLabel,
          daysToExpiry,
          strategyType: "Bull Put Spread",
          legs,
          formula: [
            { strike: s1, type: "PE", action: "BUY" },
            { strike: s2, type: "PE", action: "SELL" },
          ],
          maxProfit,
          maxLoss,
          rewardRisk: maxLoss !== 0 ? Math.abs(maxProfit / maxLoss) : 99,
          breakevens,
          theoPrice: Math.round((p2 - p1) * 100) / 100,
          bid: Math.round((p2 - p1 - 1) * 100) / 100,
          ask: Math.round((p2 - p1 + 1) * 100) / 100,
          bidAskSpread: (2 / Math.abs(p2 - p1) * 100).toFixed(2) + "%",
          expPayoff: Math.round(spotPrice >= s2 ? (p2 - p1) * lotSize : (spotPrice - s1 + p2 - p1) * lotSize),
          outlook: "Bullish",
        });
      }
    }
  }

  // Iron Condor
  if (strategyTypes.includes("all") || strategyTypes.includes("iron_condor")) {
    for (let w = 1; w <= 3; w++) {
      const putBuy = atm - (w + 2) * stepSize;
      const putSell = atm - w * stepSize;
      const callSell = atm + w * stepSize;
      const callBuy = atm + (w + 2) * stepSize;

      const pp1 = premium(putBuy, "PE"), pp2 = premium(putSell, "PE");
      const cp1 = premium(callSell, "CE"), cp2 = premium(callBuy, "CE");

      const legs: StrategyLeg[] = [
        { type: "PE", action: "BUY", strike: putBuy, lots: 1, premium: pp1 },
        { type: "PE", action: "SELL", strike: putSell, lots: 1, premium: pp2 },
        { type: "CE", action: "SELL", strike: callSell, lots: 1, premium: cp1 },
        { type: "CE", action: "BUY", strike: callBuy, lots: 1, premium: cp2 },
      ];
      const range = Array.from({ length: 50 }, (_, i) => atm - 12 * stepSize + i * stepSize);
      const payoff = calculatePayoff(legs, lotSize, range);
      const maxProfit = Math.max(...payoff.map(d => d.pnl));
      const maxLoss = Math.min(...payoff.map(d => d.pnl));
      const breakevens = payoff.filter((d, i) => i > 0 && ((payoff[i-1].pnl < 0 && d.pnl >= 0) || (payoff[i-1].pnl >= 0 && d.pnl < 0))).map(d => d.spot);

      results.push({
        id: `ic-${w}`,
        expiry: expiryLabel,
        daysToExpiry,
        strategyType: "Iron Condor",
        legs,
        formula: [
          { strike: putBuy, type: "PE", action: "BUY" },
          { strike: putSell, type: "PE", action: "SELL" },
          { strike: callSell, type: "CE", action: "SELL" },
          { strike: callBuy, type: "CE", action: "BUY" },
        ],
        maxProfit,
        maxLoss,
        rewardRisk: maxLoss !== 0 ? Math.abs(maxProfit / maxLoss) : 99,
        breakevens,
        theoPrice: Math.round((pp2 + cp1 - pp1 - cp2) * 100) / 100,
        bid: Math.round((pp2 + cp1 - pp1 - cp2 - 2) * 100) / 100,
        ask: Math.round((pp2 + cp1 - pp1 - cp2 + 2) * 100) / 100,
        bidAskSpread: "2.5%",
        expPayoff: maxProfit,
        outlook: "Neutral",
      });
    }
  }

  // Jade Lizard
  if (strategyTypes.includes("all") || strategyTypes.includes("jade_lizard")) {
    for (let w = 1; w <= 2; w++) {
      const putSell = atm - w * stepSize;
      const callSell = atm + w * stepSize;
      const callBuy = atm + (w + 2) * stepSize;

      const pp = premium(putSell, "PE");
      const cp1 = premium(callSell, "CE");
      const cp2 = premium(callBuy, "CE");

      const legs: StrategyLeg[] = [
        { type: "PE", action: "SELL", strike: putSell, lots: 1, premium: pp },
        { type: "CE", action: "SELL", strike: callSell, lots: 1, premium: cp1 },
        { type: "CE", action: "BUY", strike: callBuy, lots: 1, premium: cp2 },
      ];
      const range = Array.from({ length: 50 }, (_, i) => atm - 12 * stepSize + i * stepSize);
      const payoff = calculatePayoff(legs, lotSize, range);
      const maxProfit = Math.max(...payoff.map(d => d.pnl));
      const maxLoss = Math.min(...payoff.map(d => d.pnl));
      const breakevens = payoff.filter((d, i) => i > 0 && ((payoff[i-1].pnl < 0 && d.pnl >= 0) || (payoff[i-1].pnl >= 0 && d.pnl < 0))).map(d => d.spot);

      results.push({
        id: `jl-${w}`,
        expiry: expiryLabel,
        daysToExpiry,
        strategyType: "Jade Lizard",
        legs,
        formula: [
          { strike: putSell, type: "PE", action: "SELL" },
          { strike: callSell, type: "CE", action: "SELL" },
          { strike: callBuy, type: "CE", action: "BUY" },
        ],
        maxProfit,
        maxLoss,
        rewardRisk: maxLoss !== 0 ? Math.abs(maxProfit / maxLoss) : 99,
        breakevens,
        theoPrice: Math.round((pp + cp1 - cp2) * 100) / 100,
        bid: Math.round((pp + cp1 - cp2 - 2) * 100) / 100,
        ask: Math.round((pp + cp1 - cp2 + 2) * 100) / 100,
        bidAskSpread: "1.64%",
        expPayoff: maxProfit,
        outlook: "Neutral",
      });
    }
  }

  return results;
}

// ── Component ──

const outlookColors: Record<string, string> = {
  Bullish: "text-bullish",
  Bearish: "text-bearish",
  Neutral: "text-warning",
  Volatile: "text-primary",
};

const outlookIcons: Record<string, React.ReactNode> = {
  Bullish: <TrendingUp className="h-3 w-3" />,
  Bearish: <TrendingDown className="h-3 w-3" />,
  Neutral: <Minus className="h-3 w-3" />,
  Volatile: <Zap className="h-3 w-3" />,
};

const strategyTypeOptions = [
  { value: "all", label: "All Strategies" },
  { value: "long_call", label: "Long Call" },
  { value: "short_put", label: "Short Put" },
  { value: "bull_call_spread", label: "Bull Call Spread" },
  { value: "bull_put_spread", label: "Bull Put Spread" },
  { value: "iron_condor", label: "Iron Condor" },
  { value: "jade_lizard", label: "Jade Lizard" },
];

const expiryOptions = [
  { label: "27 Mar 2026", value: "2026-03-27", days: 4 },
  { label: "03 Apr 2026", value: "2026-04-03", days: 11 },
  { label: "10 Apr 2026", value: "2026-04-10", days: 18 },
  { label: "24 Apr 2026", value: "2026-04-24", days: 32 },
  { label: "29 May 2026", value: "2026-05-29", days: 67 },
];

export default function StrategyFinder() {
  const navigate = useNavigate();
  const spotPrice = 24250.75;
  const stepSize = 50;
  const lotSize = 25;

  const [symbol, setSymbol] = useState("NIFTY");
  const [expiry, setExpiry] = useState(expiryOptions[3].value); // ~1 month out
  const [priceRange, setPriceRange] = useState<[number, number]>([-5, 10]);
  const [strategyType, setStrategyType] = useState("all");
  const [sortKey, setSortKey] = useState<SortKey>("rewardRisk");
  const [sortAsc, setSortAsc] = useState(false);
  const [spreadWidthFilter, setSpreadWidthFilter] = useState("any");

  const selectedExpiry = expiryOptions.find(e => e.value === expiry) || expiryOptions[3];

  const results = useMemo(() => {
    const strategies = generateStrategies(
      spotPrice,
      stepSize,
      lotSize,
      selectedExpiry.label,
      selectedExpiry.days,
      priceRange,
      strategyType === "all" ? ["all"] : [strategyType],
    );

    // Filter by spread width
    let filtered = strategies;
    if (spreadWidthFilter !== "any") {
      const widths: Record<string, number> = { narrow: 1, medium: 2, wide: 3 };
      const w = widths[spreadWidthFilter] || 99;
      filtered = strategies.filter(s => {
        if (s.formula.length <= 1) return true;
        const strikes = s.formula.map(f => f.strike);
        const spread = (Math.max(...strikes) - Math.min(...strikes)) / stepSize;
        return spread <= w + 1;
      });
    }

    // Sort
    return [...filtered].sort((a, b) => {
      let va: number, vb: number;
      switch (sortKey) {
        case "rewardRisk": va = a.rewardRisk; vb = b.rewardRisk; break;
        case "maxProfit": va = a.maxProfit; vb = b.maxProfit; break;
        case "maxLoss": va = a.maxLoss; vb = b.maxLoss; break;
        case "bidAskSpread": va = parseFloat(a.bidAskSpread); vb = parseFloat(b.bidAskSpread); break;
        case "expPayoff": va = a.expPayoff; vb = b.expPayoff; break;
        case "daysToExpiry": va = a.daysToExpiry; vb = b.daysToExpiry; break;
        default: va = 0; vb = 0;
      }
      return sortAsc ? va - vb : vb - va;
    });
  }, [spotPrice, expiry, priceRange, strategyType, sortKey, sortAsc, spreadWidthFilter]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(false); }
  };

  const SortIcon = ({ col }: { col: SortKey }) => (
    sortKey === col
      ? (sortAsc ? <ChevronUp className="h-3 w-3 inline" /> : <ChevronDown className="h-3 w-3 inline" />)
      : <ArrowUpDown className="h-2.5 w-2.5 inline opacity-30" />
  );

  const loadIntoBuilder = (strategy: StrategyResult) => {
    // Navigate to strategy builder with the first leg as params
    const firstLeg = strategy.legs[0];
    navigate(`/strategy?strike=${firstLeg.strike}&type=${firstLeg.type}&action=${firstLeg.action}`);
  };

  return (
    <div className="space-y-3 lg:space-y-4">
      {/* Header */}
      <div>
        <h1 className="text-lg sm:text-2xl font-bold tracking-tight">Strategy Finder</h1>
        <p className="text-[10px] sm:text-xs text-muted-foreground">
          Find optimal strategies based on your outlook · Filter by type, spread, risk/reward
        </p>
      </div>

      {/* Filters Bar */}
      <Card>
        <CardContent className="py-3">
          <div className="flex flex-wrap items-end gap-2 sm:gap-3">
            <div>
              <label className="text-[9px] text-muted-foreground uppercase tracking-wider">Symbol</label>
              <Select value={symbol} onValueChange={setSymbol}>
                <SelectTrigger className="w-[110px] h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY"].map(s => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-[9px] text-muted-foreground uppercase tracking-wider">Expiry</label>
              <Select value={expiry} onValueChange={setExpiry}>
                <SelectTrigger className="w-[150px] h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {expiryOptions.map(e => (
                    <SelectItem key={e.value} value={e.value}>{e.label} ({e.days}d)</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="min-w-[200px]">
              <label className="text-[9px] text-muted-foreground uppercase tracking-wider">
                Expected price range: <span className="font-mono text-foreground">{priceRange[0] > 0 ? "+" : ""}{priceRange[0]}% to +{priceRange[1]}%</span>
              </label>
              <Slider
                min={-15}
                max={15}
                step={1}
                value={priceRange}
                onValueChange={(v) => setPriceRange(v as [number, number])}
                className="mt-1.5"
              />
            </div>

            <div>
              <label className="text-[9px] text-muted-foreground uppercase tracking-wider">Strategy types</label>
              <Select value={strategyType} onValueChange={setStrategyType}>
                <SelectTrigger className="w-[150px] h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {strategyTypeOptions.map(s => (
                    <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-[9px] text-muted-foreground uppercase tracking-wider">Spread width</label>
              <Select value={spreadWidthFilter} onValueChange={setSpreadWidthFilter}>
                <SelectTrigger className="w-[110px] h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">Any</SelectItem>
                  <SelectItem value="narrow">Narrow (1-2)</SelectItem>
                  <SelectItem value="medium">Medium (2-3)</SelectItem>
                  <SelectItem value="wide">Wide (3+)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Badge variant="outline" className="h-8 px-3 text-xs gap-1.5">
              <Search className="h-3 w-3" />
              {results.length} strategies found
            </Badge>
          </div>
        </CardContent>
      </Card>

      {/* Results Table */}
      <Card>
        <CardContent className="p-0 overflow-auto">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-card">
              <TableRow className="text-[10px] sm:text-[11px]">
                <TableHead className="w-[100px]">Expiration</TableHead>
                <TableHead className="w-[40px] text-center">Days</TableHead>
                <TableHead className="w-[120px]">Strategy type</TableHead>
                <TableHead className="w-[180px]">Formula</TableHead>
                <TableHead className="text-right cursor-pointer select-none" onClick={() => handleSort("maxProfit")}>
                  Max profit <SortIcon col="maxProfit" />
                </TableHead>
                <TableHead className="text-right cursor-pointer select-none" onClick={() => handleSort("maxLoss")}>
                  Max loss <SortIcon col="maxLoss" />
                </TableHead>
                <TableHead className="text-right cursor-pointer select-none" onClick={() => handleSort("rewardRisk")}>
                  <span className="text-primary">↓</span> Reward/Risk <SortIcon col="rewardRisk" />
                </TableHead>
                <TableHead className="text-right">Breakeven(s)</TableHead>
                <TableHead className="text-right">Theo price</TableHead>
                <TableHead className="text-right">Bid</TableHead>
                <TableHead className="text-right font-bold">Ask</TableHead>
                <TableHead className="text-right cursor-pointer select-none" onClick={() => handleSort("bidAskSpread")}>
                  Bid-ask spread <SortIcon col="bidAskSpread" />
                </TableHead>
                <TableHead className="text-right cursor-pointer select-none" onClick={() => handleSort("expPayoff")}>
                  Exp payoff <SortIcon col="expPayoff" />
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {results.slice(0, 50).map((row) => {
                const bidAskPct = parseFloat(row.bidAskSpread);
                return (
                  <TableRow
                    key={row.id}
                    className="text-[11px] sm:text-xs font-mono cursor-pointer hover:bg-accent/50 transition-colors"
                    onClick={() => loadIntoBuilder(row)}
                  >
                    <TableCell className="py-2 text-muted-foreground">{row.expiry}</TableCell>
                    <TableCell className="py-2 text-center">{row.daysToExpiry}</TableCell>
                    <TableCell className="py-2 font-sans font-medium">{row.strategyType}</TableCell>
                    <TableCell className="py-2">
                      <div className="flex flex-wrap gap-1">
                        {row.formula.map((f, i) => (
                          <Badge
                            key={i}
                            variant="outline"
                            className={`text-[9px] h-4 px-1.5 font-mono ${
                              f.type === "CE"
                                ? f.action === "BUY" ? "bg-bullish/10 text-bullish border-bullish/30" : "text-orange-400 border-orange-400/30 bg-orange-400/10"
                                : f.action === "BUY" ? "bg-bearish/10 text-bearish border-bearish/30" : "text-purple-400 border-purple-400/30 bg-purple-400/10"
                            }`}
                          >
                            {f.strike.toLocaleString("en-IN")}{f.type === "CE" ? "C" : "P"}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="py-2 text-right text-bullish">{row.maxProfit.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</TableCell>
                    <TableCell className="py-2 text-right text-bearish">{row.maxLoss.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</TableCell>
                    <TableCell className="py-2 text-right font-bold">{row.rewardRisk.toFixed(2)}</TableCell>
                    <TableCell className="py-2 text-right text-muted-foreground">
                      {row.breakevens.length > 0 ? row.breakevens.map(b => b.toLocaleString("en-IN", { minimumFractionDigits: 2 })).join(", ") : "—"}
                    </TableCell>
                    <TableCell className="py-2 text-right">{row.theoPrice.toFixed(2)}</TableCell>
                    <TableCell className="py-2 text-right">{row.bid.toFixed(2)}</TableCell>
                    <TableCell className="py-2 text-right font-bold">{row.ask.toFixed(2)}</TableCell>
                    <TableCell className={`py-2 text-right ${bidAskPct > 5 ? "text-bullish" : ""}`}>
                      {row.bidAskSpread}
                    </TableCell>
                    <TableCell className="py-2 text-right">
                      {row.expPayoff.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          {results.length === 0 && (
            <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
              No strategies match your filters. Try widening the price range or selecting more strategy types.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
