import type { ReactNode } from "react";
import { ArrowUpRight } from "lucide-react";
import { withUtm } from "@/lib/brand/links";
import { cn } from "@/lib/utils";

export interface OutboundLinkProps {
  url: string;
  /** utm_campaign value (where in the app the link sits). sebi.gov.in links are never tagged. */
  campaign: string;
  children: ReactNode;
  className?: string;
  /** Show the ↗ arrow after the text. */
  arrow?: boolean;
  /** Accessible name when the visible content is only an icon. "(opens in a new tab)" is appended. */
  label?: string;
  title?: string;
}

/**
 * Link that leaves Option Hub: UTM-tagged, opens in a new tab with noopener/noreferrer and
 * tells screen-reader users that it does.
 */
export function OutboundLink({ url, campaign, children, className, arrow = false, label, title }: OutboundLinkProps) {
  return (
    <a
      href={withUtm(url, campaign)}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
      aria-label={label ? `${label} (opens in a new tab)` : undefined}
      title={title}
    >
      {children}
      {arrow ? <ArrowUpRight className={cn("inline h-3.5 w-3.5 shrink-0")} aria-hidden="true" /> : null}
      {label ? null : <span className="sr-only"> (opens in a new tab)</span>}
    </a>
  );
}

export default OutboundLink;
