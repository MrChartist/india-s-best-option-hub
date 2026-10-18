import { useId, useState, type ReactNode } from "react";
import { CalendarDays, ChevronDown, SlidersHorizontal, TrendingDown, TrendingUp, Minus, ChevronsDown, ChevronsUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Segmented } from "@/components/strategy/Segmented";
import { SymbolPicker } from "@/components/strategy/SymbolPicker";
import type { ExpiryDate } from "@/lib/mockData";
import { addCalendarDays, calendarDaysBetween, formatCompactIN, formatDateIST, formatStrike } from "@/lib/options";
import { calendarDateToIso, isoToCalendarDate } from "@/lib/calendarDate";
import { CATEGORY_LABELS, CATEGORY_ORDER, SENTIMENTS, type Pricing, type Sentiment, type StrategyCategory } from "@/lib/optimizer";
import { cn } from "@/lib/utils";
import { TargetPriceChart } from "./TargetPriceChart";
import type { FormSettings } from "./formSettings";

export type { FormSettings } from "./formSettings";

export interface ChartContext {
  forward: number;
  sigma: number;
  T: number;
  lower: number;
  upper: number;
}

export interface OptimizerFormProps {
  symbol: string;
  onSymbolChange: (s: string) => void;
  expiries: ExpiryDate[];
  expiry: string;
  onExpiryChange: (e: string) => void;
  spot: number;
  step: number;
  chart: ChartContext | null;
  targetPrice: number;
  onTargetPrice: (p: number) => void;
  activeSentiment: Sentiment | null;
  onSentiment: (s: Sentiment) => void;
  targetDate: string;
  onTargetDate: (d: string) => void;
  minDate: string;
  maxDate: string;
  settings: FormSettings;
  onSettings: (patch: Partial<FormSettings>) => void;
  onReset: () => void;
}

const BUDGET_PRESETS = [25000, 50000, 100000, 200000, 500000];

const SENTIMENT_ICON: Record<Sentiment, typeof TrendingUp> = {
  very_bearish: ChevronsDown,
  bearish: TrendingDown,
  neutral: Minus,
  bullish: TrendingUp,
  very_bullish: ChevronsUp,
};

function FieldLabel({ htmlFor, children, hint }: { htmlFor?: string; children: ReactNode; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <Label htmlFor={htmlFor} className="text-label text-muted-foreground">
        {children}
      </Label>
      {hint && <span className="text-body-sm text-muted-foreground">{hint}</span>}
    </div>
  );
}

function midDate(a: string, b: string): string {
  const days = calendarDaysBetween(a, b);
  if (!Number.isFinite(days) || days <= 0) return b;
  return addCalendarDays(a, Math.round(days / 2)) || b;
}

/** yyyy-mm-dd → a local Date at midnight on that calendar day (what the day picker works in). */
const isoToLocal = (iso: string): Date | undefined => isoToCalendarDate(iso) ?? undefined;
const localToIso = calendarDateToIso;

/**
 * A rupee or price typed by the user. Only grouping commas, spaces and the ₹ sign are stripped;
 * anything else that is not a positive finite number ("-50000", "abc") is rejected (null).
 */
function parseAmount(text: string): number | null {
  const t = text.replace(/[,\s₹]/g, "");
  if (t === "") return null;
  const v = Number(t);
  return Number.isFinite(v) && v > 0 ? v : null;
}

/**
 * Number input that keeps the typed text and clamps on blur or Enter, so a value like 12 can be
 * typed digit by digit even when the minimum is 2.
 */
function NumberField({ id, value, min, max, step, onCommit }: { id: string; value: number; min?: number; max?: number; step?: number; onCommit: (v: number) => void }) {
  const [text, setText] = useState<string | null>(null);
  const commit = () => {
    if (text === null) return;
    const v = Number(text);
    if (text.trim() !== "" && Number.isFinite(v)) onCommit(v);
    setText(null);
  };
  return (
    <Input
      id={id}
      type="number"
      min={min}
      max={max}
      step={step}
      className="font-num text-body"
      value={text ?? String(value)}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
      }}
    />
  );
}

/** Inputs for the optimizer: underlying, expiry, target, date, budget and the return-vs-chance slider. */
export function OptimizerForm(p: OptimizerFormProps) {
  const id = useId();
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [dateOpen, setDateOpen] = useState(false);
  const { settings: s, onSettings } = p;
  const [budgetText, setBudgetText] = useState<string | null>(null);
  const [targetText, setTargetText] = useState<string | null>(null);

  const commitBudget = (text: string) => {
    const v = parseAmount(text);
    if (v !== null) onSettings({ budget: Math.min(v, 1e9) });
    setBudgetText(null);
  };
  const commitTarget = (text: string) => {
    const v = parseAmount(text);
    if (v !== null) p.onTargetPrice(v);
    setTargetText(null);
  };

  const toggleCategory = (cat: StrategyCategory, on: boolean) => {
    const set = new Set(s.categories);
    if (on) set.add(cat);
    else set.delete(cat);
    if (set.size === 0) return;
    onSettings({ categories: CATEGORY_ORDER.filter((c) => set.has(c)) });
  };

  const wPct = Math.round(s.w * 100);
  const mid = midDate(p.minDate, p.maxDate);

  return (
    <div className="space-y-4">
      {/* Underlying and expiry */}
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <FieldLabel>Underlying</FieldLabel>
          <SymbolPicker value={p.symbol} onChange={p.onSymbolChange} />
        </div>
        <div className="space-y-1">
          <FieldLabel htmlFor={`${id}-expiry`}>Expiry</FieldLabel>
          <Select value={p.expiry ?? ""} onValueChange={p.onExpiryChange} disabled={p.expiries.length === 0}>
            <SelectTrigger id={`${id}-expiry`} className="text-body-sm">
              <SelectValue placeholder="Loading…" />
            </SelectTrigger>
            <SelectContent>
              {p.expiries.map((e) => (
                <SelectItem key={e.value} value={e.value} className="text-body-sm">
                  {formatDateIST(e.value)} · {e.daysToExpiry}d
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Target price */}
      <section className="space-y-2" aria-labelledby={`${id}-target-h`}>
        <div className="flex items-end justify-between gap-2">
          <div>
            <h2 id={`${id}-target-h`} className="text-label text-muted-foreground">
              Target price
            </h2>
            <p className="text-body-sm text-muted-foreground">Spot {formatStrike(Math.round(p.spot * 100) / 100)} · drag the chart or type</p>
          </div>
          <Input
            aria-label="Target price"
            inputMode="decimal"
            className="w-28 text-right font-num text-body tabular-nums"
            value={targetText ?? String(p.targetPrice || "")}
            onChange={(e) => setTargetText(e.target.value)}
            onBlur={(e) => commitTarget(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitTarget((e.target as HTMLInputElement).value);
            }}
          />
        </div>
        {p.chart && p.spot > 0 ? (
          <div className="rounded-md bg-control-track px-1 pt-1">
            <TargetPriceChart
              spot={p.spot}
              forward={p.chart.forward}
              sigma={p.chart.sigma}
              T={p.chart.T}
              target={p.targetPrice}
              onChange={p.onTargetPrice}
              step={p.step}
              lower={p.chart.lower}
              upper={p.chart.upper}
            />
          </div>
        ) : (
          <Skeleton className="h-32 w-full" />
        )}
        <div className="grid grid-cols-5 gap-px rounded-pill bg-control-track p-0.5" role="group" aria-label="Sentiment shortcuts">
          {SENTIMENTS.map((x) => {
            const Icon = SENTIMENT_ICON[x.id];
            const active = p.activeSentiment === x.id;
            const tone = x.sigmas > 0 ? "text-bullish" : x.sigmas < 0 ? "text-bearish" : "text-muted-foreground";
            return (
              <button
                key={x.id}
                type="button"
                aria-pressed={active}
                onClick={() => p.onSentiment(x.id)}
                title={x.sigmas === 0 ? "Target = spot" : `Target = spot ${x.sigmas > 0 ? "+" : "−"}${Math.abs(x.sigmas)}σ`}
                className={cn(
                  "flex min-w-0 flex-col items-center gap-0.5 rounded-[5px] px-1 py-1.5 text-micro leading-tight transition-[background-color,color,box-shadow] duration-base ease-spring focus-visible:shadow-focus focus-visible:outline-none",
                  active ? "bg-control text-foreground shadow-control" : "text-foreground/70 hover:text-foreground",
                )}
              >
                <Icon className={cn("h-3.5 w-3.5", tone)} aria-hidden="true" />
                <span className="w-full text-center [overflow-wrap:anywhere]">{x.label}</span>
              </button>
            );
          })}
        </div>
      </section>

      {/* Target date */}
      <div className="space-y-1">
        <FieldLabel htmlFor={`${id}-date`} hint="IST, 15:30 close">
          Target date
        </FieldLabel>
        <div className="flex flex-wrap items-center gap-1.5">
          <Popover open={dateOpen} onOpenChange={setDateOpen}>
            <PopoverTrigger asChild>
              <Button
                id={`${id}-date`}
                type="button"
                variant="outline"
                size="sm"
                className="w-[132px] justify-start gap-1.5 px-2 font-num text-body-sm tabular-nums"
                aria-label={p.targetDate ? `Target date ${formatDateIST(p.targetDate)}. Change date` : "Choose target date"}
              >
                <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                {p.targetDate ? formatDateIST(p.targetDate) : "Choose date"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={isoToLocal(p.targetDate)}
                defaultMonth={isoToLocal(p.targetDate) ?? isoToLocal(p.minDate)}
                fromDate={isoToLocal(p.minDate)}
                toDate={isoToLocal(p.maxDate)}
                disabled={[...(isoToLocal(p.minDate) ? [{ before: isoToLocal(p.minDate) as Date }] : []), ...(isoToLocal(p.maxDate) ? [{ after: isoToLocal(p.maxDate) as Date }] : [])]}
                onSelect={(d) => {
                  if (!d) return;
                  p.onTargetDate(localToIso(d));
                  setDateOpen(false);
                }}
                initialFocus
              />
              <p className="hairline-t px-3 py-2 text-body-sm text-muted-foreground">
                {formatDateIST(p.minDate)} to {formatDateIST(p.maxDate)} (expiry). Valued at the 15:30 IST close.
              </p>
            </PopoverContent>
          </Popover>
          {[
            { label: "Today", value: p.minDate },
            { label: "Midway", value: mid },
            { label: "Expiry", value: p.maxDate },
          ].map((c) => (
            <Button key={c.label} type="button" size="pill" variant={p.targetDate === c.value ? "secondary" : "ghost"} onClick={() => p.onTargetDate(c.value)} aria-pressed={p.targetDate === c.value}>
              {c.label}
            </Button>
          ))}
        </div>
      </div>

      {/* Budget and lots */}
      <div className="grid grid-cols-[1fr_88px] gap-2">
        <div className="space-y-1">
          <FieldLabel htmlFor={`${id}-budget`} hint={formatCompactIN(s.budget, { symbol: true })}>
            Budget (margin)
          </FieldLabel>
          <div className="relative">
            <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-body-sm text-muted-foreground">₹</span>
            <Input
              id={`${id}-budget`}
              inputMode="numeric"
              className="pl-6 font-num text-body tabular-nums"
              value={budgetText ?? s.budget.toLocaleString("en-IN")}
              onChange={(e) => setBudgetText(e.target.value)}
              onBlur={(e) => commitBudget(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitBudget((e.target as HTMLInputElement).value);
              }}
            />
          </div>
        </div>
        <div className="space-y-1">
          <FieldLabel htmlFor={`${id}-lots`}>Max lots</FieldLabel>
          <Input
            id={`${id}-lots`}
            type="number"
            min={1}
            max={100}
            className="font-num text-body tabular-nums"
            value={s.maxLots}
            onChange={(e) => {
              const v = Math.round(Number(e.target.value));
              if (Number.isFinite(v)) onSettings({ maxLots: Math.min(100, Math.max(1, v)) });
            }}
          />
        </div>
      </div>
      <div className="-mt-2 flex flex-wrap gap-1" role="group" aria-label="Budget presets">
        {BUDGET_PRESETS.map((b) => (
          <Button key={b} type="button" size="pill" variant={s.budget === b ? "secondary" : "ghost"} aria-pressed={s.budget === b} onClick={() => onSettings({ budget: b })}>
            {formatCompactIN(b, { symbol: true, decimals: 0 })}
          </Button>
        ))}
      </div>

      {/* Return vs chance */}
      <div className="space-y-1.5">
        <FieldLabel htmlFor={`${id}-w`}>Preference</FieldLabel>
        <input
          id={`${id}-w`}
          type="range"
          min={0}
          max={100}
          step={5}
          value={wPct}
          onChange={(e) => onSettings({ w: Number(e.target.value) / 100 })}
          aria-valuetext={wPct === 50 ? "Balanced" : wPct > 50 ? `${wPct}% weight on return` : `${100 - wPct}% weight on chance`}
          className="h-1 w-full cursor-pointer accent-primary"
        />
        <div className="flex justify-between text-body-sm font-medium">
          <span className={cn(wPct < 50 ? "text-info" : "text-muted-foreground")}>Max chance</span>
          <span className="text-muted-foreground">{wPct === 50 ? "Balanced" : `${Math.max(wPct, 100 - wPct)}%`}</span>
          <span className={cn(wPct > 50 ? "text-bullish" : "text-muted-foreground")}>Max return</span>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 rounded-tile bg-control-track px-2.5 py-2">
        <Label htmlFor={`${id}-dr`} className="text-body-sm font-semibold">
          Defined risk only
          <span className="block text-body-sm font-normal text-muted-foreground">Every short leg is covered by a long leg</span>
        </Label>
        <Switch id={`${id}-dr`} checked={s.definedRiskOnly} onCheckedChange={(v) => onSettings({ definedRiskOnly: v })} />
      </div>

      {/* Advanced */}
      <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
        <CollapsibleTrigger asChild>
          <Button type="button" variant="ghost" size="sm" className="w-full justify-between px-2 text-body-sm">
            <span className="inline-flex items-center gap-1.5">
              <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" /> Liquidity and scan settings
            </span>
            <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", advancedOpen && "rotate-180")} aria-hidden="true" />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-3 pt-2">
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <FieldLabel htmlFor={`${id}-n`}>Strikes ± ATM</FieldLabel>
              <NumberField id={`${id}-n`} min={2} max={20} value={s.strikesAroundAtm} onCommit={(v) => onSettings({ strikesAroundAtm: Math.min(20, Math.max(2, Math.round(v))) })} />
            </div>
            <div className="space-y-1">
              <FieldLabel htmlFor={`${id}-oi`}>Min OI (% of max)</FieldLabel>
              <NumberField id={`${id}-oi`} min={0} max={50} step={1} value={Math.round(s.minOiPct * 100)} onCommit={(v) => onSettings({ minOiPct: Math.min(0.5, Math.max(0, v / 100)) })} />
            </div>
            <div className="space-y-1">
              <FieldLabel htmlFor={`${id}-sp`}>Max spread %</FieldLabel>
              <NumberField id={`${id}-sp`} min={1} max={100} step={1} value={Math.round(s.maxSpreadPct * 100)} onCommit={(v) => onSettings({ maxSpreadPct: Math.min(1, Math.max(0.01, v / 100)) })} />
            </div>
            <div className="space-y-1">
              <FieldLabel htmlFor={`${id}-mp`}>Min premium ₹</FieldLabel>
              <NumberField id={`${id}-mp`} min={0} step={0.5} value={s.minPremium} onCommit={(v) => onSettings({ minPremium: Math.max(0, v) })} />
            </div>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-label text-muted-foreground">Fill price</span>
            <Segmented<Pricing>
              ariaLabel="Fill price"
              value={s.pricing}
              onChange={(v) => onSettings({ pricing: v })}
              options={[
                { value: "mid", label: "Mid", title: "Midpoint of bid and ask" },
                { value: "natural", label: "Natural", title: "Buy at ask, sell at bid (conservative)" },
              ]}
            />
          </div>
          <fieldset className="space-y-1.5">
            <legend className="text-label text-muted-foreground">Strategy families</legend>
            <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
              {CATEGORY_ORDER.map((cat) => {
                const checked = s.categories.includes(cat);
                return (
                  <label key={cat} className="flex cursor-pointer items-center gap-2 rounded-chip px-1 py-0.5 text-body-sm hover:bg-control-track">
                    <Checkbox checked={checked} onCheckedChange={(v) => toggleCategory(cat, v === true)} aria-label={CATEGORY_LABELS[cat]} />
                    {CATEGORY_LABELS[cat]}
                  </label>
                );
              })}
            </div>
          </fieldset>
          <Button type="button" variant="secondary" size="sm" className="w-full" onClick={p.onReset}>
            Reset to defaults
          </Button>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
