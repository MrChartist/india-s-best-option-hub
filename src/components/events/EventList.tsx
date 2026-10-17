/** Event rows and a date-grouped list (list view, day details, highlights). */
import { Link } from "react-router-dom";
import { ArrowUpRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { isTradingDay, isoWeekday } from "@/lib/options";
import { EVENT_KIND_LABEL, eventLinks, groupByDate, type MarketEvent } from "@/lib/events";
import { cn } from "@/lib/utils";
import { EventMarker } from "./EventMarker";
import { dayLabel, eventProvenance, relativeDay } from "./eventText";

export function EventRow({ event: e, today, compact = false, stacked = false }: { event: MarketEvent; today: string; compact?: boolean; stacked?: boolean }) {
  const links = eventLinks(e, today);
  const prov = eventProvenance(e);
  const past = e.date < today;
  return (
    <li
      className={cn("flex min-w-0 flex-col gap-2 py-2.5", !stacked && "sm:flex-row sm:items-start sm:gap-3", past && "opacity-75")}
      data-event-id={e.id}
      data-event-kind={e.kind}
    >
      <div className="flex min-w-0 flex-1 items-start gap-2.5">
        <span className="w-12 shrink-0 pt-0.5 text-right font-num text-body-sm tabular-nums text-muted-foreground">
          {e.time ?? <span className="text-micro uppercase">All day</span>}
        </span>
        <EventMarker event={e} variant="icon" noTooltip />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-body font-semibold text-foreground">
            <span className="min-w-0 break-words">{e.title}</span>
            {e.impact === "high" ? (
              <Badge variant="default" className="h-4 px-1 text-micro">
                High impact
              </Badge>
            ) : null}
            {prov.map((p) => (
              <Badge key={p} variant="warning" className="h-4 px-1 text-micro">
                {p}
              </Badge>
            ))}
          </div>
          {!compact && e.detail ? <p className="mt-0.5 line-clamp-2 text-body-sm text-muted-foreground">{e.detail}</p> : null}
          <p className="mt-0.5 text-micro uppercase text-muted-foreground">
            {EVENT_KIND_LABEL[e.kind]}
            {e.category && e.category !== "Results" ? ` · ${e.category}` : ""}
            {e.company && e.company !== e.symbol ? ` · ${e.company}` : ""}
            {e.region === "US" ? " · US" : ""}
          </p>
        </div>
      </div>
      {links.length ? (
        <div className={cn("flex shrink-0 flex-wrap gap-1.5 pl-[5.75rem]", !stacked && "sm:pl-0")}>
          {links.map((l) => (
            <Link
              key={l.label}
              to={l.href}
              title={l.title}
              aria-label={l.title}
              className="inline-flex h-7 items-center gap-1 rounded-chip border border-border bg-card px-2 text-body-sm font-medium text-foreground transition-colors duration-fast hover:border-primary/50 hover:text-primary-ink focus-visible:shadow-ember focus-visible:outline-none"
            >
              {l.label}
              <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
            </Link>
          ))}
        </div>
      ) : null}
    </li>
  );
}

export function DayHeading({ date, today, as: As = "h3" }: { date: string; today: string; as?: "h3" | "h4" }) {
  const trading = isTradingDay(date);
  const wd = isoWeekday(date);
  const isToday = date === today;
  return (
    <As className="flex flex-wrap items-center gap-2 text-body-sm font-semibold">
      <span className={cn("font-display", isToday ? "text-primary-ink" : "text-foreground")}>{dayLabel(date)}</span>
      <span className="text-muted-foreground">{relativeDay(date, today)}</span>
      {!trading ? <Badge variant="neutral">{wd === 0 || wd === 6 ? "Weekend" : "Market closed"}</Badge> : null}
    </As>
  );
}

export function EventList({
  events,
  today,
  compact,
  hideHeadings = false,
  stacked = false,
}: {
  events: MarketEvent[];
  today: string;
  compact?: boolean;
  /** Single-day lists (day details) skip the date heading. */
  hideHeadings?: boolean;
  /** Always stack the links under the text (narrow side panels). */
  stacked?: boolean;
}) {
  const groups = groupByDate(events);
  return (
    <div className="space-y-4">
      {groups.map((g) => (
        <section key={g.date} aria-label={dayLabel(g.date)} data-date={g.date} className={cn("min-w-0 rounded-tile", !hideHeadings && g.date === today && "bg-wash-brand/40 p-2 sm:p-3")}>
          {hideHeadings ? null : <DayHeading date={g.date} today={today} />}
          <ul className="mt-1 divide-y divide-border">
            {g.events.map((e) => (
              <EventRow key={e.id} event={e} today={today} compact={compact} stacked={stacked} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
