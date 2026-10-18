import { useEffect, useMemo, useState } from "react";
import { Wand2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { formatCompactIN, formatINR, formatPct, formatStrike, timeToExpiryYears, type BrokerPreset, type Leg } from "@/lib/options";
import { TEMPLATE_VIEWS, rankTemplates, type ResolveContext, type StrategyTemplate, type TemplateView } from "@/lib/strategyTemplates";
import { cn } from "@/lib/utils";
import { MiniPayoff, ViewIcon } from "./TemplateLibrary";
import { Segmented } from "./Segmented";
import { timeLabel, type TimePoint } from "./strategyState";

export interface StrategyWizardProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  ctx: ResolveContext | null;
  timeline: TimePoint[];
  broker?: BrokerPreset;
  onPick: (t: StrategyTemplate, legs: Leg[]) => void;
}

function defaultTarget(view: TemplateView, spot: number, sd: number): number {
  if (view === "Bullish") return spot * Math.exp(sd);
  if (view === "Bearish") return spot * Math.exp(-sd);
  if (view === "Volatile") return spot * Math.exp(1.25 * sd);
  return spot;
}

export function StrategyWizard({ open, onOpenChange, ctx, timeline, broker, onPick }: StrategyWizardProps) {
  const [view, setView] = useState<TemplateView>("Bullish");
  const spot = ctx?.spot ?? 0;
  const T = ctx ? Math.max(timeToExpiryYears(ctx.expiries[0] ?? "", ctx.now) || 0, 1 / 365) : 1 / 52;
  const sd = (ctx?.atmIv ?? 0.15) * Math.sqrt(T);
  const [target, setTarget] = useState(0);
  const [dateIdx, setDateIdx] = useState(0);

  const dateChoices = useMemo(() => timeline.filter((p, i) => i > 0 && (p.label.endsWith("close") || p.label === "At expiry")), [timeline]);

  useEffect(() => {
    if (!open || !(spot > 0)) return;
    setTarget(Math.round(defaultTarget(view, spot, sd)));
  }, [open, view, spot, sd]);

  useEffect(() => {
    if (open) setDateIdx(Math.max(0, dateChoices.length - 1));
  }, [open, dateChoices.length]);

  const targetDate = dateChoices[Math.min(dateIdx, dateChoices.length - 1)]?.at;
  const ranked = useMemo(() => {
    if (!open || !ctx || !(target > 0) || !targetDate) return [];
    return rankTemplates({ direction: view, targetPrice: target, targetDate, broker }, ctx).slice(0, 8);
  }, [open, ctx, view, target, targetDate, broker]);

  const lo = Math.round(spot * Math.exp(-2.5 * sd));
  const hi = Math.round(spot * Math.exp(2.5 * sd));
  const movePct = spot > 0 ? ((target - spot) / spot) * 100 : 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wand2 className="h-4 w-4 text-primary-ink" aria-hidden="true" /> Find a strategy for your view
          </DialogTitle>
          <DialogDescription>
            Pick a direction, a target price and a date. Templates are ranked by model return on estimated margin at that target, after round-trip charges.
          </DialogDescription>
        </DialogHeader>

        {!ctx || !(spot > 0) ? (
          <p className="py-8 text-center text-body text-muted-foreground">Waiting for market data…</p>
        ) : (
          <div className="space-y-4">
            <Segmented ariaLabel="Market view" value={view} onChange={setView} options={TEMPLATE_VIEWS.map((v) => ({ value: v, label: v }))} />
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="wiz-target" className="text-body-sm">
                  {view === "Volatile" ? "Move size (either way)" : view === "Neutral" ? "Expected price (stays near)" : "Target price"}
                </Label>
                <div className="flex items-center gap-2">
                  <Input id="wiz-target" type="number" inputMode="decimal" value={target || ""} onChange={(e) => setTarget(Number(e.target.value))} className="w-32 font-num" />
                  <span className={cn("font-num text-body-sm", movePct >= 0 ? "text-bullish" : "text-bearish")}>{formatPct(movePct, { decimals: 2, signed: true })}</span>
                  <span className="text-body-sm text-muted-foreground">from {formatStrike(Math.round(spot))}</span>
                </div>
                <Slider value={[Math.min(Math.max(target, lo), hi)]} min={lo} max={hi} step={Math.max(1, Math.round((hi - lo) / 200))} onValueChange={([v]) => setTarget(v)} aria-label="Target price" />
                <div className="flex justify-between text-micro font-normal text-muted-foreground">
                  <span>−2.5σ {formatStrike(lo)}</span>
                  <span>+2.5σ {formatStrike(hi)}</span>
                </div>
              </div>
              <div className="space-y-2">
                <Label className="text-body-sm">By date</Label>
                <Select value={String(dateIdx)} onValueChange={(v) => setDateIdx(Number(v))}>
                  <SelectTrigger aria-label="Target date">
                    <SelectValue placeholder="Choose a date" />
                  </SelectTrigger>
                  <SelectContent>
                    {dateChoices.map((p, i) => (
                      <SelectItem key={p.at.getTime()} value={String(i)} className="text-body-sm">
                        {p.label === "At expiry" ? `At expiry · ${timeLabel(p.at)}` : timeLabel(p.at)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-body-sm text-muted-foreground">Uses today's IV for later dates. Margin is an estimate.</p>
              </div>
            </div>

            <div className={cn(ranked.length > 0 && "divide-y divide-separator overflow-hidden rounded-md border border-separator")} aria-live="polite">
              {ranked.length === 0 ? (
                <p className="py-4 text-center text-body text-muted-foreground">No templates match. Try another target.</p>
              ) : (
                ranked.map((r, i) => (
                  <div key={r.template.id} className={cn("flex flex-wrap items-center gap-3 px-3 py-2.5", i === 0 && "bg-wash-brand/40")}>
                    <div className="min-w-[160px] flex-1">
                      <div className="flex items-center gap-1.5 text-body font-semibold">
                        <ViewIcon view={r.template.view} /> {r.template.name}
                        {i === 0 && <Badge>Best fit</Badge>}
                      </div>
                      <div className="mt-1 grid grid-cols-2 gap-x-4 gap-y-0.5 font-num text-body-sm sm:grid-cols-4">
                        <span>
                          <span className="text-muted-foreground">Return </span>
                          <span className={r.returnOnMargin >= 0 ? "text-bullish" : "text-bearish"}>{Number.isFinite(r.returnOnMargin) ? formatPct(r.returnOnMargin * 100, { decimals: 1, signed: true }) : "—"}</span>
                        </span>
                        <span>
                          <span className="text-muted-foreground">Net P&L </span>
                          <span className={r.netPnl >= 0 ? "text-bullish" : "text-bearish"}>{formatINR(r.netPnl, { decimals: 0 })}</span>
                        </span>
                        <span>
                          <span className="text-muted-foreground">Margin </span>
                          {formatCompactIN(r.margin, { decimals: 1, symbol: true })}
                        </span>
                        <span>
                          <span className="text-muted-foreground">POP </span>
                          {Number.isFinite(r.pop) ? formatPct(r.pop * 100, { decimals: 0 }) : "—"}
                        </span>
                        <span className="col-span-2 sm:col-span-4">
                          <span className="text-muted-foreground">Max loss </span>
                          {r.unlimitedLoss ? <span className="text-bearish">Unlimited</span> : formatINR(r.maxLoss, { decimals: 0 })}
                          <span className="text-muted-foreground"> · charges {formatINR(r.charges, { decimals: 0 })}</span>
                        </span>
                      </div>
                    </div>
                    <MiniPayoff legs={r.legs} spot={spot} />
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => {
                        onPick(r.template, r.legs);
                        onOpenChange(false);
                      }}
                    >
                      Use
                    </Button>
                  </div>
                ))
              )}
            </div>
            <p className="text-body-sm text-muted-foreground">Model results, not predictions. Data for education and research. Not investment advice.</p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
