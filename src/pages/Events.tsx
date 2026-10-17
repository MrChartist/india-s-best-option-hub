/**
 * Events calendar: results, RBI / Budget / CPI / GDP / IIP, FOMC and US CPI, expiries and exchange
 * holidays in month and list views, with today / this-week highlights, type and symbol filters,
 * deep links to the chain and straddles for each event's expiry, and the results implied-vs-
 * realised move statistics.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { CalendarDays, CalendarSearch, ChevronLeft, ChevronRight, List, Loader2, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { PageHeader } from "@/components/PageHeader";
import { EventFilters, type EventFiltersValue } from "@/components/events/EventFilters";
import { EventHighlights } from "@/components/events/EventHighlights";
import { EventList } from "@/components/events/EventList";
import { DerivedBadge, EmptyState, EventsPanel, LiveBadge, SampleBadge, VerifyBadge } from "@/components/events/EventsUi";
import { MonthView } from "@/components/events/MonthView";
import { ResultsMovePanel } from "@/components/events/ResultsMovePanel";
import { useEvents } from "@/components/events/useEvents";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { addCalendarDays, formatDateIST, formatTimeIST, istDateString } from "@/lib/options";
import {
  EVENT_KINDS,
  MACRO_COVERAGE,
  filterEvents,
  isValidMonthKey,
  monthGrid,
  monthKey,
  monthRange,
  shiftMonth,
  weekRange,
  type EventKind,
} from "@/lib/events";

const VIEWS = ["month", "list"] as const;
type View = (typeof VIEWS)[number];
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DEFAULT_KINDS: EventKind[] = [...EVENT_KINDS];

const monthTitle = (ym: string) => `${MONTH_NAMES[+ym.slice(5, 7) - 1]} ${ym.slice(0, 4)}`;

/** Wall clock refreshed every minute (rolls "today" at IST midnight). */
function useMinuteClock(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

function parseKinds(raw: string | null): EventKind[] {
  if (raw === null) return DEFAULT_KINDS;
  if (raw === "none") return [];
  const set = new Set(raw.split(",").map((s) => s.trim()));
  return EVENT_KINDS.filter((k) => set.has(k));
}

export default function Events() {
  useDocumentTitle("Events Calendar");
  const [params, setParams] = useSearchParams();
  const now = useMinuteClock();
  const today = istDateString(now);

  const viewParam = params.get("view");
  const view: View = VIEWS.includes(viewParam as View) ? (viewParam as View) : "month";
  const monthParam = params.get("month");
  const month = isValidMonthKey(monthParam) ? monthParam : monthKey(today);
  const filters: EventFiltersValue = {
    kinds: parseKinds(params.get("types")),
    symbol: (params.get("symbol") || "").toUpperCase().replace(/[^A-Z0-9&-]/g, ""),
    fnoOnly: params.get("fno") !== "0",
    highOnly: params.get("high") === "1",
  };
  const dayParam = params.get("day");
  const range = useMemo(() => monthRange(month), [month]);
  const selectedDay = dayParam && dayParam >= range.from && dayParam <= range.to ? dayParam : today >= range.from && today <= range.to ? today : range.from;

  const update = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(params);
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === "") next.delete(k);
        else next.set(k, v);
      }
      setParams(next, { replace: true });
    },
    [params, setParams],
  );

  const setFilters = (p: Partial<EventFiltersValue>) => {
    const patch: Record<string, string | null> = {};
    if (p.kinds) patch.types = p.kinds.length === EVENT_KINDS.length ? null : p.kinds.length ? p.kinds.join(",") : "none";
    if (p.symbol !== undefined) patch.symbol = p.symbol || null;
    if (p.fnoOnly !== undefined) patch.fno = p.fnoOnly ? null : "0";
    if (p.highOnly !== undefined) patch.high = p.highOnly ? "1" : null;
    update(patch);
  };
  const resetFilters = () => update({ types: null, symbol: null, fno: null, high: null });
  const dirty = filters.kinds.length !== EVENT_KINDS.length || !!filters.symbol || !filters.fnoOnly || filters.highOnly;

  // Month data covers the visible grid (including the spill-over days of adjacent months).
  const grid = useMemo(() => monthGrid(month), [month]);
  const gridRange = useMemo(() => ({ from: grid[0][0].date, to: grid[grid.length - 1][6].date }), [grid]);
  const monthQ = useEvents(gridRange);
  const week = useMemo(() => weekRange(today), [today]);
  const aheadRange = useMemo(() => ({ from: week.from, to: addCalendarDays(today, 75) }), [week.from, today]);
  const aheadQ = useEvents(aheadRange);

  const filterOpts = useMemo(
    () => ({ kinds: filters.kinds, symbol: filters.symbol, fnoOnly: filters.fnoOnly, highImpactOnly: filters.highOnly }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- primitive deps below capture every filter
    [filters.kinds.join(","), filters.symbol, filters.fnoOnly, filters.highOnly],
  );
  const monthEvents = useMemo(() => filterEvents(monthQ.events, filterOpts), [monthQ.events, filterOpts]);
  const inMonth = useMemo(() => monthEvents.filter((e) => e.date >= range.from && e.date <= range.to), [monthEvents, range]);
  const aheadEvents = useMemo(() => filterEvents(aheadQ.events, filterOpts), [aheadQ.events, filterOpts]);
  const counts = useMemo(() => {
    const base = filterEvents(monthQ.events, { symbol: filters.symbol, fnoOnly: filters.fnoOnly, highImpactOnly: filters.highOnly }).filter((e) => e.date >= range.from && e.date <= range.to);
    const out: Partial<Record<EventKind, number>> = {};
    for (const e of base) out[e.kind] = (out[e.kind] ?? 0) + 1;
    return out;
  }, [monthQ.events, filters.symbol, filters.fnoOnly, filters.highOnly, range]);

  const corp = monthQ.corporate;
  const liveEvents = corp?.mode === "live" ? corp.events : null;
  const outsideMacro = range.to < MACRO_COVERAGE.from || range.from > MACRO_COVERAGE.to;
  const corporateOutside = corp?.mode === "live" && corp.coverage && (range.to < corp.coverage.from || range.from > corp.coverage.to);

  const source = (
    <>
      {monthQ.isLoading ? (
        <Badge variant="neutral">
          <Loader2 className="animate-spin" aria-hidden="true" />
          Loading NSE calendar
        </Badge>
      ) : corp?.mode === "live" ? (
        <LiveBadge
          label="Results: NSE"
          tip={
            <>
              Board meetings from the NSE corporate event calendar
              {corp.coverage ? `, ${formatDateIST(corp.coverage.from)} to ${formatDateIST(corp.coverage.to)}` : ""}. Fetched {corp.asOf ? formatTimeIST(corp.asOf) : "just now"}
              {corp.stale ? " (cached copy)" : ""}.
            </>
          }
        />
      ) : (
        <SampleBadge label="Results: sample dates" tip={<>{corp?.reason ?? "The NSE calendar is unavailable"}. Results dates are spread through the usual season for illustration and are not companies' announced dates.</>} />
      )}
      <VerifyBadge label="Macro dates: verify" tip="RBI, Budget, MoSPI, FOMC and US CPI dates are compiled from published schedules where available and estimated otherwise. Check rbi.org.in, mospi.gov.in, federalreserve.gov and bls.gov." />
      <DerivedBadge label="Expiries & holidays" tip="Computed from the exchange holiday list and SEBI expiry rules. 2027 holidays are provisional until NSE publishes its circular." />
    </>
  );

  const actions = (
    <>
      <div className="flex items-center gap-1" role="group" aria-label="Month">
        <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => update({ month: shiftMonth(month, -1), day: null })} aria-label="Previous month">
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        </Button>
        <span className="min-w-[8.5rem] text-center font-display text-body font-bold" aria-live="polite">
          {monthTitle(month)}
        </span>
        <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => update({ month: shiftMonth(month, 1), day: null })} aria-label="Next month">
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
      <Button variant="outline" size="sm" className="h-8" onClick={() => update({ month: null, day: null })} disabled={month === monthKey(today) && selectedDay === today}>
        Today
      </Button>
      <ToggleGroup type="single" value={view} onValueChange={(v) => v && update({ view: v === "month" ? null : v })} aria-label="Calendar view" className="rounded-chip border border-border p-0.5">
        <ToggleGroupItem value="month" size="sm" className="h-7 gap-1.5 px-2.5" aria-label="Month view">
          <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />
          Month
        </ToggleGroupItem>
        <ToggleGroupItem value="list" size="sm" className="h-7 gap-1.5 px-2.5" aria-label="List view">
          <List className="h-3.5 w-3.5" aria-hidden="true" />
          List
        </ToggleGroupItem>
      </ToggleGroup>
    </>
  );

  return (
    <div className="mx-auto w-full max-w-[1400px] space-y-4 px-1.5 py-1 sm:px-0">
      <PageHeader
        icon={CalendarDays}
        eyebrow="Markets"
        title="Events Calendar"
        description="Results, RBI policy, Budget, CPI, GDP, FOMC and US CPI, expiries and market holidays in one IST calendar, with how often each stock's straddle has overpriced its results."
        source={source}
        actions={actions}
      />

      <EventHighlights events={aheadEvents} today={today} week={week} now={now} />

      <EventFilters value={filters} onChange={setFilters} onReset={resetFilters} counts={counts} dirty={dirty} />

      {(outsideMacro || corporateOutside) && (
        <p className="rounded-chip border border-info/30 bg-wash-info px-3 py-2 text-body-sm text-foreground" role="note">
          {outsideMacro ? `The macro schedule covers ${formatDateIST(MACRO_COVERAGE.from)} to ${formatDateIST(MACRO_COVERAGE.to)}. ` : ""}
          {corporateOutside && corp?.coverage ? `NSE's calendar currently lists board meetings from ${formatDateIST(corp.coverage.from)} to ${formatDateIST(corp.coverage.to)}, so results outside that window are not shown.` : ""}
        </p>
      )}

      <EventsPanel
        title={
          <>
            {view === "month" ? <CalendarDays className="h-4 w-4 text-primary-ink" aria-hidden="true" /> : <List className="h-4 w-4 text-primary-ink" aria-hidden="true" />}
            {monthTitle(month)}
            <span className="font-num text-body font-normal tabular-nums text-muted-foreground">
              {inMonth.length} event{inMonth.length === 1 ? "" : "s"}
            </span>
          </>
        }
        subtitle={filters.symbol ? `Showing ${filters.symbol} plus market-wide events (macro, holidays, the NSE monthly expiry). All times IST.` : "All times IST. Each event links to the option chain and straddles for the expiry that spans it."}
        actions={
          monthQ.isFetching && !monthQ.isLoading ? (
            <span className="inline-flex items-center gap-1 text-body-sm text-muted-foreground">
              <RefreshCw className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              Updating
            </span>
          ) : null
        }
        bodyClassName="p-2 sm:p-4"
      >
        {view === "month" ? (
          <MonthView month={month} events={monthEvents} today={today} selected={selectedDay} onSelect={(d) => update(d.slice(0, 7) === month ? { day: d } : { month: d.slice(0, 7), day: d })} />
        ) : inMonth.length ? (
          <EventList events={inMonth} today={today} />
        ) : (
          <EmptyState
            icon={<CalendarSearch className="h-6 w-6" aria-hidden="true" />}
            title={`No events in ${monthTitle(month)}`}
            action={
              dirty ? (
                <Button size="sm" variant="outline" onClick={resetFilters}>
                  Reset filters
                </Button>
              ) : undefined
            }
          >
            {dirty ? "Nothing matches your filters this month." : "Nothing is scheduled this month in the calendars we track."}
          </EmptyState>
        )}
      </EventsPanel>

      <ResultsMovePanel upcoming={aheadQ.events} today={today} liveEvents={liveEvents} initialSymbol={filters.symbol || undefined} />

      <section aria-label="About this data" className="rounded-tile border border-border bg-muted/40 p-3 text-body-sm leading-relaxed text-muted-foreground">
        <p>
          <strong className="text-foreground">About the data.</strong> Results and other board meetings come from the NSE corporate event calendar through your local proxy; when it is unavailable the calendar shows sample results dates, clearly marked. Macro dates are a hand-compiled 2026–27 schedule marked “Verify date”. Expiries follow SEBI rules (NIFTY weekly on Tuesday, monthly contracts on the last Tuesday, SENSEX on Thursday) and shift to the previous trading day for holidays. US releases are converted to IST, including US daylight saving. This page is for information only and is not investment advice.
        </p>
      </section>
    </div>
  );
}
