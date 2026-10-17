/**
 * Results: implied vs realised move. For F&O stocks reporting soon, how big a move the ATM straddle
 * priced before past results and how big the move really was, with the headline "straddle
 * overpriced X% of the time". NSE bhavcopy through the proxy, or a labelled sample.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { BarChart3, Loader2, SearchX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { axisProps, barCursor, chartColors, gridProps, legendStyle, tooltipItemStyle, tooltipLabelStyle, tooltipStyle } from "@/lib/chartTheme";
import { DASH, formatDateIST, formatINR, formatPct, formatStrike, getContractSpec } from "@/lib/options";
import { eventLinks, fnoStocks, overpricedVerdict, resultsQuarterFor, type EventMoveStats, type MarketEvent } from "@/lib/events";
import { cn } from "@/lib/utils";
import { EmptyState, EventsPanel, HelpTip, LiveBadge, SampleBadge, StatTile } from "./EventsUi";
import { useResultsMoves, type ResultsMovesData } from "./useResultsMoves";

const pct = (v: number, d = 1) => (Number.isFinite(v) ? formatPct(v, { decimals: d }) : DASH);
const signedPct = (v: number, d = 1) => (Number.isFinite(v) ? formatPct(v, { decimals: d, signed: true }) : DASH);
const shortDate = (d: string) => formatDateIST(d).replace(/ \d{4}$/, (y) => ` ’${y.trim().slice(2)}`);

/** Horizontal scroller with a right-edge fade while more columns are hidden. */
function ScrollTable({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setMore(el.scrollWidth - el.clientWidth - el.scrollLeft > 2);
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null;
    ro?.observe(el);
    if (el.firstElementChild) ro?.observe(el.firstElementChild);
    return () => {
      el.removeEventListener("scroll", update);
      ro?.disconnect();
    };
  }, []);
  return (
    <div className="relative min-w-0 rounded-tile border border-border">
      <div ref={ref} className="overflow-x-auto rounded-tile">
        {children}
      </div>
      <div
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute inset-y-0 right-0 w-8 rounded-r-tile bg-gradient-to-l from-card to-transparent transition-opacity",
          more ? "opacity-100" : "opacity-0",
        )}
      />
    </div>
  );
}

const METHOD_NOTE = {
  term: "event window isolated with the next expiry's IV",
  post: "event window isolated with the post-results IV",
  straddle: "full straddle to expiry (time value not removed)",
} as const;

function verdictTone(s: EventMoveStats | null | undefined): string {
  if (!s || s.n < 4) return "text-muted-foreground";
  if (s.unisolatedCount * 2 > s.n) return "text-muted-foreground";
  if (s.overpricedPct >= 55) return "text-bearish";
  if (s.overpricedPct <= 45) return "text-bullish";
  return "text-foreground";
}

function ModeBadge({ data }: { data: ResultsMovesData | undefined }) {
  if (!data) return null;
  return data.mode === "sample" ? (
    <SampleBadge tip={<>Simulated results moves for illustration, not market data. {data.reason}.</>} />
  ) : (
    <LiveBadge label="NSE bhavcopy" tip={`Measured from NSE F&O bhavcopy closes around ${data.answered} of ${data.requested} past results dates.`} />
  );
}

/** One upcoming-results row with its historical stats (auto in sample mode, on demand when live). */
function UpcomingRow({
  event,
  today,
  liveEvents,
  selected,
  onSelect,
}: {
  event: MarketEvent;
  today: string;
  liveEvents: MarketEvent[] | null;
  selected: boolean;
  onSelect: (s: string) => void;
}) {
  const sym = event.symbol ?? "";
  const [requested, setRequested] = useState(false);
  const q = useResultsMoves({ symbol: sym, today, liveEvents, enabled: !liveEvents || requested || selected });
  const s = q.data?.stats;
  const links = eventLinks(event, today);
  return (
    <TableRow data-state={selected ? "selected" : undefined} className={cn(selected && "bg-wash-brand/50")}>
      <TableCell className="whitespace-nowrap font-num tabular-nums">{shortDate(event.date)}</TableCell>
      <TableCell className="min-w-[8rem]">
        <button
          type="button"
          onClick={() => onSelect(sym)}
          aria-pressed={selected}
          className="text-left font-semibold text-foreground underline-offset-2 hover:text-primary-ink hover:underline focus-visible:shadow-ember focus-visible:outline-none"
        >
          {sym}
        </button>
        <span className="block text-micro uppercase text-muted-foreground">
          {resultsQuarterFor(event.date)}
          {event.source === "sample" ? " · sample date" : ""}
        </span>
      </TableCell>
      {q.data && s ? (
        <>
          <TableCell className={cn("text-right font-num font-semibold tabular-nums", verdictTone(s))} title={overpricedVerdict(s)}>
            {pct(s.overpricedPct, 0)}
            <span className="block text-micro font-normal uppercase text-muted-foreground">
              {s.overpricedCount}/{s.n}
              {q.data.mode === "sample" ? " · sample" : ""}
            </span>
          </TableCell>
          <TableCell className="text-right font-num tabular-nums">±{pct(s.avgImpliedPct)}</TableCell>
          <TableCell className="text-right font-num tabular-nums">±{pct(s.avgRealisedPct)}</TableCell>
          <TableCell className={cn("hidden text-right font-num tabular-nums md:table-cell", s.avgStraddlePnlPct < 0 ? "text-bearish" : "text-bullish")}>{signedPct(s.avgStraddlePnlPct, 0)}</TableCell>
        </>
      ) : q.isFetching ? (
        <TableCell colSpan={4} className="text-right text-body-sm text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            Reading bhavcopy…
          </span>
        </TableCell>
      ) : (
        <TableCell colSpan={4} className="text-right">
          <Button size="sm" variant="outline" className="h-7 text-body-sm" onClick={() => setRequested(true)} aria-label={`Load results history for ${sym}`}>
            Load history
          </Button>
        </TableCell>
      )}
      <TableCell className="hidden text-right lg:table-cell">
        {links.length ? (
          <span className="inline-flex gap-2">
            {links.map((l) => (
              <Link key={l.label} to={l.href} title={l.title} className="text-body-sm font-medium text-primary-ink underline-offset-2 hover:underline focus-visible:shadow-ember focus-visible:outline-none">
                {l.label}
              </Link>
            ))}
          </span>
        ) : (
          <span className="text-muted-foreground">{DASH}</span>
        )}
      </TableCell>
    </TableRow>
  );
}

interface ChartRow {
  label: string;
  implied: number;
  realised: number;
}

function MovesChart({ data }: { data: ResultsMovesData }) {
  const rows: ChartRow[] = useMemo(
    () =>
      [...data.observations].reverse().map((o) => ({
        label: resultsQuarterFor(o.eventDate),
        implied: Math.round(o.impliedMovePct * 100) / 100,
        realised: Math.round(o.realisedMovePct * 100) / 100,
      })),
    [data.observations],
  );
  return (
    <figure className="min-w-0" aria-label={`Implied versus realised results moves for ${data.symbol}`}>
      <div className="h-[230px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 8, right: 4, left: -12, bottom: 0 }} barGap={2}>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="label" {...axisProps} interval="preserveStartEnd" minTickGap={6} tick={{ ...axisProps.tick, fontSize: 10 }} />
            <YAxis {...axisProps} tickFormatter={(v: number) => `${v}%`} width={44} />
            <Tooltip
              cursor={barCursor}
              contentStyle={tooltipStyle}
              labelStyle={tooltipLabelStyle}
              itemStyle={tooltipItemStyle}
              formatter={(v: number, name: string) => [`±${formatPct(v, { decimals: 2 })}`, name]}
            />
            <Legend wrapperStyle={legendStyle} iconType="square" iconSize={9} />
            <Bar dataKey="implied" name="Implied (event window)" fill={chartColors.iv} radius={[3, 3, 0, 0]} maxBarSize={22} isAnimationActive={false} />
            <Bar dataKey="realised" name="Realised" fill={chartColors.primary} radius={[3, 3, 0, 0]} maxBarSize={22} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <figcaption className="mt-1 text-body-sm text-muted-foreground">Oldest to newest. A navy bar taller than the orange one means the straddle priced a bigger move than the stock made.</figcaption>
    </figure>
  );
}

function SymbolDetail({ symbol, today, liveEvents }: { symbol: string; today: string; liveEvents: MarketEvent[] | null }) {
  const q = useResultsMoves({ symbol, today, liveEvents, enabled: true });
  const name = getContractSpec(symbol)?.name;
  if (q.isLoading || (q.isFetching && !q.data)) {
    return (
      <div className="space-y-3" role="status" aria-busy="true" aria-label={`Loading ${symbol} results history`}>
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4 2xl:grid-cols-2">
          {["overpriced", "implied", "realised", "pnl"].map((k) => (
            <Skeleton key={k} className="h-[74px]" />
          ))}
        </div>
        <Skeleton className="h-[230px]" />
        <p className="text-body-sm text-muted-foreground">Reading NSE bhavcopy around each past results date. Each day is a large archive, so this can take a minute.</p>
      </div>
    );
  }
  if (q.isError || !q.data) {
    return (
      <EmptyState icon={<SearchX className="h-6 w-6" aria-hidden="true" />} title="Could not load results history" action={<Button size="sm" variant="outline" onClick={() => void q.refetch()}>Try again</Button>}>
        Something went wrong while reading the archives.
      </EmptyState>
    );
  }
  const d = q.data;
  const s = d.stats;
  if (!s) {
    return (
      <EmptyState icon={<SearchX className="h-6 w-6" aria-hidden="true" />} title={`No results history for ${symbol}`}>
        No past results with a tradable straddle were found.
      </EmptyState>
    );
  }
  return (
    <div className="min-w-0 space-y-4" data-testid="results-detail">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-display text-lead font-bold">
          {symbol}
          {name ? <span className="ml-1.5 text-body font-normal text-muted-foreground">{name}</span> : null}
        </h3>
        <ModeBadge data={d} />
      </div>
      {d.mode === "sample" && d.reason ? <p className="rounded-chip border border-warning/30 bg-wash-warning px-2.5 py-1.5 text-body-sm text-foreground">{d.reason}. The figures below are simulated.</p> : null}
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4 2xl:grid-cols-2">
        <StatTile
          label="Straddle overpriced"
          value={pct(s.overpricedPct, 0)}
          hint={`${s.overpricedCount} of ${s.n} · ${overpricedVerdict(s)}`}
          tone={verdictTone(s)}
          help="Share of past results where the stock's two-session move was smaller than the move the options priced for that window: the ATM straddle with the time value left after the reaction removed."
          className="col-span-2 lg:col-span-1 2xl:col-span-1"
        />
        <StatTile label="Avg implied" value={`±${pct(s.avgImpliedPct)}`} hint={`Median realised/implied ${Number.isFinite(s.medianRatio) ? s.medianRatio.toFixed(2) : DASH}×`} help={`Mean move the options priced for the two sessions around the results, as an expected absolute move. The straddle's total variance to expiry minus the ex-event variance still left after the reaction, so ordinary time value to expiry (median ${Number.isFinite(s.medianDte) ? Math.round(s.medianDte) : DASH} days) is not counted as event premium.`} />
        <StatTile label="Avg realised" value={`±${pct(s.avgRealisedPct)}`} hint={`Largest ±${pct(s.maxRealisedPct)}`} help="Mean absolute close-to-close move from the session before to the session after the results." />
        <StatTile
          label="Long straddle P&L"
          value={signedPct(s.avgStraddlePnlPct, 0)}
          tone={s.avgStraddlePnlPct < 0 ? "text-bearish" : "text-bullish"}
          hint={Number.isFinite(s.sellerWinPct) ? `Sellers won ${pct(s.sellerWinPct, 0)} of events` : undefined}
          help="Average change in the same straddle (same strike and expiry) from the close before to the close after the results: what a buyer made, before costs. IV crush usually makes this negative."
        />
      </div>
      {s.unisolatedCount > 0 ? (
        <p className="rounded-chip border border-warning/30 bg-wash-warning px-2.5 py-1.5 text-body-sm text-foreground">
          {s.unisolatedCount} of {s.n} events had no ex-event IV, so their implied move is the full straddle to expiry and leans towards &ldquo;overpriced&rdquo;.
        </p>
      ) : null}
      <MovesChart data={d} />
      <ScrollTable>
        <Table>
          <caption className="sr-only">{`${symbol} past results: implied and realised moves`}</caption>
          <TableHeader>
            <TableRow>
              <TableHead>Results</TableHead>
              <TableHead className="text-right">Straddle before</TableHead>
              <TableHead className="text-right">Implied (window)</TableHead>
              <TableHead className="text-right">Move</TableHead>
              <TableHead className="text-right">Straddle P&amp;L</TableHead>
              <TableHead className="text-right">Verdict</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {d.observations.map((o) => (
              <TableRow key={o.eventDate}>
                <TableCell className="whitespace-nowrap">
                  <span className="font-num tabular-nums">{shortDate(o.eventDate)}</span>
                  <span className="block text-micro uppercase text-muted-foreground">
                    {resultsQuarterFor(o.eventDate)} · {formatStrike(o.strike)} · exp {shortDate(o.expiry)} · {o.dte}d
                  </span>
                </TableCell>
                <TableCell className="whitespace-nowrap text-right font-num tabular-nums">
                  {formatINR(o.straddlePre, { decimals: 2 })}
                  <span className="block text-micro text-muted-foreground">±{pct(o.straddleMovePct)} to expiry</span>
                </TableCell>
                <TableCell className="text-right font-num tabular-nums" title={METHOD_NOTE[o.impliedMethod]}>
                  ±{pct(o.impliedMovePct)}
                  {o.impliedMethod === "straddle" ? <span className="block text-micro text-warning">not isolated</span> : null}
                </TableCell>
                <TableCell className={cn("text-right font-num tabular-nums", o.signedMovePct >= 0 ? "text-bullish" : "text-bearish")}>{signedPct(o.signedMovePct)}</TableCell>
                <TableCell className={cn("text-right font-num tabular-nums", o.straddlePnlPct < 0 ? "text-bearish" : "text-bullish")}>{signedPct(o.straddlePnlPct, 0)}</TableCell>
                <TableCell className="whitespace-nowrap text-right text-body-sm">{o.overpriced ? <span className="text-bearish">Overpriced</span> : <span className="text-bullish">Underpriced</span>}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </ScrollTable>
    </div>
  );
}

export interface ResultsMovePanelProps {
  /** Upcoming results events (any source), oldest first. */
  upcoming: MarketEvent[];
  today: string;
  /** Live NSE calendar events, or null when the calendar is sample. */
  liveEvents: MarketEvent[] | null;
  /** Initial stock (e.g. the page's symbol filter). */
  initialSymbol?: string;
}

const PAGE = 10;

export function ResultsMovePanel({ upcoming, today, liveEvents, initialSymbol }: ResultsMovePanelProps) {
  const fnoUpcoming = useMemo(() => upcoming.filter((e) => e.kind === "results" && e.fno && e.symbol && e.date >= today), [upcoming, today]);
  const stocks = useMemo(() => fnoStocks(), []);
  const [picked, setPicked] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const fallback = initialSymbol && stocks.includes(initialSymbol) ? initialSymbol : fnoUpcoming[0]?.symbol ?? "RELIANCE";
  const symbol = picked ?? fallback;
  const rows = showAll ? fnoUpcoming : fnoUpcoming.slice(0, PAGE);

  return (
    <EventsPanel
      id="results-moves"
      title={
        <>
          <BarChart3 className="h-4 w-4 text-primary-ink" aria-hidden="true" />
          Results: implied vs realised move
          <HelpTip
            label="How these numbers are worked out"
            text={
              <>
                Implied move = the move the ATM straddle (nearest expiry still alive after the reaction) priced for the two sessions around the results: its total implied variance minus the ex-event variance left after the reaction (from the next expiry&apos;s IV, or the post-results IV), as an expected absolute move. Stock options are monthly, so the raw straddle ÷ spot also holds weeks of ordinary time value; that is shown separately and not counted as event premium. Realised move = the close-to-close move from that session to the first session after the results date, which covers announcements before, during or after market hours. Overpriced = realised smaller than implied.
              </>
            }
          />
        </>
      }
      subtitle={liveEvents ? "Past quarters from NSE F&O bhavcopy. Live mode loads history on demand because each trading day is a large archive." : "Sample mode: dates and moves are simulated for illustration."}
      actions={
        <Select value={symbol} onValueChange={(v) => setPicked(v)}>
          <SelectTrigger className="h-8 w-[170px]" aria-label="Stock to analyse">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="max-h-72">
            {stocks.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      }
      bodyClassName="grid min-w-0 gap-5 p-3 sm:p-4 2xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]"
    >
      <div className="min-w-0">
        <h3 className="mb-2 text-label uppercase text-muted-foreground">Upcoming F&amp;O results{liveEvents ? "" : " (sample dates)"}</h3>
        {fnoUpcoming.length ? (
          <>
            <ScrollTable>
              <Table>
                <caption className="sr-only">Upcoming F&amp;O results with how often the straddle overpriced past results</caption>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Stock</TableHead>
                    <TableHead className="text-right">Overpriced</TableHead>
                    <TableHead className="text-right">Implied</TableHead>
                    <TableHead className="text-right">Realised</TableHead>
                    <TableHead className="hidden text-right md:table-cell">Straddle P&amp;L</TableHead>
                    <TableHead className="hidden text-right lg:table-cell">Open</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((e) => (
                    <UpcomingRow key={e.id} event={e} today={today} liveEvents={liveEvents} selected={e.symbol === symbol} onSelect={setPicked} />
                  ))}
                </TableBody>
              </Table>
            </ScrollTable>
            {fnoUpcoming.length > PAGE ? (
              <Button variant="ghost" size="sm" className="mt-2 h-8" onClick={() => setShowAll((v) => !v)} aria-expanded={showAll}>
                {showAll ? "Show fewer" : `Show all ${fnoUpcoming.length}`}
              </Button>
            ) : null}
          </>
        ) : (
          <EmptyState icon={<SearchX className="h-6 w-6" aria-hidden="true" />} title="No F&O results in this window">
            Pick any stock above to see how its straddle has priced past results.
          </EmptyState>
        )}
      </div>
      <div className="min-w-0">
        <SymbolDetail key={symbol} symbol={symbol} today={today} liveEvents={liveEvents} />
      </div>
    </EventsPanel>
  );
}
