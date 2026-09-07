// Custom lightweight-charts v5 Series Primitive: a mini gamma-exposure
// density strip rendered inside the price-axis gutter itself (via
// `priceAxisPaneViews`, not the main `paneViews` hook) — one short bar per
// strike, length proportional to |netGEX|, colored by call/put dominance.
//
// No built-in lightweight-charts feature does this; it reuses the exact same
// per-strike GEX array that drives Call Wall / Put Wall / Zero Gamma, so
// there's no new calculation here — only a different rendering surface.

import type {
  ISeriesApi,
  ISeriesPrimitive,
  IPrimitivePaneView,
  IPrimitivePaneRenderer,
  SeriesAttachedParameter,
  SeriesType,
  Time,
} from "lightweight-charts";
import type { CanvasRenderingTarget2D } from "fancy-canvas";
import type { StrikeGEX } from "@/lib/gexLevels";

export interface GammaStripPrimitiveOptions {
  byStrike: StrikeGEX[];
  colors: { call: string; put: string };
  barHeightPx?: number;
}

class GammaStripPaneRenderer implements IPrimitivePaneRenderer {
  constructor(
    private _series: ISeriesApi<SeriesType, Time>,
    private _options: GammaStripPrimitiveOptions
  ) {}

  draw(target: CanvasRenderingTarget2D): void {
    const { byStrike, colors, barHeightPx = 3 } = this._options;
    if (byStrike.length === 0) return;

    const maxAbs = byStrike.reduce((m, s) => Math.max(m, Math.abs(s.netGEX)), 0);
    if (maxAbs === 0) return;

    target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
      for (const s of byStrike) {
        const y = this._series.priceToCoordinate(s.strike);
        if (y === null) continue;

        const barLength = (Math.abs(s.netGEX) / maxAbs) * mediaSize.width;
        if (barLength < 1) continue;

        ctx.fillStyle = s.netGEX >= 0 ? colors.call : colors.put;
        ctx.fillRect(0, y - barHeightPx / 2, barLength, barHeightPx);
      }
    });
  }
}

class GammaStripPaneView implements IPrimitivePaneView {
  constructor(private _renderer: GammaStripPaneRenderer) {}
  renderer(): IPrimitivePaneRenderer | null {
    return this._renderer;
  }
}

export class GammaStripPrimitive implements ISeriesPrimitive<Time> {
  private _series: ISeriesApi<SeriesType, Time> | null = null;
  private _paneViews: GammaStripPaneView[] = [];
  private _requestUpdate: (() => void) | null = null;

  constructor(private _options: GammaStripPrimitiveOptions) {}

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

  updateOptions(partial: Partial<GammaStripPrimitiveOptions>): void {
    this._options = { ...this._options, ...partial };
    this._rebuildViews();
    this._requestUpdate?.();
  }

  priceAxisPaneViews(): readonly IPrimitivePaneView[] {
    return this._paneViews;
  }

  private _rebuildViews(): void {
    this._paneViews = this._series
      ? [new GammaStripPaneView(new GammaStripPaneRenderer(this._series, this._options))]
      : [];
  }
}
