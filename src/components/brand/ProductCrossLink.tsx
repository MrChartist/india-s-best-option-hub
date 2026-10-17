import type { ReactNode } from "react";
import { ArrowUpRight } from "lucide-react";
import { product, type ProductId } from "@/lib/brand/links";
import { cn } from "@/lib/utils";
import { MrChartistMark } from "./MrChartistLogo";
import { OutboundLink } from "./OutboundLink";

export interface BrandCrossLinkProps {
  /** Link text, e.g. the product name. */
  name: string;
  url: string;
  /** utm_campaign: the page this line sits on. */
  campaign: string;
  /** Short lead-in before the link. */
  lead?: ReactNode;
  /** Short, faithful summary after the link. */
  blurb?: ReactNode;
  className?: string;
  /** Marks the line for tests and styling hooks. */
  tag?: string;
}

/**
 * One quiet line pointing to something else from Mr. Chartist. Never a banner: muted text, the
 * monochrome mark, and one link.
 */
export function BrandCrossLink({ name, url, campaign, lead = "Also from Mr. Chartist:", blurb, className, tag }: BrandCrossLinkProps) {
  return (
    <p className={cn("flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-body-sm text-muted-foreground", className)} data-cross-link={tag ?? campaign}>
      <MrChartistMark size={14} decorative className="text-foreground" />
      {lead ? <span>{lead}</span> : null}
      <OutboundLink
        url={url}
        campaign={campaign}
        className="inline-flex items-center gap-0.5 rounded-sm font-semibold text-foreground underline decoration-border underline-offset-4 transition-colors duration-fast hover:text-primary-ink hover:decoration-primary focus-visible:shadow-ember focus-visible:outline-none"
      >
        {name}
        <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
      </OutboundLink>
      {blurb ? <span className="min-w-0">{blurb}</span> : null}
    </p>
  );
}

export interface ProductCrossLinkProps extends Omit<BrandCrossLinkProps, "name" | "url" | "tag"> {
  id: ProductId;
}

/** BrandCrossLink for a product in the registry (src/lib/brand/links.ts). */
export function ProductCrossLink({ id, ...rest }: ProductCrossLinkProps) {
  const p = product(id);
  return <BrandCrossLink name={p.name} url={p.url} tag={id} {...rest} />;
}

export default ProductCrossLink;
