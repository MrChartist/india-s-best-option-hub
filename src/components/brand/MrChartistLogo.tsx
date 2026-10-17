import { useId, type SVGProps } from "react";
import { MARK_PATHS, MARK_VIEWBOX_ATTR } from "@/lib/brand/logo";
import { BRAND } from "@/lib/brand/links";
import { cn } from "@/lib/utils";

export interface MrChartistMarkProps extends Omit<SVGProps<SVGSVGElement>, "children"> {
  /** Rendered size in px (square). Crisp from 16 to 40 px and beyond. */
  size?: number;
  /** Accessible name. Ignored when `decorative`. */
  title?: string;
  /** Hide from assistive tech (when visible text next to it already names the brand). */
  decorative?: boolean;
}

/**
 * The official Mr. Chartist mark. It is filled with currentColor, so it follows the text colour:
 * ink on light, white on dark. Keep it monochrome; orange is only the accent colour.
 */
export function MrChartistMark({ size = 24, title = BRAND.name, decorative = false, className, ...rest }: MrChartistMarkProps) {
  const titleId = useId();
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={MARK_VIEWBOX_ATTR}
      width={size}
      height={size}
      fill="currentColor"
      focusable="false"
      role={decorative ? undefined : "img"}
      aria-hidden={decorative ? true : undefined}
      aria-labelledby={decorative ? undefined : titleId}
      className={cn("shrink-0", className)}
      data-brand-mark=""
      {...rest}
    >
      {decorative ? null : <title id={titleId}>{title}</title>}
      {MARK_PATHS.map((d) => (
        <path key={d.slice(0, 24)} d={d} />
      ))}
    </svg>
  );
}

export interface MrChartistLogoProps {
  /** "lockup" shows the mark with the "Mr. Chartist" wordmark and a product label. */
  variant?: "mark" | "lockup";
  /** Mark size in px. */
  size?: number;
  /** Small product label under the wordmark. Pass null to hide it. */
  product?: string | null;
  className?: string;
  markClassName?: string;
}

/**
 * Mark, or mark + wordmark lockup ("Mr. Chartist" with a small "Option Hub" label).
 * In the lockup the visible text names the brand, so the mark itself is decorative.
 */
export function MrChartistLogo({ variant = "lockup", size = 28, product = BRAND.product, className, markClassName }: MrChartistLogoProps) {
  if (variant === "mark") {
    return <MrChartistMark size={size} title={`${BRAND.name}${product ? ` ${product}` : ""}`} className={cn(markClassName, className)} />;
  }
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-2.5 text-foreground", className)}>
      <MrChartistMark size={size} decorative className={markClassName} />
      <span className="flex min-w-0 flex-col">
        <span className="truncate font-display text-[15px] font-bold leading-none tracking-[-0.01em]">{BRAND.name}</span>
        {/* Whitespace is dropped by the flex column, but keeps the text "Mr. Chartist Option Hub" for assistive tech. */}{" "}
        {product ? (
          <span className="mt-1 truncate text-[10.5px] font-semibold uppercase leading-none tracking-[0.14em] text-muted-foreground">{product}</span>
        ) : null}
      </span>
    </span>
  );
}

export default MrChartistLogo;
