import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * tailwind-merge only knows Tailwind's stock theme. Our config adds custom
 * font sizes, radii and shadows (tailwind.config.ts); without registering them
 * twMerge treats e.g. `text-label` as a text colour and drops it when a colour
 * class such as `text-primary-ink` follows. Keep these lists in sync with the
 * `fontSize`, `borderRadius` and `boxShadow` extensions in tailwind.config.ts.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [
        {
          text: ["2xs", "micro", "label", "body-sm", "body", "lead", "title", "display", "num-hero"],
        },
      ],
      rounded: [{ rounded: ["chip", "pill", "tab", "tile", "card", "panel", "capsule"] }],
      shadow: [{ shadow: ["card", "card-hover", "float", "ember", "glow", "glow-sm", "glow-lg"] }],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
