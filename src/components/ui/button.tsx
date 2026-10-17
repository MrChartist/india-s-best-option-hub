import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-semibold tracking-[0.005em] transition-[background-color,color,border-color,box-shadow,transform] duration-fast ease-expo active:scale-[0.97] active:duration-press focus-visible:outline-none focus-visible:shadow-ember disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow-card hover:bg-primary-hover",
        destructive: "bg-destructive text-destructive-foreground shadow-card hover:bg-destructive/90",
        outline: "border border-border bg-card text-foreground shadow-card hover:border-primary/40 hover:bg-accent",
        secondary: "bg-secondary text-secondary-foreground hover:bg-accent",
        ghost: "text-foreground/85 hover:bg-accent hover:text-accent-foreground",
        link: "h-auto px-0 text-primary-ink underline-offset-4 hover:underline",
        buy: "bg-bullish text-bullish-foreground shadow-card hover:bg-bullish/90",
        sell: "bg-bearish text-bearish-foreground shadow-card hover:bg-bearish/90",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 rounded-md px-3",
        lg: "h-11 rounded-lg px-8",
        icon: "h-10 w-10",
        pill: "h-7 rounded-pill px-2.5 text-xs [&_svg]:size-3.5",
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
