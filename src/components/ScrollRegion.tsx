import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface ScrollRegionProps {
  /** Accessible name announced by screen readers, e.g. "Option chain table". */
  label: string;
  className?: string;
  children: ReactNode;
}

/**
 * A horizontally scrollable wrapper that keyboard users can focus and scroll with
 * the arrow keys (WCAG 2.1.1 / axe "scrollable-region-focusable").
 */
export function ScrollRegion({ label, className, children }: ScrollRegionProps) {
  return (
    <div
      role="region"
      aria-label={label}
      tabIndex={0}
      className={cn(
        "min-w-0 max-w-full overflow-x-auto rounded-[inherit] focus-visible:shadow-focus focus-visible:outline-none",
        className,
      )}
    >
      {children}
    </div>
  );
}
