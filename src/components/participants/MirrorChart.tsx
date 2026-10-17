import { useMemo, useState } from "react";
import { Area, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { axisProps, gridProps, tokenColor, tooltipCursor, tooltipItemStyle, tooltipLabelStyle, tooltipStyle } from "@/lib/chartTheme";
import { pearson, type HistoryPoint } from "@/lib/participantsApi";
import { LegendDot, Stat } from "./ui";
import { PARTICIPANT_COLOR, fmtContracts, fmtContractsFull, shortDate } from "./format";

type Measure = "fut" | "direction";

interface Props {
  series: HistoryPoint[];
}

function diffs(xs: number[]): number[] {
  return xs.slice(1).map((v, i) => v - xs[i]);
}

function corrText(r: number): string {
  if (!Number.isFinite(r)) return "Not enough data";
  const a = Math.abs(r);
  const strength = a >= 0.8 ? "Strong" : a >= 0.5 ? "Moderate" : a >= 0.25 ? "Weak" : "No clear";
  if (strength === "No clear") return "No clear link";
  return `${strength} ${r < 0 ? "mirror" : "co-movement"}`;
}

export function MirrorChart({ series }: Props) {
  const [measure, setMeasure] = useState<Measure>("fut");
  const [showPro, setShowPro] = useState(false);
  const [showDii, setShowDii] = useState(false);

  const data = useMemo(
    () =>
      series.map((p) => ({
        date: p.date,
        label: shortDate(p.date),
        FII: measure === "fut" ? p.fiiNetFut : p.fiiDirection,
        Client: measure === "fut" ? p.clientNetFut : p.clientDirection,
        Pro: measure === "fut" ? p.proNetFut : p.proDirection,
        DII: measure === "fut" ? p.diiNetFut : NaN,
      })),
    [series, measure],
  );

  const fii = data.map((d) => d.FII);
  const client = data.map((d) => d.Client);
  const rLevel = pearson(fii, client);
  const rChange = pearson(diffs(fii), diffs(client));
  const last = data[data.length - 1];

  if (data.length < 2) {
    return <div className="flex h-[260px] items-center justify-center rounded-tile border border-dashed border-border text-body-sm text-muted-foreground">The mirror needs at least two days of history.</div>;
  }

  const fmtNull = (v: number) => (Number.isFinite(v) ? v : null);
  const chartData = data.map((d) => ({ ...d, FII: fmtNull(d.FII), Client: fmtNull(d.Client), Pro: fmtNull(d.Pro), DII: fmtNull(d.DII) }));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ToggleGroup type="single" value={measure} onValueChange={(v) => v && setMeasure(v as Measure)} aria-label="Measure">
          <ToggleGroupItem value="fut" size="sm" className="h-8 px-2.5 text-xs">
            Index futures net
          </ToggleGroupItem>
          <ToggleGroupItem value="direction" size="sm" className="h-8 px-2.5 text-xs">
            Net index direction
          </ToggleGroupItem>
        </ToggleGroup>
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <Checkbox id="mirror-pro" checked={showPro} onCheckedChange={(v) => setShowPro(v === true)} />
            <Label htmlFor="mirror-pro" className="text-body-sm">
              Show Pro
            </Label>
          </div>
          {measure === "fut" ? (
            <div className="flex items-center gap-2">
              <Checkbox id="mirror-dii" checked={showDii} onCheckedChange={(v) => setShowDii(v === true)} />
              <Label htmlFor="mirror-dii" className="text-body-sm">
                Show DII
              </Label>
            </div>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Stat label="FII net" value={fmtContracts(last.FII, true)} tone={last.FII >= 0 ? "text-bullish" : "text-bearish"} hint={shortDate(last.date)} />
        <Stat label="Client net" value={fmtContracts(last.Client, true)} tone={last.Client >= 0 ? "text-bullish" : "text-bearish"} hint={shortDate(last.date)} />
        <Stat label="Level correlation" value={Number.isFinite(rLevel) ? rLevel.toFixed(2) : "—"} hint={corrText(rLevel)} help="Pearson correlation of the two net positions over the window. Close to −1 means Clients take the other side of FIIs almost one for one." />
        <Stat label="Daily change corr." value={Number.isFinite(rChange) ? rChange.toFixed(2) : "—"} hint={corrText(rChange)} help="Correlation of day-to-day changes. More telling than levels: a strongly negative value means Client positions move opposite to FII positions each day." />
      </div>

      <div className="flex flex-wrap gap-3">
        <LegendDot color={PARTICIPANT_COLOR.FII} label="FII" />
        <LegendDot color={PARTICIPANT_COLOR.Client} label="Client" />
        {showPro ? <LegendDot color={PARTICIPANT_COLOR.Pro} label="Pro" dashed /> : null}
        {showDii && measure === "fut" ? <LegendDot color={PARTICIPANT_COLOR.DII} label="DII" dashed /> : null}
      </div>

      <div className="h-[300px]" role="img" aria-label={`Client versus FII net ${measure === "fut" ? "index futures" : "index direction"} over ${data.length} sessions. Level correlation ${Number.isFinite(rLevel) ? rLevel.toFixed(2) : "not available"}.`}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: -4 }}>
            <defs>
              <linearGradient id="mirror-fii" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={PARTICIPANT_COLOR.FII} stopOpacity={0.25} />
                <stop offset="100%" stopColor={PARTICIPANT_COLOR.FII} stopOpacity={0.02} />
              </linearGradient>
              <linearGradient id="mirror-client" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={PARTICIPANT_COLOR.Client} stopOpacity={0.22} />
                <stop offset="100%" stopColor={PARTICIPANT_COLOR.Client} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid {...gridProps} />
            <ReferenceLine y={0} stroke={tokenColor("muted-foreground", 0.7)} />
            <XAxis dataKey="label" {...axisProps} interval="preserveStartEnd" minTickGap={20} />
            <YAxis {...axisProps} width={56} tickFormatter={(v: number) => fmtContracts(v)} />
            <Tooltip contentStyle={tooltipStyle} labelStyle={tooltipLabelStyle} itemStyle={tooltipItemStyle} cursor={tooltipCursor} formatter={(v: number, name: string) => [fmtContractsFull(v, true), name]} />
            <Area type="monotone" dataKey="FII" stroke={PARTICIPANT_COLOR.FII} strokeWidth={2} fill="url(#mirror-fii)" isAnimationActive={false} connectNulls />
            <Area type="monotone" dataKey="Client" stroke={PARTICIPANT_COLOR.Client} strokeWidth={2} fill="url(#mirror-client)" isAnimationActive={false} connectNulls />
            {showPro ? <Line type="monotone" dataKey="Pro" stroke={PARTICIPANT_COLOR.Pro} strokeWidth={1.5} strokeDasharray="5 3" dot={false} isAnimationActive={false} connectNulls /> : null}
            {showDii && measure === "fut" ? <Line type="monotone" dataKey="DII" stroke={PARTICIPANT_COLOR.DII} strokeWidth={1.5} strokeDasharray="2 3" dot={false} isAnimationActive={false} connectNulls /> : null}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <p className="text-body-sm text-muted-foreground">
        Index futures are zero-sum. When FIIs build shorts, someone else, usually Clients, holds the matching longs. A persistent mirror with Clients heavily long and FIIs heavily short has often resolved against Clients.
      </p>
    </div>
  );
}
