/**
 * Small shared pieces for the OI, max pain and PCR screens: expiry picker, the education note,
 * stat tiles, card headers, empty states and number formatting.
 */
import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { FlaskConical, History, Info } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { dteLabel, formatDateIST } from "@/lib/options";

export interface ExpiryOption {
  value: string;
  label?: string;
}

/**
 * Expiry picker as a segmented control. Arrow keys move between expiries; Enter/Space selects.
 * Labels show the date and days to expiry.
 */
export function ExpiryPills({
  expiries,
  value,
  onChange,
  max = 8,
  className,
  label = "Expiry",
}: {
  expiries: ExpiryOption[];
  value: string;
  onChange: (v: string) => void;
  max?: number;
  className?: string;
  label?: string;
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const list = expiries.slice(0, max);
  const onKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft" && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    const n = list.length;
    const next = e.key === "Home" ? 0 : e.key === "End" ? n - 1 : (i + (e.key === "ArrowRight" ? 1 : -1) + n) % n;
    refs.current[next]?.focus();
    onChange(list[next].value);
  };
  if (list.length === 0) return null;
  return (
    <div className={cn("-mx-1 max-w-full overflow-x-auto px-1 pb-1", className)}>
      {/* macOS segmented control: one tray, the selected expiry is the raised thumb. */}
      <div role="radiogroup" aria-label={label} className="inline-flex w-max items-center gap-px rounded-pill bg-control-track p-0.5">
        {list.map((e, i) => {
          const active = e.value === value;
          return (
            <button
              key={e.value}
              ref={(el) => (refs.current[i] = el)}
              type="button"
              role="radio"
              aria-checked={active}
              tabIndex={active || (!list.some((x) => x.value === value) && i === 0) ? 0 : -1}
              onClick={() => onChange(e.value)}
              onKeyDown={(ev) => onKey(ev, i)}
              className={cn(
                "flex h-6 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[5px] px-2.5 text-body-sm font-medium transition-[background-color,color,box-shadow] duration-base ease-spring focus-visible:shadow-focus focus-visible:outline-none",
                active ? "bg-control text-foreground shadow-control" : "text-foreground/80 hover:text-foreground",
              )}
            >
              <span className="font-num">{e.label || formatDateIST(e.value)}</span>
              <span className={cn("text-micro font-normal", active ? "text-primary-ink" : "text-muted-foreground")}>{shortDte(e.value)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function shortDte(iso: string): string {
  const s = dteLabel(iso);
  if (!s || s === "—") return "";
  return s.startsWith("Expiry today") ? "today" : s;
}

/** Card header with icon, title, optional hint and right-hand slot. */
export function ModuleHeader({ icon, title, hint, right }: { icon?: ReactNode; title: ReactNode; hint?: ReactNode; right?: ReactNode }) {
  return (
    <CardHeader className="hairline-b flex flex-col gap-2 space-y-0 px-4 pb-3 pt-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <CardTitle className="flex items-center gap-2 [&_svg]:h-4 [&_svg]:w-4">
          {icon}
          {title}
        </CardTitle>
        {hint ? <p className="mt-0.5 text-body-sm text-muted-foreground">{hint}</p> : null}
      </div>
      {right ? <div className="flex shrink-0 flex-wrap items-center gap-2">{right}</div> : null}
    </CardHeader>
  );
}

/**
 * Small metric tile. "inset" (default) is a filled well for tiles inside a card; "box" is a flat
 * group box for tiles that sit straight on the window.
 */
export function StatTile({
  label,
  value,
  sub,
  valueClass,
  title,
  variant = "inset",
}: {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  valueClass?: string;
  title?: string;
  variant?: "inset" | "box";
}) {
  return (
    <div
      className={cn(
        "min-w-0 px-3 py-2",
        variant === "box" ? "rounded-tile border border-separator bg-card shadow-card" : "rounded-md bg-control-track",
      )}
      title={title}
    >
      <div className="truncate text-body-sm font-medium text-muted-foreground">{label}</div>
      <p className={cn("mt-0.5 truncate font-num text-title tabular-nums", valueClass)}>{value}</p>
      {sub ? <p className="mt-0.5 truncate text-body-sm text-muted-foreground">{sub}</p> : null}
    </div>
  );
}

/** Centred empty or info state inside a card. */
export function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-4 py-10 text-center" role="status">
      <div className="flex h-10 w-10 items-center justify-center rounded-tile bg-control-track text-muted-foreground">{icon ?? <Info className="h-5 w-5" />}</div>
      <p className="text-headline text-foreground">{title}</p>
      {children ? <div className="max-w-md text-body-sm text-muted-foreground">{children}</div> : null}
      {action}
    </div>
  );
}

/** Segmented control built from buttons (accessible as a radio group). */
export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  label,
}: {
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex h-7 items-center gap-px rounded-pill bg-control-track p-0.5">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
          className={cn(
            "inline-flex h-full items-center rounded-[5px] px-2.5 text-body-sm font-medium transition-[background-color,color,box-shadow] duration-base ease-spring focus-visible:shadow-focus focus-visible:outline-none",
            o.value === value ? "bg-control text-foreground shadow-control" : "text-foreground/80 hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Source label for intraday charts: a recorded session or the labelled sample day. */
export function SessionBadge({ source, count }: { source: "recorded" | "sample"; count: number }) {
  return source === "sample" ? (
    <Badge variant="warning" title="No recorded session in this browser yet. This is a deterministic sample day built from the sample chain, not market data.">
      <FlaskConical aria-hidden="true" />
      Sample session
    </Badge>
  ) : (
    <Badge variant="info" title="Snapshots recorded by this browser or the local proxy recorder">
      <History aria-hidden="true" />
      Recorded · {count} snapshots
    </Badge>
  );
}

/** The one place a chart states its units (axis ticks stay unit-free). */
export function ChartCaption({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("text-body-sm text-muted-foreground", className)}>{children}</p>;
}
