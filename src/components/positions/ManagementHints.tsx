/** Rule-based trade-management hints (profit taking, rolling, delta hedging, expiry-day risk). */
import { AlertOctagon, AlertTriangle, CheckCircle2, Lightbulb } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Hint, HintSeverity } from "./analytics";

const META: Record<HintSeverity, { icon: typeof Lightbulb; cls: string; label: string }> = {
  danger: { icon: AlertOctagon, cls: "border-bearish/30 bg-wash-loss/60 text-bearish", label: "Risk" },
  warning: { icon: AlertTriangle, cls: "border-warning/30 bg-wash-warning/60 text-warning", label: "Check" },
  success: { icon: CheckCircle2, cls: "border-bullish/30 bg-wash-profit/60 text-bullish", label: "Profit" },
  info: { icon: Lightbulb, cls: "border-info/25 bg-wash-info/60 text-info", label: "Idea" },
};

export function ManagementHints({ hints }: { hints: Hint[] }) {
  if (!hints.length) {
    return (
      <div className="flex items-center gap-2 rounded-tile border border-separator bg-surface/50 px-3 py-3 text-body-sm text-muted-foreground">
        <CheckCircle2 className="h-4 w-4 text-bullish" aria-hidden="true" />
        Nothing needs attention right now. Hints appear for 50% profit captured, a tested short side, large net delta and expiry-day gamma.
      </div>
    );
  }
  return (
    <ul className="grid gap-2 md:grid-cols-2" aria-label="Management hints">
      {hints.map((h) => {
        const m = META[h.severity];
        const Icon = m.icon;
        return (
          <li key={h.id} className={cn("flex gap-2.5 rounded-tile border px-3 py-2.5", m.cls)}>
            <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <div className="min-w-0">
              <p className="text-body font-semibold">
                <span className="sr-only">{m.label}: </span>
                {h.title}
              </p>
              <p className="mt-0.5 text-body-sm text-foreground/80">{h.detail}</p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
