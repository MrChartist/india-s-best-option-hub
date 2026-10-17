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
          "flex h-9 w-9 items-center justify-center rounded-lg transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
          on ? "text-primary-ink" : "text-sidebar-foreground",
          className,
        )}
      >
        <Eye className="h-[17px] w-[17px]" strokeWidth={1.75} aria-hidden="true" />
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
        "flex min-h-8 w-full items-center gap-2 rounded-lg border border-sidebar-border bg-sidebar-accent/40 px-2.5 py-1.5 text-left text-[11px] font-medium text-sidebar-foreground transition-colors hover:text-foreground",
        className,
      )}
    >
      <Eye className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="block">Colour-blind palette</span>
        <span className="flex items-center gap-1 text-[10.5px] font-normal text-muted-foreground">
          <span className="inline-block h-2 w-2 rounded-full bg-bullish" aria-hidden="true" />
          <span className="inline-block h-2 w-2 rounded-full bg-bearish" aria-hidden="true" />
          {hint}
        </span>
      </span>
      <span
        aria-hidden="true"
        className={cn(
          "relative h-4 w-7 shrink-0 rounded-full border transition-colors",
          on ? "border-primary bg-primary" : "border-sidebar-border bg-muted",
        )}
      >
        <span
          className={cn(
            "absolute top-1/2 h-3 w-3 -translate-y-1/2 rounded-full bg-card shadow-card transition-[left] duration-fast",
            on ? "left-[0.8rem]" : "left-0.5",
          )}
        />
      </span>
    </button>
  );
}

export default PaletteToggle;
