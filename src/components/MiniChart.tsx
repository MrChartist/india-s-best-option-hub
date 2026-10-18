import { memo, useId, useMemo } from "react";
import { useSparklineData } from "@/hooks/useChartData";
import { cn } from "@/lib/utils";

export interface SparklineProps {
  values: readonly number[];
  /** Pixel width, or "100%" to fill the parent (the SVG scales without distorting the stroke). */
  width?: number | "100%";
  height?: number;
  /** Optional reference level drawn as a dashed line (for example the previous close). */
  baseline?: number;
  /** Colour by direction; "auto" compares the last value with the baseline or the first value. */
  tone?: "auto" | "bullish" | "bearish" | "neutral";
  fill?: boolean;
  className?: string;
  /** Accessible description; the chart is decorative when omitted. */
  label?: string;
}

const STROKE: Record<"bullish" | "bearish" | "neutral", string> = {
  bullish: "hsl(var(--bullish))",
  bearish: "hsl(var(--bearish))",
  neutral: "hsl(var(--muted-foreground))",
};

/** Tiny inline-SVG sparkline (no chart library). */
export const Sparkline = memo(function Sparkline({ values, width = 80, height = 28, baseline, tone = "auto", fill = true, className, label }: SparklineProps) {
  const gid = useId().replace(/:/g, "");
  const W = 100;
  const H = height;
  const geo = useMemo(() => {
    const pts = values.filter((v) => Number.isFinite(v));
    if (pts.length < 2) return null;
    const hasBase = baseline !== undefined && Number.isFinite(baseline) && baseline > 0;
    let min = Math.min(...pts);
    let max = Math.max(...pts);
    if (hasBase) {
      min = Math.min(min, baseline as number);
      max = Math.max(max, baseline as number);
    }
    const range = max - min || 1;
    const pad = 2;
    const y = (v: number) => pad + (H - pad * 2) * (1 - (v - min) / range);
    const step = W / (pts.length - 1);
    const line = pts.map((v, i) => `${i === 0 ? "M" : "L"}${(i * step).toFixed(2)} ${y(v).toFixed(2)}`).join("");
    const area = `${line}L${W} ${H}L0 ${H}Z`;
    const ref = hasBase ? y(baseline as number) : null;
    const up = pts[pts.length - 1] >= (hasBase ? (baseline as number) : pts[0]);
    return { line, area, ref, up };
  }, [values, baseline, H]);

  if (!geo) return null;
  const t = tone === "auto" ? (geo.up ? "bullish" : "bearish") : tone;
  const color = STROKE[t];
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className={cn("block overflow-visible", className)}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {fill ? (
        <>
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.22} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <path d={geo.area} fill={`url(#${gid})`} stroke="none" />
        </>
      ) : null}
      {geo.ref !== null ? (
        <line x1={0} x2={W} y1={geo.ref} y2={geo.ref} stroke="hsl(var(--muted-foreground))" strokeOpacity={0.6} strokeWidth={1} strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
      ) : null}
      <path d={geo.line} fill="none" stroke={color} strokeWidth={1.4} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
});

interface MiniChartProps {
  symbol: string;
  width?: number;
  height?: number;
  className?: string;
  /**
   * Skip the history request and show a dash, e.g. next to sample quotes, where a real price
   * history would not match the illustrative last price.
   */
  disabled?: boolean;
}

/**
 * Three-month closing-price sparkline for a symbol, drawn as inline SVG.
 * Shows a shimmer while loading and an em dash when no history is available.
 */
export const MiniChart = memo(function MiniChart({ symbol, width = 80, height = 28, className = "", disabled = false }: MiniChartProps) {
  const { data: closes, isLoading } = useSparklineData(symbol, !disabled);
  if (disabled || !closes || closes.length < 2) {
    if (isLoading && !disabled) return <div className={cn("rounded skeleton-shimmer", className)} style={{ width, height }} aria-hidden="true" />;
    return (
      <span className={cn("inline-flex items-center justify-center text-body-sm text-muted-foreground", className)} style={{ width, height }} title={disabled ? "No price history for sample quotes" : "No price history"}>
        —
      </span>
    );
  }
  const first = closes[0];
  const last = closes[closes.length - 1];
  const pct = first > 0 ? ((last - first) / first) * 100 : 0;
  return (
    <Sparkline
      values={closes}
      width={width}
      height={height}
      className={className}
      label={`${symbol} 3-month trend, ${pct >= 0 ? "up" : "down"} ${Math.abs(pct).toFixed(1)} percent`}
    />
  );
});
