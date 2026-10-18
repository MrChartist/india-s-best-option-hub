import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/** On touch screens, grow compact buttons' hit area by 6px on every side (WCAG 2.5.8). */
const touchHitArea =
  "relative [@media(pointer:coarse)]:after:absolute [@media(pointer:coarse)]:after:-inset-1.5 [@media(pointer:coarse)]:after:content-['']";

/**
 * macOS push buttons: compact (28px), 6px radius, medium weight, a bezel shadow instead of a
 * border, and they darken rather than shrink when pressed. The ink (white in dark mode) default
 * variant is the "return key" button; use it for one primary action per view. Coarse pointers get 36px.
 */
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-pill text-body font-medium transition-[background-color,color,box-shadow,filter] duration-fast ease-out active:brightness-95 focus-visible:outline-none focus-visible:shadow-focus disabled:pointer-events-none disabled:opacity-40 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow-control hover:bg-primary-hover",
        destructive: "bg-destructive text-destructive-foreground shadow-control hover:bg-destructive/90",
        outline: "bg-control text-foreground shadow-control hover:bg-control/80",
        secondary: "bg-control text-foreground shadow-control hover:bg-control/80",
        ghost: "text-foreground/85 hover:bg-control-track hover:text-foreground",
        link: "h-auto px-0 text-primary-ink underline-offset-4 hover:underline",
        buy: "bg-bullish text-bullish-foreground shadow-control hover:bg-bullish/90",
        sell: "bg-bearish text-bearish-foreground shadow-control hover:bg-bearish/90",
      },
      size: {
        default: "h-7 px-3 [@media(pointer:coarse)]:h-9",
        sm: `h-6 px-2.5 text-body-sm ${touchHitArea}`,
        lg: "h-8 px-4",
        icon: `h-7 w-7 [@media(pointer:coarse)]:h-9 [@media(pointer:coarse)]:w-9 ${touchHitArea}`,
        pill: `h-6 rounded-capsule px-2.5 text-body-sm [&_svg]:size-3.5 ${touchHitArea}`,
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
