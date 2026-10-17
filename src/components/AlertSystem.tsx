import { useMemo, useRef, useState, type ReactNode } from "react";
import {
  Activity,
  Ban,
  BarChart3,
  Bell,
  BellRing,
  Crosshair,
  Download,
  Gauge,
  Layers,
  Lightbulb,
  Plus,
  Repeat,
  Trash2,
  TrendingUp,
  Upload,
  Volume2,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FlowFeeder } from "@/components/flow/FlowFeeder";
import { useAlertEngine, playAlertSound, type AlertEngine } from "@/hooks/useAlertEngine";
import { CONTRACT_SPECS, formatDateIST, formatTimeIST } from "@/lib/options";
import {
  ANY_SYMBOL,
  RULE_IDEAS,
  RULE_TYPE_LABEL,
  alertRuleSchema,
  describeRule,
  flowStore,
  type AlertRuleType,
  type AlertTone,
  type NewAlertRule,
} from "@/lib/flow";
import { cn } from "@/lib/utils";

const TYPE_ICON: Record<AlertRuleType, ReactNode> = {
  pcr_cross: <BarChart3 className="h-4 w-4" aria-hidden="true" />,
  oi_change_strike: <Layers className="h-4 w-4" aria-hidden="true" />,
  ivp_level: <Gauge className="h-4 w-4" aria-hidden="true" />,
  price_level: <TrendingUp className="h-4 w-4" aria-hidden="true" />,
  atm_iv_spike: <Zap className="h-4 w-4" aria-hidden="true" />,
  oi_wall_shift: <Layers className="h-4 w-4" aria-hidden="true" />,
  spot_cross_ref: <Crosshair className="h-4 w-4" aria-hidden="true" />,
  repeated_hits: <Repeat className="h-4 w-4" aria-hidden="true" />,
  big_opening_print: <Activity className="h-4 w-4" aria-hidden="true" />,
  ban_entry: <Ban className="h-4 w-4" aria-hidden="true" />,
};

const TONE_DOT: Record<AlertTone, string> = { bullish: "bg-bullish", bearish: "bg-bearish", warning: "bg-warning", info: "bg-info" };

const INDEX_SYMBOLS = ["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "SENSEX", "BANKEX"];
const ALL_SYMBOLS = [...new Set([...INDEX_SYMBOLS, ...Object.keys(CONTRACT_SPECS).sort()])];
const ANY_ALLOWED = new Set<AlertRuleType>(["repeated_hits", "big_opening_print", "ban_entry"]);

// ── Rule form ──

interface Draft {
  type: AlertRuleType;
  symbol: string;
  direction: "above" | "below" | "either";
  level: string;
  strike: string;
  side: "CE" | "PE" | "BOTH";
  threshold: string;
  points: string;
  windowMin: string;
  ref: "max_pain" | "gamma_flip";
  minHits: string;
  premiumLakh: string;
  cooldownMin: string;
}

const EMPTY_DRAFT: Draft = {
  type: "price_level",
  symbol: "NIFTY",
  direction: "either",
  level: "",
  strike: "",
  side: "BOTH",
  threshold: "50000",
  points: "1.5",
  windowMin: "15",
  ref: "max_pain",
  minHits: "3",
  premiumLakh: "25",
  cooldownMin: "15",
};

function draftToRule(d: Draft): NewAlertRule | string {
  const num = (s: string) => Number(String(s).replace(/,/g, ""));
  const base = { symbol: d.symbol, cooldownMin: num(d.cooldownMin) };
  let r: NewAlertRule;
  switch (d.type) {
    case "pcr_cross":
      r = { ...base, type: "pcr_cross", direction: d.direction, level: num(d.level) };
      break;
    case "price_level":
      r = { ...base, type: "price_level", direction: d.direction, level: num(d.level) };
      break;
    case "ivp_level":
      r = { ...base, type: "ivp_level", direction: d.direction === "below" ? "below" : "above", level: num(d.level) };
      break;
    case "oi_change_strike":
      r = { ...base, type: "oi_change_strike", strike: num(d.strike), side: d.side, threshold: num(d.threshold) };
      break;
    case "atm_iv_spike":
      r = { ...base, type: "atm_iv_spike", points: num(d.points), windowMin: num(d.windowMin) };
      break;
    case "oi_wall_shift":
      r = { ...base, type: "oi_wall_shift", side: d.side };
      break;
    case "spot_cross_ref":
      r = { ...base, type: "spot_cross_ref", ref: d.ref };
      break;
    case "repeated_hits":
      r = { ...base, type: "repeated_hits", minHits: Math.round(num(d.minHits)), windowMin: num(d.windowMin), minPremium: num(d.premiumLakh) * 1_00_000 };
      break;
    case "big_opening_print":
      r = { ...base, type: "big_opening_print", minPremium: num(d.premiumLakh) * 1_00_000 };
      break;
    case "ban_entry":
      r = { ...base, type: "ban_entry" };
      break;
  }
  if (r.symbol === ANY_SYMBOL && !ANY_ALLOWED.has(r.type)) return "Pick an underlying for this rule type.";
  const check = alertRuleSchema.safeParse({ ...r, id: "draft" });
  if (!check.success) {
    const issue = check.error.issues[0];
    return `Check ${String(issue?.path?.[0] ?? "the values")}: ${issue?.message ?? "invalid value"}.`;
  }
  return r;
}

function Field({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-body-sm">
        {label}
      </Label>
      {children}
    </div>
  );
}

function NumInput({ id, value, onChange, step = "any", placeholder }: { id: string; value: string; onChange: (v: string) => void; step?: string; placeholder?: string }) {
  return <Input id={id} type="number" inputMode="decimal" step={step} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className="h-8 tabular-nums" />;
}

function RuleForm({ onAdd, onCancel }: { onAdd: (r: NewAlertRule) => void; onCancel: () => void }) {
  const [d, setD] = useState<Draft>(() => {
    const spot = flowStore.getState().feeds.NIFTY?.spot;
    return { ...EMPTY_DRAFT, level: spot ? String(Math.round(spot / 100) * 100) : "" };
  });
  const [error, setError] = useState("");
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => {
    setError("");
    setD((x) => ({ ...x, [k]: v }));
  };
  const symbolChoices = ANY_ALLOWED.has(d.type) ? [ANY_SYMBOL, ...ALL_SYMBOLS] : ALL_SYMBOLS;

  return (
    <form
      className="space-y-3 rounded-tile border border-border bg-surface p-3"
      onSubmit={(e) => {
        e.preventDefault();
        const r = draftToRule(d);
        if (typeof r === "string") setError(r);
        else onAdd(r);
      }}
    >
      <div className="grid grid-cols-2 gap-2">
        <Field id="rule-type" label="Rule">
          <Select
            value={d.type}
            onValueChange={(v) => {
              const type = v as AlertRuleType;
              setD((x) => ({
                ...x,
                type,
                symbol: type === "ban_entry" ? ANY_SYMBOL : x.symbol === ANY_SYMBOL && !ANY_ALLOWED.has(type) ? "NIFTY" : x.symbol,
                level: type === "pcr_cross" ? "1" : type === "ivp_level" ? "80" : x.level,
                direction: type === "ivp_level" && x.direction === "either" ? "above" : x.direction,
              }));
              setError("");
            }}
          >
            <SelectTrigger id="rule-type" className="h-8 text-body-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(RULE_TYPE_LABEL) as AlertRuleType[]).map((t) => (
                <SelectItem key={t} value={t}>
                  {RULE_TYPE_LABEL[t]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field id="rule-symbol" label="Underlying">
          <Select value={d.symbol} onValueChange={(v) => set("symbol", v)}>
            <SelectTrigger id="rule-symbol" className="h-8 text-body-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-h-72">
              {symbolChoices.map((s) => (
                <SelectItem key={s} value={s}>
                  {s === ANY_SYMBOL ? "Any" : s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>

      {(d.type === "pcr_cross" || d.type === "price_level" || d.type === "ivp_level") && (
        <div className="grid grid-cols-2 gap-2">
          <Field id="rule-dir" label="When it">
            <Select value={d.direction} onValueChange={(v) => set("direction", v as Draft["direction"])}>
              <SelectTrigger id="rule-dir" className="h-8 text-body-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="above">{d.type === "ivp_level" ? "Is at or above" : "Crosses above"}</SelectItem>
                <SelectItem value="below">{d.type === "ivp_level" ? "Is at or below" : "Crosses below"}</SelectItem>
                {d.type !== "ivp_level" ? <SelectItem value="either">Crosses either way</SelectItem> : null}
              </SelectContent>
            </Select>
          </Field>
          <Field id="rule-level" label={d.type === "pcr_cross" ? "PCR level" : d.type === "ivp_level" ? "IV percentile (0-100)" : "Price"}>
            <NumInput id="rule-level" value={d.level} onChange={(v) => set("level", v)} />
          </Field>
        </div>
      )}

      {d.type === "oi_change_strike" && (
        <div className="grid grid-cols-3 gap-2">
          <Field id="rule-strike" label="Strike">
            <NumInput id="rule-strike" value={d.strike} onChange={(v) => set("strike", v)} />
          </Field>
          <Field id="rule-side" label="Side">
            <Select value={d.side} onValueChange={(v) => set("side", v as Draft["side"])}>
              <SelectTrigger id="rule-side" className="h-8 text-body-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="CE">CE</SelectItem>
                <SelectItem value="PE">PE</SelectItem>
                <SelectItem value="BOTH">Either</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field id="rule-thr" label="|OI chg| over">
            <NumInput id="rule-thr" value={d.threshold} onChange={(v) => set("threshold", v)} />
          </Field>
        </div>
      )}

      {d.type === "oi_wall_shift" && (
        <Field id="rule-wall" label="Wall">
          <Select value={d.side} onValueChange={(v) => set("side", v as Draft["side"])}>
            <SelectTrigger id="rule-wall" className="h-8 text-body-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="CE">Call wall (highest CE OI)</SelectItem>
              <SelectItem value="PE">Put wall (highest PE OI)</SelectItem>
              <SelectItem value="BOTH">Either wall</SelectItem>
            </SelectContent>
          </Select>
        </Field>
      )}

      {d.type === "spot_cross_ref" && (
        <Field id="rule-ref" label="Level">
          <Select value={d.ref} onValueChange={(v) => set("ref", v as Draft["ref"])}>
            <SelectTrigger id="rule-ref" className="h-8 text-body-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="max_pain">Max pain</SelectItem>
              <SelectItem value="gamma_flip">Gamma flip (dealer model)</SelectItem>
            </SelectContent>
          </Select>
        </Field>
      )}

      {d.type === "atm_iv_spike" && (
        <div className="grid grid-cols-2 gap-2">
          <Field id="rule-pts" label="Rise of (IV pts)">
            <NumInput id="rule-pts" value={d.points} onChange={(v) => set("points", v)} />
          </Field>
          <Field id="rule-win" label="Within (minutes)">
            <NumInput id="rule-win" value={d.windowMin} onChange={(v) => set("windowMin", v)} step="1" />
          </Field>
        </div>
      )}

      {(d.type === "repeated_hits" || d.type === "big_opening_print") && (
        <div className={cn("grid gap-2", d.type === "repeated_hits" ? "grid-cols-3" : "grid-cols-1")}>
          <Field id="rule-prem" label="Min premium (₹ lakh)">
            <NumInput id="rule-prem" value={d.premiumLakh} onChange={(v) => set("premiumLakh", v)} />
          </Field>
          {d.type === "repeated_hits" ? (
            <>
              <Field id="rule-hits" label="Hits">
                <NumInput id="rule-hits" value={d.minHits} onChange={(v) => set("minHits", v)} step="1" />
              </Field>
              <Field id="rule-hwin" label="Within (min)">
                <NumInput id="rule-hwin" value={d.windowMin} onChange={(v) => set("windowMin", v)} step="1" />
              </Field>
            </>
          ) : null}
        </div>
      )}

      <Field id="rule-cool" label="Cooldown (minutes before it can fire again)">
        <NumInput id="rule-cool" value={d.cooldownMin} onChange={(v) => set("cooldownMin", v)} step="1" />
      </Field>

      {error ? (
        <p role="alert" className="text-body-sm text-bearish">
          {error}
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button type="submit" size="sm" className="flex-1">
          Add rule
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

// ── Panel sections ──

function RulesTab({ engine }: { engine: AlertEngine }) {
  const [adding, setAdding] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const onExport = () => {
    try {
      const url = URL.createObjectURL(new Blob([engine.exportJSON()], { type: "application/json" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `mr-chartist-alert-rules-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      toast.error("Could not export rules");
    }
  };

  const onImport = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 512 * 1024) {
      toast.error("That file is too large to be a rules export");
      return;
    }
    const res = engine.importJSON(await file.text());
    if (res.error) toast.error("Import failed", { description: res.error });
    else toast.success(`Imported ${res.rules.length} rule${res.rules.length === 1 ? "" : "s"}`, { description: res.skipped ? `${res.skipped} invalid rule(s) skipped.` : undefined });
    if (fileRef.current) fileRef.current.value = "";
  };

  return (
    <div className="space-y-3">
      {engine.rules.length === 0 && !adding ? (
        <div className="rounded-tile border border-dashed border-border px-4 py-6 text-center text-body-sm text-muted-foreground">
          <BellRing className="mx-auto mb-2 h-5 w-5" aria-hidden="true" />
          No rules yet. Add one, or start from the Ideas tab.
        </div>
      ) : null}

      <ul className="space-y-2">
        {engine.rules.map((r) => {
          const fired = engine.lastFired(r.id);
          return (
            <li key={r.id} className={cn("flex items-start gap-2 rounded-tile border p-2.5", r.enabled ? "border-border bg-card" : "border-border/60 bg-muted/30 opacity-70")}>
              <span className="mt-0.5 shrink-0 text-muted-foreground">{TYPE_ICON[r.type]}</span>
              <div className="min-w-0 flex-1">
                <p className="text-body-sm font-semibold leading-snug">{describeRule(r)}</p>
                <p className="text-micro uppercase text-muted-foreground">
                  {RULE_TYPE_LABEL[r.type]} · cooldown {r.cooldownMin} min{fired ? ` · fired ${formatTimeIST(fired)}` : ""}
                </p>
              </div>
              <Switch checked={r.enabled} onCheckedChange={() => engine.toggleRule(r.id)} aria-label={`${r.enabled ? "Pause" : "Resume"} rule: ${describeRule(r)}`} />
              <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => engine.removeRule(r.id)} aria-label={`Delete rule: ${describeRule(r)}`}>
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
            </li>
          );
        })}
      </ul>

      {adding ? (
        <RuleForm
          onAdd={(r) => {
            engine.addRule(r);
            setAdding(false);
            toast.success("Rule added", { description: "It is checked while the app is open." });
          }}
          onCancel={() => setAdding(false)}
        />
      ) : (
        <Button variant="outline" size="sm" onClick={() => setAdding(true)} className="w-full gap-1">
          <Plus className="h-3.5 w-3.5" aria-hidden="true" /> New rule
        </Button>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
        <Button variant="outline" size="pill" onClick={onExport} disabled={engine.rules.length === 0}>
          <Download aria-hidden="true" /> Export JSON
        </Button>
        <Button variant="outline" size="pill" onClick={() => fileRef.current?.click()}>
          <Upload aria-hidden="true" /> Import
        </Button>
        <input ref={fileRef} type="file" accept="application/json,.json" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(e) => void onImport(e.target.files?.[0])} />
        {engine.rules.length > 0 ? (
          confirmClear ? (
            <span className="ml-auto flex items-center gap-1">
              <Button
                variant="ghost"
                size="pill"
                className="text-bearish"
                onClick={() => {
                  engine.clearRules();
                  setConfirmClear(false);
                }}
              >
                Delete all
              </Button>
              <Button variant="ghost" size="pill" onClick={() => setConfirmClear(false)}>
                Keep
              </Button>
            </span>
          ) : (
            <Button variant="ghost" size="pill" className="ml-auto" onClick={() => setConfirmClear(true)}>
              Clear all
            </Button>
          )
        ) : null}
      </div>
    </div>
  );
}

function IdeasTab({ engine }: { engine: AlertEngine }) {
  const [symbol, setSymbol] = useState("NIFTY");
  const existing = useMemo(() => new Set(engine.rules.map((r) => describeRule(r))), [engine.rules]);
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Label htmlFor="idea-symbol" className="shrink-0 text-body-sm">
          Underlying
        </Label>
        <Select value={symbol} onValueChange={setSymbol}>
          <SelectTrigger id="idea-symbol" className="h-8 text-body-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="max-h-72">
            {ALL_SYMBOLS.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <ul className="space-y-2">
        {RULE_IDEAS.map((idea) => {
          const draft = idea.make(symbol, flowStore.getState().feeds[symbol]?.spot);
          const preview = describeRule({ ...draft, id: "preview", createdAt: 0, enabled: true, cooldownMin: 15 } as Parameters<typeof describeRule>[0]);
          const added = existing.has(preview);
          return (
            <li key={idea.id} className="rounded-tile border border-border bg-card p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold">{idea.title}</p>
                  <p className="mt-0.5 text-body-sm text-muted-foreground">{idea.why}</p>
                  <p className="mt-1 text-body-sm">{preview}</p>
                </div>
                <Button
                  size="pill"
                  variant={added ? "outline" : "default"}
                  disabled={added}
                  onClick={() => {
                    engine.addRule(draft);
                    toast.success("Rule added", { description: preview });
                  }}
                  aria-label={added ? `${idea.title} already added` : `Add rule: ${preview}`}
                >
                  {added ? "Added" : <><Plus aria-hidden="true" /> Add</>}
                </Button>
              </div>
              <Badge variant="neutral" className="mt-2">
                Educational, not advice
              </Badge>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function LogTab({ engine }: { engine: AlertEngine }) {
  if (engine.log.length === 0) {
    return <p className="rounded-tile border border-dashed border-border px-4 py-6 text-center text-body-sm text-muted-foreground">No alerts have fired yet.</p>;
  }
  return (
    <div className="space-y-2">
      <ul className="space-y-2" aria-live="polite">
        {engine.log.map((e) => (
          <li key={e.id} className="flex gap-2 rounded-tile border border-border bg-card p-2.5">
            <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", TONE_DOT[e.tone])} aria-hidden="true" />
            <div className="min-w-0">
              <p className="text-body-sm font-semibold">{e.title}</p>
              <p className="text-body-sm text-muted-foreground">{e.message}</p>
              <p className="text-micro uppercase text-muted-foreground">
                {formatDateIST(e.ts)} · {formatTimeIST(e.ts, { seconds: true })}
              </p>
            </div>
          </li>
        ))}
      </ul>
      <Button variant="ghost" size="pill" onClick={engine.clearLog}>
        Clear log
      </Button>
    </div>
  );
}

const MODE_LABEL = { live: "live", recorded: "delayed", sample: "sample · paused", waiting: "connecting" } as const;

interface AlertSystemProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/**
 * Rule-based alerts. Works controlled (open/onOpenChange, as DashboardLayout uses it) or with no
 * props, in which case it renders its own bell button.
 */
export function AlertSystem({ open, onOpenChange }: AlertSystemProps = {}) {
  const engine = useAlertEngine();
  const [innerOpen, setInnerOpen] = useState(false);
  const controlled = open !== undefined;
  const isOpen = controlled ? open : innerOpen;
  const setOpen = (o: boolean) => {
    if (!controlled) setInnerOpen(o);
    onOpenChange?.(o);
  };
  const active = engine.rules.filter((r) => r.enabled).length;
  const hasBanRule = engine.rules.some((r) => r.enabled && r.type === "ban_entry");

  return (
    <>
      {engine.feedSymbols.map((s) => (
        <FlowFeeder key={s} symbol={s} />
      ))}
      {!controlled ? (
        <Button variant="ghost" size="icon" className="relative h-8 w-8" onClick={() => setOpen(true)} aria-label={`Alerts, ${active} active`}>
          <Bell className="h-4 w-4" aria-hidden="true" />
          {active > 0 ? <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-capsule bg-primary px-1 text-micro text-primary-foreground">{active}</span> : null}
        </Button>
      ) : null}
      <Sheet open={isOpen} onOpenChange={setOpen}>
        <SheetContent className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-[440px]">
          <SheetHeader className="space-y-1 border-b border-border px-4 py-4 text-left">
            <SheetTitle className="flex items-center gap-2 font-display">
              <Bell className="h-4 w-4" aria-hidden="true" /> Alerts
              <Badge variant={active > 0 ? "default" : "neutral"}>{active} active</Badge>
            </SheetTitle>
            <SheetDescription className="text-body-sm">Rules are checked against live chain data every few seconds while the app is open. Sample data never triggers an alert.</SheetDescription>
          </SheetHeader>

          <div className="space-y-3 border-b border-border px-4 py-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Switch id="alert-sound" checked={engine.settings.sound} onCheckedChange={(c) => engine.setSettings({ sound: c })} />
                <Label htmlFor="alert-sound" className="text-body-sm">
                  Sound
                </Label>
              </div>
              <Button variant="ghost" size="pill" onClick={() => playAlertSound("info", engine.settings.volume)}>
                <Volume2 aria-hidden="true" /> Test
              </Button>
            </div>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Switch
                  id="alert-desktop"
                  checked={engine.settings.desktop}
                  disabled={engine.permission === "unsupported"}
                  onCheckedChange={async (c) => {
                    const p = await engine.enableDesktop(c);
                    if (c && p === "denied") toast.error("Notifications are blocked", { description: "Allow them for this site in your browser settings." });
                  }}
                />
                <Label htmlFor="alert-desktop" className="text-body-sm">
                  Desktop notifications
                </Label>
              </div>
              <span className="text-micro uppercase text-muted-foreground">
                {engine.permission === "unsupported" ? "Not supported" : engine.permission === "denied" ? "Blocked" : engine.permission === "granted" ? "Allowed" : "Ask on enable"}
              </span>
            </div>
            {engine.status.length > 0 || hasBanRule ? (
              <div className="flex flex-wrap items-center gap-1.5" aria-label="Data feeds">
                <span className="text-micro uppercase text-muted-foreground">Watching</span>
                {engine.status.map((s) => (
                  <Badge key={s.symbol} variant={s.mode === "live" ? "bullish" : s.mode === "sample" ? "warning" : "neutral"} title={s.asOf ? `As of ${formatTimeIST(s.asOf, { seconds: true })}` : undefined}>
                    {s.symbol} · {MODE_LABEL[s.mode]}
                  </Badge>
                ))}
                {hasBanRule ? <Badge variant={engine.banListAvailable ? "info" : "neutral"}>Ban list · {engine.banListAvailable ? engine.banListDate || "loaded" : "unavailable"}</Badge> : null}
              </div>
            ) : null}
          </div>

          <Tabs defaultValue={engine.rules.length === 0 ? "ideas" : "rules"} className="flex-1 px-4 py-3">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="rules">Rules ({engine.rules.length})</TabsTrigger>
              <TabsTrigger value="ideas" className="gap-1">
                <Lightbulb className="h-3.5 w-3.5" aria-hidden="true" /> Ideas
              </TabsTrigger>
              <TabsTrigger value="log">Log ({engine.log.length})</TabsTrigger>
            </TabsList>
            <TabsContent value="rules" className="mt-3">
              <RulesTab engine={engine} />
            </TabsContent>
            <TabsContent value="ideas" className="mt-3">
              <IdeasTab engine={engine} />
            </TabsContent>
            <TabsContent value="log" className="mt-3">
              <LogTab engine={engine} />
            </TabsContent>
          </Tabs>

          <p className="border-t border-border px-4 py-3 text-micro normal-case tracking-normal text-muted-foreground">
            Alerts are educational, not advice. Data for education and research. Not investment advice.
          </p>
        </SheetContent>
      </Sheet>
    </>
  );
}

export default AlertSystem;
