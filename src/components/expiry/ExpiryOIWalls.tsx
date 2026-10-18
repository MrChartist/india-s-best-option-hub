/** OI walls around ATM, max-pain and wall drift through the session, and derived DTE-0 prints. */
import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { BrickWall, Waves } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { axisProps, barCursor, chartColors, gridProps, legendStyle, tooltipCursor, tooltipItemStyle, tooltipLabelStyle, tooltipStyle } from "@/lib/chartTheme";
import { derivePrintsFromSeries, type FlowPrint } from "@/lib/flow";
import { formatCompactIN, formatINR, formatOI, formatPct, formatSigned, istDateString } from "@/lib/options";
import type { OptionData } from "@/lib/mockData";
import type { ChainSnapshot } from "@/lib/snapshotStore";
import { cn } from "@/lib/utils";
import { hhmmIST, nearestOf, oiChangeSince, oiWalls, wallDriftSeries, signTone } from "./expiryMath";
import { DerivedBadge, EmptyState, HelpTip, Panel, PanelSkeleton, SampleBadge, Stat } from "./ExpiryUi";
import type { SessionMode } from "./useExpirySession";

interface Props {
  chain: OptionData[];
  spot: number;
  snaps: ChainSnapshot[];
  mode: SessionMode;
  lotSize: number;
  expiry: string;
  loading?: boolean;
}

const PRINT_WINDOW = 240;

export function ExpiryOIWalls({ chain, spot, snaps, mode, lotSize, expiry, loading }: Props) {
  const sinceOpen = useMemo(() => oiChangeSince(snaps[0], snaps[snaps.length - 1]), [snaps]);
  const chainHasChange = useMemo(() => chain.some((r) => (r.ce?.oiChange ?? 0) !== 0 || (r.pe?.oiChange ?? 0) !== 0), [chain]);
  const walls = useMemo(() => oiWalls(chain, spot, 3), [chain, spot]);
  const drift = useMemo(() => wallDriftSeries(snaps, 90), [snaps]);

  const bars = useMemo(() => {
    const rows = chain.filter((r) => r.strikePrice > 0).sort((a, b) => a.strikePrice - b.strikePrice);
    if (rows.length === 0 || !(spot > 0)) return [];
    const atm = nearestOf(rows.map((r) => r.strikePrice), spot);
    const i = rows.findIndex((r) => r.strikePrice === atm);
    return rows.slice(Math.max(0, i - 10), i + 11).map((r) => ({ strike: r.strikePrice, ce: r.ce?.oi ?? 0, pe: r.pe?.oi ?? 0 }));
  }, [chain, spot]);

  const expiryToday = !!expiry && snaps.length > 0 && istDateString(new Date(snaps[snaps.length - 1].ts)) === expiry;
  const prints = useMemo<FlowPrint[]>(() => {
    if (snaps.length < 2 || !(lotSize > 0)) return [];
    const all = derivePrintsFromSeries(snaps.slice(-PRINT_WINDOW), lotSize);
    const scoped = expiryToday ? all.filter((p) => p.dte === 0) : all;
    return [...scoped].sort((a, b) => b.premium - a.premium).slice(0, 10);
  }, [snaps, lotSize, expiryToday]);

  if (loading) return <PanelSkeleton height={300} label="Loading OI walls" />;

  const wallChange = (strike: number, side: "CE" | "PE", fromChain: number) => (chainHasChange ? fromChain : sinceOpen.get(`${strike}|${side}`) ?? NaN);
  const spotStrike = bars.length > 0 ? nearestOf(bars.map((b) => b.strike), spot) : NaN;
  const mpInRange = bars.some((b) => b.strike === walls.maxPain);
  const mpDist = Number.isFinite(walls.maxPain) && spot > 0 ? ((spot - walls.maxPain) / spot) * 100 : NaN;
  const first = drift[0];
  const last = drift[drift.length - 1];

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Panel
        title={
          <>
            <BrickWall className="h-4 w-4 text-primary-ink" aria-hidden="true" />
            OI walls
            {mode === "sample" ? <SampleBadge /> : null}
          </>
        }
        subtitle="Largest call OI at or above ATM (resistance) and put OI at or below ATM (support)"
      >
        {chain.length === 0 ? (
          <EmptyState title="No chain loaded">OI walls appear once an option chain is available.</EmptyState>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              <Stat variant="inset" label="Call wall" value={Number.isFinite(walls.callWall) ? walls.callWall : "—"} tone="text-bearish" hint={walls.calls[0] ? `${formatOI(walls.calls[0].oi)} contracts` : undefined} />
              <Stat variant="inset" label="Put wall" value={Number.isFinite(walls.putWall) ? walls.putWall : "—"} tone="text-bullish" hint={walls.puts[0] ? `${formatOI(walls.puts[0].oi)} contracts` : undefined} />
              <Stat variant="inset"
                label="Max pain"
                value={Number.isFinite(walls.maxPain) ? walls.maxPain : "—"}
                hint={Number.isFinite(mpDist) ? `Spot ${formatPct(mpDist, { decimals: 2, signed: true })} away` : undefined}
                help="Strike where option buyers as a group would get the least at expiry. On expiry day spot often drifts towards it in quiet sessions, but it is not a target."
              />
              <Stat variant="inset" label="PCR (OI)" value={Number.isFinite(walls.pcr) ? walls.pcr.toFixed(2) : "—"} hint="Put OI ÷ call OI" />
            </div>

            <div className="mt-4 h-[260px] w-full" role="img" aria-label={`Call and put open interest by strike around ${spotStrike}. Call wall ${walls.callWall}, put wall ${walls.putWall}.`}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={bars} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barGap={1}>
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="strike" {...axisProps} interval="preserveStartEnd" minTickGap={16} />
                  <YAxis {...axisProps} width={48} tickFormatter={(v: number) => formatCompactIN(v, { decimals: 0 })} />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    labelStyle={tooltipLabelStyle}
                    itemStyle={tooltipItemStyle}
                    cursor={barCursor}
                    labelFormatter={(v: number) => `Strike ${v}`}
                    formatter={(value: number, name: string) => [`${formatOI(value)} contracts`, name]}
                  />
                  <Legend wrapperStyle={legendStyle} />
                  {Number.isFinite(spotStrike) ? <ReferenceLine x={spotStrike} stroke={chartColors.primary} strokeDasharray="4 4" label={{ value: "Spot", position: "insideTopRight", fill: chartColors.axis, fontSize: 10 }} /> : null}
                  {mpInRange ? <ReferenceLine x={walls.maxPain} stroke={chartColors.warning} strokeDasharray="2 3" label={{ value: "Max pain", position: "insideTopLeft", fill: chartColors.axis, fontSize: 10 }} /> : null}
                  <Bar dataKey="ce" name="CE OI (resistance)" fill={chartColors.call} radius={[3, 3, 0, 0]} isAnimationActive={false} />
                  <Bar dataKey="pe" name="PE OI (support)" fill={chartColors.put} radius={[3, 3, 0, 0]} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {(["CE", "PE"] as const).map((side) => {
                const list = side === "CE" ? walls.calls : walls.puts;
                return (
                  <div key={side}>
                    <p className={cn("mb-1 text-label ", side === "CE" ? "text-bearish" : "text-bullish")}>{side === "CE" ? "Call walls" : "Put walls"}</p>
                    <ul className="space-y-1">
                      {list.map((w) => {
                        const ch = wallChange(w.strike, side, w.oiChange);
                        return (
                          <li key={w.strike} className="flex items-center justify-between gap-2 rounded-chip bg-surface px-2 py-1 text-body-sm">
                            <span className="font-num tabular-nums font-semibold">{w.strike}</span>
                            <span className="font-num tabular-nums">{formatOI(w.oi)}</span>
                            <span className={cn("font-num tabular-nums", signTone(ch))} title={chainHasChange ? "OI change vs previous day" : "OI change since the first snapshot"}>
                              {Number.isFinite(ch) ? formatSigned(ch, 0) : "—"}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </Panel>

      <div className="grid gap-4">
        <Panel
          title={
            <>
              <Waves className="h-4 w-4 text-primary-ink" aria-hidden="true" />
              Max-pain and wall drift
              {mode === "sample" ? <SampleBadge /> : <DerivedBadge title="From snapshots" />}
            </>
          }
          subtitle={first && last ? `Max pain ${first.maxPain} → ${last.maxPain} since ${hhmmIST(first.ts)} IST` : "How the levels moved through the session"}
        >
          {drift.length < 2 ? (
            <EmptyState title="Not enough snapshots yet">Drift needs at least two recorded chains for this session.</EmptyState>
          ) : (
            <div className="h-[220px] w-full" role="img" aria-label={`Max pain moved from ${first?.maxPain} to ${last?.maxPain}; spot from ${first?.spot} to ${last?.spot}.`}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={drift} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="ts" type="number" scale="time" domain={["dataMin", "dataMax"]} tickFormatter={(v: number) => hhmmIST(v)} {...axisProps} minTickGap={28} />
                  <YAxis {...axisProps} width={56} domain={["auto", "auto"]} tickFormatter={(v: number) => v.toFixed(0)} />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    labelStyle={tooltipLabelStyle}
                    itemStyle={tooltipItemStyle}
                    cursor={tooltipCursor}
                    labelFormatter={(v: number) => `${hhmmIST(v)} IST`}
                    formatter={(value: number, name: string) => [Number.isFinite(value) ? value.toFixed(name === "Spot" ? 2 : 0) : "—", name]}
                  />
                  <Legend wrapperStyle={legendStyle} />
                  <Line type="stepAfter" dataKey="callWall" name="Call wall" stroke={chartColors.call} strokeWidth={1.25} dot={false} isAnimationActive={false} />
                  <Line type="stepAfter" dataKey="putWall" name="Put wall" stroke={chartColors.put} strokeWidth={1.25} dot={false} isAnimationActive={false} />
                  <Line type="stepAfter" dataKey="maxPain" name="Max pain" stroke={chartColors.warning} strokeWidth={1.75} strokeDasharray="5 3" dot={false} isAnimationActive={false} />
                  <Line type="linear" dataKey="spot" name="Spot" stroke={chartColors.primary} strokeWidth={2} dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </Panel>

        <Panel
          title={
            <>
              {expiryToday ? "DTE-0 prints" : "Biggest interval prints"}
              {mode === "sample" ? <SampleBadge /> : null}
              <DerivedBadge title="Derived" hint="Built from the change in volume and OI between two chain snapshots. NSE does not publish trade-level data." />
            </>
          }
          subtitle={expiryToday ? "Largest premium intervals in contracts expiring today" : "Not an expiry day for this contract, so all intervals of the selected expiry are shown"}
          bodyClassName="p-0"
        >
          {prints.length === 0 ? (
            <div className="p-4">
              <EmptyState title="No prints yet">Prints appear when two snapshots a few seconds to 30 minutes apart show new volume.</EmptyState>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead scope="col" className="pl-4">Time</TableHead>
                    <TableHead scope="col">Contract</TableHead>
                    <TableHead scope="col" className="text-right">Contracts</TableHead>
                    <TableHead scope="col" className="text-right">Premium</TableHead>
                    <TableHead scope="col" className="hidden sm:table-cell">Side</TableHead>
                    <TableHead scope="col" className="pr-4">
                      <span className="inline-flex items-center gap-1">Tag <HelpTip text="Opening when OI rose with the volume, closing when OI fell. Side is inferred from where LTP sat in the bid-ask spread." label="About tags" /></span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {prints.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="pl-4 font-num tabular-nums text-muted-foreground">{hhmmIST(p.ts)}</TableCell>
                      <TableCell className="whitespace-nowrap font-num tabular-nums">
                        {p.strike} <Badge variant={p.type === "CE" ? "bearish" : "bullish"} className="ml-1">{p.type}</Badge>
                      </TableCell>
                      <TableCell className="text-right font-num tabular-nums">{formatCompactIN(p.dVol, { decimals: 1 })}</TableCell>
                      <TableCell className="text-right font-num tabular-nums">{formatCompactIN(p.premium, { decimals: 2, symbol: true })}</TableCell>
                      <TableCell className="hidden sm:table-cell">
                        <Badge variant={p.aggressor === "ASK" ? "info" : p.aggressor === "BID" ? "warning" : "neutral"}>{p.aggressor === "ASK" ? "Bought" : p.aggressor === "BID" ? "Sold" : "Mid"}</Badge>
                      </TableCell>
                      <TableCell className="pr-4">
                        <Badge variant={p.tag === "OPENING" ? "default" : p.tag === "CLOSING" ? "neutral" : "outline"}>{p.tag === "UNKNOWN" ? "—" : p.tag.toLowerCase()}</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <p className="px-4 py-2 text-body-sm text-muted-foreground">Premium = contracts × LTP × lot size ({lotSize > 0 ? lotSize : "—"}). Interval aggregates, not single trades. {formatINR(prints.reduce((s, p) => s + p.premium, 0), { decimals: 0 })} across these rows.</p>
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}
