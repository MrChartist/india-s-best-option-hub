import { useMemo, useState } from "react";
import { Target } from "lucide-react";
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { axisProps, chartColors, gridProps, tooltipItemStyle, tooltipLabelStyle, tooltipStyle } from "@/lib/chartTheme";
import {
  breakevens,
  bsPrice,
  expectedValue,
  formatINR,
  formatNumberIN,
  formatPct,
  forwardFromSpot,
  getLotSize,
  getStrikeStep,
  maxProfitLoss,
  probabilityOfProfit,
  probITM,
  strategyPayoffAtExpiry,
  type Leg,
  type OptionType,
  type Side,
} from "@/lib/options";
import { useSimSpot } from "../simSpot";
import { DEFAULT_RATE, linearGrid, lognormalDensity, pnlTone } from "./simLogic";
import { SimCard, SimSegmented, SimSlider, SimStat } from "./SimUi";

type Strategy = "strangle" | "condor" | "straddle";
const STRATEGY_OPTIONS = [
  { value: "strangle", label: "Short strangle" },
  { value: "condor", label: "Iron condor" },
  { value: "straddle", label: "Short straddle" },
] as const;

const WING_STEPS = 4;

/** See how POP, expected value and the worst case trade off as short strikes move. */
export default function POPSim() {
  const { spot } = useSimSpot();
  const step = getStrikeStep("NIFTY");
  const lot = getLotSize("NIFTY") ?? 65;
  const atm = Math.round(spot / step) * step;
  const [strategy, setStrategy] = useState<Strategy>("strangle");
  const [width, setWidth] = useState(4);
  const [ivPct, setIvPct] = useState(13);
  const [days, setDays] = useState(5);

  const sigma = ivPct / 100;
  const T = days / 365;
  const F = forwardFromSpot(spot, T, DEFAULT_RATE);
  const dist = strategy === "straddle" ? 0 : width * step;

  const legs = useMemo<Leg[]>(() => {
    const mk = (type: OptionType, side: Side, strike: number): Leg => ({
      id: `${type}${side}${strike}`,
      symbol: "NIFTY",
      type,
      side,
      strike,
      expiry: "",
      lots: 1,
      lotSize: lot,
      premium: Math.max(0.05, bsPrice({ S: spot, K: strike, T, r: DEFAULT_RATE, sigma, type })),
      iv: sigma,
    });
    const out = [mk("CE", "SELL", atm + dist), mk("PE", "SELL", atm - dist)];
    if (strategy === "condor") out.push(mk("CE", "BUY", atm + dist + WING_STEPS * step), mk("PE", "BUY", atm - dist - WING_STEPS * step));
    return out;
  }, [atm, dist, strategy, step, lot, spot, T, sigma]);

  const stats = useMemo(() => {
    const pop = probabilityOfProfit(legs, { F, T, sigma });
    const ev = expectedValue(legs, { F, T, sigma });
    const mpl = maxProfitLoss(legs);
    const bes = breakevens(legs);
    const pCallItm = probITM({ F, K: atm + dist, T, sigma, type: "CE" });
    const pPutItm = probITM({ F, K: atm - dist, T, sigma, type: "PE" });
    const sd = sigma * Math.sqrt(T);
    const grid = linearGrid(F, Math.min(0.25, Math.max(0.02, 3.2 * sd)), 161);
    const data = grid.map((S) => {
      const d = lognormalDensity(S, F, sigma, T);
      const win = strategyPayoffAtExpiry(legs, S) > 0;
      return { S, win: win ? d : 0, lose: win ? 0 : d };
    });
    return { pop, ev, mpl, bes, pCallItm, pPutItm, data };
  }, [legs, F, T, sigma, atm, dist]);

  return (
    <SimCard title="Probability of profit" icon={<Target className="h-4 w-4" />} footnote="POP and EV use a lognormal model at the chosen IV, before charges. Real index returns have fatter tails.">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,280px)_1fr]">
        <div className="space-y-5">
          <SimSegmented label="Strategy" value={strategy} options={STRATEGY_OPTIONS} onChange={setStrategy} />
          {strategy !== "straddle" ? (
            <SimSlider label="Short strikes from ATM" value={width} min={1} max={12} step={1} onChange={setWidth} format={(v) => `±${formatNumberIN(v * step)} pts`} />
          ) : null}
          <SimSlider label="Implied volatility" value={ivPct} min={6} max={40} step={0.5} onChange={setIvPct} format={(v) => formatPct(v, { decimals: 1 })} />
          <SimSlider label="Days to expiry" value={days} min={1} max={30} step={1} onChange={setDays} format={(v) => `${v} day${v === 1 ? "" : "s"}`} />
        </div>
        <div className="min-w-0 space-y-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <SimStat label="POP" value={formatPct(stats.pop * 100, { decimals: 1 })} tone="info" />
            <SimStat label="Expected value" value={formatINR(stats.ev, { decimals: 0 })} tone={pnlTone(Math.round(stats.ev))} sub="per lot, before charges" />
            <SimStat label="Max profit" value={formatINR(stats.mpl.maxProfit, { decimals: 0 })} tone="bullish" />
            <SimStat label="Max loss" value={stats.mpl.unlimitedLoss ? "Unlimited" : formatINR(stats.mpl.maxLoss, { decimals: 0 })} tone="bearish" />
          </div>
          <div className="h-56 w-full sm:h-64" role="img" aria-label={`Lognormal distribution of NIFTY at expiry. Green area is the profitable zone, ${formatPct(stats.pop * 100, { decimals: 1 })} probability.`}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={stats.data} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="S" type="number" domain={["dataMin", "dataMax"]} tickFormatter={(v: number) => formatNumberIN(v)} {...axisProps} />
                <YAxis hide />
                <Tooltip
                  contentStyle={tooltipStyle}
                  labelStyle={tooltipLabelStyle}
                  itemStyle={tooltipItemStyle}
                  labelFormatter={(v) => `NIFTY ${formatNumberIN(Number(v))} at expiry`}
                  formatter={(_v: number, name: string, item: { payload?: { S: number } }) => {
                    const S = item.payload?.S ?? NaN;
                    return [formatINR(strategyPayoffAtExpiry(legs, S), { decimals: 0 }), name === "win" ? "P&L (profit zone)" : "P&L (loss zone)"];
                  }}
                />
                <Area type="monotone" dataKey="win" stroke={chartColors.bullish} fill={chartColors.bullish} fillOpacity={0.25} isAnimationActive={false} />
                <Area type="monotone" dataKey="lose" stroke={chartColors.bearish} fill={chartColors.bearish} fillOpacity={0.18} isAnimationActive={false} />
                {stats.bes.map((b) => (
                  <ReferenceLine key={b} x={b} stroke={chartColors.muted} strokeDasharray="2 3" />
                ))}
                <ReferenceLine x={spot} stroke={chartColors.primary} strokeDasharray="4 4" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <p className="text-body text-muted-foreground">
            Short call {formatNumberIN(atm + dist)} finishes ITM with probability {formatPct(stats.pCallItm * 100, { decimals: 0 })}; short put {formatNumberIN(atm - dist)} with {formatPct(stats.pPutItm * 100, { decimals: 0 })}. Breakevens {stats.bes.map((b) => formatNumberIN(b)).join(" and ")}. Moving strikes further out raises POP but shrinks the credit, so expected value stays near zero.
          </p>
        </div>
      </div>
    </SimCard>
  );
}
