import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { EM_METHOD_LABEL, expectedMoveSigma, formatStrike } from "@/lib/options";
import { lognormalDensity, roundTo, stepTarget } from "@/lib/optimizer";

export interface TargetPriceChartProps {
  spot: number;
  /** Forward to the target date. */
  forward: number;
  /** ATM IV, decimal. */
  sigma: number;
  /** Years to the target date. */
  T: number;
  target: number;
  onChange: (price: number) => void;
  /** Strike step (points): arrow keys move one strike; drag snaps to step / 5. */
  step: number;
  lower: number;
  upper: number;
}

const HEIGHT = 128;
const PAD_X = 12;
const PAD_TOP = 22;
const PAD_BOTTOM = 22;

/**
 * Distribution of the underlying at the target date (lognormal from ATM IV) with the IV 1σ band.
 * The whole chart is one slider: drag or tap anywhere, or focus it and use the keyboard
 * (arrows: one strike, Page Up/Down: 1σ, Home/End: the ends of the ±3σ range). The SVG is
 * decorative (aria-hidden); the slider carries the value and a text description.
 */
export function TargetPriceChart({ spot, forward, sigma, T, target, onChange, step, lower, upper }: TargetPriceChartProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const descId = useId();
  const [width, setWidth] = useState(320);
  const dragging = useRef(false);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () => setWidth(Math.max(200, Math.round(el.getBoundingClientRect().width)));
    update();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const sd = expectedMoveSigma(sigma, T, { minSd: 0.006 });
  const centre = forward > 0 ? forward : spot;
  const strikeStep = step > 0 ? step : 1;
  // Keyboard range: ±3σ around the forward on the strike grid (independent of the current target).
  const range = useMemo(() => {
    const min = Math.max(strikeStep, Math.ceil((centre * Math.exp(-3 * sd)) / strikeStep) * strikeStep);
    const max = Math.max(min, Math.floor((centre * Math.exp(3 * sd)) / strikeStep) * strikeStep);
    return { min, max };
  }, [centre, sd, strikeStep]);
  const sigmaPts = upper > lower ? (upper - lower) / 2 : centre * sd;
  const domain = useMemo(() => {
    let lo = centre * Math.exp(-3 * sd);
    let hi = centre * Math.exp(3 * sd);
    if (target > 0) {
      lo = Math.min(lo, target * 0.995);
      hi = Math.max(hi, target * 1.005);
    }
    return { lo, hi };
  }, [centre, sd, target]);

  const innerW = width - PAD_X * 2;
  const innerH = HEIGHT - PAD_TOP - PAD_BOTTOM;
  const x = useCallback((p: number) => PAD_X + ((p - domain.lo) / (domain.hi - domain.lo)) * innerW, [domain, innerW]);
  const priceAt = useCallback((px: number) => domain.lo + ((px - PAD_X) / innerW) * (domain.hi - domain.lo), [domain, innerW]);

  const { path, area } = useMemo(() => {
    const n = 80;
    const pts: Array<[number, number]> = [];
    let maxD = 0;
    const tt = Math.max(T, 1 / 365);
    for (let i = 0; i < n; i++) {
      const p = domain.lo + ((domain.hi - domain.lo) * i) / (n - 1);
      const d = lognormalDensity(p, centre, sigma > 0 ? sigma : 0.15, tt);
      pts.push([p, d]);
      if (d > maxD) maxD = d;
    }
    const y = (d: number) => PAD_TOP + innerH - (maxD > 0 ? (d / maxD) * innerH : 0);
    const line = pts.map(([p, d], i) => `${i === 0 ? "M" : "L"}${x(p).toFixed(1)},${y(d).toFixed(1)}`).join(" ");
    const base = PAD_TOP + innerH;
    return { path: line, area: `${line} L${x(domain.hi).toFixed(1)},${base} L${x(domain.lo).toFixed(1)},${base} Z` };
  }, [domain, centre, sigma, T, innerH, x]);

  const snap = Math.max(step / 5, 0.05);
  const setFromClientX = (clientX: number, el: HTMLElement) => {
    const rect = el.getBoundingClientRect();
    const px = ((clientX - rect.left) / rect.width) * width;
    const p = priceAt(Math.min(Math.max(px, PAD_X), width - PAD_X));
    if (p > 0) onChange(roundTo(p, snap));
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    dragging.current = true;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setFromClientX(e.clientX, e.currentTarget);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (dragging.current) setFromClientX(e.clientX, e.currentTarget);
  };
  const endDrag = (e: PointerEvent<HTMLDivElement>) => {
    dragging.current = false;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const next = stepTarget(target > 0 ? target : spot, e.key, { step: strikeStep, sigmaPts, min: range.min, max: range.max });
    if (next !== null && next > 0) {
      e.preventDefault();
      onChange(next);
    }
  };

  const tx = x(target > 0 ? target : spot);
  const sx = x(spot);
  const bandLo = x(Math.max(lower, domain.lo));
  const bandHi = x(Math.min(upper, domain.hi));
  const pct = spot > 0 && target > 0 ? ((target - spot) / spot) * 100 : 0;
  const labelLeft = Math.min(Math.max(tx, PAD_X + 36), width - PAD_X - 36);

  const lowerText = formatStrike(Math.round(lower));
  const upperText = formatStrike(Math.round(upper));
  const valueText = `${formatStrike(target)}, ${pct >= 0 ? "+" : "−"}${Math.abs(pct).toFixed(2)}% from spot`;

  return (
    <div
      ref={wrapRef}
      role="slider"
      tabIndex={0}
      aria-label="Target price"
      aria-orientation="horizontal"
      aria-valuemin={range.min}
      aria-valuemax={range.max}
      aria-valuenow={Math.round(target * 100) / 100}
      aria-valuetext={valueText}
      aria-describedby={descId}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      className="w-full cursor-ew-resize touch-none select-none rounded-tile focus-visible:shadow-ember focus-visible:outline-none"
    >
      <p id={descId} className="sr-only">
        Expected price distribution at the target date. {EM_METHOD_LABEL.iv} range {lowerText} to {upperText}, spot {formatStrike(Math.round(spot * 100) / 100)}. Arrow keys move one
        strike, Page Up and Page Down move one sigma, Home and End jump to the ends of the range.
      </p>
      <svg width={width} height={HEIGHT} viewBox={`0 0 ${width} ${HEIGHT}`} className="block" aria-hidden="true" focusable="false">
        <rect x={bandLo} y={PAD_TOP} width={Math.max(0, bandHi - bandLo)} height={innerH} className="fill-info/10" />
        <path d={area} className="fill-primary/10" />
        <path d={path} className="fill-none stroke-primary" strokeWidth={1.5} />
        <line x1={PAD_X} x2={width - PAD_X} y1={PAD_TOP + innerH} y2={PAD_TOP + innerH} className="stroke-border" />
        {/* IV 1σ edges */}
        <line x1={bandLo} x2={bandLo} y1={PAD_TOP} y2={PAD_TOP + innerH} className="stroke-info/60" strokeDasharray="3 3" />
        <line x1={bandHi} x2={bandHi} y1={PAD_TOP} y2={PAD_TOP + innerH} className="stroke-info/60" strokeDasharray="3 3" />
        <text x={bandLo} y={HEIGHT - 6} textAnchor="middle" className="fill-muted-foreground text-[10px]">
          −1σ {lowerText}
        </text>
        <text x={bandHi} y={HEIGHT - 6} textAnchor="middle" className="fill-muted-foreground text-[10px]">
          +1σ {upperText}
        </text>
        {/* spot */}
        <line x1={sx} x2={sx} y1={PAD_TOP - 4} y2={PAD_TOP + innerH} className="stroke-muted-foreground" strokeDasharray="2 3" />
        {/* target handle */}
        <line x1={tx} x2={tx} y1={PAD_TOP - 2} y2={PAD_TOP + innerH} className="stroke-foreground" strokeWidth={1.5} />
        <circle cx={tx} cy={PAD_TOP + innerH} r={6} className="fill-primary stroke-card" strokeWidth={2} />
        <text x={labelLeft} y={13} textAnchor="middle" className="fill-foreground text-[11px] font-semibold">
          {formatStrike(target)} ({pct >= 0 ? "+" : "−"}
          {Math.abs(pct).toFixed(2)}%)
        </text>
      </svg>
    </div>
  );
}
