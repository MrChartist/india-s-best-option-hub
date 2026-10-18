import { History, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import type { BackfillState } from "@/lib/futures/useFutures";

export interface HistoryLoaderProps {
  symbol: string;
  missing: number;
  storedDays: number;
  state: BackfillState;
  onRun: () => void;
  onCancel: () => void;
}

/**
 * Explicit backfill from the NSE archive. Each session is a separate bhavcopy file, so the user
 * starts it (and can stop it); the proxy fetches one file at a time and caches it for six hours.
 */
export function HistoryLoader({ symbol, missing, storedDays, state, onRun, onCancel }: HistoryLoaderProps) {
  const pct = state.total ? Math.round((state.done / state.total) * 100) : 0;
  return (
    <div
      className="flex flex-col gap-2 rounded-tile bg-muted/50 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between"
      aria-live="polite"
    >
      <div className="min-w-0 text-body-sm">
        {state.running ? (
          <>
            <p className="font-medium">
              Loading {symbol} history: {state.done} of {state.total} sessions
            </p>
            <Progress
              value={pct}
              className="mt-1.5 h-1.5 w-full sm:w-64"
              aria-label={`History download ${pct}% complete`}
            />
          </>
        ) : state.stoppedReason ? (
          <p className="text-warning">
            Stopped after {state.done} sessions: the proxy is not answering ({state.stoppedReason}). Try again when it
            is running.
          </p>
        ) : missing > 0 ? (
          <p className="text-muted-foreground">
            {storedDays} session{storedDays === 1 ? "" : "s"} saved in this browser. {missing} more NSE file
            {missing === 1 ? "" : "s"} fill the OI chart, the roll tracker and the 3-expiry average.
          </p>
        ) : (
          <p className="text-muted-foreground">
            History complete: {storedDays} sessions saved in this browser
            {state.failed ? ` (${state.failed} file${state.failed === 1 ? "" : "s"} not on NSE)` : ""}.
          </p>
        )}
      </div>
      {state.running ? (
        <Button variant="outline" size="sm" onClick={onCancel}>
          <X aria-hidden="true" />
          Stop
        </Button>
      ) : missing > 0 ? (
        <Button variant="outline" size="sm" onClick={onRun}>
          {state.running ? <Loader2 className="animate-spin" aria-hidden="true" /> : <History aria-hidden="true" />}
          Load NSE history ({missing})
        </Button>
      ) : null}
    </div>
  );
}
