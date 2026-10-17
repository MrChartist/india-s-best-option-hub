import { useId, useMemo } from "react";
import { Download, Filter, Plus, Search, SlidersHorizontal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BUILDUP_LABEL, type Buildup } from "@/lib/options";
import {
  FIELD_META,
  NUMERIC_FIELDS,
  OP_LABEL,
  newRuleId,
  type FilterRule,
  type FilterState,
  type NumericField,
  type NumericOp,
} from "@/lib/screener/filters";
import { cn } from "@/lib/utils";
import { BUILDUP_VARIANT } from "./buildupStyle";

const BUILDUPS: Buildup[] = ["LONG_BUILDUP", "SHORT_BUILDUP", "SHORT_COVERING", "LONG_UNWINDING", "NEUTRAL"];
const OPS: NumericOp[] = ["gt", "gte", "lt", "lte", "between"];

const TONE_ON: Record<string, string> = {
  bullish: "border-bullish/50 bg-wash-profit text-bullish",
  bearish: "border-bearish/50 bg-wash-loss text-bearish",
  info: "border-info/50 bg-wash-info text-info",
  warning: "border-warning/50 bg-wash-warning text-warning",
  neutral: "border-border bg-muted text-foreground",
};

export interface ScreenerFiltersProps {
  value: FilterState;
  onChange: (next: FilterState) => void;
  sectors: string[];
  matchCount: number;
  totalCount: number;
  onExport: () => void;
}

function NumberRuleRow({ rule, onChange, onRemove }: { rule: Extract<FilterRule, { kind: "number" }>; onChange: (r: FilterRule) => void; onRemove: () => void }) {
  const id = useId();
  const meta = FIELD_META[rule.field];
  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-tile border border-border bg-background/60 p-1.5" role="group" aria-label={`Rule: ${meta.label}`}>
      <Select value={rule.field} onValueChange={(v) => onChange({ ...rule, field: v as NumericField })}>
        <SelectTrigger className="h-8 w-[170px] text-body-sm" aria-label="Metric">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {NUMERIC_FIELDS.map((f) => (
            <SelectItem key={f.field} value={f.field}>
              {f.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={rule.op} onValueChange={(v) => onChange({ ...rule, op: v as NumericOp })}>
        <SelectTrigger className="h-8 w-[100px] text-body-sm" aria-label="Condition">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {OPS.map((o) => (
            <SelectItem key={o} value={o}>
              {OP_LABEL[o]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <label htmlFor={`${id}-v`} className="sr-only">
        Value
      </label>
      <Input
        id={`${id}-v`}
        type="number"
        inputMode="decimal"
        step={meta.step}
        value={Number.isFinite(rule.value) ? rule.value : ""}
        onChange={(e) => onChange({ ...rule, value: e.target.value === "" ? NaN : Number(e.target.value) })}
        className="h-8 w-20 text-body-sm"
      />
      {rule.op === "between" ? (
        <>
          <span className="text-body-sm text-muted-foreground">and</span>
          <label htmlFor={`${id}-v2`} className="sr-only">
            Upper value
          </label>
          <Input
            id={`${id}-v2`}
            type="number"
            inputMode="decimal"
            step={meta.step}
            value={rule.value2 !== undefined && Number.isFinite(rule.value2) ? rule.value2 : ""}
            onChange={(e) => onChange({ ...rule, value2: e.target.value === "" ? undefined : Number(e.target.value) })}
            className="h-8 w-20 text-body-sm"
          />
        </>
      ) : null}
      {meta.unit ? <span className="text-body-sm text-muted-foreground">{meta.unit}</span> : null}
      <Button type="button" variant="ghost" size="icon" className="ml-auto h-8 w-8" onClick={onRemove} aria-label={`Remove ${meta.label} rule`}>
        <X />
      </Button>
    </div>
  );
}

export function ScreenerFilters({ value, onChange, sectors, matchCount, totalCount, onExport }: ScreenerFiltersProps) {
  const searchId = useId();
  const buildupRule = value.rules.find((r): r is Extract<FilterRule, { kind: "buildup" }> => r.kind === "buildup");
  const selectedBuildups = buildupRule?.values ?? [];
  const bannedRule = value.rules.find((r): r is Extract<FilterRule, { kind: "banned" }> => r.kind === "banned");
  const instrumentRule = value.rules.find((r): r is Extract<FilterRule, { kind: "instrument" }> => r.kind === "instrument");
  const numberRules = value.rules.filter((r): r is Extract<FilterRule, { kind: "number" }> => r.kind === "number");
  const activeCount = value.rules.length + value.sectors.length + (value.search ? 1 : 0);

  const setRules = (rules: FilterRule[]) => onChange({ ...value, rules });
  const replaceRule = (id: string, next: FilterRule) => setRules(value.rules.map((r) => (r.id === id ? next : r)));
  const removeRule = (id: string) => setRules(value.rules.filter((r) => r.id !== id));

  const toggleBuildup = (b: Buildup) => {
    const next = selectedBuildups.includes(b) ? selectedBuildups.filter((x) => x !== b) : [...selectedBuildups, b];
    const others = value.rules.filter((r) => r.kind !== "buildup");
    setRules(next.length ? [...others, { id: buildupRule?.id ?? newRuleId(), kind: "buildup", values: next }] : others);
  };

  const setBanned = (mode: "all" | "hide" | "only") => {
    const others = value.rules.filter((r) => r.kind !== "banned");
    setRules(mode === "all" ? others : [...others, { id: newRuleId(), kind: "banned", value: mode === "only" }]);
  };
  const setInstrument = (mode: "all" | "STOCK" | "INDEX") => {
    const others = value.rules.filter((r) => r.kind !== "instrument");
    setRules(mode === "all" ? others : [...others, { id: newRuleId(), kind: "instrument", value: mode }]);
  };

  const sortedSectors = useMemo(() => [...sectors].sort((a, b) => a.localeCompare(b)), [sectors]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[180px] flex-1 sm:max-w-xs">
          <label htmlFor={searchId} className="sr-only">
            Search symbol or sector
          </label>
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            id={searchId}
            value={value.search}
            onChange={(e) => onChange({ ...value, search: e.target.value })}
            placeholder="Search symbol or sector"
            className="h-9 pl-8"
            autoComplete="off"
            spellCheck={false}
          />
        </div>

        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="gap-1.5">
              <Filter />
              Sector{value.sectors.length ? ` (${value.sectors.length})` : ""}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-64 p-0">
            <div className="flex items-center justify-between border-b border-border px-3 py-2">
              <span className="text-label uppercase text-muted-foreground">Sectors</span>
              {value.sectors.length ? (
                <button type="button" className="text-body-sm text-primary-ink hover:underline" onClick={() => onChange({ ...value, sectors: [] })}>
                  Clear
                </button>
              ) : null}
            </div>
            <div className="max-h-72 overflow-y-auto p-1.5">
              {sortedSectors.map((s) => {
                const checked = value.sectors.includes(s);
                const cid = `${searchId}-sec-${s.replace(/\W+/g, "-")}`;
                return (
                  <label key={s} htmlFor={cid} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-body-sm hover:bg-accent">
                    <Checkbox
                      id={cid}
                      checked={checked}
                      onCheckedChange={(c) => onChange({ ...value, sectors: c ? [...value.sectors, s] : value.sectors.filter((x) => x !== s) })}
                    />
                    {s}
                  </label>
                );
              })}
            </div>
          </PopoverContent>
        </Popover>

        <Select value={instrumentRule ? instrumentRule.value : "all"} onValueChange={(v) => setInstrument(v as "all" | "STOCK" | "INDEX")}>
          <SelectTrigger className="h-9 w-[130px] text-body-sm" aria-label="Instrument type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Stocks + indices</SelectItem>
            <SelectItem value="STOCK">Stocks only</SelectItem>
            <SelectItem value="INDEX">Indices only</SelectItem>
          </SelectContent>
        </Select>

        <Select value={bannedRule ? (bannedRule.value ? "only" : "hide") : "all"} onValueChange={(v) => setBanned(v as "all" | "hide" | "only")}>
          <SelectTrigger className="h-9 w-[150px] text-body-sm" aria-label="Ban period filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Include ban names</SelectItem>
            <SelectItem value="hide">Hide ban names</SelectItem>
            <SelectItem value="only">Only ban names</SelectItem>
          </SelectContent>
        </Select>

        <div className="ml-auto flex items-center gap-2">
          <span className="text-body-sm text-muted-foreground" aria-live="polite">
            <span className="font-num font-semibold text-foreground">{matchCount}</span> of {totalCount}
          </span>
          {activeCount > 0 ? (
            <Button variant="ghost" size="sm" onClick={() => onChange({ search: "", sectors: [], rules: [] })}>
              Clear all
            </Button>
          ) : null}
          <Button variant="outline" size="sm" onClick={onExport} disabled={matchCount === 0} className="gap-1.5">
            <Download />
            CSV
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Buildup type">
        <span className="mr-1 text-label uppercase text-muted-foreground">Buildup</span>
        {BUILDUPS.map((b) => {
          const on = selectedBuildups.includes(b);
          return (
            <button
              key={b}
              type="button"
              aria-pressed={on}
              onClick={() => toggleBuildup(b)}
              className={cn(
                "h-7 rounded-pill border px-2.5 text-body-sm transition-colors duration-fast focus-visible:shadow-ember focus-visible:outline-none",
                on ? TONE_ON[BUILDUP_VARIANT[b]] : "border-border bg-card text-muted-foreground hover:text-foreground",
              )}
            >
              {BUILDUP_LABEL[b]}
            </button>
          );
        })}
      </div>

      <div className="space-y-1.5">
        {numberRules.map((r) => (
          <NumberRuleRow key={r.id} rule={r} onChange={(n) => replaceRule(r.id, n)} onRemove={() => removeRule(r.id)} />
        ))}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="gap-1.5 text-muted-foreground"
          onClick={() => setRules([...value.rules, { id: newRuleId(), kind: "number", field: "atmIv", op: "gte", value: 30 }])}
        >
          {numberRules.length ? <Plus /> : <SlidersHorizontal />}
          {numberRules.length ? "Add another rule" : "Add a rule (IV, PCR, MWPL, volume…)"}
        </Button>
      </div>
    </div>
  );
}
