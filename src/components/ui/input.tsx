import * as React from "react";

import { cn } from "@/lib/utils";

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          // macOS text field: 5px radius, bezel shadow instead of a border, 3px accent focus ring.
          // 16px text on coarse pointers stops iOS zooming into the field.
          "flex h-7 w-full rounded-sm bg-control px-2 py-1 text-body text-foreground shadow-control transition-shadow duration-fast ease-out file:border-0 file:bg-transparent file:text-body file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:shadow-[var(--shadow-control),var(--focus-ring)] focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40 aria-[invalid=true]:shadow-[0_0_0_2px_hsl(var(--destructive)/0.6)] [@media(pointer:coarse)]:h-9 [@media(pointer:coarse)]:text-base",
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

export { Input };
