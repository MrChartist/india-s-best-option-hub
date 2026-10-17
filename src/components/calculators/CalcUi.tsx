import { useId, useMemo, useState, type ReactNode } from "react";
import { CalendarDays, Info } from "lucide-react";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatDateIST, istDateString } from "@/lib/options";
import { cn } from "@/lib/utils";
import { calendarDateToIso, isoToCalendarDate, symbolOptions, type Tone } from "./calcLogic";

/** Card-like section used by every calculator. */
export function Panel({
  title,
  description,
  actions,
  children,
  className,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("rounded-card border border-border bg-card p-4 shadow-card sm:p-5", className)} aria-label={title}>
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 data-card-title="" className="font-display text-[15px] font-bold leading-snug text-foreground">{title}</h2>
          {description ? <p className="mt-1 max-w-3xl text-body-sm text-muted-foreground">{description}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

/** Labelled numeric text input; keeps the raw string so typing "12." works. */
export function NumField({
  label,
  value,
  onChange,
  hint,
  suffix,
  prefix,
  invalid,
  className,
  placeholder,
  step,
  compact,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: ReactNode;
  suffix?: string;
  prefix?: string;
  invalid?: boolean;
  className?: string;
  placeholder?: string;
  step?: string;
  compact?: boolean;
}) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  return (
    <div className={cn("min-w-0 space-y-1", className)}>
      <Label htmlFor={id} className={cn("block text-label uppercase text-muted-foreground", compact && "text-micro")}>
        {label}
      </Label>
      <div className="relative">
        {prefix ? (
          <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-muted-foreground" aria-hidden="true">
            {prefix}
          </span>
        ) : null}
        <Input
          id={id}
          inputMode="decimal"
          autoComplete="off"
          value={value}
          step={step}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={invalid || undefined}
          aria-describedby={hintId}
          className={cn("font-num tabular-nums", prefix && "pl-7", suffix && "pr-10")}
        />
        {suffix ? (
          <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted-foreground" aria-hidden="true">
            {suffix}
          </span>
        ) : null}
      </div>
      {hint ? (
        <div id={hintId} className={cn("text-body-sm", invalid ? "text-destructive" : "text-muted-foreground")}>
          {hint}
        </div>
      ) : null}
    </div>
  );
}

/** Labelled shadcn select with plain string options. */
export function SelectField<T extends string>({
  label,
  value,
  onChange,
  options,
  className,
  compact,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: ReadonlyArray<{ value: T; label: string }>;
  className?: string;
  compact?: boolean;
}) {
  const id = useId();
  return (
    <div className={cn("min-w-0 space-y-1", className)}>
      <Label htmlFor={id} className={cn("block text-label uppercase text-muted-foreground", compact && "text-micro")}>
        {label}
      </Label>
      <Select value={value} onValueChange={(v) => onChange(v as T)}>
        <SelectTrigger id={id} className={compact ? undefined : "sm:min-w-[11rem]"}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

const SYMBOLS = symbolOptions();

/** Underlying picker: indices, then F&O stocks. */
export function SymbolField({ value, onChange, label = "Underlying", className }: { value: string; onChange: (s: string) => void; label?: string; className?: string }) {
  const id = useId();
  return (
    <div className={cn("min-w-0 space-y-1", className)}>
      <Label htmlFor={id} className="block text-label uppercase text-muted-foreground">
        {label}
      </Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="max-h-80">
          <SelectGroup>
            <SelectLabel>Indices</SelectLabel>
            {SYMBOLS.indices.map((s) => (
              <SelectItem key={s.symbol} value={s.symbol}>
                {s.symbol}
              </SelectItem>
            ))}
          </SelectGroup>
          <SelectGroup>
            <SelectLabel>Stocks</SelectLabel>
            {SYMBOLS.stocks.map((s) => (
              <SelectItem key={s.symbol} value={s.symbol}>
                {s.symbol}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
  );
}

/** Two-option segmented control (radio group semantics). */
export function Segmented<T extends string>({
  label,
  value,
  onChange,
  options,
  className,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: ReadonlyArray<{ value: T; label: string }>;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0 space-y-1", className)}>
      <span className="block text-label uppercase text-muted-foreground">{label}</span>
      <div role="radiogroup" aria-label={label} className="inline-flex h-9 w-full items-center gap-0.5 rounded-tile bg-muted p-1">
        {options.map((o) => {
          const active = o.value === value;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(o.value)}
              onKeyDown={(e) => {
                if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                  e.preventDefault();
                  const idx = options.findIndex((x) => x.value === value);
                  const next = options[(idx + (e.key === "ArrowRight" ? 1 : options.length - 1)) % options.length];
                  onChange(next.value);
                }
              }}
              className={cn(
                "h-7 flex-1 whitespace-nowrap rounded-tab px-2 text-xs font-semibold transition-[background-color,color,box-shadow] duration-fast ease-expo focus-visible:shadow-ember focus-visible:outline-none",
                active ? "bg-card text-foreground shadow-card" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}


const TONE_TEXT: Record<Tone, string> = {
  default: "text-foreground",
  bullish: "text-bullish",
  bearish: "text-bearish",
  warning: "text-warning",
  info: "text-info",
  brand: "text-primary-ink",
};

/** Result tile: label, big number, optional sub line. */
export function Stat({ label, value, sub, tone = "default", emphasis, className }: { label: string; value: ReactNode; sub?: ReactNode; tone?: Tone; emphasis?: boolean; className?: string }) {
  return (
    <div className={cn("min-w-0 rounded-tile border border-border bg-surface px-3 py-2.5", emphasis && "border-primary/40 bg-wash-brand/40", className)}>
      <div className="text-label uppercase text-muted-foreground">{label}</div>
      <div className={cn("mt-1 truncate font-num font-bold tabular-nums", emphasis ? "text-title" : "text-lead", TONE_TEXT[tone])}>{value}</div>
      {sub ? <div className="mt-0.5 text-body-sm text-muted-foreground">{sub}</div> : null}
    </div>
  );
}

/** Inline callout (info / warning). */
export function Callout({ tone = "info", children, className }: { tone?: "info" | "warning" | "loss"; children: ReactNode; className?: string }) {
  const styles = {
    info: "border-info/30 bg-wash-info text-info",
    warning: "border-warning/40 bg-wash-warning text-warning",
    loss: "border-bearish/40 bg-wash-loss text-bearish",
  }[tone];
  return (
    <div role={tone === "info" ? "note" : "alert"} className={cn("flex items-start gap-2 rounded-tile border px-3 py-2 text-body-sm", styles, className)}>
      <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** Small key/value row for breakdown tables. */
export function KV({ k, v, strong, className }: { k: ReactNode; v: ReactNode; strong?: boolean; className?: string }) {
  return (
    <div className={cn("flex items-baseline justify-between gap-3 py-1.5 text-body", strong && "font-semibold", className)}>
      <span className="text-muted-foreground">{k}</span>
      <span className="font-num tabular-nums text-foreground">{v}</span>
    </div>
  );
}

/**
 * Date picker: a button showing the date in Indian format ("20 Oct 2026", IST) that
 * opens a calendar popover. Value is an ISO "yyyy-mm-dd" IST calendar date.
 * `markDates` highlights dates such as NSE expiries.
 */
export function DateField({
  label,
  value,
  onChange,
  min,
  hint,
  className,
  markDates,
  markLabel = "Expiry",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  min?: string;
  hint?: ReactNode;
  className?: string;
  markDates?: readonly string[];
  markLabel?: string;
}) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const [open, setOpen] = useState(false);
  const selected = isoToCalendarDate(value) ?? undefined;
  const minDate = isoToCalendarDate(min) ?? undefined;
  const marked = useMemo(() => (markDates ?? []).map((d) => isoToCalendarDate(d)).filter((d): d is Date => d !== null), [markDates]);
  const today = isoToCalendarDate(istDateString()) ?? new Date();
  const pick = (iso: string) => {
    if (!iso) return;
    onChange(iso);
    setOpen(false);
  };
  return (
    <div className={cn("min-w-0 space-y-1", className)}>
      <Label htmlFor={id} className="block text-label uppercase text-muted-foreground">
        {label}
      </Label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            id={id}
            type="button"
            lang="en-IN"
            aria-describedby={hintId}
            aria-haspopup="dialog"
            className="flex h-9 w-full min-w-0 items-center justify-between gap-2 rounded-md border border-input bg-card px-3 text-left text-sm text-foreground transition-[border-color,box-shadow] duration-fast ease-expo hover:border-foreground/25 focus-visible:border-primary focus-visible:shadow-ember focus-visible:outline-none data-[state=open]:border-primary"
          >
            <span className={cn("min-w-0 truncate font-num tabular-nums", !value && "text-muted-foreground")}>{value ? formatDateIST(value) : "Pick a date"}</span>
            <CalendarDays className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-auto p-0" aria-label={`${label} calendar`}>
          <Calendar
            mode="single"
            selected={selected}
            defaultMonth={selected ?? minDate ?? today}
            onSelect={(d) => pick(calendarDateToIso(d))}
            disabled={minDate ? { before: minDate } : undefined}
            modifiers={marked.length ? { marked } : undefined}
            modifiersClassNames={marked.length ? { marked: "font-bold underline decoration-primary decoration-2 underline-offset-4" } : undefined}
            weekStartsOn={1}
            initialFocus
          />
          <div className="flex items-center justify-between gap-2 border-t border-border px-3 py-2 text-body-sm">
            {marked.length ? (
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <span className="font-bold text-foreground underline decoration-primary decoration-2 underline-offset-4">Underlined</span>
                <span>= {markLabel.toLowerCase()}</span>
              </span>
            ) : (
              <span className="text-muted-foreground">Dates in IST</span>
            )}
            <button
              type="button"
              onClick={() => pick(istDateString())}
              disabled={!!min && istDateString() < min}
              className="rounded-chip px-2 py-1 font-semibold text-primary-ink hover:bg-accent focus-visible:shadow-ember focus-visible:outline-none disabled:opacity-50"
            >
              Today
            </button>
          </div>
        </PopoverContent>
      </Popover>
      {hint ? (
        <div id={hintId} className="text-body-sm text-muted-foreground">
          {hint}
        </div>
      ) : null}
    </div>
  );
}
