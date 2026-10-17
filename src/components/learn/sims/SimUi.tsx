import { useId, type ReactNode } from "react";
import * as SliderPrimitive from "@radix-ui/react-slider";
import { Clock, FlaskConical, Radio, Sigma } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useSimSpot } from "../simSpot";

/** Frame shared by every simulator: title, data-source badges and a model note. */
export function SimCard({ title, icon, children, footnote, className }: { title: string; icon?: ReactNode; children: ReactNode; footnote?: ReactNode; className?: string }) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className={cn("rounded-card border border-border bg-card p-4 shadow-card sm:p-5", className)}>
      <header className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h3 id={headingId} className="flex items-center gap-2 font-display text-lead font-bold text-foreground">
          <span className="grid h-7 w-7 place-items-center rounded-tile bg-product-wash text-product" aria-hidden="true">
            {icon ?? <Sigma className="h-4 w-4" />}
          </span>
          {title}
        </h3>
        <div className="flex flex-wrap items-center gap-1.5">
          <SpotSourceBadge />
          <Badge variant="info" title="Prices come from the Black-Scholes model in @/lib/options, not from the exchange.">
            Model prices
          </Badge>
        </div>
      </header>
      {children}
      <p className="mt-4 border-t border-border pt-3 text-body-sm text-muted-foreground">
        {footnote ?? "Interactive model for learning. Real premiums differ with skew, bid-ask spreads and demand."}
      </p>
    </section>
  );
}

export function SpotSourceBadge() {
  const s = useSimSpot();
  if (s.kind === "live")
    return (
      <Badge variant="bullish">
        <Radio aria-hidden="true" /> {s.label}
      </Badge>
    );
  if (s.kind === "delayed")
    return (
      <Badge variant="neutral">
        <Clock aria-hidden="true" /> {s.label}
      </Badge>
    );
  return (
    <Badge variant="warning">
      <FlaskConical aria-hidden="true" /> Sample data
    </Badge>
  );
}

/** Accessible slider: visible label, live value and an aria-label on the thumb. */
export function SimSlider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format,
  hint,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
  hint?: string;
}) {
  const id = useId();
  const text = format ? format(value) : String(value);
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-label uppercase text-muted-foreground">
          {label}
        </label>
        <output htmlFor={id} className="font-num text-body font-semibold tabular-nums text-foreground" aria-live="polite">
          {text}
        </output>
      </div>
      <SliderPrimitive.Root
        className="relative flex h-6 w-full touch-none select-none items-center"
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={(v) => onChange(v[0] ?? value)}
      >
        <SliderPrimitive.Track className="relative h-1.5 w-full grow overflow-hidden rounded-capsule bg-muted">
          <SliderPrimitive.Range className="absolute h-full bg-primary" />
        </SliderPrimitive.Track>
        <SliderPrimitive.Thumb
          id={id}
          aria-label={label}
          aria-valuetext={text}
          className="block h-5 w-5 cursor-grab rounded-capsule border-2 border-primary bg-card shadow-card transition-transform duration-fast ease-press focus-visible:shadow-ember focus-visible:outline-none active:scale-110 active:cursor-grabbing"
        />
      </SliderPrimitive.Root>
      {hint ? <p className="text-body-sm text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/** Small labelled number tile. */
export function SimStat({ label, value, tone, sub }: { label: string; value: ReactNode; tone?: "bullish" | "bearish" | "warning" | "info"; sub?: ReactNode }) {
  return (
    <div className="min-w-0 rounded-tile border border-border bg-surface px-3 py-2">
      <div className="truncate text-label uppercase text-muted-foreground">{label}</div>
      <div
        className={cn(
          "mt-1 truncate font-num text-lead font-bold tabular-nums",
          tone === "bullish" && "text-bullish",
          tone === "bearish" && "text-bearish",
          tone === "warning" && "text-warning",
          tone === "info" && "text-info",
          !tone && "text-foreground",
        )}
      >
        {value}
      </div>
      {sub ? <div className="mt-0.5 truncate text-body-sm text-muted-foreground">{sub}</div> : null}
    </div>
  );
}

/** Radio-style segmented control (keyboard: arrow keys via native radios). */
export function SimSegmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: ReadonlyArray<{ value: T; label: string }>; onChange: (v: T) => void }) {
  const name = useId();
  return (
    <fieldset className="min-w-0">
      <legend className="mb-1.5 text-label uppercase text-muted-foreground">{label}</legend>
      <div className="inline-flex flex-wrap gap-1 rounded-tab bg-muted p-1">
        {options.map((o) => {
          const checked = o.value === value;
          return (
            <label
              key={o.value}
              className={cn(
                "relative cursor-pointer rounded-pill px-2.5 py-1 text-body-sm font-semibold transition-colors duration-fast focus-within:shadow-ember",
                checked ? "bg-card text-foreground shadow-card" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <input type="radio" name={name} value={o.value} checked={checked} onChange={() => onChange(o.value)} className="sr-only" />
              {o.label}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
