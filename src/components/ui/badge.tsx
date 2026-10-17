import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * Chip-style badge. Buildup mapping used across the app:
 * Long buildup → bullish, Short buildup → bearish, Short covering → info, Long unwinding → warning.
 */
const badgeVariants = cva(
  "inline-flex h-5 shrink-0 items-center gap-1 whitespace-nowrap rounded-chip border px-1.5 text-label uppercase transition-colors focus:outline-none focus-visible:shadow-ember [&_svg]:size-3",
  {
    variants: {
      variant: {
        // Light mode: primary-ink on wash-brand is only ~3.75:1, which fails WCAG AA
        // for 11px text (this is the "SAMPLE DATA" disclosure chip). orange-900 on
        // orange-100 is ~8:1 and still reads as brand orange. Dark mode keeps
        // primary-ink (orange-300 on orange-900), which already passes.
        default: "border-transparent bg-wash-brand text-[hsl(var(--orange-900))] dark:text-primary-ink",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        destructive: "border-transparent bg-destructive text-destructive-foreground",
        outline: "border-border text-foreground",
        bullish: "border-transparent bg-wash-profit text-bullish",
        bearish: "border-transparent bg-wash-loss text-bearish",
        warning: "border-transparent bg-wash-warning text-warning",
        info: "border-transparent bg-wash-info text-info",
        neutral: "border-transparent bg-muted text-muted-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

const Badge = React.forwardRef<HTMLDivElement, BadgeProps>(({ className, variant, ...props }, ref) => (
  <div ref={ref} className={cn(badgeVariants({ variant }), className)} {...props} />
));
Badge.displayName = "Badge";

export { Badge, badgeVariants };
