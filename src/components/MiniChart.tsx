import { useRef, useEffect, memo } from "react";
import { useSparklineData } from "@/hooks/useChartData";
import { useIsDark, getChartColors } from "@/hooks/useIsDark";

interface MiniChartProps {
  symbol: string;
  width?: number;
  height?: number;
  className?: string;
}

/**
 * Tiny sparkline chart rendered with canvas.
 * Shows 3-month price trend as a simple line with gradient fill.
 */
export const MiniChart = memo(function MiniChart({
  symbol,
  width = 80,
  height = 28,
  className = "",
}: MiniChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { data: closes } = useSparklineData(symbol);
  const isDark = useIsDark();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !closes || closes.length < 2) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    const min = Math.min(...closes);
    const max = Math.max(...closes);
    const range = max - min || 1;
    const padding = 2;
    const chartWidth = width - padding * 2;
    const chartHeight = height - padding * 2;

    const colors = getChartColors(isDark);
    const isPositive = closes[closes.length - 1] >= closes[0];
    const lineColor = isPositive ? colors.bullish : colors.bearish;
    const fillColor = isPositive ? `hsl(${colors.bullishRaw} / 0.15)` : `hsl(${colors.bearishRaw} / 0.12)`;

    // Build path
    const stepX = chartWidth / (closes.length - 1);
    const points: [number, number][] = closes.map((val, i) => [
      padding + i * stepX,
      padding + chartHeight - ((val - min) / range) * chartHeight,
    ]);

    // Fill gradient
    ctx.beginPath();
    ctx.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i][0], points[i][1]);
    }
    ctx.lineTo(points[points.length - 1][0], height);
    ctx.lineTo(points[0][0], height);
    ctx.closePath();

    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, fillColor);
    gradient.addColorStop(1, "transparent");
    ctx.fillStyle = gradient;
    ctx.fill();

    // Draw line
    ctx.beginPath();
    ctx.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i][0], points[i][1]);
    }
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 1.2;
    ctx.lineJoin = "round";
    ctx.stroke();
  }, [closes, width, height, isDark]);

  if (!closes || closes.length < 2) {
    return (
      <div
        className={`rounded skeleton-shimmer ${className}`}
        style={{ width, height }}
      />
    );
  }

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ width, height }}
    />
  );
});
