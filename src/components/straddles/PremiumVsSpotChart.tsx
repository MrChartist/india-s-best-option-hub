/**
 * Straddle vs spot: each snapshot as a dot (premium against spot, darker = later in the session)
 * over the pair's value at expiry. The gap between the dots and the V is the time value left.
 */
import { useMemo } from "react";
import { CartesianGrid, Cell, ComposedChart, Legend, Line, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis } from "recharts";
import { Crosshair } from "lucide-react";
import { axisProps, chartColors, gridProps, legendStyle, tooltipItemStyle, tooltipLabelStyle, tooltipStyle } from "@/lib/chartTheme";
import { formatINR, formatNumberIN, formatStrike } from "@/lib/options";
import { expiryValueLine, premiumVsSpot } from "@/lib/straddles";
import { hhmmIST, type StraddlePoint } from "@/components/expiry/expiryMath";
import { DerivedBadge, EmptyState, ModeBadge, Panel } from "@/components/expiry/ExpiryUi";
import type { SessionMode } from "@/components/expiry/useExpirySession";

interface Props {
  points: StraddlePoint[];
  mult: number;
  unit: string;
  mode: SessionMode;
}

interface TipPayload {
  payload?: { spot?: number; premium?: number; ts?: number; expiry?: number };
}

export function PremiumVsSpotChart({ points, mult, unit, mode }: Props) {
  const dots = useMemo(() => premiumVsSpot(points, mult), [points, mult]);
  const last = points[points.length - 1];
  const range = useMemo(() => {
    if (dots.length === 0 || !last) return null;
    const spots = dots.map((d) => d.spot);
    const lo = Math.min(...spots, last.peStrike);
    const hi = Math.max(...spots, last.strike);
    const pad = Math.max((hi - lo) * 0.15, last.spot * 0.002);
    return { lo: Math.floor(lo - pad), hi: Math.ceil(hi + pad) };
  }, [dots, last]);
  const line = useMemo(() => (range && last ? expiryValueLine(last.strike, last.peStrike, range.lo, range.hi, mult) : []), [range, last, mult]);
  const dec = mult > 1 ? 0 : 2;
  const rolled = new Set(points.map((p) => `${p.strike}/${p.peStrike}`)).size > 1;
  const pairText = last ? (last.strike === last.peStrike ? `${formatStrike(last.strike)} straddle` : `${formatStrike(last.strike)} CE + ${formatStrike(last.peStrike)} PE`) : "";

  return (
    <Panel
      title={
        <>
          <Crosshair className="h-4 w-4 text-primary-ink" aria-hidden="true" />
          Straddle vs spot
          <ModeBadge mode={mode} />
        </>
      }
      subtitle={<>Premium against spot at every snapshot · {unit}</>}
    >
      {dots.length < 2 || !range ? (
        <EmptyState icon={<Crosshair className="h-6 w-6" aria-hidden="true" />} title="Not enough snapshots yet">
          Needs at least two snapshots with a spot price.
        </EmptyState>
      ) : (
        <figure aria-label={`Premium of the ${pairText} against spot between ${formatNumberIN(range.lo)} and ${formatNumberIN(range.hi)}`}>
          <div className="h-[280px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="spot" type="number" domain={[range.lo, range.hi]} allowDuplicatedCategory={false} tickFormatter={(v: number) => formatNumberIN(v, 0)} {...axisProps} minTickGap={24} />
                <YAxis {...axisProps} width={56} domain={[0, "auto"]} tickFormatter={(v: number) => formatNumberIN(v, 0)} />
                <Tooltip
                  contentStyle={tooltipStyle}
                  labelStyle={tooltipLabelStyle}
                  itemStyle={tooltipItemStyle}
                  cursor={{ strokeDasharray: "3 3", stroke: chartColors.muted }}
                  content={({ active, payload }) => {
                    const p = (payload as TipPayload[] | undefined)?.[0]?.payload;
                    if (!active || !p || !Number.isFinite(p.spot)) return null;
                    return (
                      <div style={tooltipStyle}>
                        <p style={tooltipLabelStyle}>{p.ts ? `${hhmmIST(p.ts)} IST` : "At expiry"}</p>
                        <p style={tooltipItemStyle}>Spot {formatNumberIN(p.spot as number, 2)}</p>
                        {Number.isFinite(p.premium) ? <p style={tooltipItemStyle}>Premium {formatINR(p.premium as number, { decimals: dec })}</p> : null}
                        {Number.isFinite(p.expiry) ? <p style={tooltipItemStyle}>Value at expiry {formatINR(p.expiry as number, { decimals: dec })}</p> : null}
                      </div>
                    );
                  }}
                />
                <Legend wrapperStyle={legendStyle} />
                <Line data={line} type="linear" dataKey="expiry" name={`At expiry (${pairText})`} stroke={chartColors.axis} strokeDasharray="5 4" strokeWidth={1.5} dot={false} isAnimationActive={false} />
                <Scatter data={dots} dataKey="premium" name="Snapshots" fill={chartColors.primary} isAnimationActive={false}>
                  {dots.map((d) => (
                    <Cell key={d.ts} fill={chartColors.primary} fillOpacity={0.15 + 0.85 * d.t} />
                  ))}
                </Scatter>
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <figcaption className="mt-2 flex flex-wrap items-center gap-2 text-body-sm text-muted-foreground">
            <DerivedBadge title="From snapshots" />
            Darker dots are later in the session. The dashed V is what the pair is worth at expiry; the gap above it is time value.
            {rolled ? " The rolling ATM changed strike, so the V uses the latest strike." : ""}
          </figcaption>
        </figure>
      )}
    </Panel>
  );
}
