import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import { Clock, Percent } from "lucide-react";
import type { StrategyLeg } from "@/lib/mockData";
import { axisProps, chartColors, gridProps, payoffFills, tooltipStyle } from "@/lib/chartTheme";
import {
  addCalendarDays,
  breakevens,
  formatCompactIN,
  formatINR,
  formatStrike,
  istDateString,
  maxProfitLoss,
  payoffDateKey,
  payoffSeries,
  strategyValueAt,
  toISTDate,
  type Leg,
} from "@/lib/options";

interface Props {
  legs: StrategyLeg[];
  spotPrice: number;
  lotSize: number;
  stepSize: number;
  daysToExpiry?: number;
  /** Optional: underlying symbol (default NIFTY). */
  symbol?: string;
  /** Optional: ISO expiry. Overrides daysToExpiry. */
  expiry?: string;
  /** Optional: IV in percent used for legs without one (default 14). */
  ivPct?: number;
}

/**
 * T+0 / T+n / expiry payoff curves. A thin wrapper over @/lib/options (Black-76, time to 15:30 IST);
 * the Strategy Builder's PayoffChart is the full version with a continuous date slider.
 */
export function PayoffMultiDTE({ legs, spotPrice, lotSize, stepSize, daysToExpiry = 7, symbol = "NIFTY", expiry, ivPct = 14 }: Props) {
  const [ivShift, setIvShift] = useState(0); // vol points
  const [showT0, setShowT0] = useState(true);
  const [showMid, setShowMid] = useState(true);
  const [showExpiry, setShowExpiry] = useState(true);

  const now = useMemo(() => new Date(), []);
  const exp = expiry || addCalendarDays(istDateString(now), Math.max(0, Math.round(daysToExpiry)));
  const midDays = Math.max(1, Math.floor(Math.max(daysToExpiry, 1) / 2));

  const contractLegs = useMemo<Leg[]>(
    () => legs.map((l) => ({ symbol, type: l.type, side: l.action, strike: l.strike, expiry: exp, lots: l.lots, lotSize, premium: l.premium, iv: ivPct / 100 })),
    [legs, symbol, exp, lotSize, ivPct],
  );

  const { data, midKey, nowKey } = useMemo(() => {
    const step = stepSize > 0 ? stepSize : 50;
    const center = Math.round(spotPrice / step) * step;
    const grid: number[] = [];
    for (let s = center - step * 20; s <= center + step * 20; s += step / 2) if (s > 0) grid.push(s);
    const midAt = new Date(Math.min(now.getTime() + midDays * 864e5, toISTDate(exp, "15:30").getTime()));
    const rows = payoffSeries(contractLegs, grid, { dates: [now, midAt], ivShift: ivShift / 100, now });
    return { data: rows, midKey: payoffDateKey(midAt), nowKey: payoffDateKey(now) };
  }, [contractLegs, spotPrice, stepSize, ivShift, now, exp, midDays]);

  const stats = useMemo(() => {
    const mpl = maxProfitLoss(contractLegs);
    return { ...mpl, breakevens: breakevens(contractLegs), current: strategyValueAt(contractLegs, spotPrice, { now, ivShift: ivShift / 100 }) };
  }, [contractLegs, spotPrice, now, ivShift]);

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Clock className="h-4 w-4 text-primary-ink" /> Payoff over time
          </CardTitle>
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <Label className="flex items-center gap-1.5 text-xs"><Switch checked={showT0} onCheckedChange={setShowT0} className="scale-75" /> Today</Label>
            <Label className="flex items-center gap-1.5 text-xs"><Switch checked={showMid} onCheckedChange={setShowMid} className="scale-75" /> T+{midDays}</Label>
            <Label className="flex items-center gap-1.5 text-xs"><Switch checked={showExpiry} onCheckedChange={setShowExpiry} className="scale-75" /> Expiry</Label>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-4 px-2">
          <Label className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
            <Percent className="h-3.5 w-3.5" /> IV change
          </Label>
          <Slider value={[ivShift]} onValueChange={([v]) => setIvShift(v)} min={-10} max={10} step={0.5} className="flex-1" aria-label="IV change in vol points" />
          <Badge variant="outline" className="shrink-0 font-num">
            {ivShift >= 0 ? "+" : "−"}
            {Math.abs(ivShift)} pts
          </Badge>
        </div>

        <div className="h-[340px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data}>
              <CartesianGrid {...gridProps} />
              <XAxis {...axisProps} dataKey="spot" type="number" domain={["dataMin", "dataMax"]} tickFormatter={(v: number) => formatStrike(v)} />
              <YAxis {...axisProps} width={56} tickFormatter={(v: number) => formatCompactIN(v, { decimals: 1 })} />
              <Tooltip
                contentStyle={tooltipStyle}
                labelFormatter={(l) => `Spot ${formatStrike(Number(l))}`}
                formatter={(value: number, key: string) => [formatINR(value, { decimals: 0 }), key === "expiry" ? "Expiry" : key === nowKey ? "Today" : `T+${midDays}`]}
              />
              <ReferenceLine y={0} stroke={payoffFills.zeroLine} />
              <ReferenceLine x={spotPrice} stroke={payoffFills.spotLine} strokeDasharray="4 4" label={{ value: "Spot", fill: chartColors.primary, fontSize: 10 }} />
              {stats.breakevens.map((be) => (
                <ReferenceLine key={be} x={be} stroke={payoffFills.breakeven} strokeDasharray="3 3" />
              ))}
              {showT0 && <Line type="monotone" dataKey={nowKey} stroke={payoffFills.todayLine} strokeWidth={2.25} dot={false} isAnimationActive={false} />}
              {showMid && <Line type="monotone" dataKey={midKey} stroke={chartColors.info} strokeWidth={1.75} strokeDasharray="5 4" dot={false} isAnimationActive={false} />}
              {showExpiry && <Line type="linear" dataKey="expiry" stroke={payoffFills.expiryLine} strokeWidth={1.5} dot={false} isAnimationActive={false} />}
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="rounded-tile bg-surface p-2 text-center">
            <p className="text-[11px] text-muted-foreground">P&L today</p>
            <p className={`font-num text-sm font-bold ${stats.current >= 0 ? "text-bullish" : "text-bearish"}`}>{formatINR(stats.current, { decimals: 0 })}</p>
          </div>
          <div className="rounded-tile bg-wash-profit/40 p-2 text-center">
            <p className="text-[11px] text-muted-foreground">Max profit</p>
            <p className="font-num text-sm font-bold text-bullish">{stats.unlimitedProfit ? "Unlimited" : formatINR(stats.maxProfit, { decimals: 0 })}</p>
          </div>
          <div className="rounded-tile bg-wash-loss/40 p-2 text-center">
            <p className="text-[11px] text-muted-foreground">Max loss</p>
            <p className="font-num text-sm font-bold text-bearish">{stats.unlimitedLoss ? "Unlimited" : formatINR(stats.maxLoss, { decimals: 0 })}</p>
          </div>
          <div className="rounded-tile bg-surface p-2 text-center">
            <p className="text-[11px] text-muted-foreground">Breakevens</p>
            <p className="font-num text-xs">{stats.breakevens.length ? stats.breakevens.map((b) => formatStrike(Math.round(b))).join(", ") : "—"}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
