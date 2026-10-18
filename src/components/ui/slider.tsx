import * as React from "react";
import * as SliderPrimitive from "@radix-ui/react-slider";

import { cn } from "@/lib/utils";

type ThumbA11yProps = Pick<
  React.ComponentPropsWithoutRef<typeof SliderPrimitive.Thumb>,
  "aria-label" | "aria-labelledby" | "aria-valuetext" | "aria-describedby" | "id"
>;

export type SliderProps = React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root> & ThumbA11yProps;

/**
 * The accessible name and value text belong on the focusable thumb (role="slider"),
 * not on the root <span>, so labels and ids are forwarded to every Thumb.
 */
const Slider = React.forwardRef<React.ElementRef<typeof SliderPrimitive.Root>, SliderProps>(
  (
    {
      className,
      "aria-label": ariaLabel,
      "aria-labelledby": ariaLabelledBy,
      "aria-valuetext": ariaValueText,
      "aria-describedby": ariaDescribedBy,
      id,
      ...props
    },
    ref,
  ) => {
    const count = Math.max(1, (props.value ?? props.defaultValue ?? [0]).length);
    return (
      <SliderPrimitive.Root
        ref={ref}
        className={cn("relative flex w-full touch-none select-none items-center py-1", className)}
        {...props}
      >
        <SliderPrimitive.Track className="relative h-1 w-full grow overflow-hidden rounded-capsule bg-[hsl(var(--switch-off))]">
          <SliderPrimitive.Range className="absolute h-full bg-primary" />
        </SliderPrimitive.Track>
        {Array.from({ length: count }, (_, i) => (
          <SliderPrimitive.Thumb
            // Thumbs are positional (min, max) and never reorder.
            // eslint-disable-next-line mrc/no-array-index-key
            key={i}
            id={i === 0 ? id : id ? `${id}-${i}` : undefined}
            aria-label={ariaLabel}
            aria-labelledby={ariaLabelledBy}
            aria-valuetext={ariaValueText}
            aria-describedby={ariaDescribedBy}
            className="block h-5 w-5 rounded-capsule bg-knob shadow-[0_0_0_0.5px_rgb(0_0_0/0.12),0_1px_3px_rgb(0_0_0/0.25)] transition-shadow duration-fast focus-visible:outline-none focus-visible:shadow-focus disabled:pointer-events-none disabled:opacity-40"
          />
        ))}
      </SliderPrimitive.Root>
    );
  },
);
Slider.displayName = SliderPrimitive.Root.displayName;

export { Slider };
