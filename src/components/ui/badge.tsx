import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * Chip-style badge. Renders a <span> so it is valid inline anywhere, including inside <p>.
 * Buildup mapping used across the app:
 * Long buildup → bullish, Short buildup → bearish, Short covering → info, Long unwinding → warning.
 */
const badgeVariants = cva(
  "inline-flex h-[18px] shrink-0 items-center gap-1 whitespace-nowrap rounded-chip border px-1.5 text-micro font-semibold transition-colors focus:outline-none focus-visible:shadow-focus [&_svg]:size-3",
  {
    variants: {
      variant: {
        // Neutral iOS-style chip: ink on a darker cream (white on graphite in dark mode).
        default: "border-transparent bg-wash-brand text-foreground",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        destructive: "border-transparent bg-destructive text-destructive-foreground",
        outline: "border-separator-strong text-foreground",
        bullish: "border-transparent bg-wash-profit text-bullish",
        bearish: "border-transparent bg-wash-loss text-bearish",
        warning: "border-warning/40 bg-transparent text-warning",
        info: "border-transparent bg-wash-info text-info",
        neutral: "border-transparent bg-muted text-muted-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(({ className, variant, ...props }, ref) => (
  <span ref={ref} className={cn(badgeVariants({ variant }), className)} {...props} />
));
Badge.displayName = "Badge";

export { Badge, badgeVariants };
