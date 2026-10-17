/** Pre-trade confirmation for "Place all": legs by underlying, net premium, margin, charges, funds after and the max-loss guardrail. */
import { useEffect, useId, useState } from "react";
import { FlaskConical, ShieldAlert, ShieldCheck } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatDateIST, formatINR, formatNumberIN, formatPct } from "@/lib/options";
import type { GuardResult } from "@/lib/paperTrading";
import { cn } from "@/lib/utils";
import { signedClass, signedINR } from "@/components/positions/helpers";
import type { BasketPreview } from "./basketPreview";

export function BasketConfirmDialog({
  open,
  onOpenChange,
  preview,
  capital,
  maxRiskPct,
  guard,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  preview: BasketPreview | null;
  capital: number;
  maxRiskPct: number;
  guard: (maxLoss: number | null) => GuardResult | null;
  onConfirm: (maxLoss: number | null) => void;
}) {
  const uid = useId();
  const [text, setText] = useState("");
  useEffect(() => {
    if (!open) setText("");
  }, [open]);
  const maxLoss = text.trim() && Number(text) > 0 ? Number(text) : null;
  const g = preview ? guard(maxLoss) : null;
  const pct = maxLoss !== null && capital > 0 ? (maxLoss / capital) * 100 : NaN;
  const worst = g && !g.risk.unlimited ? Math.ceil(g.risk.loss) : null;
  const canPlace = !!preview && preview.riskLegs.length > 0 && !!g?.ok;

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-h-[90dvh] max-w-2xl overflow-y-auto">
        <AlertDialogHeader>
          <AlertDialogTitle>Review the basket before placing</AlertDialogTitle>
          <AlertDialogDescription>Every leg goes in as a market order at mid plus slippage. Figures below are estimates from the current quotes.</AlertDialogDescription>
        </AlertDialogHeader>
        {!preview ? null : (
          <div className="space-y-4 text-body-sm">
            {preview.anySample ? (
              <p className="flex items-start gap-1.5 rounded-tile border border-warning/30 bg-wash-warning/60 px-3 py-2 text-foreground">
                <FlaskConical className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" /> Some legs are priced from sample quotes, not the market. Fills will be labelled Sample.
              </p>
            ) : null}
            {preview.groups.map((grp) => (
              <section key={grp.symbol} className="rounded-tile border border-border" aria-label={`${grp.symbol} legs`}>
                <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border bg-surface/60 px-3 py-2">
                  <p className="font-display font-bold">
                    {grp.symbol}
                    {grp.spot > 0 ? <span className="ml-2 font-sans text-micro font-normal text-muted-foreground">spot {formatNumberIN(grp.spot, 2)}</span> : null}
                  </p>
                  <p className="font-num text-micro tabular-nums text-muted-foreground">
                    net <span className={cn("font-semibold", signedClass(grp.premium))}>{signedINR(grp.premium)}</span> · margin {formatINR(grp.margin, { decimals: 0 })}
                    {grp.hedgeBenefit > 0 ? ` · hedge benefit ${formatINR(grp.hedgeBenefit, { decimals: 0 })}` : ""}
                  </p>
                </header>
                <ul className="divide-y divide-border">
                  {grp.legs.map((l, i) => (
                    <li key={`${l.key}-${l.input.side}-${i}`} className="flex items-center justify-between gap-2 px-3 py-1.5">
                      <span className="min-w-0">
                        <Badge variant={l.input.side === "BUY" ? "bullish" : "bearish"}>{l.input.side}</Badge>{" "}
                        <span className="font-semibold">
                          {l.input.lots} × {formatNumberIN(l.input.strike)} {l.input.type}
                        </span>
                        <span className="ml-1 text-micro text-muted-foreground">{formatDateIST(l.input.expiry)}</span>
                        {preview.naked.some((n) => n.startsWith(`${l.input.symbol} ${l.input.type}`)) && l.input.side === "SELL" ? (
                          <Badge variant="warning" className="ml-1">
                            Naked short
                          </Badge>
                        ) : null}
                      </span>
                      <span className="shrink-0 text-right font-num tabular-nums">
                        {l.price > 0 ? (
                          <>
                            ≈ {formatNumberIN(l.price, 2)}
                            <span className={cn("block text-micro", signedClass(l.premium))}>{signedINR(l.premium)}</span>
                          </>
                        ) : (
                          <span className="text-bearish">No quote</span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
                {grp.elm > 0 ? (
                  <p className="border-t border-border px-3 py-1.5">
                    <Badge variant="warning">incl. expiry-day ELM {formatINR(grp.elm, { decimals: 0 })}</Badge>
                  </p>
                ) : null}
              </section>
            ))}

            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                ["Net premium", <span key="np" className={signedClass(preview.netPremium)}>{signedINR(preview.netPremium)}</span>, preview.netPremium >= 0 ? "credit" : "debit"],
                ["Margin (est.)", formatINR(preview.margin, { decimals: 0 }), "SPAN-style, new legs"],
                ["Charges", formatINR(preview.charges, { decimals: 0 }), "entry orders"],
                ["Available after", <span key="aa" className={preview.availableAfter < 0 ? "text-bearish" : undefined}>{formatINR(preview.availableAfter, { decimals: 0 })}</span>, `now ${formatINR(preview.availableBefore, { decimals: 0 })}`],
              ].map(([k, v, sub]) => (
                <div key={k as string} className="rounded-tile border border-border px-2.5 py-2">
                  <dt className="text-label uppercase text-muted-foreground">{k}</dt>
                  <dd className="font-num text-lead font-semibold tabular-nums">{v}</dd>
                  <dd className="text-micro text-muted-foreground">{sub}</dd>
                </div>
              ))}
            </dl>

            <div className="space-y-1.5 rounded-tile border border-border p-3">
              <Label htmlFor={`${uid}-ml`} className="flex items-center gap-1.5">
                <ShieldAlert className="h-4 w-4 text-primary-ink" aria-hidden="true" /> Max loss for this basket (₹) <span className="text-bearish" aria-hidden="true">*</span>
              </Label>
              <div className="flex items-center gap-2">
                <Input id={`${uid}-ml`} type="number" inputMode="numeric" min={1} step={100} required aria-required="true" value={text} onChange={(e) => setText(e.target.value)} placeholder={worst ? `Worst case ${worst}` : "Required"} className="h-9" />
                {worst && !text ? (
                  <Button type="button" variant="outline" size="sm" className="h-9 shrink-0" onClick={() => setText(String(worst))}>
                    Use {formatINR(worst, { decimals: 0 })}
                  </Button>
                ) : null}
              </div>
              <p className="text-muted-foreground">
                Worst case at expiry: {g ? (g.risk.unlimited ? <span className="font-semibold text-bearish">unlimited</span> : <span className="font-num font-semibold text-foreground">{formatINR(g.risk.loss, { decimals: 0 })}</span>) : "—"} including charges.
                {maxLoss !== null ? (
                  <>
                    {" "}
                    Your max loss is <span className={cn("font-num font-semibold", pct > maxRiskPct ? "text-bearish" : "text-foreground")}>{formatPct(pct, { decimals: 2 })}</span> of capital (limit {maxRiskPct}%).
                  </>
                ) : null}
              </p>
            </div>

            {preview.unpriced.length ? <p className="text-bearish">No quote right now for {preview.unpriced.join(", ")}. Those legs will be rejected.</p> : null}
            {g && !g.ok ? (
              <ul className="space-y-1 rounded-tile border border-warning/30 bg-wash-warning/60 px-3 py-2 text-foreground" aria-label="Guardrail checks">
                {g.blockers.map((b) => (
                  <li key={b} className="flex items-start gap-1.5">
                    <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" aria-hidden="true" />
                    {b}
                  </li>
                ))}
              </ul>
            ) : g?.ok ? (
              <p className="flex items-center gap-1.5 text-bullish">
                <ShieldCheck className="h-4 w-4" aria-hidden="true" /> {g.reducing ? "This basket only reduces open positions." : "Guardrails passed."}
              </p>
            ) : null}
          </div>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel>Back</AlertDialogCancel>
          <AlertDialogAction disabled={!canPlace} onClick={() => onConfirm(maxLoss)}>
            Place {preview?.riskLegs.length ?? 0} leg{preview?.riskLegs.length === 1 ? "" : "s"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
