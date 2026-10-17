import { useId, type ReactNode } from "react";
import { Info } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { symbolOptions, type Tone } from "./calcLogic";

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
          <h2 className="font-display text-title">{title}</h2>
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
        <SelectTrigger id={id}>
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

/** Native date input styled like the shadcn Input (accessible and mobile-friendly). */
export function DateField({ label, value, onChange, min, hint, className }: { label: string; value: string; onChange: (v: string) => void; min?: string; hint?: ReactNode; className?: string }) {
  const id = useId();
  return (
    <div className={cn("min-w-0 space-y-1", className)}>
      <Label htmlFor={id} className="block text-label uppercase text-muted-foreground">
        {label}
      </Label>
      <Input id={id} type="date" value={value} min={min} onChange={(e) => onChange(e.target.value)} className="font-num tabular-nums" />
      {hint ? <div className="text-body-sm text-muted-foreground">{hint}</div> : null}
    </div>
  );
}
