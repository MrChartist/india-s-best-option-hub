import type { KeyboardEvent } from "react";
import { cn } from "@/lib/utils";

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  title?: string;
}

/**
 * macOS segmented control with radio-group semantics: a 6px tray, the selected segment as a
 * raised thumb (bg-control is white in light mode, graphite in dark). Arrow keys move the
 * selection, as in a native radio group. `fill` stretches the segments to the tray width.
 */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  className,
  size = "sm",
  fill = false,
}: {
  value: T;
  options: ReadonlyArray<SegmentedOption<T>>;
  onChange: (v: T) => void;
  ariaLabel: string;
  className?: string;
  /** sm: 24px tray for dense panels; md: 28px, the standard control height. */
  size?: "sm" | "md";
  fill?: boolean;
}) {
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const idx = options.findIndex((x) => x.value === value);
    const next = options[(idx + (e.key === "ArrowRight" ? 1 : options.length - 1)) % options.length];
    onChange(next.value);
    const group = e.currentTarget.parentElement;
    group?.querySelector<HTMLButtonElement>(`[data-value="${CSS.escape(next.value)}"]`)?.focus();
  };
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn(
        "inline-flex items-center gap-px rounded-pill bg-control-track p-0.5",
        size === "sm" ? "h-6" : "h-7 [@media(pointer:coarse)]:h-9",
        fill && "flex w-full",
        className,
      )}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            data-value={o.value}
            title={o.title}
            onClick={() => onChange(o.value)}
            onKeyDown={onKeyDown}
            className={cn(
              "h-full min-w-0 truncate whitespace-nowrap rounded-[5px] font-medium transition-[background-color,color,box-shadow] duration-base ease-spring focus-visible:outline-none focus-visible:shadow-focus",
              size === "sm" ? "px-2 text-body-sm" : "px-2.5 text-body",
              fill && "flex-1",
              active ? "bg-control text-foreground shadow-control" : "text-foreground/70 hover:text-foreground",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
