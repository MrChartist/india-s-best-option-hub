/** Today, this week and the next high-impact event, at a glance. */
import { CalendarClock, CalendarDays, Flame } from "lucide-react";
import { Card } from "@/components/ui/card";
import { calendarDaysBetween, formatDateIST, getMarketSession, isTradingDay } from "@/lib/options";
import { EVENT_KIND_LABEL, EVENT_KINDS, type EventRange, type MarketEvent } from "@/lib/events";
import { cn } from "@/lib/utils";
import { EventMarker } from "./EventMarker";
import { EventRow } from "./EventList";
import { dayLabel } from "./eventText";
import { EVENT_KIND_STYLE } from "./eventStyle";

const SESSION_TEXT: Record<string, string> = {
  "pre-open": "Pre-open session",
  open: "Market open",
  closing: "Closing session",
  closed: "Market closed for the day",
  holiday: "Exchange holiday",
  weekend: "Weekend: markets closed",
};

function CardShell({ icon: Icon, title, aside, children, className }: { icon: typeof Flame; title: string; aside?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <Card className={cn("flex min-w-0 flex-col p-3.5", className)}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-label uppercase text-muted-foreground">
          <Icon className="h-3.5 w-3.5" aria-hidden="true" />
          {title}
        </h2>
        {aside}
      </div>
      {children}
    </Card>
  );
}

export function EventHighlights({ events, today, week, now }: { events: MarketEvent[]; today: string; week: EventRange; now: Date }) {
  const todays = events.filter((e) => e.date === today);
  const weekEvents = events.filter((e) => e.date >= week.from && e.date <= week.to);
  const upcomingWeek = weekEvents.filter((e) => e.date >= today);
  const counts = EVENT_KINDS.map((k) => ({ kind: k, n: weekEvents.filter((e) => e.kind === k).length })).filter((c) => c.n > 0);
  const nextBig = events.find((e) => e.impact === "high" && e.date > today && e.kind !== "results") ?? events.find((e) => e.impact === "high" && e.date > today);
  const session = getMarketSession(now);
  const daysTo = nextBig ? calendarDaysBetween(today, nextBig.date) : NaN;

  return (
    <div className="grid min-w-0 gap-3 md:grid-cols-2 xl:grid-cols-[1.2fr_1fr_1fr]" data-testid="event-highlights">
      <CardShell
        icon={CalendarDays}
        title={`Today · ${dayLabel(today)}`}
        aside={<span className={cn("text-body-sm", isTradingDay(today) ? "text-bullish" : "text-muted-foreground")}>{SESSION_TEXT[session] ?? ""}</span>}
        className="ring-1 ring-primary/30"
      >
        {todays.length ? (
          <ul className="-my-1 divide-y divide-border">
            {todays.slice(0, 4).map((e) => (
              <EventRow key={e.id} event={e} today={today} compact stacked />
            ))}
            {todays.length > 4 ? <li className="py-1.5 text-body-sm text-muted-foreground">+{todays.length - 4} more today</li> : null}
          </ul>
        ) : (
          <p className="text-body text-muted-foreground">No scheduled events match your filters today.</p>
        )}
      </CardShell>

      <CardShell
        icon={CalendarClock}
        title="This week"
        aside={
          <span className="font-num text-body-sm tabular-nums text-muted-foreground">
            {formatDateIST(week.from).replace(/ \d{4}$/, "")} – {formatDateIST(week.to).replace(/ \d{4}$/, "")}
          </span>
        }
      >
        <p className="font-num text-title tabular-nums">
          {weekEvents.length} <span className="text-body font-normal text-muted-foreground">event{weekEvents.length === 1 ? "" : "s"}, {upcomingWeek.length} still ahead</span>
        </p>
        {counts.length ? (
          <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Events this week by type">
            {counts.map(({ kind, n }) => {
              const s = EVENT_KIND_STYLE[kind];
              const Icon = s.icon;
              return (
                <li key={kind} className={cn("inline-flex h-6 items-center gap-1 rounded-chip px-2 text-body-sm font-medium", s.chip)}>
                  <Icon className="h-3 w-3" aria-hidden="true" />
                  {EVENT_KIND_LABEL[kind]} <span className="font-num font-semibold tabular-nums">{n}</span>
                </li>
              );
            })}
          </ul>
        ) : null}
        {upcomingWeek.some((e) => e.impact === "high") ? (
          <div className="mt-2.5 flex flex-wrap gap-1">
            {upcomingWeek
              .filter((e) => e.impact === "high")
              .slice(0, 8)
              .map((e) => (
                <EventMarker key={e.id} event={e} />
              ))}
          </div>
        ) : null}
      </CardShell>

      <CardShell icon={Flame} title="Next high-impact event" className="md:col-span-2 xl:col-span-1">
        {nextBig ? (
          <div className="min-w-0">
            <p className="font-num text-num-hero tabular-nums text-primary-ink">
              {daysTo}
              <span className="ml-1 text-body font-normal text-muted-foreground">day{daysTo === 1 ? "" : "s"}</span>
            </p>
            <p className="mt-1 break-words text-body font-semibold">{nextBig.title}</p>
            <p className="text-body-sm text-muted-foreground">
              {dayLabel(nextBig.date)}
              {nextBig.time ? ` · ${nextBig.time} IST` : ""}
            </p>
            <div className="mt-2">
              <EventMarker event={nextBig} variant="chip" label={EVENT_KIND_LABEL[nextBig.kind]} />
            </div>
          </div>
        ) : (
          <p className="text-body text-muted-foreground">No high-impact events ahead in this view.</p>
        )}
      </CardShell>
    </div>
  );
}
