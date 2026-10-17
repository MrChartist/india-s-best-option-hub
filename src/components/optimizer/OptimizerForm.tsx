import { useId, useState, type ReactNode } from "react";
import { ChevronDown, SlidersHorizontal, TrendingDown, TrendingUp, Minus, ChevronsDown, ChevronsUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Segmented } from "@/components/strategy/Segmented";
import { SymbolPicker } from "@/components/strategy/SymbolPicker";
import type { ExpiryDate } from "@/lib/mockData";
import { formatCompactIN, formatDateIST, formatStrike } from "@/lib/options";
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
      <Label htmlFor={htmlFor} className="text-[11px] font-semibold uppercase tracking-[0.07em] text-muted-foreground">
        {children}
      </Label>
      {hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}
    </div>
  );
}

function midDate(a: string, b: string): string {
  const ta = Date.parse(`${a}T00:00:00Z`);
  const tb = Date.parse(`${b}T00:00:00Z`);
  if (!Number.isFinite(ta) || !Number.isFinite(tb) || tb <= ta) return b;
  const mid = new Date(ta + Math.round((tb - ta) / 2 / 86400000) * 86400000);
  return mid.toISOString().slice(0, 10);
}

/** Inputs for the optimizer: underlying, expiry, target, date, budget and the return-vs-chance slider. */
export function OptimizerForm(p: OptimizerFormProps) {
  const id = useId();
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const { settings: s, onSettings } = p;
  const [budgetText, setBudgetText] = useState<string | null>(null);
  const [targetText, setTargetText] = useState<string | null>(null);

  const commitBudget = (text: string) => {
    const v = Number(text.replace(/[^\d.]/g, ""));
    if (Number.isFinite(v) && v > 0) onSettings({ budget: Math.min(v, 1e9) });
    setBudgetText(null);
  };
  const commitTarget = (text: string) => {
    const v = Number(text.replace(/[^\d.]/g, ""));
    if (Number.isFinite(v) && v > 0) p.onTargetPrice(v);
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
            <SelectTrigger id={`${id}-expiry`} className="h-8 text-xs">
              <SelectValue placeholder="Loading…" />
            </SelectTrigger>
            <SelectContent>
              {p.expiries.map((e) => (
                <SelectItem key={e.value} value={e.value} className="text-xs">
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
            <h2 id={`${id}-target-h`} className="text-[11px] font-semibold uppercase tracking-[0.07em] text-muted-foreground">
              Target price
            </h2>
            <p className="text-[11px] text-muted-foreground">Spot {formatStrike(Math.round(p.spot * 100) / 100)} · drag the chart or type</p>
          </div>
          <Input
            aria-label="Target price"
            inputMode="decimal"
            className="h-8 w-28 text-right font-num text-sm tabular-nums"
            value={targetText ?? String(p.targetPrice || "")}
            onChange={(e) => setTargetText(e.target.value)}
            onBlur={(e) => commitTarget(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitTarget((e.target as HTMLInputElement).value);
            }}
          />
        </div>
        {p.chart && p.spot > 0 ? (
          <div className="rounded-tile border border-border bg-surface/60 px-1 pt-1">
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
        <div className="grid grid-cols-5 gap-1" role="group" aria-label="Sentiment shortcuts">
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
                  "flex min-w-0 flex-col items-center gap-0.5 rounded-tile border px-1 py-1.5 text-[10px] font-semibold leading-tight transition-colors duration-fast focus-visible:shadow-ember focus-visible:outline-none",
                  active ? "border-primary bg-wash-brand text-foreground" : "border-border bg-card text-muted-foreground hover:text-foreground",
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
          <Input
            id={`${id}-date`}
            type="date"
            className="h-8 w-[150px] font-num text-xs"
            min={p.minDate}
            max={p.maxDate}
            value={p.targetDate}
            onChange={(e) => e.target.value && p.onTargetDate(e.target.value)}
          />
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
            <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">₹</span>
            <Input
              id={`${id}-budget`}
              inputMode="numeric"
              className="h-8 pl-6 font-num text-sm tabular-nums"
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
            className="h-8 font-num text-sm tabular-nums"
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
          className="h-2 w-full cursor-pointer accent-primary"
        />
        <div className="flex justify-between text-[11px] font-semibold">
          <span className={cn(wPct < 50 ? "text-info" : "text-muted-foreground")}>Max chance</span>
          <span className="text-muted-foreground">{wPct === 50 ? "Balanced" : `${Math.max(wPct, 100 - wPct)}%`}</span>
          <span className={cn(wPct > 50 ? "text-bullish" : "text-muted-foreground")}>Max return</span>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 rounded-tile bg-muted/50 px-2.5 py-2">
        <Label htmlFor={`${id}-dr`} className="text-xs font-semibold">
          Defined risk only
          <span className="block text-[11px] font-normal text-muted-foreground">Every short leg is covered by a long leg</span>
        </Label>
        <Switch id={`${id}-dr`} checked={s.definedRiskOnly} onCheckedChange={(v) => onSettings({ definedRiskOnly: v })} />
      </div>

      {/* Advanced */}
      <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
        <CollapsibleTrigger asChild>
          <Button type="button" variant="ghost" size="sm" className="w-full justify-between px-2 text-xs">
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
              <Input id={`${id}-n`} type="number" min={2} max={20} className="h-8 font-num text-sm" value={s.strikesAroundAtm} onChange={(e) => {
                const v = Math.round(Number(e.target.value));
                if (Number.isFinite(v)) onSettings({ strikesAroundAtm: Math.min(20, Math.max(2, v)) });
              }} />
            </div>
            <div className="space-y-1">
              <FieldLabel htmlFor={`${id}-oi`}>Min OI (% of max)</FieldLabel>
              <Input id={`${id}-oi`} type="number" min={0} max={50} step={1} className="h-8 font-num text-sm" value={Math.round(s.minOiPct * 100)} onChange={(e) => {
                const v = Number(e.target.value);
                if (Number.isFinite(v)) onSettings({ minOiPct: Math.min(0.5, Math.max(0, v / 100)) });
              }} />
            </div>
            <div className="space-y-1">
              <FieldLabel htmlFor={`${id}-sp`}>Max spread %</FieldLabel>
              <Input id={`${id}-sp`} type="number" min={1} max={100} step={1} className="h-8 font-num text-sm" value={Math.round(s.maxSpreadPct * 100)} onChange={(e) => {
                const v = Number(e.target.value);
                if (Number.isFinite(v)) onSettings({ maxSpreadPct: Math.min(1, Math.max(0.01, v / 100)) });
              }} />
            </div>
            <div className="space-y-1">
              <FieldLabel htmlFor={`${id}-mp`}>Min premium ₹</FieldLabel>
              <Input id={`${id}-mp`} type="number" min={0} step={0.5} className="h-8 font-num text-sm" value={s.minPremium} onChange={(e) => {
                const v = Number(e.target.value);
                if (Number.isFinite(v)) onSettings({ minPremium: Math.max(0, v) });
              }} />
            </div>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.07em] text-muted-foreground">Fill price</span>
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
            <legend className="text-[11px] font-semibold uppercase tracking-[0.07em] text-muted-foreground">Strategy families</legend>
            <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
              {CATEGORY_ORDER.map((cat) => {
                const checked = s.categories.includes(cat);
                return (
                  <label key={cat} className="flex cursor-pointer items-center gap-2 rounded-chip px-1 py-0.5 text-xs hover:bg-muted/60">
                    <Checkbox checked={checked} onCheckedChange={(v) => toggleCategory(cat, v === true)} aria-label={CATEGORY_LABELS[cat]} />
                    {CATEGORY_LABELS[cat]}
                  </label>
                );
              })}
            </div>
          </fieldset>
          <Button type="button" variant="outline" size="sm" className="w-full text-xs" onClick={p.onReset}>
            Reset to defaults
          </Button>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
