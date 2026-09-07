import { useRef, useEffect, useState, useCallback, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { createChart, ColorType, CandlestickSeries, HistogramSeries, LineSeries, type IChartApi, type ISeriesApi, type Time } from "lightweight-charts";
import { useChartData } from "@/hooks/useChartData";
import { useIsDark, getChartColors } from "@/hooks/useIsDark";
import { useChartLevelsOverlay } from "@/hooks/useChartLevelsOverlay";
import type { OptionData } from "@/lib/mockData";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { BarChart3, Loader2, X, CandlestickChart, LineChart, Layers } from "lucide-react";

const TIME_RANGES = ["1W", "1M", "3M", "6M", "1Y"] as const;
type TimeRange = (typeof TIME_RANGES)[number];

interface StockChartProps {
  symbol: string;
  /** Inline mode renders directly, otherwise renders inside a Card */
  inline?: boolean;
  /** Initial height in pixels */
  height?: number;
  /** If provided, renders as a Sheet (drawer) */
  asSheet?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /**
   * Live option chain + context. When provided, an optional "Levels" overlay
   * (Call Wall, Put Wall, Zero Gamma, Volume Profile, IV bands) becomes
   * available on the chart. Omit to render a plain price chart (e.g. Watchlist,
   * which has no option-chain context for an arbitrary symbol).
   */
  chain?: OptionData[];
  spotPrice?: number;
  lotSize?: number;
  daysToExpiry?: number;
}

function ChartCore({
  symbol,
  height = 340,
  chain,
  spotPrice,
  lotSize,
  daysToExpiry,
}: {
  symbol: string;
  height?: number;
  chain?: OptionData[];
  spotPrice?: number;
  lotSize?: number;
  daysToExpiry?: number;
}) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  // Bumped each time buildChart creates a new chart instance. Lets a stale
  // overlay-cleanup closure (see useChartLevelsOverlay) detect that "its"
  // chart has already been torn down and replaced, so it can skip touching
  // an already-removed series instead of racing lightweight-charts' own
  // internal resize/redraw cycle on the disposed one.
  const chartGenerationRef = useRef(0);
  const [range, setRange] = useState<TimeRange>("3M");
  const [chartType, setChartType] = useState<"candle" | "line">("candle");
  const { data: candles, isLoading, error } = useChartData(symbol, range);
  const isDark = useIsDark();
  const queryClient = useQueryClient();
  const colors = useMemo(() => getChartColors(isDark), [isDark]);

  const [showLevels, setShowLevels] = useState(false);
  const [priceSeries, setPriceSeries] = useState<ISeriesApi<"Candlestick"> | ISeriesApi<"Line"> | null>(null);

  // useChartData has no refetchInterval, so once loaded the chart would
  // otherwise never pick up new candles while this view stays open — a
  // stale-price bug for a live trading terminal. Periodically invalidate
  // the query so it's refetched in the background; interval is cleared on
  // unmount / symbol / range change to avoid leaking timers.
  useEffect(() => {
    const id = window.setInterval(() => {
      queryClient.invalidateQueries({ queryKey: ["chart-data", symbol, range] });
    }, 60000);
    return () => window.clearInterval(id);
  }, [symbol, range, queryClient]);

  const buildChart = useCallback(() => {
    if (!chartContainerRef.current || !candles || candles.length === 0) return;

    // Destroy previous chart
    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
    }

    const container = chartContainerRef.current;
    const gridColor = isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.04)";
    const crosshairColor = isDark ? "rgba(255,255,255,0.2)" : "rgba(0,0,0,0.15)";

    const chart = createChart(container, {
      width: container.clientWidth,
      height,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: colors.text,
        fontFamily: "'Instrument Sans Variable', 'SF Pro', system-ui, sans-serif",
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
        // 1W (15-min) and 1M (60-min) ranges use intraday candles — show the
        // time-of-day, not just the date, otherwise multiple same-day bars
        // are indistinguishable on the axis/crosshair.
        timeVisible: range === "1W" || range === "1M",
        secondsVisible: false,
        rightOffset: 3,
        minBarSpacing: range === "1W" ? 3 : 4,
      },
      handleScroll: { mouseWheel: true, pressedMouseMove: true },
      handleScale: { mouseWheel: true, pinch: true },
    });

    chartRef.current = chart;
    chartGenerationRef.current += 1;

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
      setPriceSeries(candleSeries);
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
      setPriceSeries(lineSeries);
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
      setPriceSeries(null);
    };
  }, [candles, height, chartType, range, isDark, colors]);

  useEffect(() => {
    const cleanup = buildChart();
    return () => cleanup?.();
  }, [buildChart]);

  useChartLevelsOverlay({
    chart: chartRef.current,
    chartGenerationRef,
    priceSeries,
    enabled: showLevels,
    symbol,
    colors,
    chain,
    spotPrice,
    lotSize,
    daysToExpiry,
    candles,
  });

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

          {chain !== undefined && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => setShowLevels((v) => !v)}
              title="Toggle options-flow levels (Call Wall, Put Wall, Zero Gamma, Volume Profile, IV bands)"
            >
              <Layers className={`h-3.5 w-3.5 ${showLevels ? "text-primary" : ""}`} />
            </Button>
          )}
        </div>

        <div className="flex items-center gap-2">
          {lastCandle && (
            <>
              <span className="text-xs font-mono font-semibold">
                ₹{lastCandle.close.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
              </span>
              <Badge
                variant="outline"
                className={`text-xs font-mono ${priceChange >= 0 ? "text-bullish border-bullish/30" : "text-bearish border-bearish/30"}`}
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
  chain,
  spotPrice,
  lotSize,
  daysToExpiry,
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
          </SheetHeader>
          <div className="mt-3">
            <ChartCore symbol={symbol} height={380} chain={chain} spotPrice={spotPrice} lotSize={lotSize} daysToExpiry={daysToExpiry} />
          </div>
        </SheetContent>
      </Sheet>
    );
  }

  if (inline) {
    return <ChartCore symbol={symbol} height={height} chain={chain} spotPrice={spotPrice} lotSize={lotSize} daysToExpiry={daysToExpiry} />;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-primary" />
          {symbol} — Price Chart
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ChartCore symbol={symbol} height={height} chain={chain} spotPrice={spotPrice} lotSize={lotSize} daysToExpiry={daysToExpiry} />
      </CardContent>
    </Card>
  );
}
