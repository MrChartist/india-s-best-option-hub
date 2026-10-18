import * as React from "react";
import * as TogglePrimitive from "@radix-ui/react-toggle";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const toggleVariants = cva(
  // Segment / toolbar toggle: borderless until on, then a raised macOS thumb.
  "inline-flex items-center justify-center gap-1.5 rounded-[5px] text-body font-medium text-foreground/80 transition-[background-color,color,box-shadow] duration-base ease-spring hover:text-foreground focus-visible:outline-none focus-visible:shadow-focus disabled:pointer-events-none disabled:opacity-40 data-[state=on]:bg-control data-[state=on]:text-foreground data-[state=on]:shadow-control [&_svg]:size-3.5",
  {
    variants: {
      variant: {
        default: "bg-transparent",
        outline: "bg-control shadow-control hover:bg-control/80",
      },
      size: {
        default: "h-6 px-2.5",
        sm: "h-6 px-2 text-body-sm",
        lg: "h-8 px-4",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

const Toggle = React.forwardRef<
  React.ElementRef<typeof TogglePrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof TogglePrimitive.Root> & VariantProps<typeof toggleVariants>
>(({ className, variant, size, ...props }, ref) => (
  <TogglePrimitive.Root ref={ref} className={cn(toggleVariants({ variant, size, className }))} {...props} />
));

Toggle.displayName = TogglePrimitive.Root.displayName;

export { Toggle, toggleVariants };
