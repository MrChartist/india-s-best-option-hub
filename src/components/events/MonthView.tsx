/**
 * Month view: a Monday-first calendar grid. Each day shows its events as chips (dots on phones);
 * selecting a day (click, Enter, or arrow keys) lists its events beside or below the grid.
 */
import { useMemo, useRef, type KeyboardEvent } from "react";
import { CalendarCheck } from "lucide-react";
import { addCalendarDays, formatDateIST } from "@/lib/options";
import { monthGrid, type MarketEvent } from "@/lib/events";
import { cn } from "@/lib/utils";
import { EventMarker } from "./EventMarker";
import { DayHeading, EventList } from "./EventList";
import { dayLabel, eventShortLabel } from "./eventText";
import { EmptyState } from "./EventsUi";

const HEAD = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MAX_CHIPS = 3;

/** Compact chip text for the narrow day cells: short codes for expiries and holidays. */
function monthChipLabel(e: MarketEvent): string {
  if (e.kind === "holiday") return e.category === "Special session" ? "Special" : "Holiday";
  const label = eventShortLabel(e);
  if (e.kind === "expiry") {
    return label
      .replace(/\bweekly\b/i, "W")
      .replace(/\bmonthly( F&O)?\b/i, "M")
      .trim();
  }
  return label;
}

/** Sample-dated events: a muted hatched fill instead of the chip's dashed (error-like) outline. */
const SAMPLE_CHIP = "border-0 bg-[repeating-linear-gradient(135deg,transparent_0_4px,hsl(var(--foreground)/0.08)_4px_6px)] opacity-80";

export interface MonthViewProps {
  month: string;
  events: MarketEvent[];
  today: string;
  selected: string;
  onSelect: (date: string) => void;
}

export function MonthView({ month, events, today, selected, onSelect }: MonthViewProps) {
  const weeks = useMemo(() => monthGrid(month), [month]);
  const byDate = useMemo(() => {
    const m = new Map<string, MarketEvent[]>();
    for (const e of events) {
      const list = m.get(e.date);
      if (list) list.push(e);
      else m.set(e.date, [e]);
    }
    return m;
  }, [events]);
  const gridRef = useRef<HTMLDivElement>(null);
  const first = weeks[0]?.[0]?.date ?? "";
  const last = weeks[weeks.length - 1]?.[6]?.date ?? "";
  const dayEvents = byDate.get(selected) ?? [];

  const onKey = (ev: KeyboardEvent<HTMLButtonElement>, date: string) => {
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[ev.key];
    if (!step) return;
    ev.preventDefault();
    const next = addCalendarDays(date, step);
    if (next < first || next > last) return;
    onSelect(next);
    requestAnimationFrame(() => gridRef.current?.querySelector<HTMLButtonElement>(`[data-date="${next}"]`)?.focus());
  };

  return (
    <div className="grid min-w-0 gap-4 2xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0">
        <div className="grid grid-cols-7 overflow-hidden rounded-t-tile border border-b-0 border-separator" aria-hidden="true">
          {HEAD.map((h, i) => (
            <div key={h} className={cn("bg-surface px-1.5 py-1 text-right text-label text-muted-foreground", i >= 5 && "text-muted-foreground-subtle")}>
              {h}
            </div>
          ))}
        </div>
        <div ref={gridRef} role="grid" aria-label={`Events in ${formatDateIST(`${month}-15`).replace(/^\d+ /, "")}`} className="grid gap-px overflow-hidden rounded-b-tile border border-separator bg-separator">
          {weeks.map((week) => (
            <div key={week[0].date} role="row" className="grid grid-cols-7 gap-px">
              {week.map((cell) => {
                const evs = byDate.get(cell.date) ?? [];
                const isToday = cell.date === today;
                const isSel = cell.date === selected;
                const high = evs.some((e) => e.impact === "high");
                return (
                  <div key={cell.date} role="gridcell" aria-selected={isSel} className="min-w-0">
                    <button
                      type="button"
                      data-date={cell.date}
                      tabIndex={isSel ? 0 : -1}
                      onClick={() => onSelect(cell.date)}
                      onKeyDown={(ev) => onKey(ev, cell.date)}
                      aria-current={isToday ? "date" : undefined}
                      className={cn(
                        "flex h-full min-h-[64px] w-full min-w-0 flex-col items-stretch gap-1 p-1 text-left transition-colors duration-fast focus-visible:relative focus-visible:z-10 focus-visible:shadow-focus focus-visible:outline-none sm:min-h-[104px] sm:p-1.5",
                        cell.inMonth ? "bg-card" : "bg-surface text-muted-foreground",
                        !cell.trading && cell.inMonth && "bg-surface/70",
                        isSel ? "bg-wash-brand" : "hover:bg-control-track",
                      )}
                    >
                      {/* Name comes from this hidden text (not aria-label) so the visible day number never conflicts with it. */}
                      <span className="sr-only">{`${dayLabel(cell.date)}${isToday ? ", today" : ""}${!cell.trading ? ", market closed" : ""}: ${evs.length ? `${evs.length} event${evs.length === 1 ? "" : "s"}` : "no events"}`}</span>
                      <span className="flex items-center justify-between gap-1" aria-hidden="true">
                        <span
                          className={cn(
                            "inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1 font-num text-body-sm tabular-nums",
                            cell.inMonth ? "text-foreground" : "text-muted-foreground-subtle",
                            isToday && "bg-primary font-bold text-primary-foreground",
                          )}
                        >
                          {+cell.date.slice(8, 10)}
                        </span>
                        {high ? <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden="true" title="High-impact event" /> : null}
                      </span>
                      {evs.length ? (
                        <>
                          <span className="flex flex-wrap gap-0.5 sm:hidden" aria-hidden="true">
                            {evs.slice(0, 6).map((e) => (
                              <EventMarker key={e.id} event={e} variant="dot" noTooltip />
                            ))}
                          </span>
                          <span className="hidden min-w-0 flex-col gap-0.5 sm:flex" aria-hidden="true">
                            {evs.slice(0, MAX_CHIPS).map((e) => (
                              <span key={e.id} className="flex min-w-0" title={`${e.title}${e.source === "sample" ? " (sample date)" : ""}`}>
                                <EventMarker event={e} variant="chip" noTooltip label={monthChipLabel(e)} className={cn("w-full", e.source === "sample" && SAMPLE_CHIP)} />
                              </span>
                            ))}
                            {evs.length > MAX_CHIPS ? <span className="px-1 text-label font-medium text-muted-foreground">+{evs.length - MAX_CHIPS} more</span> : null}
                          </span>
                        </>
                      ) : null}
                    </button>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        <p className="mt-2 text-body-sm text-muted-foreground">Use the arrow keys to move between days. Shaded days are weekends or exchange holidays.</p>
      </div>
      <aside aria-label="Selected day" className="min-w-0 rounded-tile bg-surface p-3" aria-live="polite">
        <DayHeading date={selected} today={today} as="h3" />
        {dayEvents.length ? (
          <div className="mt-2">
            <EventList events={dayEvents} today={today} hideHeadings stacked />
          </div>
        ) : (
          <div className="mt-3">
            <EmptyState icon={<CalendarCheck className="h-6 w-6" aria-hidden="true" />} title="Nothing scheduled">
              No events match your filters on this day.
            </EmptyState>
          </div>
        )}
      </aside>
    </div>
  );
}
