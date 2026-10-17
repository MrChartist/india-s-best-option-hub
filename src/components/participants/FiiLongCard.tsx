import { Link } from "react-router-dom";
import { ArrowUpRight, Landmark } from "lucide-react";
import { Line, LineChart, ReferenceArea, ResponsiveContainer, YAxis } from "recharts";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { chartColors, tokenColor } from "@/lib/chartTheme";
import { LONG_PCT_BANDS, ZONE_TEXT, classifyLongPct } from "@/lib/participantsApi";
import { cn } from "@/lib/utils";
import { GaugeDial } from "./FiiLongGauge";
import { SourceBadge } from "./ui";
import { arrow, fmtContracts, fmtPct, shortDate, toneClass } from "./format";
import { useParticipantsDashboard } from "./useParticipants";

const TONE_CLASS = { bullish: "text-bullish", bearish: "text-bearish", warning: "text-warning", neutral: "text-muted-foreground" } as const;

/** Compact FII index-futures long % card for the dashboard. Links to /participants. */
export default function FiiLongCard() {
  const { data, isLoading } = useParticipantsDashboard(null, 20);

  if (isLoading || !data) {
    return (
      <Card className="p-4" role="status" aria-busy="true" aria-label="Loading FII positioning">
        <Skeleton className="mb-3 h-4 w-36" />
        <Skeleton className="mx-auto h-24 w-44" />
        <Skeleton className="mt-3 h-10 w-full" />
      </Card>
    );
  }

  const fii = data.views.find((v) => v.participant === "FII");
  const client = data.views.find((v) => v.participant === "Client");
  const longPct = fii?.products.futIdx.longPct ?? NaN;
  const chg = fii?.products.futIdx.change?.longPct ?? null;
  const zone = ZONE_TEXT[classifyLongPct(longPct)];
  const spark = data.series.slice(-20).map((p) => ({ v: Number.isFinite(p.fiiLongPct) ? p.fiiLongPct : null }));

  return (
    <Card className="flex h-full min-w-0 flex-col p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="flex items-center gap-1.5 font-display text-lead font-bold">
            <Landmark className="h-4 w-4 text-primary-ink" aria-hidden="true" />
            FII index futures long
          </h3>
          <p className="text-body-sm text-muted-foreground">NSE participant OI · {shortDate(data.date)}</p>
        </div>
        <SourceBadge mode={data.mode} />
      </div>

      <div className="mt-2 flex items-center gap-3">
        <div className="w-[150px] shrink-0">
          <GaugeDial value={longPct} size="sm" />
        </div>
        <div className="min-w-0">
          <p className="font-num text-display tabular-nums">{Number.isFinite(longPct) ? fmtPct(longPct, 1) : "—"}</p>
          <p className={cn("font-semibold text-body", TONE_CLASS[zone.tone])}>{zone.label}</p>
          {chg !== null && Number.isFinite(chg) ? (
            <p className={cn("font-num text-body-sm tabular-nums", toneClass(chg))}>
              {arrow(chg)} {fmtPct(chg, 2, true).replace("%", " pts")} on day
            </p>
          ) : null}
        </div>
      </div>

      {spark.length > 1 ? (
        <div className="mt-2 h-12" role="img" aria-label={`FII long percent, last ${spark.length} sessions`}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={spark} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
              <YAxis hide domain={[0, 100]} />
              <ReferenceArea y1={0} y2={LONG_PCT_BANDS.extremeLow} fill={tokenColor("warning", 0.14)} stroke="none" />
              <ReferenceArea y1={LONG_PCT_BANDS.extremeHigh} y2={100} fill={tokenColor("warning", 0.14)} stroke="none" />
              <Line type="monotone" dataKey="v" stroke={chartColors.fii} strokeWidth={1.75} dot={false} isAnimationActive={false} connectNulls />
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : null}

      <dl className="mt-2 grid grid-cols-2 gap-2 text-body-sm">
        <div>
          <dt className="text-label uppercase text-muted-foreground">FII net</dt>
          <dd className={cn("font-num tabular-nums", toneClass(fii?.products.futIdx.net ?? NaN))}>{fmtContracts(fii?.products.futIdx.net ?? NaN, true)}</dd>
        </div>
        <div>
          <dt className="text-label uppercase text-muted-foreground">Client net</dt>
          <dd className={cn("font-num tabular-nums", toneClass(client?.products.futIdx.net ?? NaN))}>{fmtContracts(client?.products.futIdx.net ?? NaN, true)}</dd>
        </div>
      </dl>

      <Link
        to="/participants"
        className="mt-auto inline-flex items-center gap-1 pt-3 text-body-sm font-semibold text-primary-ink hover:underline focus-visible:rounded-chip focus-visible:shadow-ember focus-visible:outline-none"
      >
        FII / DII positioning <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
      </Link>
    </Card>
  );
}
