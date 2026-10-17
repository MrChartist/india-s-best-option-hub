/**
 * Small shared pieces for the OI, max pain and PCR screens: expiry pills, the education note,
 * stat tiles, card headers, empty states and number formatting.
 */
import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { Info } from "lucide-react";
import { CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { dteLabel, formatDateIST } from "@/lib/options";

export interface ExpiryOption {
  value: string;
  label?: string;
}

/**
 * Expiry pills (capsules). Arrow keys move between pills; Enter/Space selects.
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
    <div role="radiogroup" aria-label={label} className={cn("-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1", className)}>
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
              "flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-capsule border px-3 py-1 text-xs font-medium transition-colors duration-fast focus-visible:shadow-ember focus-visible:outline-none",
              active ? "border-primary/50 bg-wash-brand text-primary-ink" : "border-border bg-card text-muted-foreground hover:text-foreground",
            )}
          >
            <span className="font-num">{e.label || formatDateIST(e.value)}</span>
            <span className={cn("text-micro font-normal normal-case", active ? "text-primary-ink" : "text-muted-foreground")}>{shortDte(e.value)}</span>
          </button>
        );
      })}
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
    <CardHeader className="flex flex-col gap-2 space-y-0 border-b border-border px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          {icon}
          {title}
        </CardTitle>
        {hint ? <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p> : null}
      </div>
      {right ? <div className="flex shrink-0 flex-wrap items-center gap-2">{right}</div> : null}
    </CardHeader>
  );
}

/** Small metric tile. */
export function StatTile({ label, value, sub, valueClass, title }: { label: ReactNode; value: ReactNode; sub?: ReactNode; valueClass?: string; title?: string }) {
  return (
    <div className="min-w-0 rounded-tile border border-border bg-surface/60 px-3 py-2" title={title}>
      <p className="truncate text-label uppercase text-muted-foreground">{label}</p>
      <p className={cn("mt-1 truncate font-num text-lg font-semibold leading-none tabular-nums", valueClass)}>{value}</p>
      {sub ? <p className="mt-1 truncate text-[11px] text-muted-foreground">{sub}</p> : null}
    </div>
  );
}

/** Centred empty or info state inside a card. */
export function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-4 py-10 text-center" role="status">
      <div className="flex h-10 w-10 items-center justify-center rounded-tile bg-muted text-muted-foreground">{icon ?? <Info className="h-5 w-5" />}</div>
      <p className="text-sm font-semibold text-foreground">{title}</p>
      {children ? <div className="max-w-md text-xs leading-relaxed text-muted-foreground">{children}</div> : null}
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
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-tab border border-border bg-muted p-0.5">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
          className={cn(
            "rounded-chip px-2.5 py-1 text-xs font-medium transition-colors duration-fast focus-visible:shadow-ember focus-visible:outline-none",
            o.value === value ? "bg-card text-foreground shadow-card" : "text-muted-foreground hover:text-foreground",
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
    <span
      className="inline-flex h-5 items-center rounded-chip border border-warning/40 px-1.5 text-label uppercase text-warning"
      title="No recorded session in this browser yet. This is a deterministic sample day built from the sample chain, not market data."
    >
      Sample session
    </span>
  ) : (
    <span className="inline-flex h-5 items-center rounded-chip bg-wash-info px-1.5 text-label uppercase text-info" title="Snapshots recorded by this browser or the local proxy recorder">
      Recorded · {count} snapshots
    </span>
  );
}

/** The one place a chart states its units (axis ticks stay unit-free). */
export function ChartCaption({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("text-[11px] text-muted-foreground", className)}>{children}</p>;
}
