import { useMemo } from "react";

interface Props {
  low: number | null;
  high: number | null;
  current: number | null;
  open?: number | null;
  align?: "left" | "center" | "right";
}

/**
 * The day's range as a thin bar with a live marker — the strip under each price
 * in the reference terminal.
 *
 * Deliberately NOT built on ui/slider.tsx: that is a Radix Root, an interactive
 * input with a focus ring and a 20px thumb, and it would swallow the arrow keys
 * the execution layer depends on. This is a static, aria-hidden readout with the
 * real numbers exposed to screen readers separately.
 */
export function DayRangeMeter({ low, high, current, open, align = "left" }: Props) {
  const { pct, openPct, valid } = useMemo(() => {
    const ok = low !== null && high !== null && current !== null && high > low;
    if (!ok) return { pct: 50, openPct: null as number | null, valid: false };
    const span = (high as number) - (low as number);
    const clamp = (v: number) => Math.min(100, Math.max(0, ((v - (low as number)) / span) * 100));
    return {
      pct: clamp(current as number),
      openPct: open !== null && open !== undefined && Number.isFinite(open) ? clamp(open) : null,
      valid: true,
    };
  }, [low, high, current, open]);

  const fmt = (v: number | null) => (v === null || !Number.isFinite(v) ? "—" : v.toFixed(2));
  const justify = align === "right" ? "flex-row-reverse" : align === "center" ? "justify-center" : "";

  return (
    <div className="w-full select-none">
      <div className={`flex items-baseline gap-2 text-[10px] font-mono text-muted-foreground ${justify}`}>
        <span>L: {fmt(low)}</span>
        <span className="flex-1" />
        <span>{fmt(high)} :H</span>
      </div>

      <div className="relative h-1.5 mt-1 rounded-full bg-muted overflow-hidden" aria-hidden="true">
        {valid && (
          <>
            <div
              className="absolute inset-y-0 left-0 bg-primary/25"
              style={{ width: `${pct}%` }}
            />
            {openPct !== null && (
              <div
                className="absolute inset-y-0 w-px bg-muted-foreground/60"
                style={{ left: `${openPct}%` }}
                title="Open"
              />
            )}
            <div
              className="absolute inset-y-[-2px] w-0.5 rounded-full bg-primary shadow-[0_0_6px_hsl(var(--primary))]"
              style={{ left: `calc(${pct}% - 1px)` }}
            />
          </>
        )}
      </div>

      <span className="sr-only">
        {valid
          ? `Day range ${fmt(low)} to ${fmt(high)}, currently ${fmt(current)}`
          : "Day range not available"}
      </span>
    </div>
  );
}
