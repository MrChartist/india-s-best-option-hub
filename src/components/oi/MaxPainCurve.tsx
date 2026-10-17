import { useMemo } from "react";
import { Area, CartesianGrid, ComposedChart, Legend, Line, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Magnet } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { axisProps, chartColors, gridProps, legendStyle, tokenColor, tooltipCursor, tooltipStyle } from "@/lib/chartTheme";
import { inferOiUnit } from "@/lib/gexData";
import { formatCompactIN, formatDateIST, maxPainCurve } from "@/lib/options";
import type { OptionData } from "@/lib/mockData";
import { EmptyState, ModuleHeader, StatTile } from "./shared";
import { fmtStrike } from "./format";

interface Props {
  chain: OptionData[];
  spot: number;
  expiry: string;
  lotSize: number;
  sample?: boolean;
}

const rupees = (v: number) => formatCompactIN(v, { symbol: true });

/**
 * Writer payout curve: what call and put writers together would pay at expiry if the index settled
 * at each strike. Max pain is the minimum. Payout is converted to rupees (contracts × lot size).
 */
export function MaxPainCurve({ chain, spot, expiry, lotSize, sample }: Props) {
  const view = useMemo(() => {
    const curve = maxPainCurve(chain);
    if (curve.length === 0) return null;
    const unit = inferOiUnit(chain, lotSize);
    const mult = unit === "contracts" && lotSize > 0 ? lotSize : 1;
    let min = curve[0];
    for (const p of curve) if (p.total < min.total) min = p;
    // Keep the readable part: within ±10% of spot (or of max pain when spot is unknown).
    const centre = spot > 0 ? spot : min.strike;
    const near = curve.filter((p) => Math.abs(p.strike - centre) / centre <= 0.1);
    const rows = (near.length >= 5 ? near : curve).map((p) => ({ strike: p.strike, ce: p.cePayout * mult, pe: p.pePayout * mult, total: p.total * mult }));
    // Payout if expiry were at spot: interpolate between neighbouring strikes.
    let atSpot = NaN;
    if (spot > 0) {
      for (let i = 1; i < curve.length; i++) {
        const a = curve[i - 1];
        const b = curve[i];
        if (spot >= a.strike && spot <= b.strike) {
          const w = b.strike === a.strike ? 0 : (spot - a.strike) / (b.strike - a.strike);
          atSpot = (a.total + w * (b.total - a.total)) * mult;
          break;
        }
      }
    }
    return { rows, min: { strike: min.strike, total: min.total * mult }, atSpot, unit };
  }, [chain, spot, lotSize]);

  return (
    <Card className="overflow-hidden">
      <ModuleHeader
        icon={<Magnet className="h-4 w-4 text-primary-ink" />}
        title="Max pain payout curve"
        hint={`Total writer payout if ${expiry ? formatDateIST(expiry) : "this"} expiry settles at each strike. The lowest point is max pain.`}
        right={sample ? <Badge variant="warning">Sample data</Badge> : <Badge variant="info">Derived</Badge>}
      />
      <CardContent className="space-y-3 p-4">
        {!view ? (
          <EmptyState icon={<Magnet className="h-5 w-5" />} title="No open interest for this expiry" />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              <StatTile label="Max pain" value={fmtStrike(view.min.strike)} valueClass="text-warning" />
              <StatTile
                label="Distance from spot"
                value={spot > 0 ? `${view.min.strike - spot >= 0 ? "+" : "−"}${Math.abs(view.min.strike - spot).toLocaleString("en-IN", { maximumFractionDigits: 0 })} pts` : "—"}
                sub={spot > 0 ? `${(((view.min.strike - spot) / spot) * 100).toFixed(2)}%` : undefined}
              />
              <StatTile label="Payout at max pain" value={rupees(view.min.total)} />
              <StatTile label="Payout at spot" value={rupees(view.atSpot)} sub={Number.isFinite(view.atSpot) ? `${rupees(view.atSpot - view.min.total)} above minimum` : undefined} />
            </div>
            <div className="h-[320px] sm:h-[360px]" role="img" aria-label={`Max pain payout curve; minimum at ${fmtStrike(view.min.strike)}`}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={view.rows} margin={{ top: 16, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid {...gridProps} />
                  <XAxis {...axisProps} dataKey="strike" type="number" domain={["dataMin", "dataMax"]} tickFormatter={(v: number) => fmtStrike(v)} minTickGap={18} />
                  <YAxis {...axisProps} tickFormatter={(v: number) => formatCompactIN(v)} width={56} />
                  <Tooltip contentStyle={tooltipStyle} cursor={tooltipCursor} labelFormatter={(v: number) => `Settle at ${fmtStrike(v)}`} formatter={(v: number, n: string) => [rupees(v), n]} />
                  <Legend wrapperStyle={legendStyle} />
                  <Area type="monotone" dataKey="ce" name="Call writers pay" stackId="p" stroke={chartColors.call} fill={tokenColor("chart-call", 0.18)} isAnimationActive={false} />
                  <Area type="monotone" dataKey="pe" name="Put writers pay" stackId="p" stroke={chartColors.put} fill={tokenColor("chart-put", 0.18)} isAnimationActive={false} />
                  <Line type="monotone" dataKey="total" name="Total payout" stroke={chartColors.foreground} strokeWidth={2} dot={false} isAnimationActive={false} />
                  <ReferenceLine x={view.min.strike} stroke={chartColors.warning} strokeDasharray="5 4" label={{ value: `Max pain ${fmtStrike(view.min.strike)}`, position: "top", fill: chartColors.warning, fontSize: 11 }} />
                  <ReferenceDot x={view.min.strike} y={view.min.total} r={5} fill={chartColors.warning} stroke={chartColors.card} />
                  {spot > 0 && <ReferenceLine x={spot} stroke={chartColors.spot} strokeDasharray="3 3" label={{ value: "Spot", position: "insideTopRight", fill: chartColors.spot, fontSize: 11 }} />}
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <p className="text-[11px] text-muted-foreground">
              {view.unit === "contracts" ? `OI read as contracts and multiplied by the lot size (${lotSize}).` : "OI read as quantity."} Max pain is a reference level, not a forecast; it tends to matter most in the last session before expiry.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
