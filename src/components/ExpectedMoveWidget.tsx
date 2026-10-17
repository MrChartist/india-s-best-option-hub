/**
 * Expected move to the nearest expiry, from the symbol's own option chain:
 *  - IV move: ATM IV (Black-76 on the parity forward) with log-space bounds F·e^(±σ√T)
 *  - Straddle move: 0.85 × the ATM straddle
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
  expectedMoveFromIV,
  expectedMoveFromStraddle,
  formatDateIST,
  formatINR,
  formatNumberIN,
  formatPct,
  getMarketParams,
  timeToExpiryYears,
} from "@/lib/options";
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
}

const n0 = (v: number) => formatNumberIN(v, 0);

export function ExpectedMoveWidget({ symbol = "NIFTY", compact = false }: Props) {
  const { data, isLoading } = useLiveOptionChain(symbol);

  const m = useMemo(() => {
    if (!data || data.chain.length === 0 || !(data.spotPrice > 0) || !data.expiry) return null;
    const now = new Date();
    const r = getMarketParams().r;
    const T = timeToExpiryYears(data.expiry, now);
    const F = chainForward(data.chain, data.spotPrice, T, r);
    const iv = chainAtmIv(data.chain, data.spotPrice, data.expiry, now, r);
    const st = atmStraddle(data.chain, data.spotPrice);
    const iv1 = expectedMoveFromIV(F, iv / 100, T, 1);
    const iv2 = expectedMoveFromIV(F, iv / 100, T, 2);
    const sm = expectedMoveFromStraddle(st.straddle, data.spotPrice);
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
      <Card>
        <CardContent className="py-6 text-center">
          <Target className="mx-auto mb-2 h-6 w-6 text-muted-foreground/40" aria-hidden="true" />
          <p className="text-body-sm text-muted-foreground">{symbol} expected move</p>
          <p className="mt-1 text-body-sm text-muted-foreground">The option chain has no usable ATM prices right now.</p>
        </CardContent>
      </Card>
    );
  }

  const expLabel = `${formatDateIST(data.expiry)} · ${dteLabel(data.expiry)}`;

  if (compact) {
    return (
      <Card>
        <CardContent className="p-3">
          <div className="mb-1 flex items-center gap-1.5">
            <Target className="h-3.5 w-3.5 text-primary-ink" aria-hidden="true" />
            <p className="truncate text-label uppercase text-muted-foreground">{symbol} move · {dteLabel(data.expiry)}</p>
          </div>
          <p className="font-num text-title tabular-nums text-primary-ink">±{n0(m.iv1.move)}</p>
          <p className="text-body-sm tabular-nums text-muted-foreground">
            {n0(m.iv1.lower)} – {n0(m.iv1.upper)}
          </p>
          {data.source === "sample" ? <div className="mt-1">{badge}</div> : null}
        </CardContent>
      </Card>
    );
  }

  const lo = m.iv2.lower;
  const span = m.iv2.upper - lo || 1;
  const at = (x: number) => `${Math.min(100, Math.max(0, ((x - lo) / span) * 100))}%`;

  return (
    <Card>
      <CardHeader className="p-4 pb-2">
        <CardTitle className="flex flex-wrap items-center gap-2 text-lead">
          <ArrowUpDown className="h-4 w-4 text-primary-ink" aria-hidden="true" />
          {symbol} expected move
          <span className="ml-auto flex items-center gap-1.5">
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
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-tile bg-surface/70 p-2 text-center">
            <p className="text-label uppercase text-muted-foreground">IV move</p>
            <p className="font-num text-title tabular-nums text-primary-ink">±{n0(m.iv1.move)}</p>
            <p className="text-body-sm tabular-nums text-muted-foreground">{formatPct(m.iv1.pct)}</p>
          </div>
          <div className="rounded-tile bg-surface/70 p-2 text-center">
            <p className="text-label uppercase text-muted-foreground">Straddle move</p>
            <p className="font-num text-title tabular-nums">{Number.isFinite(m.sm.move) ? `±${n0(m.sm.move)}` : "—"}</p>
            <p className="text-body-sm tabular-nums text-muted-foreground">{formatINR(m.st.straddle, { decimals: 0 })} × 0.85</p>
          </div>
          <div className="rounded-tile bg-surface/70 p-2 text-center">
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
          <Badge variant="info">1σ (≈68%) {n0(m.iv1.lower)} – {n0(m.iv1.upper)}</Badge>
          <Badge variant="neutral">2σ (≈95%) {n0(m.iv2.lower)} – {n0(m.iv2.upper)}</Badge>
        </div>
      </CardContent>
    </Card>
  );
}
