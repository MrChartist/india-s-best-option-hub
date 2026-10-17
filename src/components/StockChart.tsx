import { useRef, useEffect, useState, useMemo } from "react";
import { createChart, ColorType, CandlestickSeries, HistogramSeries, LineSeries, LineStyle, type IChartApi, type IPriceLine, type ISeriesApi, type SeriesType, type Time } from "lightweight-charts";
import { resolveTokenColor } from "@/lib/chartTheme";
import { formatDateIST, formatINR, formatNumberIN } from "@/lib/options";
import { expectedMoveCone } from "@/components/option-chain/chartOverlays";
import { cn } from "@/lib/utils";
import { useChartData } from "@/hooks/useChartData";
import { useChartThemeKey, getChartColors } from "@/hooks/useIsDark";
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

export type ChartLevelKind = "callWall" | "putWall" | "flip" | "maxPain" | "absGamma" | "breakeven";

export interface ChartLevel {
  price: number;
  label: string;
  kind: ChartLevelKind;
}

/** IV-implied cone from the last candle to expiry (1σ and 2σ by default). */
export interface ExpectedMoveConeSpec {
  expiry: string;
  /** Centre price: the chain forward or spot. */
  anchor: number;
  /** Annualised IV as a decimal (0.14 = 14%). */
  iv: number;
  sigmas?: number[];
}

interface ChartOverlays {
  /** Expected-move bands drawn as dashed price lines (one pair per expiry). */
  expectedMoveBands?: ExpectedMoveBand[];
  /** Key option levels (walls, gamma flip, max pain) drawn as price lines. */
  levels?: ChartLevel[];
  /** Expected-move cone(s) projected to expiry. */
  expectedMoveCone?: ExpectedMoveConeSpec;
  /** Strategy breakevens drawn as price lines. */
  breakevens?: number[];
  /** Short note under the chart about where the overlays come from (e.g. "Levels from sample chain"). */
  overlayNote?: string;
}

/** Token used for each level kind. CE OI walls are resistance (bearish), PE OI walls support (bullish). */
const LEVEL_TOKEN: Record<ChartLevelKind, string> = {
  callWall: "chart-call",
  putWall: "chart-put",
  flip: "warning",
  maxPain: "chart-1",
  absGamma: "info",
  breakeven: "primary",
};

/** Tailwind swatch classes matching LEVEL_TOKEN, for the overlay legend. */
const LEVEL_SWATCH: Record<ChartLevelKind, string> = {
  callWall: "bg-chart-call",
  putWall: "bg-chart-put",
  flip: "bg-warning",
  maxPain: "bg-chart-1",
  absGamma: "bg-info",
  breakeven: "bg-primary",
};

const finitePos = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x) && x > 0;

/** Token values from index.css, used only when CSS variables cannot be read (SSR/tests). */
const TOKEN_FALLBACK = {
  dark: { info: "hsl(211 78% 68%)", muted: "hsl(72 6% 64%)", grid: "hsl(212 14% 12%)" },
  light: { info: "hsl(212.6 80% 33.3%)", muted: "hsl(337 10% 40%)", grid: "hsl(54 14% 89%)" },
} as const;

/** All price-line levels: explicit levels plus breakevens. */
function allLevels(o: ChartOverlays): ChartLevel[] {
  const be = (o.breakevens ?? []).filter(finitePos).map((b, i, arr): ChartLevel => ({ price: b, label: arr.length > 1 ? `BE ${i + 1}` : "Breakeven", kind: "breakeven" }));
  return [...(o.levels ?? []), ...be];
}

function drawCone(chart: IChartApi, o: ChartOverlays, anchorTime: number, isDark: boolean): ISeriesApi<"Line">[] {
  const c = o.expectedMoveCone;
  const out: ISeriesApi<"Line">[] = [];
  if (!c) return out;
  const fb = TOKEN_FALLBACK[isDark ? "dark" : "light"];
  const bands = expectedMoveCone({ anchorTime, anchor: c.anchor, iv: c.iv, expiry: c.expiry, sigmas: c.sigmas });
  for (const band of bands) {
    const color = resolveTokenColor("info", fb.info, band.k <= 1 ? 0.85 : 0.5);
    for (const [pts, sign] of [[band.upper, "+"], [band.lower, "−"]] as const) {
      if (pts.length < 2) continue;
      const line = chart.addSeries(LineSeries, {
        color,
        lineWidth: 1,
        lineStyle: band.k <= 1 ? LineStyle.Dashed : LineStyle.SparseDotted,
        crosshairMarkerVisible: false,
        priceLineVisible: false,
        lastValueVisible: true,
        title: `${sign}${band.k}σ`,
      });
      line.setData(pts.map((p) => ({ time: p.time as Time, value: p.value })));
      out.push(line);
    }
  }
  return out;
}

function drawOverlays(series: ISeriesApi<SeriesType>, o: ChartOverlays, isDark: boolean): IPriceLine[] {
  const out: IPriceLine[] = [];
  const fb = TOKEN_FALLBACK[isDark ? "dark" : "light"];
  const bands = (o.expectedMoveBands ?? []).filter((b) => b && finitePos(b.upper) && finitePos(b.lower));
  bands.forEach((b, i) => {
    const color = resolveTokenColor("info", fb.info, Math.max(0.45, 0.9 - i * 0.2));
    const tag = b.expiry ? formatDateIST(b.expiry).split(" ").slice(0, 2).join(" ") : "";
    for (const [price, side] of [[b.upper, "+1σ"], [b.lower, "−1σ"]] as const) {
      out.push(series.createPriceLine({ price, color, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: `EM ${side}${tag ? ` ${tag}` : ""}` }));
    }
  });
  for (const l of allLevels(o)) {
    if (!l || !finitePos(l.price)) continue;
    const color = resolveTokenColor(LEVEL_TOKEN[l.kind] ?? "muted-foreground", fb.muted);
    out.push(
      series.createPriceLine({
        price: l.price,
        color,
        lineWidth: l.kind === "flip" || l.kind === "breakeven" ? 2 : 1,
        lineStyle: l.kind === "maxPain" ? LineStyle.Dotted : l.kind === "flip" || l.kind === "breakeven" ? LineStyle.Solid : LineStyle.LargeDashed,
        axisLabelVisible: true,
        title: l.label,
      }),
    );
  }
  return out;
}

/** Strike-like rounding step for a price: 50 for NIFTY-sized prices, 5 for ~1,000. */
function roundStep(price: number): number {
  if (!finitePos(price)) return 1;
  return (10 ** Math.floor(Math.log10(price)) / 1000) * 5;
}

/**
 * Overlay inputs with live-noise removed: the cone anchor is rounded to a
 * strike-like step and IV to 0.1 vol, the gamma flip to a tenth of that step.
 * Tick-by-tick float jitter then leaves the overlay key unchanged.
 */
function stableOverlayKey(o: ChartOverlays): string {
  const c = o.expectedMoveCone;
  const cone =
    c && finitePos(c.anchor) && finitePos(c.iv)
      ? { ...c, anchor: Math.round(c.anchor / roundStep(c.anchor)) * roundStep(c.anchor), iv: Math.round(c.iv * 1000) / 1000 }
      : null;
  const levels = (o.levels ?? []).map((l) =>
    l.kind === "flip" && finitePos(l.price) ? { ...l, price: Math.round(l.price / (roundStep(l.price) / 10)) * (roundStep(l.price) / 10) } : l,
  );
  return JSON.stringify({ b: o.expectedMoveBands ?? [], l: levels, c: cone, be: o.breakevens ?? [] });
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
  expectedMoveCone: cone,
  breakevens,
  overlayNote,
}: {
  symbol: string;
  height?: number;
} & ChartOverlays) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const [range, setRange] = useState<TimeRange>("3M");
  const [chartType, setChartType] = useState<"candle" | "line">("candle");
  const { data: candles, isLoading, error } = useChartData(symbol, range);
  const themeKey = useChartThemeKey();
  const isDark = themeKey.startsWith("dark");
  // Stable key so new array identities (and tick-level float noise) do not redraw the overlays.
  const overlayKey = stableOverlayKey({ expectedMoveBands, levels, expectedMoveCone: cone, breakevens });
  const overlays = useMemo((): ChartOverlays => {
    const parsed = JSON.parse(overlayKey) as { b: ExpectedMoveBand[]; l: ChartLevel[]; c: ExpectedMoveConeSpec | null; be: number[] };
    return { expectedMoveBands: parsed.b, levels: parsed.l, expectedMoveCone: parsed.c ?? undefined, breakevens: parsed.be };
  }, [overlayKey]);
  const legend = useMemo(() => allLevels(overlays).filter((l) => finitePos(l.price)), [overlays]);

  const mainSeriesRef = useRef<ISeriesApi<SeriesType> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const priceLinesRef = useRef<IPriceLine[]>([]);
  const coneSeriesRef = useRef<ISeriesApi<"Line">[]>([]);
  const fittedRef = useRef(false);
  const hasCandles = !!candles && candles.length > 0;
  const lastTime = hasCandles ? candles[candles.length - 1].time : null;

  // 1. Build the chart once per symbol, range, type, height and theme. Data and
  //    overlay updates below reuse it, so polls keep the user's zoom and pan.
  useEffect(() => {
    const container = chartContainerRef.current;
    if (!container || !hasCandles) return;

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

    mainSeriesRef.current =
      chartType === "candle"
        ? chart.addSeries(CandlestickSeries, {
            upColor: colors.bullish,
            downColor: colors.bearish,
            borderUpColor: colors.bullish,
            borderDownColor: colors.bearish,
            wickUpColor: colors.bullish,
            wickDownColor: colors.bearish,
          })
        : chart.addSeries(LineSeries, {
            color: colors.bullish,
            lineWidth: 2,
            crosshairMarkerVisible: true,
            crosshairMarkerRadius: 4,
          });

    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
    });
    volumeSeries.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
    volumeSeriesRef.current = volumeSeries;
    fittedRef.current = false;

    const resizeObserver = new ResizeObserver((entries) => {
      const { width: w } = entries[0].contentRect;
      chart.applyOptions({ width: w });
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      chart.remove();
      chartRef.current = null;
      mainSeriesRef.current = null;
      volumeSeriesRef.current = null;
      priceLinesRef.current = [];
      coneSeriesRef.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- isDark is part of themeKey
  }, [hasCandles, height, chartType, range, themeKey, symbol]);

  // 2. Push candles and volume into the existing series, keeping the visible range.
  useEffect(() => {
    const chart = chartRef.current;
    const main = mainSeriesRef.current;
    if (!chart || !main || !candles || candles.length === 0) return;
    const colors = getChartColors(isDark);
    const visible = fittedRef.current ? chart.timeScale().getVisibleLogicalRange() : null;

    if (chartType === "candle") {
      main.setData(candles.map((c) => ({ time: c.time as Time, open: c.open, high: c.high, low: c.low, close: c.close })));
    } else {
      const isPositive = candles[candles.length - 1].close >= candles[0].close;
      main.applyOptions({ color: isPositive ? colors.bullish : colors.bearish });
      main.setData(candles.map((c) => ({ time: c.time as Time, value: c.close })));
    }

    // Volume histogram — tinted to match the theme's bullish/bearish palette
    const volumeData = candles
      .filter((c) => c.volume && c.volume > 0)
      .map((c, i, arr) => ({
        time: c.time as Time,
        value: c.volume!,
        color: i > 0 && c.close >= arr[i - 1].close ? `hsl(${colors.bullishRaw} / 0.25)` : `hsl(${colors.bearishRaw} / 0.2)`,
      }));
    volumeSeriesRef.current?.setData(volumeData);

    if (visible) chart.timeScale().setVisibleLogicalRange(visible);
    else {
      chart.timeScale().fitContent();
      fittedRef.current = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rebuild deps re-run this after a new chart
  }, [candles, chartType, themeKey, hasCandles, height, range, symbol]);

  // 3. Redraw price lines and the cone on the existing chart when overlays change.
  useEffect(() => {
    const chart = chartRef.current;
    const main = mainSeriesRef.current;
    if (!chart || !main || lastTime == null) return;
    for (const pl of priceLinesRef.current) main.removePriceLine(pl);
    for (const series of coneSeriesRef.current) chart.removeSeries(series);
    priceLinesRef.current = drawOverlays(main, overlays, isDark);
    coneSeriesRef.current = drawCone(chart, overlays, lastTime, isDark);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rebuild deps re-run this after a new chart
  }, [overlays, lastTime, themeKey, hasCandles, height, chartType, range, symbol]);

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
                {formatINR(lastCandle.close)}
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
              Loading chart…
            </div>
          </div>
        )}
        {error && !candles && (
          <div className="flex items-center justify-center h-[200px] text-sm text-muted-foreground">
            Price history is unavailable. Start the local proxy for candles; the levels below still come from the chain.
          </div>
        )}
        <div ref={chartContainerRef} className="w-full rounded-lg overflow-hidden" />
        {candles && candles.length === 0 && !isLoading && (
          <div className="flex h-[200px] items-center justify-center px-4 text-center text-sm text-muted-foreground">
            No price history for {symbol} right now. Start the local proxy for candles; the option levels below still come from the chain.
          </div>
        )}
      </div>
      {(legend.length > 0 || overlays.expectedMoveCone) && (
        <ul className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground" aria-label="Chart overlays">
          {legend.map((l) => (
            <li key={`${l.kind}-${l.price}`} className="inline-flex items-center gap-1">
              <span className={cn("h-0.5 w-3 rounded-full", LEVEL_SWATCH[l.kind])} aria-hidden="true" />
              <span>{l.label}</span>
              <span className="font-num tabular-nums text-foreground">{formatNumberIN(l.price, l.price % 1 ? 2 : 0)}</span>
            </li>
          ))}
          {overlays.expectedMoveCone && (
            <li className="inline-flex items-center gap-1">
              <span className="h-0.5 w-3 rounded-full bg-info" aria-hidden="true" />
              <span>1σ / 2σ cone to {formatDateIST(overlays.expectedMoveCone.expiry)} at {(overlays.expectedMoveCone.iv * 100).toFixed(1)}% IV</span>
            </li>
          )}
          {overlayNote && <li className="basis-full text-[10.5px]">{overlayNote}</li>}
        </ul>
      )}
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
  expectedMoveCone,
  breakevens,
  overlayNote,
}: StockChartProps) {
  const overlayProps = { expectedMoveBands, levels, expectedMoveCone, breakevens, overlayNote };
  if (asSheet) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="bottom" className="h-[480px]">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2 text-base">
              <BarChart3 className="h-4 w-4 text-primary" />
              {symbol} price chart
            </SheetTitle>
            <SheetDescription className="sr-only">Price chart for {symbol}</SheetDescription>
          </SheetHeader>
          <div className="mt-3">
            <ChartCore symbol={symbol} height={380} {...overlayProps} />
          </div>
        </SheetContent>
      </Sheet>
    );
  }

  if (inline) {
    return <ChartCore symbol={symbol} height={height} {...overlayProps} />;
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-primary" />
          {symbol} price chart
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ChartCore symbol={symbol} height={height} {...overlayProps} />
      </CardContent>
    </Card>
  );
}

export default StockChart;
