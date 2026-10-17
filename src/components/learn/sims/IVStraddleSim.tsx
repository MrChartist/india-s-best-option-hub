import { useMemo, useRef, useState } from "react";
import { Activity } from "lucide-react";
import { CartesianGrid, Line, LineChart, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { axisProps, chartColors, gridProps, tooltipItemStyle, tooltipLabelStyle, tooltipStyle } from "@/lib/chartTheme";
import { bsPrice, expectedMoveFromIV, expectedMoveFromStraddle, formatINR, formatNumberIN, formatPct, getLotSize, getStrikeStep } from "@/lib/options";
import { useSimSpot } from "../simSpot";
import { DEFAULT_RATE, ivRange, straddleCurve } from "./simLogic";
import { SimCard, SimSlider, SimStat } from "./SimUi";

const IV_MIN = 0.05;
const IV_MAX = 0.6;

interface ChartState {
  activeLabel?: string | number;
}

/** Drag IV (slider or chart) to see the ATM straddle and the expected move respond. */
export default function IVStraddleSim() {
  const { spot } = useSimSpot();
  const [ivPct, setIvPct] = useState(13);
  const [days, setDays] = useState(7);
  const dragging = useRef(false);

  const step = getStrikeStep("NIFTY");
  const lot = getLotSize("NIFTY") ?? 65;
  const strike = Math.round(spot / step) * step;
  const sigma = ivPct / 100;
  const T = days / 365;

  const ce = bsPrice({ S: spot, K: strike, T, r: DEFAULT_RATE, sigma, type: "CE" });
  const pe = bsPrice({ S: spot, K: strike, T, r: DEFAULT_RATE, sigma, type: "PE" });
  const straddle = ce + pe;
  const emS = expectedMoveFromStraddle(straddle, spot);
  const emIv = expectedMoveFromIV(spot, sigma, T);

  const curve = useMemo(
    () => straddleCurve({ spot, days, strike, ivs: ivRange(IV_MIN, IV_MAX, 56) }).map((p) => ({ ivPct: +(p.iv * 100).toFixed(2), straddle: p.straddle })),
    [spot, days, strike],
  );

  const setFromChart = (s: ChartState | null | undefined) => {
    const v = Number(s?.activeLabel);
    if (Number.isFinite(v)) setIvPct(Math.min(IV_MAX * 100, Math.max(IV_MIN * 100, Math.round(v * 2) / 2)));
  };

  return (
    <SimCard title="IV and the straddle" icon={<Activity className="h-4 w-4" />}>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,280px)_1fr]">
        <div className="space-y-5">
          <SimSlider label="Implied volatility" value={ivPct} min={IV_MIN * 100} max={IV_MAX * 100} step={0.5} onChange={setIvPct} format={(v) => formatPct(v, { decimals: 1 })} hint="Or click and drag on the chart." />
          <SimSlider label="Days to expiry" value={days} min={0.25} max={30} step={0.25} onChange={setDays} format={(v) => (v < 1 ? `${formatNumberIN(v * 24, 0)} hours` : `${formatNumberIN(v, 2, { minDecimals: 0 })} days`)} />
          <div className="grid grid-cols-2 gap-2">
            <SimStat label={`${formatNumberIN(strike)} CE`} value={formatINR(ce)} />
            <SimStat label={`${formatNumberIN(strike)} PE`} value={formatINR(pe)} />
            <SimStat label="ATM straddle" value={formatINR(straddle)} sub={`${formatINR(straddle * lot, { decimals: 0 })} per lot of ${lot}`} tone="info" />
            <SimStat label="Straddle % of spot" value={formatPct((straddle / spot) * 100, { decimals: 2 })} />
          </div>
        </div>
        <div className="min-w-0">
          <div
            className="h-60 w-full cursor-crosshair select-none sm:h-72"
            role="img"
            aria-label={`Straddle price against implied volatility. At ${formatPct(ivPct, { decimals: 1 })} IV the straddle is ${formatINR(straddle)}.`}
          >
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={curve}
                margin={{ top: 8, right: 12, bottom: 4, left: 0 }}
                onMouseDown={(s) => {
                  dragging.current = true;
                  setFromChart(s as ChartState);
                }}
                onMouseMove={(s) => {
                  if (dragging.current) setFromChart(s as ChartState);
                }}
                onMouseUp={() => {
                  dragging.current = false;
                }}
                onMouseLeave={() => {
                  dragging.current = false;
                }}
              >
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="ivPct" type="number" domain={[IV_MIN * 100, IV_MAX * 100]} tickFormatter={(v: number) => `${v}%`} {...axisProps} />
                <YAxis width={56} tickFormatter={(v: number) => `₹${formatNumberIN(v)}`} {...axisProps} />
                <Tooltip
                  contentStyle={tooltipStyle}
                  labelStyle={tooltipLabelStyle}
                  itemStyle={tooltipItemStyle}
                  labelFormatter={(v) => `IV ${formatPct(Number(v), { decimals: 1 })}`}
                  formatter={(v: number) => [formatINR(v), "Straddle"]}
                />
                <ReferenceLine x={ivPct} stroke={chartColors.primary} strokeDasharray="4 4" />
                <Line type="monotone" dataKey="straddle" stroke={chartColors.iv} strokeWidth={2} dot={false} isAnimationActive={false} />
                <ReferenceDot x={ivPct} y={straddle} r={6} fill={chartColors.primary} stroke={chartColors.card} strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-3 rounded-tile border border-border bg-product-wash/60 p-3 text-body">
            <p className="font-semibold text-foreground">
              1σ expected move (from IV): ±{formatNumberIN(emIv.move)} points
              <span className="font-normal text-muted-foreground"> · {formatNumberIN(emIv.lower)} – {formatNumberIN(emIv.upper)} (±{formatPct(emIv.pct, { decimals: 2 })})</span>
            </p>
            <p className="mt-1 text-muted-foreground">
              Straddle rule (0.85 × straddle): ±{formatNumberIN(emS.move)} points, {formatNumberIN(emS.lower)} – {formatNumberIN(emS.upper)}. It is tighter because the straddle prices the average move (about 0.8σ), so this band holds roughly half the time versus about two in three for 1σ. Doubling IV roughly doubles the straddle; doubling time adds only about 41%.
            </p>
          </div>
        </div>
      </div>
    </SimCard>
  );
}
