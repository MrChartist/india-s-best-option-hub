import { Pause, Play, RotateCcw, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { SCAN_INTERVAL_MS, type ScanPart } from "@/lib/screener/scanner";
import type { ScanProgress as Progress } from "@/lib/screener/useScreener";
import { cn } from "@/lib/utils";

const PART_LABEL: Record<ScanPart, string> = { chain: "option chain", futures: "futures (bhavcopy)", history: "daily candles" };

export interface ScanProgressProps {
  progress: Progress;
  enabled: boolean;
  onPause: () => void;
  onResume: () => void;
  onReset: () => void;
}

/** Rotating-fetch indicator: coverage, freshness, what is being fetched now, and pause/resume. */
export function ScanProgress({ progress, enabled, onPause, onResume, onReset }: ScanProgressProps) {
  const { done, fresh, total, current, paused, offlineReason } = progress;
  const pctDone = total > 0 ? (done / total) * 100 : 0;
  const pctFresh = total > 0 ? (fresh / total) * 100 : 0;
  const status = !enabled
    ? "Paused: sample data"
    : offlineReason
      ? `Proxy unreachable (${offlineReason}). Retrying every 30 s`
      : paused
        ? "Scan paused"
        : current
          ? `Fetching ${current.symbol} ${PART_LABEL[current.part]}`
          : done >= total && total > 0
            ? "All symbols up to date"
            : "Waiting";

  return (
    <div className="flex w-full flex-col gap-1.5 rounded-tile border border-separator bg-card px-3 py-2 shadow-card sm:w-[340px]">
      <div className="flex items-center justify-between gap-2">
        <span className="text-headline">Per-stock scan</span>
        <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={paused ? onResume : onPause}
                disabled={!enabled}
                aria-label={paused ? "Resume scan" : "Pause scan"}
              >
                {paused ? <Play /> : <Pause />}
              </Button>
            </TooltipTrigger>
            <TooltipContent className="text-body-sm">{paused ? "Resume" : "Pause"} the rotating fetch</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" onClick={onReset} disabled={!enabled} aria-label="Clear cached scan and start again">
                <RotateCcw />
              </Button>
            </TooltipTrigger>
            <TooltipContent className="text-body-sm">Clear the saved scan and start again</TooltipContent>
          </Tooltip>
        </div>
      </div>
      <div
        className="relative h-1 overflow-hidden rounded-capsule bg-control-track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done}
        aria-valuetext={`${done} of ${total} scanned, ${fresh} fresh`}
        aria-label="Scan coverage"
      >
        <div className="absolute inset-y-0 left-0 rounded-capsule bg-primary/35 transition-[width] duration-settle ease-expo" style={{ width: `${pctDone}%` }} />
        <div className="absolute inset-y-0 left-0 rounded-capsule bg-primary transition-[width] duration-settle ease-expo" style={{ width: `${pctFresh}%` }} />
      </div>
      <div className="flex items-center justify-between gap-2 text-body-sm font-normal text-muted-foreground">
        <span className={cn("flex min-w-0 items-center gap-1 truncate", offlineReason && "text-warning")} aria-live="polite">
          {offlineReason ? <WifiOff className="h-3 w-3 shrink-0" aria-hidden="true" /> : current && !paused ? <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-capsule bg-primary" aria-hidden="true" /> : null}
          <span className="truncate">{status}</span>
        </span>
        <span className="shrink-0 font-num tabular-nums">
          {fresh}/{done}/{total}
        </span>
      </div>
      <p className="text-micro font-normal text-muted-foreground">
        Fresh / scanned / total. One request every {SCAN_INTERVAL_MS / 1000} s, visible rows first. Older values show a clock.
      </p>
    </div>
  );
}
