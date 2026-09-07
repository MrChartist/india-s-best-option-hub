// Draws/cleans up the options-flow levels overlay (Call Wall, Put Wall, Zero
// Gamma, secondary GEX levels, gamma-density strip, Volume Profile, IV
// expected-move bands, and the "ABS CW" marker) on top of StockChart's price
// series.
//
// Deliberately a SEPARATE effect from the chart/candle construction in
// StockChart.tsx: option-chain data refreshes far more often than the 60s
// candle refetch, and re-running the expensive full chart rebuild on every
// chain poll would reset the user's zoom/scroll state. This effect only
// touches price lines / markers / primitives on the already-built series.
import { useEffect, type RefObject } from "react";
import {
  LineStyle,
  createSeriesMarkers,
  type IChartApi,
  type ISeriesApi,
  type IPriceLine,
  type ISeriesMarkersPluginApi,
  type Time,
} from "lightweight-charts";
import type { OptionData } from "@/lib/mockData";
import type { OHLCVCandle } from "@/hooks/useChartData";
import { getGexLevels } from "@/lib/gexLevels";
import { getVolumeProfile } from "@/lib/volumeProfile";
import { getATMIV } from "@/lib/oiUtils";
import { calculateExpectedMove } from "@/lib/gexData";
import { SecondaryLevelPrimitive } from "@/components/chart-overlays/SecondaryLevelPrimitive";
import { GammaStripPrimitive } from "@/components/chart-overlays/GammaStripPrimitive";

export interface ChartLevelColors {
  primary: string;
  bearish: string;
  warning: string;
  levelPoc: string;
  levelValueArea: string;
  levelIvBand: string;
}

type PriceSeries = ISeriesApi<"Candlestick"> | ISeriesApi<"Line">;

interface UseChartLevelsOverlayParams {
  chart: IChartApi | null;
  /**
   * Bumped by StockChart every time it builds a brand-new chart instance.
   * A range/theme/chart-type change tears the old chart down (via its own,
   * earlier-running effect cleanup) and replaces `priceSeries` with a new
   * one — but this hook's OWN cleanup for the old series still runs one
   * commit later, as a stale closure. Comparing against this ref at
   * cleanup time (not the stale `priceSeries` closure) is what lets that
   * stale cleanup detect "my chart is already gone" and skip touching an
   * already-`.remove()`'d series, instead of racing lightweight-charts'
   * own internal resize/redraw cycle on it.
   */
  chartGenerationRef: RefObject<number>;
  priceSeries: PriceSeries | null;
  enabled: boolean;
  symbol: string;
  colors: ChartLevelColors;
  chain?: OptionData[];
  spotPrice?: number;
  lotSize?: number;
  daysToExpiry?: number;
  candles?: OHLCVCandle[];
}

export function useChartLevelsOverlay(params: UseChartLevelsOverlayParams): void {
  // `chart` is accepted for API completeness (callers naturally have it
  // alongside `priceSeries`) but isn't needed directly here — a non-null
  // `priceSeries` already implies an active chart.
  const { priceSeries, chartGenerationRef, enabled, symbol, colors, chain, spotPrice, lotSize, daysToExpiry, candles } =
    params;

  useEffect(() => {
    if (!enabled || !priceSeries || !chain || chain.length === 0 || !spotPrice) {
      return;
    }

    const series = priceSeries;
    const myGeneration = chartGenerationRef.current;
    const priceLines: IPriceLine[] = [];
    let markersPlugin: ISeriesMarkersPluginApi<Time> | null = null;
    let secondaryPrimitive: SecondaryLevelPrimitive | null = null;
    let gammaStripPrimitive: GammaStripPrimitive | null = null;

    const addLine = (price: number, color: string, title: string, lineStyle: LineStyle, lineWidth: 1 | 2 = 1) => {
      priceLines.push(
        series.createPriceLine({ price, color, lineWidth, lineStyle, title, axisLabelVisible: true })
      );
    };

    // Call Wall / Put Wall / Zero Gamma / secondary levels / gamma strip —
    // all null together when the chain has no real Greeks (NSE fallback).
    const gex = getGexLevels(chain, spotPrice, lotSize ?? 1);
    if (gex) {
      addLine(gex.callWall, colors.primary, "CALL WALL", LineStyle.Solid, 2);
      addLine(gex.putWall, colors.bearish, "PUT WALL", LineStyle.Solid, 2);
      if (gex.zeroGamma !== null) {
        addLine(gex.zeroGamma, colors.warning, "ZERO GAMMA", LineStyle.Dashed);
      }

      secondaryPrimitive = new SecondaryLevelPrimitive({
        levels: gex.secondaryLevels,
        colors: { call: colors.primary, put: colors.bearish },
      });
      series.attachPrimitive(secondaryPrimitive);

      gammaStripPrimitive = new GammaStripPrimitive({
        byStrike: gex.byStrike,
        colors: { call: colors.primary, put: colors.bearish },
      });
      series.attachPrimitive(gammaStripPrimitive);

      // "ABS CW" — best-effort marker on the most recent candle whose real
      // high tagged the live Call Wall. No precedent for this exact label
      // exists anywhere in this repo's history; this is a documented guess
      // at its intent, easy to adjust.
      const taggedCandle = candles ? [...candles].reverse().find((c) => c.high >= gex.callWall) : undefined;
      if (taggedCandle) {
        markersPlugin = createSeriesMarkers(series, [
          {
            time: taggedCandle.time as Time,
            position: "aboveBar",
            shape: "circle",
            color: colors.primary,
            text: "ABS CW",
          },
        ]);
      }
    }

    // Volume Profile — candle-derived, independent of gamma availability.
    const volumeProfile = getVolumeProfile(candles ?? []);
    if (volumeProfile) {
      addLine(volumeProfile.poc, colors.levelPoc, "POC", LineStyle.Solid);
      addLine(volumeProfile.vah, colors.levelValueArea, "VAH", LineStyle.Dashed);
      addLine(volumeProfile.val, colors.levelValueArea, "VAL", LineStyle.Dashed);
    }

    // IV expected-move band — only needs real IV (present even on the NSE
    // fallback) and a real days-to-expiry, independent of gamma too.
    if (daysToExpiry && daysToExpiry > 0) {
      const { atmIV } = getATMIV(chain, spotPrice);
      if (atmIV > 0) {
        const move = calculateExpectedMove(spotPrice, atmIV, daysToExpiry);
        addLine(move.upperBound1SD, colors.levelIvBand, "IV+", LineStyle.SparseDotted);
        addLine(move.lowerBound1SD, colors.levelIvBand, "IV-", LineStyle.SparseDotted);
      }
    }

    return () => {
      // A concurrent range/theme/chart-type change tears the old chart down
      // and builds a new one before this cleanup runs (see chartGenerationRef
      // doc above) — if that already happened, `series` here is an orphaned
      // reference to an already-`.remove()`'d chart. Touching it (even just
      // to remove a price line) can trigger lightweight-charts' own internal
      // resize/redraw cycle asynchronously, which then throws on the
      // disposed canvas binding — outside any try/catch we could wrap here.
      // Skip entirely; `chart.remove()` already disposed everything attached
      // to it, so there's nothing left to clean up.
      if (chartGenerationRef.current !== myGeneration) {
        return;
      }
      for (const line of priceLines) {
        try {
          series.removePriceLine(line);
        } catch {
          /* series already torn down */
        }
      }
      try {
        markersPlugin?.detach();
      } catch {
        /* series already torn down */
      }
      try {
        if (secondaryPrimitive) series.detachPrimitive(secondaryPrimitive);
      } catch {
        /* series already torn down */
      }
      try {
        if (gammaStripPrimitive) series.detachPrimitive(gammaStripPrimitive);
      } catch {
        /* series already torn down */
      }
    };
  }, [priceSeries, enabled, symbol, colors, chain, spotPrice, lotSize, daysToExpiry, candles]);
}
