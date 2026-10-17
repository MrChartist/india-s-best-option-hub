/**
 * Expected move to the nearest expiry, from the symbol's own option chain, always shown with both
 * methods and their tags (the app-wide contract):
 *  - "IV 1σ": ATM IV (Black-76 on the parity forward) with log-space bounds F·e^(±σ√T), about 68%
 *  - "Straddle ×0.85": 0.85 × the ATM straddle around spot, about a 50% band
 * Legacy `iv` / `daysToExpiry` / `spotPrice` props are accepted but ignored (they were VIX-based).
 */
import { useMemo } from "react";
import { Link } from "react-router-dom";
import { ArrowUpDown, ArrowUpRight, Target } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { SourceBadge } from "@/components/option-chain/SourceBadge";
import { useLiveOptionChain } from "@/hooks/useMarketData";
import {
  atmStraddle,
  chainForward,
  dteLabel,
  EM_METHOD_LABEL,
  expectedMoveFromIV,
  expectedMoves,
  formatDateIST,
  formatINR,
  formatNumberIN,
  formatPct,
  getMarketParams,
  timeToExpiryYears,
  type ExpectedMoveMethod,
} from "@/lib/options";
import { cn } from "@/lib/utils";
import { chainAtmIv } from "@/lib/volatility/screener";
import { fmtVol } from "@/lib/volatility/format";

interface Props {
  symbol?: string;
  /** @deprecated ignored; the widget reads spot from the chain. */
  spotPrice?: number;
  /** @deprecated ignored; the widget solves ATM IV from the chain. */
  iv?: number;
  /** @deprecated ignored; the widget measures time to the 15:30 IST expiry. */
  daysToExpiry?: number;
  /** @deprecated ignored. */
  vix?: number;
  compact?: boolean;
  className?: string;
}

const n0 = (v: number) => formatNumberIN(v, 0);

/** The method tag every expected move carries ("IV 1σ" or "Straddle ×0.85"). */
function MethodTag({ method }: { method: ExpectedMoveMethod }) {
  return (
    <span
      className={cn(
        // normal-case: an uppercase transform would turn σ into Σ (wrong notation).
        "inline-flex items-center whitespace-nowrap rounded-chip px-1.5 py-0.5 text-micro font-semibold normal-case",
        method === "iv" ? "bg-wash-info text-info" : "bg-wash-brand text-primary-ink",
      )}
      title={method === "iv" ? "1σ band from the ATM implied volatility, about a 68% range" : "0.85 × the ATM straddle around spot, about a 50% range"}
    >
      {EM_METHOD_LABEL[method]}
    </span>
  );
}

export function ExpectedMoveWidget({ symbol = "NIFTY", compact = false, className }: Props) {
  const { data, isLoading } = useLiveOptionChain(symbol);

  const m = useMemo(() => {
    if (!data || data.chain.length === 0 || !(data.spotPrice > 0) || !data.expiry) return null;
    const now = new Date();
    const r = getMarketParams().r;
    const T = timeToExpiryYears(data.expiry, now);
    const F = chainForward(data.chain, data.spotPrice, T, r);
    const iv = chainAtmIv(data.chain, data.spotPrice, data.expiry, now, r);
    const st = atmStraddle(data.chain, data.spotPrice);
    const both = expectedMoves({ spot: data.spotPrice, forward: F, atmIv: iv / 100, tYears: T, straddle: st.straddle });
    const iv1 = both.iv;
    const iv2 = expectedMoveFromIV(F, iv / 100, T, 2);
    const sm = both.straddle ?? { move: NaN, upper: NaN, lower: NaN, pct: NaN };
    if (!Number.isFinite(iv1.move) && !Number.isFinite(sm.move)) return null;
    return { spot: data.spotPrice, F, iv, T, st, iv1, iv2, sm };
  }, [data]);

  const badge = data ? <SourceBadge source={data.source} asOf={data.asOf} stale={data.stale} isLive={data.isLive} reason={data.reason} /> : null;

  if (isLoading) {
    return (
      <Card aria-busy="true">
        <CardContent className="space-y-2 p-4">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-3 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (!m || !data) {
    return (
      <Card className={cn("h-full", className)}>
        <CardContent className="py-6 text-center">
          <Target className="mx-auto mb-2 h-6 w-6 text-muted-foreground" aria-hidden="true" />
          <p className="text-body-sm text-muted-foreground">{symbol} expected move</p>
          <p className="mt-1 text-body-sm text-muted-foreground">The option chain has no usable ATM prices right now.</p>
        </CardContent>
      </Card>
    );
  }

  const expLabel = `${formatDateIST(data.expiry)} · ${dteLabel(data.expiry)}`;

  if (compact) {
    return (
      <Card className={className}>
        <CardContent className="p-3">
          <div className="mb-1 flex items-center gap-1.5">
            <Target className="h-3.5 w-3.5 text-primary-ink" aria-hidden="true" />
            <p className="truncate text-label uppercase text-muted-foreground">{symbol} move · {dteLabel(data.expiry)}</p>
          </div>
          <dl className="space-y-1">
            <div className="flex items-baseline justify-between gap-2">
              <dt><MethodTag method="iv" /></dt>
              <dd className="font-num text-lead font-bold tabular-nums text-primary-ink">{Number.isFinite(m.iv1.move) ? `±${n0(m.iv1.move)}` : "—"}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-2">
              <dt><MethodTag method="straddle" /></dt>
              <dd className="font-num text-lead font-bold tabular-nums">{Number.isFinite(m.sm.move) ? `±${n0(m.sm.move)}` : "—"}</dd>
            </div>
          </dl>
          {data.source === "sample" ? <div className="mt-1">{badge}</div> : null}
        </CardContent>
      </Card>
    );
  }

  const lo = m.iv2.lower;
  const span = m.iv2.upper - lo || 1;
  const at = (x: number) => `${Math.min(100, Math.max(0, ((x - lo) / span) * 100))}%`;

  return (
    <Card className={cn("h-full", className)}>
      <CardHeader className="p-4 pb-2">
        {/* Fixed header row: the title truncates and the actions never wrap, so cards line up. */}
        <CardTitle className="flex min-w-0 items-center gap-2 text-lead">
          <ArrowUpDown className="h-4 w-4 shrink-0 text-primary-ink" aria-hidden="true" />
          <span className="min-w-0 truncate" title={`${symbol} expected move`}>{symbol} expected move</span>
          <span className="ml-auto flex shrink-0 items-center gap-1.5">
            {badge}
            <Link
              to={`/volatility?symbol=${encodeURIComponent(symbol)}&tab=move`}
              className="rounded-sm text-muted-foreground hover:text-foreground focus-visible:shadow-ember focus-visible:outline-none"
              aria-label={`All ${symbol} expiries`}
            >
              <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </span>
        </CardTitle>
        <p className="text-body-sm text-muted-foreground">{expLabel}</p>
      </CardHeader>
      <CardContent className="space-y-3 p-4 pt-0">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <div className="flex min-w-0 flex-col items-center rounded-tile bg-surface/70 p-2 text-center">
            <MethodTag method="iv" />
            <p className="mt-1 font-num text-title tabular-nums text-primary-ink">{Number.isFinite(m.iv1.move) ? `±${n0(m.iv1.move)}` : "—"}</p>
            <p className="text-body-sm tabular-nums text-muted-foreground">{Number.isFinite(m.iv1.pct) ? `${formatPct(m.iv1.pct)} · ≈68%` : "—"}</p>
          </div>
          <div className="flex min-w-0 flex-col items-center rounded-tile bg-surface/70 p-2 text-center">
            <MethodTag method="straddle" />
            <p className="mt-1 font-num text-title tabular-nums">{Number.isFinite(m.sm.move) ? `±${n0(m.sm.move)}` : "—"}</p>
            <p className="text-body-sm leading-tight tabular-nums text-muted-foreground">{Number.isFinite(m.st.straddle) && m.st.straddle > 0 ? `${formatINR(m.st.straddle, { decimals: 0 })} straddle` : "No straddle"}</p>
          </div>
          <div className="col-span-2 min-w-0 rounded-tile bg-surface/70 p-2 text-center sm:col-span-1">
            <p className="text-label uppercase text-muted-foreground">ATM IV</p>
            <p className="font-num text-title tabular-nums">{fmtVol(m.iv)}</p>
            <p className="text-body-sm text-muted-foreground">annualised</p>
          </div>
        </div>

        <div>
          <div className="relative h-8 rounded-md bg-muted" role="img" aria-label={`1 sigma range ${n0(m.iv1.lower)} to ${n0(m.iv1.upper)}; 2 sigma range ${n0(m.iv2.lower)} to ${n0(m.iv2.upper)}`}>
            <div className="absolute inset-y-0 rounded-md bg-info/15" style={{ left: at(m.iv1.lower), right: `calc(100% - ${at(m.iv1.upper)})` }} />
            {Number.isFinite(m.sm.lower) ? (
              <div className="absolute inset-y-1.5 rounded-sm border border-dashed border-primary/70" style={{ left: at(m.sm.lower), right: `calc(100% - ${at(m.sm.upper)})` }} />
            ) : null}
            <div className="absolute inset-y-0 w-0.5 bg-foreground" style={{ left: at(m.spot) }} />
          </div>
          <div className="mt-1 flex justify-between text-body-sm tabular-nums text-muted-foreground">
            <span>{n0(m.iv2.lower)}</span>
            <span className="text-bearish">{n0(m.iv1.lower)}</span>
            <span className="text-bullish">{n0(m.iv1.upper)}</span>
            <span>{n0(m.iv2.upper)}</span>
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5 text-body-sm">
          <Badge variant="info" className="normal-case">1σ (≈68%) {n0(m.iv1.lower)} – {n0(m.iv1.upper)}</Badge>
          {Number.isFinite(m.sm.lower) ? <Badge variant="default" className="normal-case">Straddle {n0(m.sm.lower)} – {n0(m.sm.upper)}</Badge> : null}
          <Badge variant="neutral" className="normal-case">2σ (≈95%) {n0(m.iv2.lower)} – {n0(m.iv2.upper)}</Badge>
        </div>
        <p className="text-body-sm text-muted-foreground">
          Shaded: IV 1σ band. Dashed: straddle band. Line: spot.
        </p>
      </CardContent>
    </Card>
  );
}
