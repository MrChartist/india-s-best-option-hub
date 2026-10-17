/**
 * <EventMarker event/>: a compact, accessible marker for one event, reusable in pickers, tables and
 * chart overlays. Variants: "chip" (icon + short label), "dot" (8 px dot for dense calendars and
 * chart axes) and "icon" (tinted icon only). A tooltip carries the full title, IST time, detail and
 * provenance (Sample / Verify date / Provisional).
 */
import { forwardRef } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { EVENT_KIND_LABEL, type MarketEvent } from "@/lib/events";
import { formatDateIST } from "@/lib/options";
import { cn } from "@/lib/utils";
import { EVENT_KIND_STYLE } from "./eventStyle";
import { eventProvenance, eventShortLabel } from "./eventText";

export type EventMarkerVariant = "chip" | "dot" | "icon";

export interface EventMarkerProps {
  event: MarketEvent;
  variant?: EventMarkerVariant;
  /** Chip text; defaults to the symbol (results, corporate) or the category. */
  label?: string;
  /** Hide the tooltip (e.g. when the marker sits inside a row that already shows the details). */
  noTooltip?: boolean;
  className?: string;
}

function ariaText(e: MarketEvent): string {
  const when = `${formatDateIST(e.date)}${e.time ? `, ${e.time} IST` : ""}`;
  const prov = eventProvenance(e);
  return `${EVENT_KIND_LABEL[e.kind]}: ${e.title}, ${when}${prov.length ? ` (${prov.join(", ")})` : ""}`;
}

export function EventTooltipBody({ event: e }: { event: MarketEvent }) {
  const prov = eventProvenance(e);
  return (
    <div className="max-w-[280px] space-y-1 text-xs">
      <p className="font-semibold text-foreground">{e.title}</p>
      <p className="font-num tabular-nums text-muted-foreground">
        {formatDateIST(e.date)}
        {e.time ? ` · ${e.time} IST` : ""} · {EVENT_KIND_LABEL[e.kind]}
      </p>
      {e.detail ? <p className="leading-relaxed text-muted-foreground">{e.detail}</p> : null}
      {prov.length ? <p className="font-semibold text-warning">{prov.join(" · ")}</p> : null}
    </div>
  );
}

const Inner = forwardRef<HTMLSpanElement, EventMarkerProps & { tabbable: boolean }>(function Inner(
  { event, variant = "chip", label, className, tabbable, noTooltip: _noTooltip, ...rest },
  ref,
) {
  const s = EVENT_KIND_STYLE[event.kind];
  const Icon = s.icon;
  const aria = ariaText(event);
  const sample = event.source === "sample";
  const common = {
    ref,
    role: "img" as const,
    "aria-label": aria,
    tabIndex: tabbable ? 0 : undefined,
    "data-event-kind": event.kind,
    "data-event-source": event.source,
    ...rest,
  };
  if (variant === "dot") {
    return (
      <span
        {...common}
        className={cn(
          "inline-block h-2 w-2 shrink-0 rounded-full focus-visible:shadow-ember focus-visible:outline-none",
          s.dot,
          sample && "opacity-60 ring-1 ring-inset ring-background",
          className,
        )}
      />
    );
  }
  if (variant === "icon") {
    return (
      <span {...common} className={cn("inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-chip focus-visible:shadow-ember focus-visible:outline-none", s.chip, className)}>
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      </span>
    );
  }
  return (
    <span
      {...common}
      className={cn(
        "inline-flex h-5 min-w-0 max-w-full items-center gap-1 rounded-chip px-1.5 text-[11px] font-semibold leading-none focus-visible:shadow-ember focus-visible:outline-none",
        s.chip,
        sample && "border border-dashed border-current",
        className,
      )}
    >
      <Icon className="h-3 w-3 shrink-0" aria-hidden="true" />
      <span className="truncate">{label ?? eventShortLabel(event)}</span>
    </span>
  );
});

export function EventMarker(props: EventMarkerProps) {
  if (props.noTooltip) return <Inner {...props} tabbable={false} />;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Inner {...props} tabbable />
      </TooltipTrigger>
      <TooltipContent className="p-2.5">
        <EventTooltipBody event={props.event} />
      </TooltipContent>
    </Tooltip>
  );
}

export default EventMarker;
