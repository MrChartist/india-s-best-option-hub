import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatTimeIST } from "@/lib/options";
import type { DataSource } from "@/lib/types/market";

export interface SourceInfo {
  source: DataSource | "none";
  isLive: boolean;
  stale?: boolean;
  afterHours?: boolean;
  asOf?: number;
  reason?: string;
}

/** Visible data-source label: Live / Closing / Cached / Sample data, plus a "Derived" Greeks tag. */
export function GexSourceTag({ info, showDerived = true }: { info: SourceInfo | null; showDerived?: boolean }) {
  if (!info) return null;
  const { source, isLive, stale, afterHours, asOf, reason } = info;
  let label = "Live";
  let variant: "bullish" | "warning" | "neutral" | "info" = "bullish";
  if (source === "sample" || source === "none") {
    label = "Sample data";
    variant = "warning";
  } else if (source === "cache" || stale) {
    label = "Cached";
    variant = "neutral";
  } else if (afterHours || !isLive) {
    label = "Closing data";
    variant = "info";
  }
  const when = asOf ? formatTimeIST(asOf) : "";
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant={variant} tabIndex={0} aria-label={`${label}${reason ? `: ${reason}` : ""}`}>
            {label}
          </Badge>
        </TooltipTrigger>
        <TooltipContent className="max-w-64 text-body-sm">
          {source === "sample" || source === "none"
            ? `${reason ?? "Live data unavailable"}. Showing a generated sample chain, not market data.`
            : `Source: ${source.toUpperCase()}${when ? ` · as of ${when}` : ""}${reason ? ` · ${reason}` : ""}`}
        </TooltipContent>
      </Tooltip>
      {showDerived && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge variant="outline" tabIndex={0}>
              Derived
            </Badge>
          </TooltipTrigger>
          <TooltipContent className="max-w-64 text-body-sm">
            Exposures are computed here from open interest with Black-76 Greeks. They are a model of positioning, not
            reported dealer books.
          </TooltipContent>
        </Tooltip>
      )}
      {when && source !== "sample" && source !== "none" && (
        <span className="font-num text-label text-muted-foreground">{when}</span>
      )}
    </div>
  );
}
