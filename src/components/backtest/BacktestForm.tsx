import { useId, useState, type ReactNode } from "react";
import { Play, RotateCcw, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Segmented } from "@/components/strategy/Segmented";
import { BACKTEST_SYMBOLS, PERIOD_MONTHS, WEEKDAY_SHORT, type BacktestSettings, type StrikeMode } from "@/lib/backtest";
import { BROKER_PRESETS, getContractSpec } from "@/lib/options";
import { TEMPLATE_VIEWS, getTemplate, templatesByView } from "@/lib/strategyTemplates";
import { cn } from "@/lib/utils";

export interface BacktestFormProps {
  settings: BacktestSettings;
  onChange: (patch: Partial<BacktestSettings>) => void;
  onRun: () => void;
  onCancel: () => void;
  onReset: () => void;
  busy: boolean;
  /** The local proxy answered recently (NSE bhavcopy is available). */
  proxyOnline: boolean;
  /** The app is built in sample-data mode: the proxy is never contacted. */
  sampleOnly: boolean;
  /** Bumped by the parent on reset. */
  resetKey: number;
}

function FieldLabel({ htmlFor, children, hint }: { htmlFor?: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <Label htmlFor={htmlFor} className="text-label text-muted-foreground">
        {children}
      </Label>
      {hint ? <span className="text-body-sm text-muted-foreground">{hint}</span> : null}
    </div>
  );
}

function Section({ title, children, id }: { title: string; children: ReactNode; id: string }) {
  return (
    <section className="space-y-2.5 border-t border-separator pt-3 first:border-t-0 first:pt-0" aria-labelledby={id}>
      <h2 id={id} className="font-display text-headline text-foreground">
        {title}
      </h2>
      {children}
    </section>
  );
}

/**
 * Number input that keeps the typed text while editing and commits a parsed number (or null when
 * `optional` and blank). Invalid text reverts on blur.
 */
function NumberField(p: {
  id: string;
  value: number | null;
  onCommit: (v: number | null) => void;
  min: number;
  max: number;
  step?: number;
  optional?: boolean;
  prefix?: string;
  suffix?: string;
  placeholder?: string;
  describedBy?: string;
  /** Accessible name when no visible <label htmlFor> points at this field. */
  ariaLabel?: string;
}) {
  const [text, setText] = useState<string | null>(null);
  const shown = text ?? (p.value === null ? "" : String(p.value));
  const commit = (raw: string) => {
    const t = raw.replace(/[,\s₹%]/g, "");
    if (t === "") {
      if (p.optional) p.onCommit(null);
      setText(null);
      return;
    }
    const v = Number(t);
    if (Number.isFinite(v)) p.onCommit(Math.min(p.max, Math.max(p.min, v)));
    setText(null);
  };
  return (
    <div className="relative">
      {p.prefix ? <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-body-sm text-muted-foreground">{p.prefix}</span> : null}
      <Input
        id={p.id}
        inputMode="decimal"
        value={shown}
        placeholder={p.placeholder}
        aria-describedby={p.describedBy}
        aria-label={p.ariaLabel}
        onChange={(e) => setText(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit((e.target as HTMLInputElement).value);
        }}
        className={cn("font-num tabular-nums", p.prefix && "pl-6", p.suffix && "pr-8")}
      />
      {p.suffix ? <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-body-sm text-muted-foreground">{p.suffix}</span> : null}
    </div>
  );
}

const STRIKE_MODES: ReadonlyArray<{ value: StrikeMode; label: string; title: string }> = [
  { value: "template", label: "Template", title: "Use the strikes the template defines" },
  { value: "atm", label: "ATM ± N", title: "Short strikes N steps out of the money" },
  { value: "delta", label: "Delta", title: "Short strikes at a target delta" },
  { value: "premium", label: "Premium", title: "Short strikes nearest a target premium" },
];

/** Settings panel for the backtester: data, strategy, entry, strikes, exits and costs. */
export function BacktestForm(p: BacktestFormProps) {
  const id = useId();
  const s = p.settings;
  const tpl = getTemplate(s.templateId);
  const spec = getContractSpec(s.symbol);
  const weeklyListed = !!spec?.weekly;
  // Number fields re-mount when the parent bumps resetKey (after "Reset"), dropping any typed text.
  const capitalKey = p.resetKey;

  const bhavUnavailable = p.sampleOnly || !p.proxyOnline;

  return (
    <form
      className="space-y-4"
      aria-label="Backtest settings"
      onSubmit={(e) => {
        e.preventDefault();
        if (!p.busy) p.onRun();
      }}
    >
      <Section title="Data" id={`${id}-data`}>
        <div className="space-y-1">
          <FieldLabel>Source</FieldLabel>
          <Segmented
            ariaLabel="Data source"
            value={s.data}
            onChange={(v) => p.onChange({ data: v })}
            options={[
              { value: "sample", label: "Sample dataset", title: "Seeded Black-76 dataset, Oct 2025 – Sep 2026. Not market data." },
              { value: "bhavcopy", label: "NSE bhavcopy", title: "End-of-day F&O bhavcopy through the local proxy, cached in this browser" },
            ]}
            size="md"
            fill
          />
          <p className="text-body-sm text-muted-foreground" role="note">
            {s.data === "sample"
              ? "A generated, clearly labelled teaching dataset. Use it to learn the tool, not to judge a strategy."
              : bhavUnavailable
                ? p.sampleOnly
                  ? "This build runs in sample-data mode, so the run will fall back to the sample."
                  : "The local proxy is offline right now. Start it with npm run proxy, or the run falls back to the sample."
                : "One NSE file per session through the local proxy. The first load can take a few minutes; later runs read the browser cache."}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <FieldLabel htmlFor={`${id}-sym`}>Underlying</FieldLabel>
            <Select value={s.symbol} onValueChange={(v) => p.onChange({ symbol: v })}>
              <SelectTrigger id={`${id}-sym`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BACKTEST_SYMBOLS.map((sym) => (
                  <SelectItem key={sym} value={sym}>
                    {sym}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <FieldLabel>Period</FieldLabel>
            <Segmented
              ariaLabel="Backtest period"
              value={String(s.months)}
              onChange={(v) => p.onChange({ months: Number(v) })}
              options={PERIOD_MONTHS.map((m) => ({ value: String(m), label: m === 12 ? "1Y" : `${m}M`, title: `Last ${m} months` }))}
              size="md"
              fill
            />
          </div>
        </div>
      </Section>

      <Section title="Strategy" id={`${id}-strategy`}>
        <div className="space-y-1">
          <FieldLabel htmlFor={`${id}-tpl`} hint={tpl ? `${tpl.view} · ${tpl.risk} risk` : undefined}>
            Template
          </FieldLabel>
          <Select value={s.templateId} onValueChange={(v) => p.onChange({ templateId: v })}>
            <SelectTrigger id={`${id}-tpl`} aria-describedby={`${id}-tpl-desc`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-h-[320px]">
              {TEMPLATE_VIEWS.map((view) => (
                <SelectGroup key={view}>
                  <SelectLabel>{view}</SelectLabel>
                  {templatesByView(view).map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
          {tpl ? (
            <p id={`${id}-tpl-desc`} className="text-body-sm text-muted-foreground">
              {tpl.description}
            </p>
          ) : null}
        </div>
        <div className="grid grid-cols-[88px_1fr] gap-2">
          <div className="space-y-1">
            <FieldLabel htmlFor={`${id}-lots`}>Lots</FieldLabel>
            <NumberField key={`lots-${capitalKey}`} id={`${id}-lots`} value={s.lots} min={1} max={500} onCommit={(v) => p.onChange({ lots: Math.round(v ?? 1) })} />
          </div>
          <div className="space-y-1">
            <FieldLabel htmlFor={`${id}-cap`}>Capital</FieldLabel>
            <NumberField key={`cap-${capitalKey}`} id={`${id}-cap`} prefix="₹" value={s.capital} min={10_000} max={1e10} onCommit={(v) => p.onChange({ capital: v ?? 500_000 })} />
          </div>
        </div>
      </Section>

      <Section title="Entry" id={`${id}-entry`}>
        <div className="space-y-1">
          <FieldLabel hint={weeklyListed ? undefined : "Monthly contracts only"}>Expiry</FieldLabel>
          <Segmented
            ariaLabel="Expiry series"
            value={s.series}
            onChange={(v) => p.onChange({ series: v })}
            options={[
              { value: "nearest", label: weeklyListed ? "Weekly (nearest)" : "Nearest", title: "The nearest listed expiry with enough DTE" },
              { value: "monthly", label: "Monthly", title: "Monthly expiries only" },
            ]}
            size="md"
            fill
          />
        </div>
        <div className="space-y-1">
          <FieldLabel>Timing</FieldLabel>
          <Segmented
            ariaLabel="Entry timing"
            value={s.timing}
            onChange={(v) => p.onChange({ timing: v })}
            options={[
              { value: "dte", label: "Days to expiry", title: "One trade per expiry, opened N calendar days before it" },
              { value: "weekday", label: "Weekdays", title: "Open on chosen weekdays into the nearest expiry" },
            ]}
            size="md"
            fill
          />
        </div>
        <div className="grid grid-cols-[88px_1fr] items-start gap-2">
          <div className="space-y-1">
            <FieldLabel htmlFor={`${id}-dte`}>{s.timing === "dte" ? "DTE" : "Min DTE"}</FieldLabel>
            <NumberField key={`dte-${capitalKey}`} id={`${id}-dte`} value={s.dte} min={1} max={90} onCommit={(v) => p.onChange({ dte: Math.round(v ?? 1) })} />
          </div>
          <div className="space-y-1">
            <FieldLabel hint={s.weekdays.length ? undefined : "Any day"}>{s.timing === "dte" ? "Only on" : "Enter on"}</FieldLabel>
            <ToggleGroup
              type="multiple"
              aria-label="Entry weekdays"
              value={s.weekdays.map(String)}
              onValueChange={(v) => p.onChange({ weekdays: v.map(Number).sort() })}
              className="grid grid-cols-5 gap-px"
            >
              {[1, 2, 3, 4, 5].map((d) => (
                <ToggleGroupItem
                  key={d}
                  value={String(d)}
                  size="sm"
                  aria-label={WEEKDAY_SHORT[d]}
                  className="min-w-0 px-0"
                >
                  {WEEKDAY_SHORT[d]}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
        </div>
        <p className="text-body-sm text-muted-foreground">
          {s.timing === "dte"
            ? `Opens at the close ${s.dte} calendar day${s.dte === 1 ? "" : "s"} before each expiry (the session before, if that day is a holiday).`
            : `Opens at the close on ${s.weekdays.length ? s.weekdays.map((d) => WEEKDAY_SHORT[d]).join(", ") : "every session"} into the nearest expiry at least ${s.dte} day${s.dte === 1 ? "" : "s"} away.`}{" "}
          One position at a time.
        </p>
      </Section>

      <Section title="Strikes" id={`${id}-strikes`}>
        <Segmented ariaLabel="Strike selection" value={s.strikeMode} onChange={(v) => p.onChange({ strikeMode: v })} options={STRIKE_MODES} size="md" fill />
        {s.strikeMode === "atm" && (
          <div className="grid grid-cols-[88px_1fr] items-center gap-2">
            <NumberField key={`atm-${capitalKey}`} id={`${id}-atm`} ariaLabel="Strikes out of the money" value={s.atmOffset} min={0} max={40} onCommit={(v) => p.onChange({ atmOffset: Math.round(v ?? 0) })} describedBy={`${id}-atm-h`} />
            <p id={`${id}-atm-h`} className="text-body-sm text-muted-foreground">
              Strikes out of the money (0 = ATM). Step {spec?.strikeStep ?? 50}.
            </p>
          </div>
        )}
        {s.strikeMode === "delta" && (
          <div className="grid grid-cols-[88px_1fr] items-center gap-2">
            <NumberField key={`delta-${capitalKey}`} id={`${id}-delta`} ariaLabel="Target delta for short strikes" value={s.delta} min={0.02} max={0.9} onCommit={(v) => p.onChange({ delta: v ?? 0.2 })} describedBy={`${id}-delta-h`} />
            <p id={`${id}-delta-h`} className="text-body-sm text-muted-foreground">
              Target |Δ| for the short strikes (0.16 ≈ 1σ).
            </p>
          </div>
        )}
        {s.strikeMode === "premium" && (
          <div className="grid grid-cols-[110px_1fr] items-center gap-2">
            <NumberField key={`prem-${capitalKey}`} id={`${id}-prem`} prefix="₹" value={s.premium} min={0.05} max={100_000} onCommit={(v) => p.onChange({ premium: v ?? 40 })} describedBy={`${id}-prem-h`} />
            <p id={`${id}-prem-h`} className="text-body-sm text-muted-foreground">
              Out-of-the-money strike nearest this premium per unit.
            </p>
          </div>
        )}
        <p className="text-body-sm text-muted-foreground">
          {s.strikeMode === "template"
            ? "Strikes exactly as the template defines them."
            : "The short strike of each side moves; wings, hedges and calendar legs keep their distance to it."}
        </p>
      </Section>

      <Section title="Exits" id={`${id}-exits`}>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <FieldLabel htmlFor={`${id}-tp`}>Profit target</FieldLabel>
            <NumberField key={`tp-${capitalKey}`} id={`${id}-tp`} optional placeholder="Off" suffix="%" value={s.profitPct} min={1} max={10_000} onCommit={(v) => p.onChange({ profitPct: v })} />
          </div>
          <div className="space-y-1">
            <FieldLabel htmlFor={`${id}-sl`}>Stop loss</FieldLabel>
            <NumberField key={`sl-${capitalKey}`} id={`${id}-sl`} optional placeholder="Off" suffix="%" value={s.stopPct} min={1} max={10_000} onCommit={(v) => p.onChange({ stopPct: v })} />
          </div>
          <div className="space-y-1">
            <FieldLabel htmlFor={`${id}-held`}>Days held</FieldLabel>
            <NumberField key={`held-${capitalKey}`} id={`${id}-held`} optional placeholder="Off" value={s.maxDaysHeld} min={1} max={90} onCommit={(v) => p.onChange({ maxDaysHeld: v === null ? null : Math.round(v) })} />
          </div>
          <div className="space-y-1">
            <FieldLabel htmlFor={`${id}-xdte`}>Exit at DTE</FieldLabel>
            <NumberField key={`xdte-${capitalKey}`} id={`${id}-xdte`} optional placeholder="Off" value={s.exitDte} min={0} max={90} onCommit={(v) => p.onChange({ exitDte: v === null ? null : Math.round(v) })} />
          </div>
        </div>
        <p className="text-body-sm text-muted-foreground">
          Profit and stop are a % of the premium collected or paid (of estimated margin when the structure costs almost nothing), checked at each close. Leave blank to hold to expiry.
        </p>
      </Section>

      <Section title="Costs" id={`${id}-costs`}>
        <div className="grid grid-cols-[1fr_96px] gap-2">
          <div className="space-y-1">
            <FieldLabel htmlFor={`${id}-broker`}>Broker</FieldLabel>
            <Select value={s.brokerId} onValueChange={(v) => p.onChange({ brokerId: v })}>
              <SelectTrigger id={`${id}-broker`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BROKER_PRESETS.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.name} {b.perOrder > 0 ? `· ₹${b.perOrder}/order` : "· no brokerage"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <FieldLabel htmlFor={`${id}-slip`}>Slippage</FieldLabel>
            <NumberField key={`slip-${capitalKey}`} id={`${id}-slip`} suffix="%" value={s.slippagePct} min={0} max={20} onCommit={(v) => p.onChange({ slippagePct: v ?? 0 })} />
          </div>
        </div>
        <p className="text-body-sm text-muted-foreground">STT, exchange, SEBI, stamp duty and GST at the rates in force on each fill date, plus STT on long options exercised at expiry.</p>
      </Section>

      {/* Sticky so Run stays reachable while scrolling the long settings column. */}
      <div className="sticky bottom-0 z-10 -mx-3 -mb-3 flex gap-2 rounded-b-tile border-t border-separator bg-card px-3 py-2.5">
        {p.busy ? (
          <Button type="button" variant="secondary" className="flex-1" onClick={p.onCancel}>
            <Square aria-hidden="true" /> Cancel
          </Button>
        ) : (
          <Button type="submit" className="flex-1">
            <Play aria-hidden="true" /> Run backtest
          </Button>
        )}
        <Button type="button" variant="ghost" size="icon" onClick={p.onReset} aria-label="Reset settings to defaults" title="Reset settings" disabled={p.busy}>
          <RotateCcw aria-hidden="true" />
        </Button>
      </div>
    </form>
  );
}
