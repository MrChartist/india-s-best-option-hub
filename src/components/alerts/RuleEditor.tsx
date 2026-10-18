import { useId, useMemo, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { flowStore } from "@/lib/flow";
import { formatDateIST, getExpiries } from "@/lib/options";
import {
  ANY_ALLOWED,
  ANY_SYMBOL,
  CATEGORY_LABEL,
  GREEK_LABEL,
  GREEK_UNIT,
  RULE_CATEGORY,
  RULE_TYPES,
  RULE_TYPE_LABEL,
  STRIKE_FIELD_LABEL,
  describeRule,
  type AlertRule,
  type AlertRuleType,
  type ChannelKey,
  type GreekKey,
  type RuleCategory,
  type StrikeField,
} from "@/lib/alerts";
import { cn } from "@/lib/utils";
import { ALL_SYMBOLS } from "./alertConstants";
import {
  DEFAULT_DRAFT,
  draftFromRule,
  draftToRule,
  retypeDraft,
  type ChannelChoice,
  type RuleDraft,
} from "./ruleDraft";

function Field({
  id,
  label,
  hint,
  children,
  className,
}: {
  id: string;
  label: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0 space-y-1", className)}>
      <Label htmlFor={id} className="text-body-sm">
        {label}
      </Label>
      {children}
      {hint ? <p className="text-micro normal-case tracking-normal text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function NumInput({
  id,
  value,
  onChange,
  step = "any",
  placeholder,
  invalid,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  step?: string;
  placeholder?: string;
  invalid?: boolean;
}) {
  return (
    <Input
      id={id}
      type="number"
      inputMode="decimal"
      step={step}
      value={value}
      placeholder={placeholder}
      aria-invalid={invalid || undefined}
      onChange={(e) => onChange(e.target.value)}
      className="h-9 tabular-nums"
    />
  );
}

function SimpleSelect<T extends string>({
  id,
  value,
  onChange,
  options,
}: {
  id: string;
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: string }>;
}) {
  return (
    <Select key={options.map((o) => o.value).join("|")} value={value} onValueChange={(v) => v && onChange(v as T)}>
      <SelectTrigger id={id} className="text-body-sm">
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="max-h-72">
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

const CATEGORIES: RuleCategory[] = ["market", "chain", "flow", "positions"];
const CHANNEL_NAMES: Record<ChannelKey, string> = {
  toast: "In-app",
  desktop: "Browser",
  sound: "Sound",
  webhook: "Webhook",
};

export interface RuleEditorProps {
  /** Rule to edit; omit to create a new one. */
  rule?: AlertRule;
  /** Pre-filled draft for a new rule (e.g. from a template). */
  initial?: Partial<RuleDraft>;
  onSave: (rule: AlertRule) => string | null | void;
  onCancel: () => void;
  /** Hide the label and channel overrides (compact sheet form). */
  compact?: boolean;
  submitLabel?: string;
}

/** Create or edit any rule type. Validation uses the same guard as storage and imports. */
export function RuleEditor({ rule, initial, onSave, onCancel, compact = false, submitLabel }: RuleEditorProps) {
  const uid = useId();
  const id = (s: string) => `${uid}-${s}`;
  const [d, setD] = useState<RuleDraft>(() => {
    if (rule) return draftFromRule(rule);
    const spot = flowStore.getState().feeds[initial?.symbol ?? "NIFTY"]?.spot;
    const base = retypeDraft({ ...DEFAULT_DRAFT, ...initial }, initial?.type ?? DEFAULT_DRAFT.type, spot);
    return { ...base, ...initial };
  });
  const [error, setError] = useState<{ message: string; field?: string } | null>(null);
  const set = <K extends keyof RuleDraft>(k: K, v: RuleDraft[K]) => {
    setError(null);
    setD((x) => ({ ...x, [k]: v }));
  };
  const symbolChoices = ANY_ALLOWED.has(d.type) ? [ANY_SYMBOL, ...ALL_SYMBOLS] : ALL_SYMBOLS;
  const expiries = useMemo(
    () => (d.type === "strike_level" && d.symbol !== ANY_SYMBOL ? getExpiries(d.symbol, new Date(), 8) : []),
    [d.type, d.symbol],
  );
  const preview = useMemo(() => {
    const r = draftToRule(d, rule);
    return r.ok ? describeRule(r.rule) : null;
  }, [d, rule]);
  const bad = (f: string) => error?.field === f;

  const submit = () => {
    const r = draftToRule(d, rule);
    if (!r.ok) {
      setError({ message: r.error, field: r.field });
      return;
    }
    const msg = onSave(r.rule);
    if (typeof msg === "string") setError({ message: msg });
  };

  const isPosition = d.type === "position_pnl" || d.type === "position_greek";

  return (
    <form
      className="space-y-3"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field id={id("type")} label="Rule">
          <Select
            value={d.type}
            onValueChange={(v) => {
              setError(null);
              setD((x) => retypeDraft(x, v as AlertRuleType, flowStore.getState().feeds[x.symbol]?.spot));
            }}
          >
            <SelectTrigger id={id("type")} className="text-body-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-h-80">
              {CATEGORIES.map((c) => (
                <SelectGroup key={c}>
                  <SelectLabel className="text-micro text-muted-foreground">{CATEGORY_LABEL[c]}</SelectLabel>
                  {RULE_TYPES.filter((t) => RULE_CATEGORY[t] === c).map((t) => (
                    <SelectItem key={t} value={t}>
                      {RULE_TYPE_LABEL[t]}
                    </SelectItem>
                  ))}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field id={id("symbol")} label={isPosition ? "Positions in" : "Underlying"}>
          <Select
            key={ANY_ALLOWED.has(d.type) ? "scope-any" : "scope-one"}
            value={d.symbol}
            onValueChange={(v) => v && set("symbol", v)}
          >
            <SelectTrigger id={id("symbol")} className="text-body-sm" aria-invalid={bad("symbol") || undefined}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-h-72">
              {symbolChoices.map((s) => (
                <SelectItem key={s} value={s}>
                  {s === ANY_SYMBOL ? (isPosition ? "All underlyings" : "Any") : s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>

      {(d.type === "pcr_cross" ||
        d.type === "price_level" ||
        d.type === "iv_level" ||
        d.type === "ivp_level" ||
        d.type === "position_pnl" ||
        d.type === "premium_tide") && (
        <div className="grid grid-cols-2 gap-3">
          <Field id={id("dir")} label="When it">
            <SimpleSelect
              id={id("dir")}
              value={d.direction}
              onChange={(v) => set("direction", v)}
              options={
                d.type === "ivp_level" || d.type === "position_pnl"
                  ? [
                      { value: "above", label: "Is at or above" },
                      { value: "below", label: "Is at or below" },
                    ]
                  : [
                      { value: "above", label: "Crosses above" },
                      { value: "below", label: "Crosses below" },
                      { value: "either", label: "Crosses either way" },
                    ]
              }
            />
          </Field>
          {d.type === "premium_tide" ? (
            <Field id={id("tide")} label="Net tide (₹ crore)" hint="Negative for put-heavy. 0 = sign flip.">
              <NumInput
                id={id("tide")}
                value={d.tideCrore}
                onChange={(v) => set("tideCrore", v)}
                invalid={bad("level")}
              />
            </Field>
          ) : (
            <Field
              id={id("level")}
              label={
                d.type === "pcr_cross"
                  ? "PCR level"
                  : d.type === "ivp_level"
                    ? "IV percentile (0–100)"
                    : d.type === "iv_level"
                      ? "ATM IV (%)"
                      : d.type === "position_pnl"
                        ? "P&L (₹)"
                        : "Price"
              }
              hint={d.type === "position_pnl" ? "Use a negative number for a loss, e.g. −10000." : undefined}
            >
              <NumInput id={id("level")} value={d.level} onChange={(v) => set("level", v)} invalid={bad("level")} />
            </Field>
          )}
        </div>
      )}

      {d.type === "position_greek" && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field id={id("greek")} label="Greek">
            <SimpleSelect
              id={id("greek")}
              value={d.greek}
              onChange={(v) => set("greek", v as GreekKey)}
              options={(Object.keys(GREEK_LABEL) as GreekKey[]).map((g) => ({ value: g, label: GREEK_LABEL[g] }))}
            />
          </Field>
          <Field id={id("gdir")} label="When it">
            <SimpleSelect
              id={id("gdir")}
              value={d.greekDirection}
              onChange={(v) => set("greekDirection", v)}
              options={[
                { value: "abs_above", label: "Beyond ± level" },
                { value: "above", label: "Is at or above" },
                { value: "below", label: "Is at or below" },
              ]}
            />
          </Field>
          <Field id={id("glevel")} label="Level" hint={GREEK_UNIT[d.greek]}>
            <NumInput id={id("glevel")} value={d.level} onChange={(v) => set("level", v)} invalid={bad("level")} />
          </Field>
        </div>
      )}

      {d.type === "strike_level" && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Field id={id("expiry")} label="Expiry">
              <Select value={d.expiry} onValueChange={(v) => v && set("expiry", v)}>
                <SelectTrigger id={id("expiry")} className="text-body-sm" aria-invalid={bad("expiry") || undefined}>
                  <SelectValue placeholder="Pick expiry" />
                </SelectTrigger>
                <SelectContent>
                  {d.expiry && !expiries.some((e) => e.date === d.expiry) ? (
                    <SelectItem value={d.expiry}>{formatDateIST(d.expiry)}</SelectItem>
                  ) : null}
                  {expiries.map((e) => (
                    <SelectItem key={e.date} value={e.date}>
                      {formatDateIST(e.date)} · {e.type === "monthly" ? "Monthly" : "Weekly"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field id={id("sstrike")} label="Strike">
              <NumInput
                id={id("sstrike")}
                value={d.strike}
                onChange={(v) => set("strike", v)}
                invalid={bad("strike")}
              />
            </Field>
          </div>
          <div className="space-y-1">
            <span className="text-body-sm font-medium" id={id("opt-label")}>
              Option
            </span>
            <ToggleGroup
              type="single"
              value={d.side === "PE" ? "PE" : "CE"}
              onValueChange={(v) => v && set("side", v as "CE" | "PE")}
              className="justify-start"
              aria-labelledby={id("opt-label")}
            >
              <ToggleGroupItem value="CE" className="px-4 text-body-sm">
                CE (call)
              </ToggleGroupItem>
              <ToggleGroupItem value="PE" className="px-4 text-body-sm">
                PE (put)
              </ToggleGroupItem>
            </ToggleGroup>
          </div>
          <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
            <Field id={id("field")} label="When">
              <SimpleSelect
                id={id("field")}
                value={d.field}
                onChange={(v) => set("field", v as StrikeField)}
                options={(Object.keys(STRIKE_FIELD_LABEL) as StrikeField[]).map((f) => ({
                  value: f,
                  label: STRIKE_FIELD_LABEL[f],
                }))}
              />
            </Field>
            <ToggleGroup
              type="single"
              value={d.op}
              onValueChange={(v) => v && set("op", v as RuleDraft["op"])}
              aria-label="Condition"
            >
              <ToggleGroupItem value="gte" className="w-7 px-0" aria-label="at or above">
                ≥
              </ToggleGroupItem>
              <ToggleGroupItem value="lte" className="w-7 px-0" aria-label="at or below">
                ≤
              </ToggleGroupItem>
            </ToggleGroup>
            <Field id={id("value")} label="Value">
              <NumInput
                id={id("value")}
                value={d.value}
                onChange={(v) => set("value", v)}
                invalid={bad("value")}
                placeholder={d.field === "iv" ? "e.g. 18" : d.field === "premium" ? "e.g. 120" : "e.g. 500000"}
              />
            </Field>
          </div>
        </>
      )}

      {d.type === "oi_change_strike" && (
        <div className="grid grid-cols-3 gap-2">
          <Field id={id("strike")} label="Strike">
            <NumInput id={id("strike")} value={d.strike} onChange={(v) => set("strike", v)} invalid={bad("strike")} />
          </Field>
          <Field id={id("side")} label="Side">
            <SimpleSelect
              id={id("side")}
              value={d.side}
              onChange={(v) => set("side", v)}
              options={[
                { value: "CE", label: "CE" },
                { value: "PE", label: "PE" },
                { value: "BOTH", label: "Either" },
              ]}
            />
          </Field>
          <Field id={id("thr")} label="|OI chg| over">
            <NumInput
              id={id("thr")}
              value={d.threshold}
              onChange={(v) => set("threshold", v)}
              invalid={bad("threshold")}
            />
          </Field>
        </div>
      )}

      {d.type === "oi_wall_shift" && (
        <Field id={id("wall")} label="Wall">
          <SimpleSelect
            id={id("wall")}
            value={d.side}
            onChange={(v) => set("side", v)}
            options={[
              { value: "CE", label: "Call wall (highest CE OI)" },
              { value: "PE", label: "Put wall (highest PE OI)" },
              { value: "BOTH", label: "Either wall" },
            ]}
          />
        </Field>
      )}

      {d.type === "spot_cross_ref" && (
        <Field id={id("ref")} label="Level">
          <SimpleSelect
            id={id("ref")}
            value={d.ref}
            onChange={(v) => set("ref", v)}
            options={[
              { value: "max_pain", label: "Max pain" },
              { value: "gamma_flip", label: "Gamma flip (dealer model)" },
            ]}
          />
        </Field>
      )}

      {d.type === "atm_iv_spike" && (
        <div className="grid grid-cols-2 gap-3">
          <Field id={id("pts")} label="Rise of (IV pts)">
            <NumInput id={id("pts")} value={d.points} onChange={(v) => set("points", v)} invalid={bad("points")} />
          </Field>
          <Field id={id("win")} label="Within (minutes)">
            <NumInput
              id={id("win")}
              value={d.windowMin}
              onChange={(v) => set("windowMin", v)}
              step="1"
              invalid={bad("windowMin")}
            />
          </Field>
        </div>
      )}

      {(d.type === "repeated_hits" || d.type === "big_opening_print") && (
        <div className={cn("grid gap-2", d.type === "repeated_hits" ? "grid-cols-3" : "grid-cols-1")}>
          <Field id={id("prem")} label="Min premium (₹ lakh)">
            <NumInput
              id={id("prem")}
              value={d.premiumLakh}
              onChange={(v) => set("premiumLakh", v)}
              invalid={bad("minPremium")}
            />
          </Field>
          {d.type === "repeated_hits" ? (
            <>
              <Field id={id("hits")} label="Hits">
                <NumInput
                  id={id("hits")}
                  value={d.minHits}
                  onChange={(v) => set("minHits", v)}
                  step="1"
                  invalid={bad("minHits")}
                />
              </Field>
              <Field id={id("hwin")} label="Within (min)">
                <NumInput
                  id={id("hwin")}
                  value={d.windowMin}
                  onChange={(v) => set("windowMin", v)}
                  step="1"
                  invalid={bad("windowMin")}
                />
              </Field>
            </>
          ) : null}
        </div>
      )}

      <div className={cn("grid gap-3", compact ? "grid-cols-1" : "grid-cols-1 sm:grid-cols-2")}>
        <Field
          id={id("cool")}
          label="Cooldown (minutes)"
          hint={
            d.type === "strike_level"
              ? "0 = fire again only after the condition resets."
              : "Minimum gap before it can fire again."
          }
        >
          <NumInput
            id={id("cool")}
            value={d.cooldownMin}
            onChange={(v) => set("cooldownMin", v)}
            step="1"
            invalid={bad("cooldownMin")}
          />
        </Field>
        {!compact ? (
          <Field id={id("label")} label="Name (optional)" hint="Shown instead of the generated description.">
            <Input
              id={id("label")}
              value={d.label}
              maxLength={80}
              onChange={(e) => set("label", e.target.value)}
              className="h-9"
              placeholder="e.g. Weekly strangle stop"
            />
          </Field>
        ) : null}
      </div>

      {!compact ? (
        <fieldset className="space-y-2 rounded-tile border border-separator p-3">
          <legend className="px-1 text-body-sm font-medium">Channels for this rule</legend>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {(Object.keys(CHANNEL_NAMES) as ChannelKey[]).map((k) => (
              <div key={k} className="flex items-center gap-2">
                <Label htmlFor={id(`ch-${k}`)} className="w-16 shrink-0 text-body-sm">
                  {CHANNEL_NAMES[k]}
                </Label>
                <div className="min-w-0 flex-1">
                  <SimpleSelect<ChannelChoice>
                    id={id(`ch-${k}`)}
                    value={d.channels[k]}
                    onChange={(v) => set("channels", { ...d.channels, [k]: v })}
                    options={[
                      { value: "default", label: "Follow default" },
                      { value: "on", label: "Always on" },
                      { value: "off", label: "Off" },
                    ]}
                  />
                </div>
              </div>
            ))}
          </div>
        </fieldset>
      ) : null}

      <p className="rounded-chip bg-muted/60 px-2.5 py-2 text-body-sm" aria-live="polite">
        <span className="text-muted-foreground">Preview: </span>
        {preview ?? <span className="text-muted-foreground">complete the fields above</span>}
      </p>

      {error ? (
        <p role="alert" className="text-body-sm text-bearish">
          {error.message}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" className="flex-1">
          {submitLabel ?? (rule ? "Save changes" : "Add rule")}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
