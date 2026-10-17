import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { formatStrike } from "@/lib/options";
import { lognormalDensity, roundTo } from "@/lib/optimizer";

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
  /** Keyboard step (points); drag snaps to step / 5. */
  step: number;
  lower: number;
  upper: number;
}

const HEIGHT = 128;
const PAD_X = 12;
const PAD_TOP = 22;
const PAD_BOTTOM = 22;

/**
 * Distribution of the underlying at the target date (lognormal from ATM IV) with the 1σ band.
 * Drag anywhere (or use the arrow keys on the handle) to set the target price.
 */
export function TargetPriceChart({ spot, forward, sigma, T, target, onChange, step, lower, upper }: TargetPriceChartProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
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

  const sd = Math.max(sigma * Math.sqrt(Math.max(T, 1 / 365)), 0.006);
  const centre = forward > 0 ? forward : spot;
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
  const setFromClientX = (clientX: number, el: SVGSVGElement) => {
    const rect = el.getBoundingClientRect();
    const px = ((clientX - rect.left) / rect.width) * width;
    const p = priceAt(Math.min(Math.max(px, PAD_X), width - PAD_X));
    if (p > 0) onChange(roundTo(p, snap));
  };

  const onPointerDown = (e: PointerEvent<SVGSVGElement>) => {
    dragging.current = true;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setFromClientX(e.clientX, e.currentTarget);
  };
  const onPointerMove = (e: PointerEvent<SVGSVGElement>) => {
    if (dragging.current) setFromClientX(e.clientX, e.currentTarget);
  };
  const endDrag = (e: PointerEvent<SVGSVGElement>) => {
    dragging.current = false;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  };

  const onKeyDown = (e: KeyboardEvent<SVGGElement>) => {
    const base = target > 0 ? target : spot;
    let next: number | null = null;
    if (e.key === "ArrowRight" || e.key === "ArrowUp") next = base + step;
    else if (e.key === "ArrowLeft" || e.key === "ArrowDown") next = base - step;
    else if (e.key === "PageUp") next = base + step * 5;
    else if (e.key === "PageDown") next = base - step * 5;
    else if (e.key === "Home") next = spot;
    if (next !== null && next > 0) {
      e.preventDefault();
      onChange(roundTo(next, snap));
    }
  };

  const tx = x(target > 0 ? target : spot);
  const sx = x(spot);
  const bandLo = x(Math.max(lower, domain.lo));
  const bandHi = x(Math.min(upper, domain.hi));
  const pct = spot > 0 && target > 0 ? ((target - spot) / spot) * 100 : 0;
  const labelLeft = Math.min(Math.max(tx, PAD_X + 36), width - PAD_X - 36);

  return (
    <div ref={wrapRef} className="w-full select-none">
      <svg
        width={width}
        height={HEIGHT}
        viewBox={`0 0 ${width} ${HEIGHT}`}
        className="block cursor-ew-resize touch-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        role="img"
        aria-label={`Expected price distribution at the target date. 1 sigma range ${formatStrike(Math.round(lower))} to ${formatStrike(Math.round(upper))}.`}
      >
        <rect x={bandLo} y={PAD_TOP} width={Math.max(0, bandHi - bandLo)} height={innerH} className="fill-info/10" />
        <path d={area} className="fill-primary/10" />
        <path d={path} className="fill-none stroke-primary" strokeWidth={1.5} />
        <line x1={PAD_X} x2={width - PAD_X} y1={PAD_TOP + innerH} y2={PAD_TOP + innerH} className="stroke-border" />
        {/* 1σ edges */}
        <line x1={bandLo} x2={bandLo} y1={PAD_TOP} y2={PAD_TOP + innerH} className="stroke-info/60" strokeDasharray="3 3" />
        <line x1={bandHi} x2={bandHi} y1={PAD_TOP} y2={PAD_TOP + innerH} className="stroke-info/60" strokeDasharray="3 3" />
        <text x={bandLo} y={HEIGHT - 6} textAnchor="middle" className="fill-muted-foreground text-[10px]">
          −1σ {formatStrike(Math.round(lower))}
        </text>
        <text x={bandHi} y={HEIGHT - 6} textAnchor="middle" className="fill-muted-foreground text-[10px]">
          +1σ {formatStrike(Math.round(upper))}
        </text>
        {/* spot */}
        <line x1={sx} x2={sx} y1={PAD_TOP - 4} y2={PAD_TOP + innerH} className="stroke-muted-foreground" strokeDasharray="2 3" />
        {/* target handle */}
        <g
          role="slider"
          tabIndex={0}
          aria-label="Target price"
          aria-valuemin={Math.round(domain.lo)}
          aria-valuemax={Math.round(domain.hi)}
          aria-valuenow={Math.round(target)}
          aria-valuetext={`${formatStrike(target)}, ${pct >= 0 ? "+" : "−"}${Math.abs(pct).toFixed(2)}% from spot`}
          onKeyDown={onKeyDown}
          className="cursor-ew-resize outline-none [&:focus-visible_circle]:stroke-[3px]"
        >
          <line x1={tx} x2={tx} y1={PAD_TOP - 2} y2={PAD_TOP + innerH} className="stroke-foreground" strokeWidth={1.5} />
          <rect x={tx - 10} y={PAD_TOP - 2} width={20} height={innerH + 2} className="fill-transparent" />
          <circle cx={tx} cy={PAD_TOP + innerH} r={6} className="fill-primary stroke-card" strokeWidth={2} />
        </g>
        <text x={labelLeft} y={13} textAnchor="middle" className="fill-foreground text-[11px] font-semibold">
          {formatStrike(target)} ({pct >= 0 ? "+" : "−"}
          {Math.abs(pct).toFixed(2)}%)
        </text>
      </svg>
    </div>
  );
}
