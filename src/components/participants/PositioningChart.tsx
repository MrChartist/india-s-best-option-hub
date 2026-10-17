import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { axisProps, barCursor, chartColors, gridProps, tokenColor, tooltipCursor, tooltipItemStyle, tooltipLabelStyle, tooltipStyle } from "@/lib/chartTheme";
import { PARTICIPANTS, indexDirection, productStats, type Participant, type ParticipantOIRow, type ParticipantView } from "@/lib/participantsApi";
import { cn } from "@/lib/utils";
import { LegendDot, Stat } from "./ui";
import { PARTICIPANT_COLOR, arrow, fmtContracts, fmtContractsFull, shortDate, toneClass } from "./format";

interface Props {
  views: ParticipantView[];
  history: ParticipantOIRow[];
  initialParticipant?: Participant;
  /** hide the participant switcher (fixed view) */
  fixed?: boolean;
}

/** Plain-language read of a participant's net index options book. */
function optionsRead(callNet: number, putNet: number): string {
  const callSide = callNet > 0 ? "net long calls (bullish)" : callNet < 0 ? "net short calls (bearish or income)" : "flat on calls";
  const putSide = putNet > 0 ? "net long puts (bearish or hedged)" : putNet < 0 ? "net short puts (bullish or income)" : "flat on puts";
  return `${callSide}, ${putSide}.`;
}

export function PositioningChart({ views, history, initialParticipant = "FII", fixed = false }: Props) {
  const [who, setWho] = useState<Participant>(initialParticipant);
  const view = views.find((v) => v.participant === who);

  const bars = useMemo(() => {
    if (!view) return [];
    const c = view.products.optIdxCall;
    const p = view.products.optIdxPut;
    return [
      { key: "Call long", value: c.long, color: chartColors.call, opacity: 1 },
      { key: "Call short", value: c.short, color: chartColors.call, opacity: 0.45 },
      { key: "Put long", value: p.long, color: chartColors.put, opacity: 1 },
      { key: "Put short", value: p.short, color: chartColors.put, opacity: 0.45 },
    ];
  }, [view]);

  const trend = useMemo(() => {
    return history
      .filter((r) => r.participant === who)
      .sort((a, b) => (a.date < b.date ? -1 : 1))
      .map((r) => ({
        date: r.date,
        label: shortDate(r.date),
        callNet: productStats(r, "optIdxCall").net,
        putNet: productStats(r, "optIdxPut").net,
        futNet: productStats(r, "futIdx").net,
        direction: indexDirection(r),
      }));
  }, [history, who]);

  if (!view) {
    return <p className="text-body-sm text-muted-foreground">No {who} row in this file.</p>;
  }

  const c = view.products.optIdxCall;
  const p = view.products.optIdxPut;
  const f = view.products.futIdx;

  return (
    <div className="space-y-4">
      {!fixed ? (
        <ToggleGroup type="single" value={who} onValueChange={(v) => v && setWho(v as Participant)} aria-label="Participant" className="justify-start">
          {PARTICIPANTS.map((x) => (
            <ToggleGroupItem key={x} value={x} size="sm" className="h-8 px-3 text-xs">
              {x}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      ) : null}

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Stat label="Index fut net" value={fmtContracts(f.net, true)} tone={toneClass(f.net)} hint={f.change ? `${arrow(f.change.net)} ${fmtContracts(f.change.net, true)} on day` : "No prior day"} />
        <Stat label="Index calls net" value={fmtContracts(c.net, true)} tone={toneClass(c.net)} hint={c.change ? `${arrow(c.change.net)} ${fmtContracts(c.change.net, true)} on day` : "No prior day"} />
        <Stat label="Index puts net" value={fmtContracts(p.net, true)} tone={toneClass(-p.net)} hint={p.change ? `${arrow(p.change.net)} ${fmtContracts(p.change.net, true)} on day` : "No prior day"} help="Net long puts is shown in red because buying puts is a bearish or hedging bet." />
        <Stat
          label="Net index direction"
          value={fmtContracts(view.indexDirection, true)}
          tone={toneClass(view.indexDirection)}
          hint={view.indexDirectionChange !== null ? `${arrow(view.indexDirectionChange)} ${fmtContracts(view.indexDirectionChange, true)} on day` : "Fut + calls − puts"}
          help="Net index futures + net index calls − net index puts, in contracts. A rough gauge of how long the index this participant is. It ignores strikes and deltas."
        />
      </div>

      <p className="text-body-sm text-muted-foreground">
        <span className="font-semibold text-foreground">{who}</span> is {optionsRead(c.net, p.net)}
      </p>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="min-w-0">
          <p className="mb-2 text-label uppercase text-muted-foreground">Index options book (contracts)</p>
          <div className="h-[220px]" role="img" aria-label={`${who} index options: call long ${fmtContractsFull(c.long)}, call short ${fmtContractsFull(c.short)}, put long ${fmtContractsFull(p.long)}, put short ${fmtContractsFull(p.short)}`}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={bars} margin={{ top: 6, right: 8, bottom: 0, left: -6 }}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="key" {...axisProps} interval={0} />
                <YAxis {...axisProps} width={52} tickFormatter={(v: number) => fmtContracts(v)} />
                <Tooltip contentStyle={tooltipStyle} labelStyle={tooltipLabelStyle} itemStyle={tooltipItemStyle} cursor={barCursor} formatter={(v: number) => [fmtContractsFull(v), "Contracts"]} />
                <Bar dataKey="value" radius={[4, 4, 0, 0]} isAnimationActive={false}>
                  {bars.map((b) => (
                    <Cell key={b.key} fill={b.color} fillOpacity={b.opacity} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-1 text-body-sm text-muted-foreground">Calls in the call colour, puts in the put colour; lighter bars are shorts.</p>
        </div>

        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-label uppercase text-muted-foreground">Net calls and puts over time</p>
            <div className="flex flex-wrap gap-3">
              <LegendDot color={chartColors.call} label="Calls net" />
              <LegendDot color={chartColors.put} label="Puts net" />
              <LegendDot color={PARTICIPANT_COLOR[who]} label="Direction" />
            </div>
          </div>
          {trend.length < 2 ? (
            <div className="flex h-[220px] items-center justify-center rounded-tile border border-dashed border-border text-body-sm text-muted-foreground">History builds up as more days load.</div>
          ) : (
            <div className="h-[220px]" role="img" aria-label={`${who} net index calls, puts and direction over ${trend.length} sessions`}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trend} margin={{ top: 6, right: 8, bottom: 0, left: -6 }}>
                  <CartesianGrid {...gridProps} />
                  <ReferenceLine y={0} stroke={tokenColor("muted-foreground", 0.6)} />
                  <XAxis dataKey="label" {...axisProps} interval="preserveStartEnd" minTickGap={18} />
                  <YAxis {...axisProps} width={52} tickFormatter={(v: number) => fmtContracts(v)} />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    labelStyle={tooltipLabelStyle}
                    itemStyle={tooltipItemStyle}
                    cursor={tooltipCursor}
                    formatter={(v: number, name: string) => [fmtContractsFull(v, true), name === "callNet" ? "Calls net" : name === "putNet" ? "Puts net" : "Direction"]}
                  />
                  <Line type="monotone" dataKey="callNet" stroke={chartColors.call} strokeWidth={1.75} dot={false} isAnimationActive={false} />
                  <Line type="monotone" dataKey="putNet" stroke={chartColors.put} strokeWidth={1.75} dot={false} isAnimationActive={false} />
                  <Line type="monotone" dataKey="direction" stroke={PARTICIPANT_COLOR[who]} strokeWidth={2} strokeDasharray="5 3" dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>
      <p className={cn("text-body-sm text-muted-foreground")}>Long calls and short puts profit when the index rises; short calls and long puts profit when it falls. Many option positions are hedges, so read these as tilts, not bets.</p>
    </div>
  );
}
