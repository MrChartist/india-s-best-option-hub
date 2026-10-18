import { useId, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  axisProps,
  barCursor,
  chartColors,
  gridProps,
  tokenColor,
  tooltipCursor,
  tooltipItemStyle,
  tooltipLabelStyle,
  tooltipStyle,
} from "@/lib/chartTheme";
import {
  PARTICIPANTS,
  indexDirection,
  productStats,
  type Participant,
  type ParticipantOIRow,
  type ParticipantView,
} from "@/lib/participantsApi";
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
  const callSide =
    callNet > 0 ? "net long calls (bullish)" : callNet < 0 ? "net short calls (bearish or income)" : "flat on calls";
  const putSide =
    putNet > 0
      ? "net long puts (bearish or hedged)"
      : putNet < 0
        ? "net short puts (bullish or income)"
        : "flat on puts";
  return `${callSide}, ${putSide}.`;
}

/** SVG hatch for short bars: a light wash of the series colour with 1.5px diagonal strokes. */
function HatchPattern({ id, color }: { id: string; color: string }) {
  return (
    <pattern id={id} width={6} height={6} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <rect width={6} height={6} fill={color} fillOpacity={0.16} />
      <line x1={0} y1={0} x2={0} y2={6} stroke={color} strokeWidth={1.5} />
    </pattern>
  );
}

export function PositioningChart({ views, history, initialParticipant = "FII", fixed = false }: Props) {
  const [who, setWho] = useState<Participant>(initialParticipant);
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const hatchCall = `hatch-call-${uid}`;
  const hatchPut = `hatch-put-${uid}`;
  const view = views.find((v) => v.participant === who);

  const bars = useMemo(() => {
    if (!view) return [];
    const c = view.products.optIdxCall;
    const p = view.products.optIdxPut;
    return [
      { key: "Call long", value: c.long, fill: chartColors.call, stroke: "none" },
      { key: "Call short", value: c.short, fill: `url(#${hatchCall})`, stroke: chartColors.call },
      { key: "Put long", value: p.long, fill: chartColors.put, stroke: "none" },
      { key: "Put short", value: p.short, fill: `url(#${hatchPut})`, stroke: chartColors.put },
    ];
  }, [view, hatchCall, hatchPut]);

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
        <ToggleGroup
          type="single"
          value={who}
          onValueChange={(v) => v && setWho(v as Participant)}
          aria-label="Participant"
          className="justify-start"
        >
          {PARTICIPANTS.map((x) => (
            <ToggleGroupItem key={x} value={x} size="sm">
              {x}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      ) : null}

      <div className="grid grid-cols-2 gap-2">
        <Stat
          label="Fut net"
          value={fmtContracts(f.net, true)}
          tone={toneClass(f.net)}
          hint={f.change ? `${arrow(f.change.net)} ${fmtContracts(f.change.net, true)} on day` : "No prior day"}
        />
        <Stat
          label="Calls net"
          value={fmtContracts(c.net, true)}
          tone={toneClass(c.net)}
          hint={c.change ? `${arrow(c.change.net)} ${fmtContracts(c.change.net, true)} on day` : "No prior day"}
        />
        <Stat
          label="Puts net"
          value={fmtContracts(p.net, true)}
          tone={toneClass(-p.net)}
          hint={p.change ? `${arrow(p.change.net)} ${fmtContracts(p.change.net, true)} on day` : "No prior day"}
          help="Net long puts is shown in red because buying puts is a bearish or hedging bet."
        />
        <Stat
          label="Direction"
          value={fmtContracts(view.indexDirection, true)}
          tone={toneClass(view.indexDirection)}
          hint={
            view.indexDirectionChange !== null
              ? `${arrow(view.indexDirectionChange)} ${fmtContracts(view.indexDirectionChange, true)} on day`
              : "Fut + calls − puts"
          }
          help="Net index futures + net index calls − net index puts, in contracts. A rough gauge of how long the index this participant is. It ignores strikes and deltas."
        />
      </div>

      <p className="text-body-sm text-muted-foreground">
        <span className="font-semibold text-foreground">{who}</span> is {optionsRead(c.net, p.net)}
      </p>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="min-w-0">
          <p className="mb-2 text-label text-muted-foreground">Index options book (contracts)</p>
          <div
            className="h-[220px]"
            role="img"
            aria-label={`${who} index options: call long ${fmtContractsFull(c.long)}, call short ${fmtContractsFull(c.short)}, put long ${fmtContractsFull(p.long)}, put short ${fmtContractsFull(p.short)}`}
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={bars} margin={{ top: 22, right: 8, bottom: 0, left: -6 }}>
                <defs>
                  <HatchPattern id={hatchCall} color={chartColors.call} />
                  <HatchPattern id={hatchPut} color={chartColors.put} />
                </defs>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="key" {...axisProps} interval={0} />
                <YAxis {...axisProps} width={52} tickFormatter={(v: number) => fmtContracts(v)} />
                <Tooltip
                  contentStyle={tooltipStyle}
                  labelStyle={tooltipLabelStyle}
                  itemStyle={tooltipItemStyle}
                  cursor={barCursor}
                  formatter={(v: number) => [fmtContractsFull(v), "Contracts"]}
                />
                <Bar dataKey="value" radius={[4, 4, 0, 0]} isAnimationActive={false}>
                  {bars.map((b) => (
                    <Cell key={b.key} fill={b.fill} stroke={b.stroke} strokeWidth={b.stroke === "none" ? 0 : 1.5} />
                  ))}
                  <LabelList
                    dataKey="value"
                    position="top"
                    offset={6}
                    fill={chartColors.foreground}
                    fontSize={11}
                    formatter={(v: number) => fmtContracts(v)}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-body-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <svg aria-hidden="true" width="14" height="10" className="shrink-0">
                <rect width="14" height="10" rx="2" fill={chartColors.call} />
              </svg>
              Solid bars are longs
            </span>
            <span className="inline-flex items-center gap-1.5">
              <svg aria-hidden="true" width="14" height="10" className="shrink-0">
                <defs>
                  <HatchPattern id={`${hatchCall}-key`} color={chartColors.muted} />
                </defs>
                <rect
                  width="14"
                  height="10"
                  rx="2"
                  fill={`url(#${hatchCall}-key)`}
                  stroke={chartColors.muted}
                  strokeWidth={1.5}
                />
              </svg>
              hatched bars are shorts
            </span>
            <span>Calls in the call colour, puts in the put colour.</span>
          </p>
        </div>

        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-label text-muted-foreground">Net calls and puts over time</p>
            <div className="flex flex-wrap gap-3">
              <LegendDot color={chartColors.call} label="Calls net" />
              <LegendDot color={chartColors.put} label="Puts net" />
              <LegendDot color={PARTICIPANT_COLOR[who]} label="Direction" />
            </div>
          </div>
          {trend.length < 2 ? (
            <div className="flex h-[220px] items-center justify-center rounded-tile bg-muted/40 text-body-sm text-muted-foreground">
              History builds up as more days load.
            </div>
          ) : (
            <div
              className="h-[220px]"
              role="img"
              aria-label={`${who} net index calls, puts and direction over ${trend.length} sessions`}
            >
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
                    formatter={(v: number, name: string) => [
                      fmtContractsFull(v, true),
                      name === "callNet" ? "Calls net" : name === "putNet" ? "Puts net" : "Direction",
                    ]}
                  />
                  <Line
                    type="monotone"
                    dataKey="callNet"
                    stroke={chartColors.call}
                    strokeWidth={1.75}
                    dot={false}
                    isAnimationActive={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="putNet"
                    stroke={chartColors.put}
                    strokeWidth={1.75}
                    dot={false}
                    isAnimationActive={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="direction"
                    stroke={PARTICIPANT_COLOR[who]}
                    strokeWidth={2}
                    strokeDasharray="5 3"
                    dot={false}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>
      <p className={cn("text-body-sm text-muted-foreground")}>
        Long calls and short puts profit when the index rises; short calls and long puts profit when it falls. Many
        option positions are hedges, so read these as tilts, not bets.
      </p>
    </div>
  );
}
