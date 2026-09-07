// Custom lightweight-charts v5 Series Primitive: short, right-anchored
// dashed segments for secondary GEX levels.
//
// `series.createPriceLine(...)` (used for Call Wall / Put Wall / Zero Gamma /
// Volume Profile / IV bands) always spans the full chart width — there's no
// built-in way to draw a shorter segment. This primitive exists purely to
// draw a partial-width line for the next-most-notable strikes.
//
// The right-anchored width is a presentation choice to visually rank these
// as secondary vs. the full-width primary levels — it is NOT a claim about
// how long the level has been "active." This repo has no per-strike GEX
// history to back a real time-extent (see useChartLevelsOverlay.ts).

import {
  LineStyle,
  type ISeriesApi,
  type ISeriesPrimitive,
  type IPrimitivePaneView,
  type IPrimitivePaneRenderer,
  type SeriesAttachedParameter,
  type SeriesType,
  type Time,
  type DrawingUtils,
} from "lightweight-charts";
import type { CanvasRenderingTarget2D } from "fancy-canvas";
import type { SecondaryLevel } from "@/lib/gexLevels";

export interface SecondaryLevelPrimitiveOptions {
  levels: SecondaryLevel[];
  colors: { call: string; put: string };
  /** Fraction of chart width the segment spans, anchored to the right edge. */
  widthFraction?: number;
}

class SecondaryLevelPaneRenderer implements IPrimitivePaneRenderer {
  constructor(
    private _series: ISeriesApi<SeriesType, Time>,
    private _options: SecondaryLevelPrimitiveOptions
  ) {}

  draw(target: CanvasRenderingTarget2D, utils?: DrawingUtils): void {
    const { levels, colors, widthFraction = 0.18 } = this._options;
    if (levels.length === 0) return;

    target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
      const xRight = mediaSize.width;
      const xLeft = xRight - mediaSize.width * widthFraction;

      for (const level of levels) {
        const y = this._series.priceToCoordinate(level.strike);
        if (y === null) continue;

        ctx.save();
        ctx.strokeStyle = level.side === "call" ? colors.call : colors.put;
        ctx.lineWidth = 1;
        if (utils) {
          utils.setLineStyle(ctx, LineStyle.Dashed);
        } else {
          ctx.setLineDash([4, 3]);
        }
        ctx.beginPath();
        ctx.moveTo(xLeft, y + 0.5);
        ctx.lineTo(xRight, y + 0.5);
        ctx.stroke();
        ctx.restore();
      }
    });
  }
}

class SecondaryLevelPaneView implements IPrimitivePaneView {
  constructor(private _renderer: SecondaryLevelPaneRenderer) {}
  renderer(): IPrimitivePaneRenderer | null {
    return this._renderer;
  }
}

export class SecondaryLevelPrimitive implements ISeriesPrimitive<Time> {
  private _series: ISeriesApi<SeriesType, Time> | null = null;
  private _paneViews: SecondaryLevelPaneView[] = [];
  private _requestUpdate: (() => void) | null = null;

  constructor(private _options: SecondaryLevelPrimitiveOptions) {}

  attached(param: SeriesAttachedParameter<Time, SeriesType>): void {
    this._series = param.series;
    this._requestUpdate = param.requestUpdate;
    this._rebuildViews();
  }

  detached(): void {
    this._series = null;
    this._requestUpdate = null;
    this._paneViews = [];
  }

  updateOptions(partial: Partial<SecondaryLevelPrimitiveOptions>): void {
    this._options = { ...this._options, ...partial };
    this._rebuildViews();
    this._requestUpdate?.();
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return this._paneViews;
  }

  private _rebuildViews(): void {
    this._paneViews = this._series
      ? [new SecondaryLevelPaneView(new SecondaryLevelPaneRenderer(this._series, this._options))]
      : [];
  }
}
