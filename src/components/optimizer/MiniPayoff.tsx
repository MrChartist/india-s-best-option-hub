import { memo, useId, useMemo } from "react";
import { Area, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { chartColors, payoffFills, tooltipItemStyle, tooltipLabelStyle, tooltipStyle, zeroCrossOffset } from "@/lib/chartTheme";
import { formatINR, formatStrike } from "@/lib/options";
import { payoffPreview, type ScoredCandidate } from "@/lib/optimizer";

export interface MiniPayoffProps {
  candidate: Pick<ScoredCandidate, "legs" | "lots" | "lotSize" | "label">;
  symbol: string;
  spot: number;
  target: number;
  lower: number;
  upper: number;
  nowMs: number;
  atDateMs: number;
  frontExpiryMs: number;
  atExpiry: boolean;
  r: number;
  height?: number;
}

/** Compact payoff: expiry P&L as a green/red area, target-date P&L as a line, spot and target markers. */
function MiniPayoffImpl({ candidate, symbol, spot, target, lower, upper, nowMs, atDateMs, frontExpiryMs, atExpiry, r, height = 96 }: MiniPayoffProps) {
  const gid = useId().replace(/:/g, "");
  const { data, lo, hi } = useMemo(() => {
    const strikes = candidate.legs.map((l) => l.strike);
    const span = Math.max(upper - lower, spot * 0.01);
    const lo0 = Math.min(lower, target, ...strikes) - span * 0.35;
    const hi0 = Math.max(upper, target, ...strikes) + span * 0.35;
    const pts = payoffPreview(candidate, { symbol, lo: Math.max(lo0, spot * 0.5), hi: hi0, points: 72, nowMs, atDateMs, frontExpiryMs, r });
    return { data: pts, lo: Math.max(lo0, spot * 0.5), hi: hi0 };
  }, [candidate, symbol, spot, target, lower, upper, nowMs, atDateMs, frontExpiryMs, r]);

  const offset = useMemo(() => zeroCrossOffset(data.map((d) => d.expiry)), [data]);

  if (data.length === 0) {
    return <div className="flex items-center justify-center text-body-sm text-muted-foreground" style={{ height }}>No payoff to show</div>;
  }

  return (
    <div style={{ height }} role="img" aria-label={`Payoff for ${candidate.label}: profit zone in green, loss zone in red. Target ${formatStrike(target)}, spot ${formatStrike(spot)}.`}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
          <defs>
            <linearGradient id={`mp-${gid}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset={0} stopColor={payoffFills.profitStroke} stopOpacity={0.28} />
              <stop offset={offset} stopColor={payoffFills.profitStroke} stopOpacity={0.12} />
              <stop offset={offset} stopColor={payoffFills.lossStroke} stopOpacity={0.12} />
              <stop offset={1} stopColor={payoffFills.lossStroke} stopOpacity={0.28} />
            </linearGradient>
            <linearGradient id={`ms-${gid}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset={0} stopColor={payoffFills.profitStroke} />
              <stop offset={offset} stopColor={payoffFills.profitStroke} />
              <stop offset={offset} stopColor={payoffFills.lossStroke} />
              <stop offset={1} stopColor={payoffFills.lossStroke} />
            </linearGradient>
          </defs>
          <XAxis dataKey="spot" type="number" domain={[lo, hi]} hide />
          <YAxis hide domain={["auto", "auto"]} />
          <ReferenceLine y={0} stroke={payoffFills.zeroLine} strokeWidth={1} />
          <ReferenceLine x={spot} stroke={chartColors.muted} strokeDasharray="2 3" />
          <ReferenceLine x={target} stroke={chartColors.primary} strokeWidth={1.5} />
          <Tooltip
            contentStyle={tooltipStyle}
            labelStyle={tooltipLabelStyle}
            itemStyle={tooltipItemStyle}
            labelFormatter={(v: number) => `At ${formatStrike(Math.round(v))}`}
            formatter={(v: number, name: string) => [formatINR(v, { decimals: 0 }), name === "expiry" ? "At expiry" : "At target date"]}
          />
          <Area type="linear" dataKey="expiry" stroke={`url(#ms-${gid})`} strokeWidth={1.5} fill={`url(#mp-${gid})`} isAnimationActive={false} dot={false} />
          {!atExpiry && <Line type="monotone" dataKey="target" stroke={payoffFills.todayLine} strokeWidth={1.25} strokeDasharray="4 3" dot={false} isAnimationActive={false} />}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export const MiniPayoff = memo(MiniPayoffImpl);
