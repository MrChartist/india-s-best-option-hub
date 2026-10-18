/** Paper account settings in a side sheet: fills, charges, guardrails and reset. */
import { useEffect, useId, useState } from "react";
import { RotateCcw, Settings2, ShieldCheck } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { BROKER_PRESETS, formatINR } from "@/lib/options";
import { DEFAULT_CAPITAL, guardrailsOf, type Guardrails, type PaperState } from "@/lib/paperTrading";

function NumberField({ id, label, value, onCommit, min, max, step, suffix, help }: { id: string; label: string; value: number | null; onCommit: (v: number | null) => void; min: number; max: number; step: number; suffix?: string; help?: string }) {
  const [text, setText] = useState(value === null ? "" : String(value));
  useEffect(() => setText(value === null ? "" : String(value)), [value]);
  const commit = () => {
    const t = text.trim();
    if (!t) return onCommit(null);
    const v = Number(t);
    if (Number.isFinite(v) && v >= min && v <= max) onCommit(v);
    else setText(value === null ? "" : String(value));
  };
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>
        {label}
        {suffix ? <span className="ml-1 font-normal text-muted-foreground">{suffix}</span> : null}
      </Label>
      <Input id={id} type="number" inputMode="decimal" min={min} max={max} step={step} value={text} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} aria-describedby={help ? `${id}-help` : undefined} />
      {help ? (
        <p id={`${id}-help`} className="text-micro text-muted-foreground">
          {help}
        </p>
      ) : null}
    </div>
  );
}

export function AccountSheet({
  state,
  onSettings,
  onGuardrails,
  onReset,
}: {
  state: PaperState;
  onSettings: (patch: Partial<Omit<PaperState["settings"], "guardrails">>) => void;
  onGuardrails: (patch: Partial<Guardrails>) => void;
  onReset: (capital: number) => void;
}) {
  const uid = useId();
  const g = guardrailsOf(state);
  const [capitalText, setCapitalText] = useState(String(state.startingCapital));
  useEffect(() => setCapitalText(String(state.startingCapital)), [state.startingCapital]);
  const cap = Number(capitalText) > 0 ? Number(capitalText) : DEFAULT_CAPITAL;

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm">
          <Settings2 aria-hidden="true" /> Account
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Paper account settings</SheetTitle>
          <SheetDescription>Slippage and broker apply to new fills. Guardrails apply to every new order and basket.</SheetDescription>
        </SheetHeader>

        <div className="mt-5 space-y-6">
          <section className="space-y-3" aria-labelledby={`${uid}-fills`}>
            <h3 id={`${uid}-fills`} className="font-display text-lead font-semibold">
              Fills and charges
            </h3>
            <div className="grid grid-cols-2 gap-3">
              <NumberField id={`${uid}-slip`} label="Slippage" suffix="% of mid" value={state.settings.slippagePct} min={0} max={10} step={0.1} onCommit={(v) => onSettings({ slippagePct: v ?? 0 })} />
              <div className="grid gap-1.5">
                <Label htmlFor={`${uid}-broker`}>Broker charges</Label>
                <Select value={state.settings.brokerId} onValueChange={(v) => onSettings({ brokerId: v })}>
                  <SelectTrigger id={`${uid}-broker`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {BROKER_PRESETS.filter((b) => b.id !== "custom").map((b) => (
                      <SelectItem key={b.id} value={b.id}>
                        {b.name} · ₹{b.perOrder}/order
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex items-start justify-between gap-3">
              <Label htmlFor={`${uid}-sample`} className="text-body-sm font-normal leading-snug">
                Allow fills on sample quotes when no live chain is reachable (fills are labelled “Sample”).
              </Label>
              <Switch id={`${uid}-sample`} checked={state.settings.allowSampleFills} onCheckedChange={(v) => onSettings({ allowSampleFills: v })} />
            </div>
          </section>

          <section className="space-y-3 border-t border-separator pt-5" aria-labelledby={`${uid}-guard`}>
            <h3 id={`${uid}-guard`} className="flex items-center gap-1.5 font-display text-lead font-semibold">
              <ShieldCheck className="h-4 w-4 text-primary-ink" aria-hidden="true" /> Guardrails
            </h3>
            <div className="flex items-start justify-between gap-3">
              <Label htmlFor={`${uid}-beginner`} className="text-body-sm font-normal leading-snug">
                <span className="block font-semibold">Beginner mode</span>
                Hides and blocks naked option selling. A sell must be hedged by a long of the same type.
              </Label>
              <Switch id={`${uid}-beginner`} checked={g.beginnerMode} onCheckedChange={(v) => onGuardrails({ beginnerMode: v })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <NumberField
                id={`${uid}-risk`}
                label="Max loss per trade"
                suffix="% of capital"
                value={g.maxRiskPct}
                min={0.1}
                max={25}
                step={0.5}
                onCommit={(v) => onGuardrails({ maxRiskPct: v ?? 2 })}
                help="Every order needs a max loss in ₹ up to this share of equity."
              />
              <NumberField
                id={`${uid}-cap`}
                label="Daily loss cap"
                suffix="₹ (blank = off)"
                value={g.dailyLossCap}
                min={100}
                max={1e9}
                step={1000}
                onCommit={(v) => onGuardrails({ dailyLossCap: v })}
                help="Reached when today's realised plus open P&L hits −cap. Then only exits are allowed."
              />
            </div>
          </section>

          <section className="space-y-3 border-t border-separator pt-5" aria-labelledby={`${uid}-reset`}>
            <h3 id={`${uid}-reset`} className="font-display text-lead font-semibold">
              Capital and reset
            </h3>
            <div className="flex flex-wrap items-end gap-2">
              <div className="grid flex-1 gap-1.5">
                <Label htmlFor={`${uid}-capital`}>Virtual capital (₹)</Label>
                <Input id={`${uid}-capital`} type="number" inputMode="numeric" min={10000} step={10000} value={capitalText} onChange={(e) => setCapitalText(e.target.value)} />
              </div>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline">
                    <RotateCcw aria-hidden="true" /> Reset account
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Reset the paper account?</AlertDialogTitle>
                    <AlertDialogDescription>All positions, orders, trades and the ledger are deleted and the account restarts with {formatINR(cap, { decimals: 0 })}. Settings and guardrails are kept.</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={() => onReset(cap)}>Reset</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}
