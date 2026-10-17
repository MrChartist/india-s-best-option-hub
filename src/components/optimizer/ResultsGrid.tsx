import { SearchX } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import type { RankedCandidate } from "@/lib/optimizer";
import { ResultCard, type PayoffView } from "./ResultCard";

export interface ResultsGridProps {
  results: RankedCandidate[];
  view: PayoffView | null;
  loading: boolean;
  onOpen: (c: RankedCandidate) => void;
  onAddToBasket: (c: RankedCandidate) => void;
  emptyHint?: string;
}

/** Responsive grid of ranked strategy cards with loading and empty states. */
export function ResultsGrid({ results, view, loading, onOpen, onAddToBasket, emptyHint }: ResultsGridProps) {
  if (loading && results.length === 0) {
    return (
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-3" aria-busy="true" aria-label="Loading strategies">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="space-y-2 rounded-card border border-border bg-card p-3">
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
      <div className="flex flex-col items-center justify-center gap-2 rounded-card border border-dashed border-border bg-card/60 px-4 py-12 text-center">
        <SearchX className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
        <p className="font-display text-[15px] font-bold">No strategy fits these settings</p>
        <p className="max-w-md text-body-sm text-muted-foreground">
          {emptyHint ?? "Try a larger budget, a target further from spot, more strikes around ATM, or looser liquidity filters."}
        </p>
      </div>
    );
  }
  return (
    <div className={loading ? "pointer-events-none opacity-60 transition-opacity" : "transition-opacity"} aria-busy={loading}>
      <ol className="grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-3" aria-label="Ranked strategies">
        {results.map((c) => (
          <li key={c.id} className="flex min-w-0">
            <div className="h-full w-full">
              <ResultCard candidate={c} view={view} onOpen={onOpen} onAddToBasket={onAddToBasket} />
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
