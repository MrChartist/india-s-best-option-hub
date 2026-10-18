import { SearchX } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import type { RankedCandidate } from "@/lib/optimizer";
import { ResultCard } from "./ResultCard";
import { ResultsTable } from "./ResultsTable";
import type { PayoffView, ResultActions } from "./resultHelpers";

const ROW_SKELETONS = ["r1", "r2", "r3", "r4", "r5", "r6", "r7", "r8"];
const CARD_SKELETONS = ["c1", "c2", "c3", "c4", "c5", "c6"];

export type ResultsLayout = "cards" | "table";

export interface ResultsGridProps extends ResultActions {
  results: RankedCandidate[];
  view: PayoffView | null;
  loading: boolean;
  emptyHint?: string;
  /** Cards (default) or the compact table. */
  layout?: ResultsLayout;
  /** The reader's view is Neutral (explains the "matches your view" chip). */
  neutralView?: boolean;
}

/** Ranked strategies as cards or a compact table, with loading and empty states. */
export function ResultsGrid({ results, view, loading, onOpen, onAddToBasket, onPaperTrade, emptyHint, layout = "cards", neutralView = false }: ResultsGridProps) {
  if (loading && results.length === 0 && layout === "table") {
    return (
      <div className="space-y-1.5 rounded-tile border border-separator bg-card p-3" role="status" aria-busy="true" aria-label="Loading strategies">
        <Skeleton className="h-6 w-full" />
        {ROW_SKELETONS.map((k) => (
          <Skeleton key={k} className="h-11 w-full" />
        ))}
      </div>
    );
  }
  if (loading && results.length === 0) {
    return (
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-3" role="status" aria-busy="true" aria-label="Loading strategies">
        {CARD_SKELETONS.map((k) => (
          <div key={k} className="space-y-2 rounded-tile border border-separator bg-card p-3">
            <Skeleton className="h-4 w-2/3" />
            <div className="grid grid-cols-2 gap-2">
              <Skeleton className="h-12" />
              <Skeleton className="h-12" />
            </div>
            <Skeleton className="h-24" />
            <Skeleton className="h-16" />
          </div>
        ))}
      </div>
    );
  }
  if (results.length === 0 || !view) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 rounded-tile border border-separator bg-card px-4 py-12 text-center shadow-card">
        <SearchX className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
        <p className="font-display text-lead font-semibold">No strategy fits these settings</p>
        <p className="max-w-md text-body-sm text-muted-foreground">
          {emptyHint ?? "Try a larger budget, a target further from spot, more strikes around ATM, or looser liquidity filters."}
        </p>
      </div>
    );
  }
  const wrap = loading ? "pointer-events-none opacity-60 transition-opacity" : "transition-opacity";
  if (layout === "table") {
    return (
      <div className={wrap} aria-busy={loading}>
        <ResultsTable results={results} view={view} onOpen={onOpen} onAddToBasket={onAddToBasket} onPaperTrade={onPaperTrade} neutralView={neutralView} />
      </div>
    );
  }
  return (
    <div className={wrap} aria-busy={loading}>
      <ol className="grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-3" aria-label="Ranked strategies">
        {results.map((c, i) => (
          <li key={c.id} className="flex min-w-0">
            <div className="h-full w-full">
              <ResultCard candidate={c} view={view} primary={i === 0} neutralView={neutralView} onOpen={onOpen} onAddToBasket={onAddToBasket} onPaperTrade={onPaperTrade} />
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
