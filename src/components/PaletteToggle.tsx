import { Eye } from "lucide-react";
import { useTheme } from "@/hooks/useTheme";
import { cn } from "@/lib/utils";

export interface PaletteToggleProps {
  /** Icon-only button for the collapsed sidebar rail. */
  collapsed?: boolean;
  className?: string;
}

/**
 * Switches profit/loss colours between green/red and a colour-vision-friendly
 * blue/orange (sets data-palette="cvd" on <html>; persisted in localStorage).
 */
export function PaletteToggle({ collapsed = false, className }: PaletteToggleProps) {
  const { palette, setPalette } = useTheme();
  const on = palette === "cvd";
  const toggle = () => setPalette(on ? "default" : "cvd");
  const hint = on ? "Profit blue, loss orange" : "Profit green, loss red";

  if (collapsed) {
    return (
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label="Colour-blind friendly palette"
        title={`Colour-blind friendly palette: ${on ? "on" : "off"}`}
        onClick={toggle}
        className={cn(
          "flex h-9 w-9 items-center justify-center rounded-pill transition-colors hover:bg-control-track focus-visible:shadow-focus focus-visible:outline-none",
          on ? "text-primary-ink" : "text-sidebar-foreground",
          className,
        )}
      >
        <Eye className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
      </button>
    );
  }

  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={toggle}
      className={cn(
        "flex min-h-8 w-full items-center gap-2 rounded-pill px-2 py-1 text-left text-body-sm text-sidebar-foreground focus-visible:shadow-focus focus-visible:outline-none",
        className,
      )}
    >
      <Eye className="h-4 w-4 shrink-0 text-primary-ink" strokeWidth={1.75} aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="block">Colour-blind palette</span>
        <span className="flex items-center gap-1 text-micro text-muted-foreground">
          <span className="inline-block h-2 w-2 rounded-full bg-bullish" aria-hidden="true" />
          <span className="inline-block h-2 w-2 rounded-full bg-bearish" aria-hidden="true" />
          {hint}
        </span>
      </span>
      {/* Mini macOS switch (26x15), drawn for sighted users; the button itself is the switch. */}
      <span
        aria-hidden="true"
        className={cn(
          "relative h-[15px] w-[26px] shrink-0 rounded-capsule transition-colors duration-base",
          on ? "bg-primary" : "bg-[hsl(var(--switch-off))]",
        )}
      >
        <span
          className={cn(
            "absolute top-[2px] h-[11px] w-[11px] rounded-capsule bg-knob shadow-[0_0.5px_1.5px_rgb(0_0_0/0.3)] transition-[left] duration-base ease-spring",
            on ? "left-[13px]" : "left-[2px]",
          )}
        />
      </span>
    </button>
  );
}
