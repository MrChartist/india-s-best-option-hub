import { useRef, useEffect, useState, useCallback, useMemo } from "react";
import { createChart, ColorType, CandlestickSeries, HistogramSeries, LineSeries, LineStyle, type IChartApi, type ISeriesApi, type SeriesType, type Time } from "lightweight-charts";
import { resolveTokenColor } from "@/lib/chartTheme";
import { formatDateIST } from "@/lib/options";
import { useChartData } from "@/hooks/useChartData";
import { useIsDark, getChartColors } from "@/hooks/useIsDark";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { BarChart3, Loader2, CandlestickChart, LineChart } from "lucide-react";

const TIME_RANGES = ["1W", "1M", "3M", "6M", "1Y"] as const;
type TimeRange = (typeof TIME_RANGES)[number];

export interface ExpectedMoveBand {
  /** ISO expiry the band belongs to. */
  expiry: string;
  upper: number;
  lower: number;
}

export type ChartLevelKind = "callWall" | "putWall" | "flip" | "maxPain" | "absGamma";

export interface ChartLevel {
  price: number;
  label: string;
  kind: ChartLevelKind;
}

interface ChartOverlays {
  /** Expected-move bands drawn as dashed price lines (one pair per expiry). */
  expectedMoveBands?: ExpectedMoveBand[];
  /** Key option levels (walls, gamma flip, max pain) drawn as price lines. */
  levels?: ChartLevel[];
}

/** Token used for each level kind. CE OI walls are resistance (bearish), PE OI walls support (bullish). */
const LEVEL_TOKEN: Record<ChartLevelKind, string> = {
  callWall: "chart-call",
  putWall: "chart-put",
  flip: "warning",
  maxPain: "chart-1",
  absGamma: "info",
};

const finitePos = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x) && x > 0;

/** Token values from index.css, used only when CSS variables cannot be read (SSR/tests). */
const TOKEN_FALLBACK = {
  dark: { info: "hsl(211 78% 68%)", muted: "hsl(72 6% 64%)", grid: "hsl(212 14% 12%)" },
  light: { info: "hsl(212.6 80% 33.3%)", muted: "hsl(337 10% 40%)", grid: "hsl(54 14% 89%)" },
} as const;

function drawOverlays(series: ISeriesApi<SeriesType>, o: ChartOverlays, isDark: boolean) {
  const fb = TOKEN_FALLBACK[isDark ? "dark" : "light"];
  const bands = (o.expectedMoveBands ?? []).filter((b) => b && finitePos(b.upper) && finitePos(b.lower));
  bands.forEach((b, i) => {
    const color = resolveTokenColor("info", fb.info, Math.max(0.45, 0.9 - i * 0.2));
    const tag = b.expiry ? formatDateIST(b.expiry).split(" ").slice(0, 2).join(" ") : "";
    for (const [price, side] of [[b.upper, "+1σ"], [b.lower, "−1σ"]] as const) {
      series.createPriceLine({ price, color, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: `EM ${side}${tag ? ` ${tag}` : ""}` });
    }
  });
  for (const l of o.levels ?? []) {
    if (!l || !finitePos(l.price)) continue;
    const color = resolveTokenColor(LEVEL_TOKEN[l.kind] ?? "muted-foreground", fb.muted);
    series.createPriceLine({
      price: l.price,
      color,
      lineWidth: l.kind === "flip" ? 2 : 1,
      lineStyle: l.kind === "maxPain" ? LineStyle.Dotted : l.kind === "flip" ? LineStyle.Solid : LineStyle.LargeDashed,
      axisLabelVisible: true,
      title: l.label,
    });
  }
}

interface StockChartProps extends ChartOverlays {
  symbol: string;
  /** Inline mode renders directly, otherwise renders inside a Card */
  inline?: boolean;
  /** Initial height in pixels */
  height?: number;
  /** If provided, renders as a Sheet (drawer) */
  asSheet?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

function ChartCore({
  symbol,
  height = 340,
  expectedMoveBands,
  levels,
}: {
  symbol: string;
  height?: number;
} & ChartOverlays) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const [range, setRange] = useState<TimeRange>("3M");
  const [chartType, setChartType] = useState<"candle" | "line">("candle");
  const { data: candles, isLoading, error } = useChartData(symbol, range);
  const isDark = useIsDark();
  // Stable key so new array identities with the same content do not rebuild the chart.
  const overlayKey = JSON.stringify({ b: expectedMoveBands ?? [], l: levels ?? [] });
  const overlays = useMemo((): ChartOverlays => {
    const parsed = JSON.parse(overlayKey) as { b: ExpectedMoveBand[]; l: ChartLevel[] };
    return { expectedMoveBands: parsed.b, levels: parsed.l };
  }, [overlayKey]);

  const buildChart = useCallback(() => {
    if (!chartContainerRef.current || !candles || candles.length === 0) return;

    // Destroy previous chart
    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
    }

    const container = chartContainerRef.current;
    const colors = getChartColors(isDark);
    const fb = TOKEN_FALLBACK[isDark ? "dark" : "light"];
    const gridColor = resolveTokenColor("chart-grid", fb.grid, 0.6);
    const crosshairColor = resolveTokenColor("muted-foreground", fb.muted, 0.5);

    const chart = createChart(container, {
      width: container.clientWidth,
      height,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: colors.text,
        fontFamily: "'Inter', 'SF Pro', system-ui, sans-serif",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: gridColor },
        horzLines: { color: gridColor },
      },
      crosshair: {
        vertLine: { color: crosshairColor, width: 1, style: 2, labelBackgroundColor: colors.primary },
        horzLine: { color: crosshairColor, width: 1, style: 2, labelBackgroundColor: colors.primary },
      },
      rightPriceScale: {
        borderVisible: false,
        scaleMargins: { top: 0.1, bottom: 0.25 },
      },
      timeScale: {
        borderVisible: false,
        timeVisible: range === "1W",
        secondsVisible: false,
        rightOffset: 3,
        minBarSpacing: range === "1W" ? 3 : 4,
      },
      handleScroll: { mouseWheel: true, pressedMouseMove: true },
      handleScale: { mouseWheel: true, pinch: true },
    });

    chartRef.current = chart;

    // Format candle data for lightweight-charts
    const formattedCandles = candles.map((c) => ({
      time: c.time as Time,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));

    if (chartType === "candle") {
      const candleSeries = chart.addSeries(CandlestickSeries, {
        upColor: colors.bullish,
        downColor: colors.bearish,
        borderUpColor: colors.bullish,
        borderDownColor: colors.bearish,
        wickUpColor: colors.bullish,
        wickDownColor: colors.bearish,
      });
      candleSeries.setData(formattedCandles);
      drawOverlays(candleSeries, overlays, isDark);
    } else {
      const isPositive = candles[candles.length - 1].close >= candles[0].close;
      const lineColor = isPositive ? colors.bullish : colors.bearish;
      const lineSeries = chart.addSeries(LineSeries, {
        color: lineColor,
        lineWidth: 2,
        crosshairMarkerVisible: true,
        crosshairMarkerRadius: 4,
      });
      lineSeries.setData(
        candles.map((c) => ({ time: c.time as Time, value: c.close }))
      );
      drawOverlays(lineSeries, overlays, isDark);
    }

    // Volume histogram — tinted to match the theme's bullish/bearish palette
    const volumeData = candles
      .filter((c) => c.volume && c.volume > 0)
      .map((c, i, arr) => ({
        time: c.time as Time,
        value: c.volume!,
        color:
          i > 0 && c.close >= arr[i - 1].close
            ? `hsl(${colors.bullishRaw} / 0.25)`
            : `hsl(${colors.bearishRaw} / 0.2)`,
      }));

    if (volumeData.length > 0) {
      const volumeSeries = chart.addSeries(HistogramSeries, {
        priceFormat: { type: "volume" },
        priceScaleId: "volume",
      });
      volumeSeries.priceScale().applyOptions({
        scaleMargins: { top: 0.8, bottom: 0 },
      });
      volumeSeries.setData(volumeData);
    }

    chart.timeScale().fitContent();

    // Resize handler
    const resizeObserver = new ResizeObserver((entries) => {
      const { width: w } = entries[0].contentRect;
      chart.applyOptions({ width: w });
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      chart.remove();
      chartRef.current = null;
    };
  }, [candles, height, chartType, range, isDark, overlays]);

  useEffect(() => {
    const cleanup = buildChart();
    return () => cleanup?.();
  }, [buildChart]);

  const lastCandle = candles?.[candles.length - 1];
  const firstCandle = candles?.[0];
  const priceChange =
    lastCandle && firstCandle
      ? ((lastCandle.close - firstCandle.close) / firstCandle.close) * 100
      : 0;

  return (
    <div className="space-y-2">
      {/* Controls */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ToggleGroup
            type="single"
            value={range}
            onValueChange={(v) => v && setRange(v as TimeRange)}
            className="bg-muted rounded-md p-0.5"
          >
            {TIME_RANGES.map((r) => (
              <ToggleGroupItem
                key={r}
                value={r}
                className="text-xs h-6 px-2.5 data-[state=on]:bg-background data-[state=on]:shadow-sm rounded"
              >
                {r}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>

          <ToggleGroup
            type="single"
            value={chartType}
            onValueChange={(v) => v && setChartType(v as "candle" | "line")}
            className="bg-muted rounded-md p-0.5"
          >
            <ToggleGroupItem value="candle" className="h-6 w-7 p-0 data-[state=on]:bg-background data-[state=on]:shadow-sm rounded">
              <CandlestickChart className="h-3.5 w-3.5" />
            </ToggleGroupItem>
            <ToggleGroupItem value="line" className="h-6 w-7 p-0 data-[state=on]:bg-background data-[state=on]:shadow-sm rounded">
              <LineChart className="h-3.5 w-3.5" />
            </ToggleGroupItem>
          </ToggleGroup>
        </div>

        <div className="flex items-center gap-2">
          {lastCandle && (
            <>
              <span className="text-xs font-mono font-semibold">
                ₹{lastCandle.close.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
              </span>
              <Badge
                variant="outline"
                className={`text-[11px] font-mono ${priceChange >= 0 ? "text-bullish border-bullish/30" : "text-bearish border-bearish/30"}`}
              >
                {priceChange >= 0 ? "+" : ""}
                {priceChange.toFixed(2)}%
              </Badge>
            </>
          )}
          {isLoading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
        </div>
      </div>

      {/* Chart Container */}
      <div className="relative">
        {isLoading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/60 backdrop-blur-sm rounded-lg">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading chart...
            </div>
          </div>
        )}
        {error && !candles && (
          <div className="flex items-center justify-center h-[200px] text-sm text-muted-foreground">
            Chart data unavailable. Start the proxy server for live data.
          </div>
        )}
        <div ref={chartContainerRef} className="w-full rounded-lg overflow-hidden" />
        {candles && candles.length === 0 && !isLoading && (
          <div className="flex items-center justify-center h-[200px] text-sm text-muted-foreground">
            No historical data available for {symbol}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Full interactive stock chart component.
 * Can render inline (as a Card) or as a Sheet (drawer).
 */
export function StockChart({
  symbol,
  inline = false,
  height = 340,
  asSheet = false,
  open = false,
  onOpenChange,
  expectedMoveBands,
  levels,
}: StockChartProps) {
  if (asSheet) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="bottom" className="h-[480px]">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2 text-base">
              <BarChart3 className="h-4 w-4 text-primary" />
              {symbol} — Price Chart
            </SheetTitle>
            <SheetDescription className="sr-only">Price chart for {symbol}</SheetDescription>
          </SheetHeader>
          <div className="mt-3">
            <ChartCore symbol={symbol} height={380} expectedMoveBands={expectedMoveBands} levels={levels} />
          </div>
        </SheetContent>
      </Sheet>
    );
  }

  if (inline) {
    return <ChartCore symbol={symbol} height={height} expectedMoveBands={expectedMoveBands} levels={levels} />;
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-primary" />
          {symbol} — Price Chart
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ChartCore symbol={symbol} height={height} expectedMoveBands={expectedMoveBands} levels={levels} />
      </CardContent>
    </Card>
  );
}
