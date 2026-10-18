import type { ReactNode } from "react";
import { Eraser, Layers, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatINR } from "@/lib/options";
import { LegEditor } from "./LegEditor";
import type { BuilderLeg } from "./strategyState";

export interface LegTableProps {
  legs: BuilderLeg[];
  expiries: string[];
  strikesFor: (expiry: string) => number[];
  marketPriceFor: (leg: BuilderLeg) => number | undefined;
  focusedId: string | null;
  netPremium: { net: number; type: "CREDIT" | "DEBIT" };
  templateName?: string;
  onChange: (id: string, patch: Partial<BuilderLeg>) => void;
  onRemove: (id: string) => void;
  onFocus: (id: string) => void;
  onAdd: () => void;
  onClear: () => void;
  /** Rendered when there are no legs (template quick picks). */
  emptyState?: ReactNode;
}

export function LegTable({ legs, expiries, strikesFor, marketPriceFor, focusedId, netPremium, templateName, onChange, onRemove, onFocus, onAdd, onClear, emptyState }: LegTableProps) {
  const enabled = legs.filter((l) => l.enabled).length;
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="flex min-w-0 items-center gap-2">
            <Layers className="h-4 w-4 text-primary-ink" aria-hidden="true" />
            <span className="truncate">{templateName || (legs.length ? "Custom strategy" : "Legs")}</span>
          </CardTitle>
          <div className="flex shrink-0 items-center gap-1">
            {legs.length > 0 && (
              <Badge variant="neutral" className="font-num">
                {enabled}/{legs.length} on
              </Badge>
            )}
            {legs.length > 0 && (
              <Button type="button" variant="ghost" size="pill" onClick={onClear} aria-label="Clear all legs">
                <Eraser /> Clear
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {legs.length === 0 ? (
          <div className="rounded-md bg-control-track px-4 py-5 text-center">
            <p className="text-body font-medium">No legs yet</p>
            <p className="mt-1 text-body-sm text-muted-foreground">Add a leg, pick from the chain below, or start from a template.</p>
            {emptyState && <div className="mt-3">{emptyState}</div>}
          </div>
        ) : (
          <ul className="divide-y divide-separator overflow-hidden rounded-md border border-separator" aria-label="Strategy legs">
            {legs.map((leg, i) => (
              <li key={leg.id}>
                <LegEditor
                  leg={leg}
                  index={i}
                  expiries={expiries}
                  strikes={strikesFor(leg.expiry)}
                  marketPrice={marketPriceFor(leg)}
                  focused={focusedId === leg.id}
                  onChange={onChange}
                  onRemove={onRemove}
                  onFocus={onFocus}
                />
              </li>
            ))}
          </ul>
        )}
        <div className="flex items-center justify-between gap-2">
          <Button type="button" variant="secondary" onClick={onAdd}>
            <Plus /> Add leg <kbd className="ml-0.5 rounded-chip bg-control-track px-1 font-mono text-micro text-muted-foreground">N</kbd>
          </Button>
          {legs.length > 0 && (
            <div className="text-right">
              <div className="text-label text-muted-foreground">Net premium</div>
              <div className={`font-num text-body font-semibold ${netPremium.type === "CREDIT" ? "text-bullish" : "text-bearish"}`}>
                {netPremium.type === "CREDIT" ? "Credit" : "Debit"} {formatINR(Math.abs(netPremium.net), { decimals: 0 })}
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
