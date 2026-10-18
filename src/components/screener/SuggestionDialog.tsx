import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, ArrowRight, FlaskConical, Radio, Database, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { strategyBuilderUrl } from "@/components/option-chain/basket";
import { formatDateIST, formatINR, formatNumberIN, getLotSize } from "@/lib/options";
import type { ScreenerRow } from "@/lib/screener/metrics";
import type { PresetId } from "@/lib/screener/presets";
import { buildSuggestedLegs, netPremiumPerUnit, suggestionFor, type SuggestedStructure } from "@/lib/screener/suggest";
import { loadSuggestionChain, type SuggestionChainSource } from "@/lib/screener/suggestChain";
import { cn } from "@/lib/utils";

type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | {
      status: "ready";
      structure: SuggestedStructure;
      expiry: string;
      source: SuggestionChainSource;
      reason?: string;
      spot: number;
    };

const SOURCE_BADGE: Record<
  SuggestionChainSource,
  { label: string; variant: "bullish" | "neutral" | "warning"; Icon: typeof Radio }
> = {
  live: { label: "Live chain", variant: "bullish", Icon: Radio },
  cache: { label: "Last saved chain", variant: "neutral", Icon: Database },
  sample: { label: "Sample chain", variant: "warning", Icon: FlaskConical },
};

export interface SuggestionDialogProps {
  row: ScreenerRow | null;
  preset: PresetId | null;
  /** False when the screener itself is in sample mode: never price sample rows off a live chain. */
  allowLive: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Preview of the suggested structure for one row, with a hand-off to the Strategy Builder. */
export function SuggestionDialog({ row, preset, allowLive, onOpenChange }: SuggestionDialogProps) {
  const navigate = useNavigate();
  const [state, setState] = useState<State>({ status: "loading" });
  const meta = row ? suggestionFor(row, preset) : null;

  useEffect(() => {
    if (!row) return;
    const m = suggestionFor(row, preset);
    if (!m) {
      setState({
        status: "error",
        message: "Nothing in this row points to a clear structure yet. Wait for IV, HV or futures OI to be scanned.",
      });
      return;
    }
    const ctrl = new AbortController();
    setState({ status: "loading" });
    loadSuggestionChain(row, { allowLive, signal: ctrl.signal })
      .then((chain) => {
        if (ctrl.signal.aborted) return;
        if (!chain) {
          setState({ status: "error", message: "No option chain is available for this symbol." });
          return;
        }
        const structure = buildSuggestedLegs(m, chain.model, row.symbol, chain.expiry);
        setState({
          status: "ready",
          structure,
          expiry: chain.expiry,
          source: chain.source,
          reason: chain.reason,
          spot: chain.model.spot,
        });
      })
      .catch(() => {
        if (!ctrl.signal.aborted)
          setState({ status: "error", message: "The option chain could not be loaded. Please try again." });
      });
    return () => ctrl.abort();
  }, [row, preset, allowLive]);

  const open = row !== null;
  const ready = state.status === "ready" ? state : null;
  const legs = ready?.structure.legs ?? [];
  const lot = row && ready ? (getLotSize(row.symbol, ready.expiry) ?? NaN) : NaN;
  const { net, unpriced } = netPremiumPerUnit(legs);
  const src = ready ? SOURCE_BADGE[ready.source] : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] w-[calc(100vw-2rem)] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 pr-6 font-display">
            <Sparkles className="h-4 w-4 shrink-0 text-primary-ink" aria-hidden="true" />
            {row ? `${row.symbol}: ${meta?.title ?? "Suggested structure"}` : "Suggested structure"}
          </DialogTitle>
          <DialogDescription>
            {meta?.rationale ?? "A starting point to study in the Strategy Builder."}
          </DialogDescription>
        </DialogHeader>

        {state.status === "loading" ? (
          <div className="space-y-2" role="status" aria-busy="true" aria-label="Loading option chain">
            <Skeleton className="h-5 w-40" />
            {["l1", "l2", "l3", "l4"].map((k) => (
              <Skeleton key={k} className="h-8 w-full" />
            ))}
          </div>
        ) : state.status === "error" ? (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-tile bg-wash-warning px-3 py-2 text-body-sm text-warning"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {state.message}
          </p>
        ) : ready ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-body-sm text-muted-foreground">
              {src ? (
                <Badge
                  variant={src.variant}
                  title={
                    ready.source === "sample"
                      ? "Black-76 prices generated for illustration. Not market data."
                      : undefined
                  }
                >
                  <src.Icon aria-hidden="true" />
                  {src.label}
                </Badge>
              ) : null}
              <span>
                Expiry {formatDateIST(ready.expiry)} · spot {formatINR(ready.spot, { decimals: 2 })}
                {Number.isFinite(lot) ? ` · lot ${formatNumberIN(lot)}` : ""}
              </span>
            </div>
            {ready.source === "sample" && ready.reason ? (
              <p className="text-body-sm text-muted-foreground">{ready.reason} Premiums below are illustrative.</p>
            ) : null}

            {legs.length === 0 ? (
              <p
                role="alert"
                className="flex items-start gap-2 rounded-tile bg-wash-warning px-3 py-2 text-body-sm text-warning"
              >
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                {ready.structure.error ?? "The legs could not be built from this chain."}
              </p>
            ) : (
              <div className="overflow-x-auto rounded-tile border border-separator">
                <table className="w-full min-w-[320px] text-body-sm">
                  <caption className="sr-only">Suggested legs, one lot each</caption>
                  <thead>
                    <tr className="bg-surface text-label text-muted-foreground [&>th]:shadow-[inset_0_calc(-1*var(--hairline))_0_hsl(var(--separator-strong))]">
                      <th scope="col" className="px-3 py-2 text-left">
                        Leg
                      </th>
                      <th scope="col" className="px-2 py-2 text-right">
                        Strike
                      </th>
                      <th scope="col" className="px-2 py-2 text-right">
                        Premium
                      </th>
                      <th scope="col" className="px-3 py-2 text-right">
                        IV
                      </th>
                    </tr>
                  </thead>
                  <tbody className="zebra-rows">
                    {legs.map((l) => (
                      <tr key={`${l.side}-${l.type}-${l.strike}`}>
                        <th scope="row" className="px-3 py-1.5 text-left font-normal">
                          <span
                            className={cn(
                              "mr-1.5 inline-flex w-9 justify-center rounded-chip px-1 text-micro font-semibold uppercase",
                              l.side === "BUY" ? "bg-wash-profit text-bullish" : "bg-wash-loss text-bearish",
                            )}
                          >
                            {l.side === "BUY" ? "Buy" : "Sell"}
                          </span>
                          {l.type}
                        </th>
                        <td className="px-2 text-right font-num tabular-nums">
                          {formatNumberIN(l.strike, l.strike % 1 ? 2 : 0)}
                        </td>
                        <td className="px-2 text-right font-num tabular-nums">
                          {l.premium > 0 ? formatINR(l.premium, { decimals: 2 }) : "—"}
                        </td>
                        <td className="px-3 text-right font-num tabular-nums">
                          {l.iv !== null ? `${(l.iv * 100).toFixed(1)}%` : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {legs.length > 0 ? (
              <dl className="grid grid-cols-2 gap-2">
                <div className="rounded-md bg-control-track px-3 py-2">
                  <dt className="text-label text-muted-foreground">
                    {net >= 0 ? "Net credit / unit" : "Net debit / unit"}
                  </dt>
                  <dd className={cn("font-num text-lead tabular-nums", net >= 0 ? "text-bullish" : "text-bearish")}>
                    {formatINR(Math.abs(net), { decimals: 2 })}
                  </dd>
                </div>
                <div className="rounded-md bg-control-track px-3 py-2">
                  <dt className="text-label text-muted-foreground">Per lot</dt>
                  <dd className="font-num text-lead tabular-nums">
                    {Number.isFinite(lot) ? formatINR(Math.abs(net) * lot, { decimals: 0 }) : "—"}
                  </dd>
                </div>
              </dl>
            ) : null}
            {unpriced > 0 ? (
              <p className="text-body-sm text-warning">
                {unpriced} leg{unpriced === 1 ? " has" : "s have"} no quote; check prices in the builder.
              </p>
            ) : null}
            <p className="text-body-sm text-muted-foreground">
              One lot per leg. Charges, margin, breakevens and POP are worked out in the Strategy Builder. Not
              investment advice.
            </p>
          </div>
        ) : null}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button
            disabled={legs.length === 0}
            onClick={() => {
              onOpenChange(false);
              navigate(strategyBuilderUrl(legs));
            }}
          >
            Open in Strategy Builder
            <ArrowRight aria-hidden="true" />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
