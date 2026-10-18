import { useId, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { AlertEngine } from "@/hooks/useAlertEngine";
import { flowStore } from "@/lib/flow";
import { RULE_IDEAS, createRule, describeRule } from "@/lib/alerts";
import { cn } from "@/lib/utils";
import { ALL_SYMBOLS, TYPE_ICON } from "./alertConstants";

/** Template cards: one click turns an idea into a rule for the chosen underlying. */
export function IdeasList({ engine, columns = 1 }: { engine: AlertEngine; columns?: 1 | 2 }) {
  const uid = useId();
  const [symbol, setSymbol] = useState("NIFTY");
  const existing = useMemo(() => new Set(engine.rules.map((r) => describeRule(r))), [engine.rules]);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-body-sm text-muted-foreground">
        <Badge variant="neutral">Educational, not advice</Badge>
        <span>These ideas are starting points for your own alerts, not trade recommendations.</span>
      </div>
      <div className="flex items-center gap-2">
        <Label htmlFor={`${uid}-sym`} className="shrink-0">
          Underlying
        </Label>
        <Select value={symbol} onValueChange={setSymbol}>
          <SelectTrigger id={`${uid}-sym`} className="w-auto min-w-32">
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
      {/* One group box; cells are divided by 1px gaps, and an odd last cell spans the row. */}
      <ul
        className={cn(
          "grid gap-px overflow-hidden rounded-tile border border-separator bg-separator shadow-card",
          columns === 2 ? "grid-cols-1 lg:grid-cols-2 lg:[&>li:last-child:nth-child(odd)]:col-span-2" : "grid-cols-1",
        )}
      >
        {RULE_IDEAS.map((idea) => {
          const draft = idea.make(symbol, flowStore.getState().feeds[symbol]?.spot);
          const preview = describeRule(createRule(draft, 0));
          const added = existing.has(preview);
          return (
            <li key={idea.id} className="flex flex-col bg-card px-3 py-2.5">
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 gap-2">
                  <span className="mt-0.5 shrink-0 text-muted-foreground">{TYPE_ICON[draft.type]}</span>
                  <div className="min-w-0">
                    <p className="font-semibold">{idea.title}</p>
                    <p className="mt-0.5 text-body-sm text-muted-foreground">{idea.why}</p>
                    <p className="mt-1 break-words text-body-sm">{preview}</p>
                  </div>
                </div>
                <Button
                  size="sm"
                  variant={added ? "ghost" : "outline"}
                  disabled={added}
                  onClick={() => {
                    engine.addRule(draft);
                    toast.success("Rule added", { description: preview });
                  }}
                  aria-label={added ? `${idea.title} already added` : `Add rule: ${preview}`}
                >
                  {added ? (
                    "Added"
                  ) : (
                    <>
                      <Plus aria-hidden="true" /> Add
                    </>
                  )}
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
