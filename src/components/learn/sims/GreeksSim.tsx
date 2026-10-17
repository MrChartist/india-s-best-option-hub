import { useMemo, useState } from "react";
import { Sigma } from "lucide-react";
import { CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Badge } from "@/components/ui/badge";
import { axisProps, chartColors, gridProps, legendStyle, tooltipItemStyle, tooltipLabelStyle, tooltipStyle } from "@/lib/chartTheme";
import { bsPrice, formatGreek, formatINR, formatNumberIN, formatPct, formatSigned, getLotSize, getStrikeStep, greeks, intrinsic, type OptionType } from "@/lib/options";
import { useSimSpot } from "../simSpot";
import { DEFAULT_RATE, greeksCurve, linearGrid } from "./simLogic";
import { SimCard, SimSegmented, SimSlider, SimStat } from "./SimUi";

const TYPE_OPTIONS = [
  { value: "CE", label: "Call (CE)" },
  { value: "PE", label: "Put (PE)" },
] as const;

function moneyness(type: OptionType, spot: number, strike: number, step: number): { label: string; variant: "bullish" | "warning" | "neutral" } {
  if (Math.abs(spot - strike) < step / 2) return { label: "ATM", variant: "warning" };
  const itm = type === "CE" ? spot > strike : spot < strike;
  return itm ? { label: "ITM", variant: "bullish" } : { label: "OTM", variant: "neutral" };
}

/** Explore price, delta, gamma, theta and vega across strikes, time and IV. */
export default function GreeksSim() {
  const { spot } = useSimSpot();
  const step = getStrikeStep("NIFTY");
  const lot = getLotSize("NIFTY") ?? 65;
  const atm = Math.round(spot / step) * step;
  const [type, setType] = useState<OptionType>("CE");
  const [offset, setOffset] = useState(0);
  const [days, setDays] = useState(7);
  const [ivPct, setIvPct] = useState(13);

  const strike = atm + offset;
  const sigma = ivPct / 100;
  const T = days / 365;
  const price = bsPrice({ S: spot, K: strike, T, r: DEFAULT_RATE, sigma, type });
  const g = greeks({ S: spot, K: strike, T, r: DEFAULT_RATE, sigma, type });
  const intr = intrinsic(spot, strike, type);
  const m = moneyness(type, spot, strike, step);

  const curve = useMemo(() => greeksCurve({ strike, days, sigma, type, spots: linearGrid(strike, 0.05, 101) }), [strike, days, sigma, type]);

  return (
    <SimCard title="Greeks explorer" icon={<Sigma className="h-4 w-4" />}>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,280px)_1fr]">
        <div className="space-y-5">
          <SimSegmented label="Option" value={type} options={TYPE_OPTIONS} onChange={setType} />
          <SimSlider label="Strike" value={offset} min={-10 * step} max={10 * step} step={step} onChange={setOffset} format={(v) => `${formatNumberIN(atm + v)} (${v === 0 ? "ATM" : formatSigned(v, 0)})`} />
          <SimSlider label="Days to expiry" value={days} min={0.1} max={45} step={0.1} onChange={setDays} format={(v) => (v < 1 ? `${formatNumberIN(v * 24, 1)} hours` : `${formatNumberIN(v, 1)} days`)} />
          <SimSlider label="Implied volatility" value={ivPct} min={5} max={50} step={0.5} onChange={setIvPct} format={(v) => formatPct(v, { decimals: 1 })} />
        </div>
        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-num text-title tabular-nums text-foreground">{formatINR(price)}</span>
            <Badge variant={m.variant}>{m.label}</Badge>
            <span className="text-body-sm text-muted-foreground">
              Intrinsic {formatINR(intr)} + time value {formatINR(Math.max(0, price - intr))} · {formatINR(price * lot, { decimals: 0 })} per lot
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            <SimStat label="Delta" value={formatGreek("delta", g.delta)} sub={`${formatNumberIN(g.delta * lot, 1)} units/lot`} />
            <SimStat label="Gamma" value={formatGreek("gamma", g.gamma)} sub="Δ per ₹1 move" />
            <SimStat label="Theta / day" value={formatINR(g.theta)} tone={g.theta < 0 ? "bearish" : undefined} sub={`${formatINR(g.theta * lot, { decimals: 0 })} per lot`} />
            <SimStat label="Vega / pt" value={formatINR(g.vega)} sub="per 1 IV point" />
            <SimStat label="Rho / 1%" value={formatINR(g.rho)} sub="per 1% rate" />
          </div>
          <div className="h-56 w-full sm:h-64" role="img" aria-label={`Delta and gamma across NIFTY levels for the ${formatNumberIN(strike)} ${type}. Delta now ${formatGreek("delta", g.delta)}.`}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={curve} margin={{ top: 8, right: 4, bottom: 4, left: 0 }}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="spot" type="number" domain={["dataMin", "dataMax"]} tickFormatter={(v: number) => formatNumberIN(v)} {...axisProps} />
                <YAxis yAxisId="d" width={40} domain={type === "CE" ? [0, 1] : [-1, 0]} tickFormatter={(v: number) => v.toFixed(1)} {...axisProps} />
                <YAxis yAxisId="g" orientation="right" width={52} tickFormatter={(v: number) => v.toFixed(4)} {...axisProps} />
                <Tooltip
                  contentStyle={tooltipStyle}
                  labelStyle={tooltipLabelStyle}
                  itemStyle={tooltipItemStyle}
                  labelFormatter={(v) => `NIFTY ${formatNumberIN(Number(v))}`}
                  formatter={(v: number, name: string) => [name === "Gamma" ? formatGreek("gamma", v) : formatGreek("delta", v), name]}
                />
                <Legend wrapperStyle={legendStyle} />
                <ReferenceLine yAxisId="d" x={strike} stroke={chartColors.muted} strokeDasharray="2 3" label={{ value: "Strike", position: "insideTopLeft", fill: chartColors.muted, fontSize: 11 }} />
                {spot >= curve[0]?.spot && spot <= curve[curve.length - 1]?.spot ? <ReferenceLine yAxisId="d" x={spot} stroke={chartColors.primary} strokeDasharray="4 4" /> : null}
                <Line yAxisId="d" name="Delta" type="monotone" dataKey="delta" stroke={chartColors.iv} strokeWidth={2} dot={false} isAnimationActive={false} />
                <Line yAxisId="g" name="Gamma" type="monotone" dataKey="gamma" stroke={chartColors.primary} strokeWidth={2} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </SimCard>
  );
}
