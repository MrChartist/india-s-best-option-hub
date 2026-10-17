import { Database, FlaskConical, Radio, Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatTimeIST } from "@/lib/options";

export interface SourceBadgeProps {
  source: string;
  asOf?: number;
  stale?: boolean;
  isLive?: boolean;
  reason?: string;
}

const SOURCE_NAME: Record<string, string> = { dhan: "Dhan", nse: "NSE", bse: "BSE", yahoo: "Yahoo", tv: "TradingView", cache: "Cache", sample: "Sample", database: "Local DB", none: "Offline" };

/** Where the chain came from, how fresh it is and why. Sample data is always labelled. */
export function SourceBadge({ source, asOf, stale, isLive, reason }: SourceBadgeProps) {
  const name = SOURCE_NAME[source] ?? source.toUpperCase();
  const isSample = source === "sample";
  const variant = isSample ? "warning" : isLive && !stale ? "bullish" : stale ? "neutral" : "info";
  const Icon = isSample ? FlaskConical : isLive && !stale ? Radio : stale ? Clock : Database;
  const text = isSample ? "Sample data" : isLive && !stale ? `Live · ${name}` : stale ? `Last saved · ${name}` : `Delayed · ${name}`;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} className="inline-flex cursor-default rounded-chip focus-visible:shadow-ember focus-visible:outline-none">
          <Badge variant={variant}>
            <Icon aria-hidden="true" />
            {text}
          </Badge>
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-[260px] text-xs">
        <p className="font-semibold">{text}</p>
        {asOf ? <p className="text-muted-foreground">As of {formatTimeIST(asOf, { seconds: true })}</p> : null}
        {reason ? <p className="mt-1 text-muted-foreground">{reason}</p> : null}
        {isSample && <p className="mt-1 text-muted-foreground">Generated with Black-76 for illustration. Not market data.</p>}
      </TooltipContent>
    </Tooltip>
  );
}
