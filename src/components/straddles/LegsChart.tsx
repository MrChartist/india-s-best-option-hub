/** CE and PE legs of the selected pair through the session, so a lopsided straddle is easy to spot. */
import { useMemo } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Split } from "lucide-react";
import { axisProps, chartColors, gridProps, legendStyle, tooltipCursor, tooltipItemStyle, tooltipLabelStyle, tooltipStyle } from "@/lib/chartTheme";
import { formatINR, formatNumberIN, formatPct, formatStrike } from "@/lib/options";
import { legRows } from "@/lib/straddles";
import type { StraddlePoint } from "@/components/expiry/expiryMath";
import { hhmmIST, premiumDomain } from "@/components/expiry/expiryMath";
import { DerivedBadge, EmptyState, ModeBadge, Panel, Stat } from "@/components/expiry/ExpiryUi";
import type { SessionMode } from "@/components/expiry/useExpirySession";

interface Props {
  points: StraddlePoint[];
  mult: number;
  unit: string;
  mode: SessionMode;
  domain: [number, number];
}

type LegRow = ReturnType<typeof legRows>[number];

/**
 * Centred moving average of each leg, never across an ATM roll (a roll is a real jump). Only used
 * for the labelled sample session, whose synthetic snapshots carry tick noise that turns the
 * chart into a saw-tooth; recorded and live data are drawn as they are.
 */
function smoothLegs(rows: LegRow[], points: StraddlePoint[], half = 3): LegRow[] {
  const pair = (i: number) => `${points[i]?.strike}/${points[i]?.peStrike}`;
  return rows.map((r, i) => {
    let ce = 0;
    let pe = 0;
    let n = 0;
    for (let j = Math.max(0, i - half); j <= Math.min(rows.length - 1, i + half); j++) {
      if (pair(j) !== pair(i)) continue;
      ce += rows[j].ce;
      pe += rows[j].pe;
      n++;
    }
    return n > 0 ? { ...r, ce: ce / n, pe: pe / n } : r;
  });
}

export function LegsChart({ points, mult, unit, mode, domain }: Props) {
  const smoothed = mode === "sample";
  const rows = useMemo(() => {
    const raw = legRows(points, mult);
    return smoothed ? smoothLegs(raw, points) : raw;
  }, [points, mult, smoothed]);
  const last = points[points.length - 1];
  const first = points[0];
  const dec = mult > 1 ? 0 : 2;
  const legChange = (now: number, then: number) => (then > 0 ? ((now - then) / then) * 100 : NaN);
  const rolled = new Set(points.map((p) => `${p.strike}/${p.peStrike}`)).size > 1;

  return (
    <Panel
      title={
        <>
          <Split className="h-4 w-4 text-primary-ink" aria-hidden="true" />
          CE and PE legs
          <ModeBadge mode={mode} />
        </>
      }
      subtitle={<>Each leg&apos;s premium · {unit}{rolled ? " · legs jump when the ATM strike rolls" : ""}</>}
    >
      {points.length < 2 ? (
        <EmptyState icon={<Split className="h-6 w-6" aria-hidden="true" />} title="No leg history yet">
          Leg prices appear once two snapshots of this pair are available.
        </EmptyState>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Stat
              label={`CE ${formatStrike(last.strike)}`}
              value={formatINR(last.ce * mult, { decimals: dec })}
              hint={rolled ? `Started at ${formatStrike(first.strike)}` : Number.isFinite(legChange(last.ce, first.ce)) ? `${formatPct(legChange(last.ce, first.ce), { decimals: 1, signed: true })} today` : undefined}
            />
            <Stat
              label={`PE ${formatStrike(last.peStrike)}`}
              value={formatINR(last.pe * mult, { decimals: dec })}
              hint={rolled ? `Started at ${formatStrike(first.peStrike)}` : Number.isFinite(legChange(last.pe, first.pe)) ? `${formatPct(legChange(last.pe, first.pe), { decimals: 1, signed: true })} today` : undefined}
            />
            <Stat
              label="CE − PE"
              value={formatINR((last.ce - last.pe) * mult, { decimals: dec })}
              hint={last.ce > last.pe ? "Calls richer: spot above the pair's centre" : last.ce < last.pe ? "Puts richer: spot below the pair's centre" : "Balanced"}
              help="For a straddle, CE minus PE tracks how far spot (strictly, the forward) is from the strike. It flips sign as spot crosses the strike."
            />
          </div>
          <figure className="mt-4" aria-label={`CE at ${formatINR(last.ce * mult, { decimals: dec })} and PE at ${formatINR(last.pe * mult, { decimals: dec })} as of ${hhmmIST(last.ts)} IST`}>
            <div className="h-[260px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="ts" type="number" scale="time" domain={domain} tickFormatter={(v: number) => hhmmIST(v)} {...axisProps} minTickGap={28} />
                  <YAxis {...axisProps} width={56} domain={premiumDomain(mult)} tickFormatter={(v: number) => formatNumberIN(v, 0)} />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    labelStyle={tooltipLabelStyle}
                    itemStyle={tooltipItemStyle}
                    cursor={tooltipCursor}
                    labelFormatter={(v: number) => `${hhmmIST(v)} IST`}
                    formatter={(value: number, name: string) => [formatINR(value, { decimals: dec }), name]}
                  />
                  <Legend wrapperStyle={legendStyle} />
                  <Line type="monotone" dataKey="ce" name="CE" stroke={chartColors.call} strokeWidth={1.75} dot={false} isAnimationActive={false} />
                  <Line type="monotone" dataKey="pe" name="PE" stroke={chartColors.put} strokeWidth={1.75} dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <figcaption className="mt-2 flex flex-wrap items-center gap-2 text-body-sm text-muted-foreground">
              <DerivedBadge title="From snapshots" />
              Calls in the call colour, puts in the put colour, matching the option chain.
              {smoothed ? " Sample session lines are smoothed (7-snapshot average)." : ""}
            </figcaption>
          </figure>
        </>
      )}
    </Panel>
  );
}
