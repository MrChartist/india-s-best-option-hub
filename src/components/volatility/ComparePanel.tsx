import { useCallback, useEffect, useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ArrowDown, ArrowUp, ArrowUpDown, Columns3, GitCompareArrows, Plus, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollRegion } from "@/components/ScrollRegion";
import { axisProps, chartColors, gridProps, tokenColor, tooltipCursor, tooltipLabelStyle, tooltipStyle } from "@/lib/chartTheme";
import { dteLabel, formatDateIST, formatNumberIN, formatPct } from "@/lib/options";
import { COMPARE_INDICES, MAX_COMPARE_STOCKS, sortCompareRows, type CompareRow, type CompareSortKey } from "@/lib/volatility/compare";
import { SCREENER_STOCKS } from "@/lib/volatility/screener";
import { fmtVol, fmtVolPts } from "@/lib/volatility/format";
import { cn } from "@/lib/utils";
import { DataState, DerivedBadge, EmptyState, HelpTip, LegendChip, PanelHeader, SampleBadge, SampleWatermark, StatTile } from "./VolUi";
import { useCompareRow, useIvSpread } from "./useVolatility";

export interface ComparePanelProps {
  stocks: string[];
  onStocksChange: (stocks: string[]) => void;
  onSelectSymbol: (symbol: string) => void;
}

interface RowState {
  row: CompareRow | null;
  loading: boolean;
  error: boolean;
  basisLabel: string;
}

/** Loads one symbol and reports it upward, so the parent can sort the whole table. */
function RowLoader({ symbol, onData }: { symbol: string; onData: (symbol: string, s: RowState) => void }) {
  const r = useCompareRow(symbol);
  useEffect(() => {
    onData(symbol, { row: r.row, loading: r.isLoading, error: r.isError, basisLabel: r.basisLabel });
  }, [symbol, r.row, r.isLoading, r.isError, r.basisLabel, onData]);
  return null;
}

const COLUMNS: Array<{ key: CompareSortKey; label: string; help?: string }> = [
  { key: "symbol", label: "Symbol" },
  { key: "atmIv", label: "ATM IV", help: "ATM implied volatility of the front expiry at least two days out, solved with Black-76 on the parity forward." },
  { key: "ivPercentile", label: "IVP", help: "IV percentile: share of the last year's days with lower 30-day IV. NIFTY uses India VIX when available; others use bhavcopy IV30." },
  { key: "pcr", label: "PCR", help: "Put OI ÷ call OI for the front expiry." },
  { key: "maxPainDistPct", label: "Max pain", help: "Distance from spot to the front expiry's max-pain strike." },
  { key: "emPct", label: "Expected move", help: "Front-expiry move with its method tag: IV 1σ is the one-standard-deviation band from ATM IV; Straddle ×0.85 is used when IV is unavailable." },
  { key: "straddlePct", label: "Straddle", help: "ATM straddle premium as a share of spot." },
];

const n0 = (v: number) => formatNumberIN(v, 0);

export function ComparePanel({ stocks, onStocksChange, onSelectSymbol }: ComparePanelProps) {
  const symbols = useMemo(() => [...COMPARE_INDICES, ...stocks], [stocks]);
  const [state, setState] = useState<Record<string, RowState>>({});
  const [sort, setSort] = useState<{ key: CompareSortKey; dir: "asc" | "desc" } | null>(null);
  const onData = useCallback((symbol: string, s: RowState) => setState((prev) => (prev[symbol] === s ? prev : { ...prev, [symbol]: s })), []);

  const rows = useMemo(() => symbols.map((s) => state[s]?.row).filter((r): r is CompareRow => !!r), [symbols, state]);
  const ordered = useMemo(() => {
    if (!sort) return symbols;
    const sorted = sortCompareRows(rows, sort.key, sort.dir).map((r) => r.symbol);
    return [...sorted, ...symbols.filter((s) => !sorted.includes(s))];
  }, [sort, rows, symbols]);
  const anySample = rows.some((r) => r.sample || r.historySample);
  const loadingCount = symbols.filter((s) => !state[s] || state[s].loading).length;
  const available = SCREENER_STOCKS.filter((s) => !stocks.includes(s));

  const toggleSort = (key: CompareSortKey) =>
    setSort((cur) => (!cur || cur.key !== key ? { key, dir: key === "symbol" ? "asc" : "desc" } : cur.dir === "desc" ? { key, dir: "asc" } : null));

  return (
    <div className="space-y-4">
      {symbols.map((s) => (
        <RowLoader key={s} symbol={s} onData={onData} />
      ))}

      <Card>
        <PanelHeader
          icon={Columns3}
          title="Compare symbols"
          subtitle="Front-expiry volatility, positioning and expected move side by side. Select a symbol to open its full analysis."
          right={anySample ? <SampleBadge /> : <DerivedBadge />}
        />
        <CardContent className="space-y-3 p-4 pt-0">
          <div className="flex flex-wrap items-center gap-2">
            {stocks.map((s) => (
              <Badge key={s} variant="outline" className="h-7 gap-1 pl-2 pr-1 text-xs normal-case">
                {s}
                <button
                  type="button"
                  onClick={() => onStocksChange(stocks.filter((x) => x !== s))}
                  aria-label={`Remove ${s}`}
                  className="inline-flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:shadow-ember focus-visible:outline-none"
                >
                  <X className="h-3 w-3" aria-hidden="true" />
                </button>
              </Badge>
            ))}
            {stocks.length < MAX_COMPARE_STOCKS ? (
              <Select value="" onValueChange={(v) => v && onStocksChange([...stocks, v])}>
                <SelectTrigger className="h-8 w-[160px]" aria-label="Add a stock to compare">
                  <span className="flex items-center gap-1.5 text-body-sm">
                    <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                    <SelectValue placeholder="Add stock" />
                  </span>
                </SelectTrigger>
                <SelectContent>
                  {available.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <span className="text-body-sm text-muted-foreground">Up to {MAX_COMPARE_STOCKS} stocks.</span>
            )}
            {loadingCount > 0 ? (
              <span className="text-body-sm text-muted-foreground" aria-live="polite">
                Loading {loadingCount} of {symbols.length}…
              </span>
            ) : null}
          </div>

          <ScrollRegion label="Volatility comparison table" className="rounded-tile border border-border">
            <table className="w-full min-w-[760px] border-collapse text-body-sm">
              <caption className="sr-only">Volatility comparison across symbols{anySample ? " (includes sample data)" : ""}</caption>
              <thead>
                <tr className="border-b border-border">
                  {COLUMNS.map((c) => {
                    const active = sort?.key === c.key;
                    const Icon = !active ? ArrowUpDown : sort?.dir === "asc" ? ArrowUp : ArrowDown;
                    return (
                      <th
                        key={c.key}
                        scope="col"
                        aria-sort={active ? (sort?.dir === "asc" ? "ascending" : "descending") : "none"}
                        className={cn(
                          "px-2 py-2 text-label uppercase text-muted-foreground",
                          c.key === "symbol" ? "sticky left-0 z-[1] bg-card pl-3 text-left" : "text-right",
                        )}
                      >
                        <span className={cn("inline-flex items-center gap-1", c.key !== "symbol" && "justify-end")}>
                          <button
                            type="button"
                            onClick={() => toggleSort(c.key)}
                            className="inline-flex items-center gap-1 rounded-sm uppercase hover:text-foreground focus-visible:shadow-ember focus-visible:outline-none"
                          >
                            {c.label}
                            <Icon className={cn("h-3 w-3", active ? "text-foreground" : "opacity-50")} aria-hidden="true" />
                          </button>
                          {c.help ? <HelpTip text={c.help} label={`About ${c.label}`} /> : null}
                        </span>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {ordered.map((sym) => {
                  const st = state[sym];
                  const r = st?.row ?? null;
                  return (
                    <tr key={sym} className="border-b border-border/60 last:border-0 hover:bg-accent/40">
                      <th scope="row" className="sticky left-0 z-[1] bg-card px-3 py-2 text-left font-medium">
                        <button
                          type="button"
                          onClick={() => onSelectSymbol(sym)}
                          className="rounded-sm font-semibold hover:underline focus-visible:shadow-ember focus-visible:outline-none"
                        >
                          {sym}
                        </button>
                        <span className="block text-micro text-muted-foreground">
                          {r ? `${formatDateIST(r.expiry)} · ${dteLabel(r.expiry)}` : st?.loading !== false ? "Loading…" : "No usable chain"}
                        </span>
                        {r?.sample ? <span className="text-micro uppercase text-warning">Sample</span> : null}
                      </th>
                      {!r ? (
                        <td colSpan={COLUMNS.length - 1} className="px-2 py-2 text-right text-muted-foreground">
                          {st?.loading !== false ? "…" : "Chain unavailable for this symbol right now."}
                        </td>
                      ) : (
                        <>
                          <td className="px-2 py-2 text-right tabular-nums">
                            <span className="font-semibold">{fmtVol(r.atmIv)}</span>
                            <span className="block text-micro text-muted-foreground">RR25 {fmtVolPts(r.rr25)}</span>
                          </td>
                          <td className="px-2 py-2 text-right tabular-nums" title={st?.basisLabel ? `Basis: ${st.basisLabel}` : undefined}>
                            {r.ivPercentile === null ? (
                              <span className="text-muted-foreground">—</span>
                            ) : (
                              <span className={r.ivPercentile > 70 ? "text-bearish" : r.ivPercentile < 25 ? "text-bullish" : undefined}>{formatNumberIN(r.ivPercentile, 0)}</span>
                            )}
                            <span className="block text-micro text-muted-foreground">
                              {r.historySample ? "sample history" : r.ivRank === null ? "no history" : `IVR ${formatNumberIN(r.ivRank, 0)}`}
                            </span>
                          </td>
                          <td className={cn("px-2 py-2 text-right tabular-nums", Number.isFinite(r.pcr) && (r.pcr > 1.2 ? "text-bullish" : r.pcr < 0.7 ? "text-bearish" : undefined))}>
                            {Number.isFinite(r.pcr) ? r.pcr.toFixed(2) : "—"}
                          </td>
                          <td className="px-2 py-2 text-right tabular-nums">
                            {Number.isFinite(r.maxPainDistPct) ? formatPct(r.maxPainDistPct, { decimals: 1, signed: true }) : "—"}
                            <span className="block text-micro text-muted-foreground">{Number.isFinite(r.maxPain) ? n0(r.maxPain) : ""}</span>
                          </td>
                          <td className="px-2 py-2 text-right tabular-nums">
                            {Number.isFinite(r.em.move) ? `±${n0(r.em.move)}` : "—"} <span className="text-muted-foreground">({formatPct(r.em.pct, { decimals: 2 })})</span>
                            <span className="block text-micro text-muted-foreground">{r.em.label}</span>
                          </td>
                          <td className="px-2 py-2 text-right tabular-nums">
                            {formatPct(r.straddlePct, { decimals: 2 })}
                            <span className="block text-micro text-muted-foreground">{Number.isFinite(r.straddle) ? `₹${formatNumberIN(r.straddle, 0)}` : ""}</span>
                          </td>
                        </>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </ScrollRegion>
          <p className="text-body-sm text-muted-foreground">
            IVP colours: red above 70 (rich), green below 25 (cheap). PCR above 1.2 shaded green, below 0.7 red, following the usual contrarian reading. Educational, not a signal.
          </p>
        </CardContent>
      </Card>

      <IvSpreadCard />
    </div>
  );
}

function IvSpreadCard() {
  const { series, isSample, isLoading } = useIvSpread("NIFTY", "BANKNIFTY");
  const rows = useMemo(() => series.rows.slice(-252), [series.rows]);
  const band = Number.isFinite(series.mean) && Number.isFinite(series.sd) ? [series.mean - series.sd, series.mean + series.sd] : null;
  return (
    <Card>
      <PanelHeader
        icon={GitCompareArrows}
        title="BANKNIFTY − NIFTY IV spread"
        subtitle="Daily 30-day ATM IV of BANKNIFTY minus NIFTY. Shaded: mean ± 1 standard deviation."
        right={isSample ? <SampleBadge /> : <DerivedBadge />}
      />
      <CardContent className="space-y-3 p-4 pt-0">
        <DataState status={isLoading ? "loading" : "live"} minHeight={220} lines={4}>
          {rows.length < 2 ? (
            <EmptyState
              icon={GitCompareArrows}
              title="Not enough shared history"
              body="Build IV history for both NIFTY and BANKNIFTY with the bhavcopy backfill on the Overview tab (select each symbol in turn)."
            />
          ) : (
            <>
              <div className="grid grid-cols-3 gap-2">
                <StatTile label="Spread now" value={fmtVolPts(series.last)} sub={isSample ? "sample" : rows[rows.length - 1]?.date ? formatDateIST(rows[rows.length - 1].date) : undefined} />
                <StatTile label="Average" value={fmtVolPts(series.mean)} sub={`${rows.length} days`} />
                <StatTile
                  label="Z-score"
                  value={Number.isFinite(series.z) ? series.z.toFixed(2) : "—"}
                  tone={!Number.isFinite(series.z) ? "muted" : Math.abs(series.z) >= 2 ? "warning" : "default"}
                  help="How many standard deviations today's spread is from its average. Beyond ±2 is unusual and often mean-reverts."
                />
              </div>
              <div className="relative h-[240px]" role="img" aria-label={`BANKNIFTY minus NIFTY implied volatility spread${isSample ? " (sample data)" : ""}`}>
                {isSample ? <SampleWatermark /> : null}
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={rows} margin={{ top: 12, right: 12, bottom: 0, left: 0 }}>
                    <CartesianGrid {...gridProps} />
                    <XAxis dataKey="date" {...axisProps} tickFormatter={(d: string) => formatDateIST(d).split(" ").slice(0, 2).join(" ")} minTickGap={36} />
                    <YAxis {...axisProps} width={44} domain={["auto", "auto"]} tickFormatter={(v: number) => `${v > 0 ? "+" : ""}${v}`} />
                    <Tooltip
                      contentStyle={tooltipStyle}
                      labelStyle={tooltipLabelStyle}
                      cursor={tooltipCursor}
                      labelFormatter={(l: string) => formatDateIST(l)}
                      formatter={(v: number, name: string) => [name === "Spread" ? fmtVolPts(v, 2) : fmtVol(v, 2), name]}
                    />
                    {band ? <ReferenceArea y1={band[0]} y2={band[1]} fill={tokenColor("chart-2", 0.1)} stroke="none" ifOverflow="extendDomain" /> : null}
                    {Number.isFinite(series.mean) ? <ReferenceLine y={series.mean} stroke={chartColors.muted} strokeDasharray="4 4" /> : null}
                    <Line dataKey="spread" name="Spread" stroke={chartColors.iv} strokeWidth={1.75} dot={false} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div className="flex flex-wrap gap-4">
                <LegendChip color={chartColors.iv} label="BANKNIFTY − NIFTY (vol points)" />
                <LegendChip color={chartColors.muted} label="Average" dashed />
              </div>
            </>
          )}
        </DataState>
      </CardContent>
    </Card>
  );
}
