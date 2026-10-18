import { useMemo, useState } from "react";
import { Search, TrendingDown, TrendingUp, Minus, Zap } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { formatCompactIN, maxProfitLoss, netPremium, strategyValueAt, toISTDate, type Leg } from "@/lib/options";
import {
  STRATEGY_TEMPLATES,
  TEMPLATE_VIEWS,
  frontExpiry,
  resolveTemplate,
  type ResolveContext,
  type StrategyTemplate,
  type TemplateView,
} from "@/lib/strategyTemplates";
import { cn } from "@/lib/utils";

const VIEW_ICON: Record<TemplateView, JSX.Element> = {
  Bullish: <TrendingUp className="h-3.5 w-3.5 text-bullish" aria-hidden="true" />,
  Bearish: <TrendingDown className="h-3.5 w-3.5 text-bearish" aria-hidden="true" />,
  Neutral: <Minus className="h-3.5 w-3.5 text-warning" aria-hidden="true" />,
  Volatile: <Zap className="h-3.5 w-3.5 text-info" aria-hidden="true" />,
};

export function ViewIcon({ view }: { view: TemplateView }) {
  return VIEW_ICON[view];
}

export interface TemplateLibraryProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  ctx: ResolveContext | null;
  onPick: (t: StrategyTemplate, legs: Leg[]) => void;
}

/** Tiny payoff sparkline at the front expiry (later legs at model value). */
export function MiniPayoff({ legs, spot, className }: { legs: Leg[]; spot: number; className?: string }) {
  const path = useMemo(() => {
    if (legs.length === 0 || !(spot > 0)) return null;
    const front = frontExpiry(legs);
    const at = front ? toISTDate(front, "15:30") : new Date();
    const n = 48;
    const xs = Array.from({ length: n + 1 }, (_, i) => spot * (0.92 + (0.16 * i) / n));
    const ys = xs.map((S) => strategyValueAt(legs, S, { atDate: at, spot }));
    const finite = ys.filter(Number.isFinite);
    if (finite.length === 0) return null;
    const max = Math.max(0, ...finite);
    const min = Math.min(0, ...finite);
    const span = max - min || 1;
    const W = 120;
    const H = 40;
    const y = (v: number) => H - 2 - ((v - min) / span) * (H - 4);
    const d = ys.map((v, i) => `${i === 0 ? "M" : "L"}${((i / n) * W).toFixed(1)},${y(Number.isFinite(v) ? v : 0).toFixed(1)}`).join(" ");
    return { d, zero: y(0), W, H };
  }, [legs, spot]);
  if (!path) return <div className={cn("h-10 w-[120px]", className)} />;
  return (
    <svg viewBox={`0 0 ${path.W} ${path.H}`} className={cn("h-10 w-[120px]", className)} aria-hidden="true">
      <line x1={0} x2={path.W} y1={path.zero} y2={path.zero} className="stroke-muted-foreground/50" strokeDasharray="2 2" strokeWidth={1} />
      <path d={path.d} fill="none" className="stroke-primary" strokeWidth={1.75} strokeLinejoin="round" />
    </svg>
  );
}

export function TemplateLibrary({ open, onOpenChange, ctx, onPick }: TemplateLibraryProps) {
  const [view, setView] = useState<TemplateView>("Neutral");
  const [query, setQuery] = useState("");

  const resolved = useMemo(() => {
    if (!open || !ctx) return new Map<string, Leg[]>();
    return new Map(STRATEGY_TEMPLATES.map((t) => [t.id, resolveTemplate(t, ctx)]));
  }, [open, ctx]);

  const q = query.trim().toLowerCase();
  const matches = (t: StrategyTemplate) => !q || t.name.toLowerCase().includes(q) || t.tags.some((x) => x.includes(q)) || t.description.toLowerCase().includes(q);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-3 overflow-hidden sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>Strategy templates</SheetTitle>
          <SheetDescription>
            {STRATEGY_TEMPLATES.length} structures with strikes set by ATM offset, delta or expected move, priced from the current chain{ctx ? ` for ${ctx.symbol}` : ""}.
          </SheetDescription>
        </SheetHeader>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search: condor, calendar, income…" className="pl-8" aria-label="Search templates" />
        </div>
        <Tabs value={q ? "search" : view} onValueChange={(v) => setView(v as TemplateView)} className="flex min-h-0 flex-1 flex-col">
          {!q && (
            <TabsList className="grid w-full grid-cols-4">
              {TEMPLATE_VIEWS.map((v) => (
                <TabsTrigger key={v} value={v} className="gap-1">
                  {VIEW_ICON[v]} <span className="hidden sm:inline">{v}</span>
                  <span className="sm:hidden">{v.slice(0, 4)}</span>
                </TabsTrigger>
              ))}
            </TabsList>
          )}
          {(q ? ["search"] : TEMPLATE_VIEWS).map((v) => (
            <TabsContent key={v} value={v} className="mt-3 min-h-0 flex-1 overflow-y-auto pr-1">
              <ul className="divide-y divide-separator overflow-hidden rounded-md border border-separator">
                {STRATEGY_TEMPLATES.filter((t) => (q ? matches(t) : t.view === v)).map((t) => {
                  const legs = resolved.get(t.id) ?? [];
                  const mpl = legs.length ? maxProfitLoss(legs) : null;
                  const np = legs.length ? netPremium(legs) : null;
                  return (
                    <li key={t.id}>
                      <button
                        type="button"
                        onClick={() => onPick(t, legs)}
                        disabled={legs.length === 0}
                        className="flex w-full items-start gap-3 bg-card px-3 py-2.5 text-left transition-colors duration-fast hover:bg-control-track focus-visible:outline-none focus-visible:shadow-[inset_0_0_0_2px_hsl(var(--primary)/0.6)] disabled:opacity-40"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            {VIEW_ICON[t.view]}
                            <span className="text-body font-semibold">{t.name}</span>
                            <Badge variant={t.risk === "Defined" ? "bullish" : "warning"}>{t.risk === "Defined" ? "Defined risk" : "Open risk"}</Badge>
                          </div>
                          <p className="mt-1 text-body-sm leading-relaxed text-muted-foreground">{t.description}</p>
                          {legs.length > 0 && (
                            <p className="mt-1 font-num text-body-sm text-muted-foreground">
                              {legs.map((l) => `${l.side === "BUY" ? "B" : "S"}${l.lots > 1 ? l.lots : ""} ${l.type === "FUT" ? "FUT" : `${l.strike}${l.type}`}`).join(" · ")}
                              {np && np.net !== 0 && <span className={np.type === "CREDIT" ? "text-bullish" : "text-bearish"}> · {np.type === "CREDIT" ? "Credit" : "Debit"} {formatCompactIN(Math.abs(np.net), { decimals: 1, symbol: true })}</span>}
                              {mpl && <span> · Max loss {mpl.unlimitedLoss ? "∞" : formatCompactIN(Math.abs(mpl.maxLoss), { decimals: 1, symbol: true })}</span>}
                            </p>
                          )}
                        </div>
                        {ctx && <MiniPayoff legs={legs} spot={ctx.spot} className="shrink-0" />}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </TabsContent>
          ))}
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}
