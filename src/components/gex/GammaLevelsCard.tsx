import { useMemo } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight, Crosshair, Magnet, ShieldCheck, ShieldAlert, Target } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useLiveOptionChain } from "@/hooks/useMarketData";
import MetricHelp from "@/components/learn/MetricHelp";
import { GEX_CONVENTION_SHORT } from "@/lib/gex";
import {
  buildGexView,
  inferOiUnit,
  type GammaLevels,
  type GammaRegime,
  type GexConvention,
  type GexTotals,
} from "@/lib/gexData";
import { maxPain as maxPainOf } from "@/lib/options";
import { cn } from "@/lib/utils";
import { EDU_NOTE, fmtCr, fmtLevel, pctFrom } from "./format";
import { GexSourceTag, type SourceInfo } from "./SourceTag";
import { useGexConvention } from "./useGexConvention";

export interface GammaLevelsPanelProps {
  levels: GammaLevels | null;
  dealerFlip: number | null;
  spot: number;
  maxPain: number;
  regime: GammaRegime;
  totals: GexTotals | null;
  convention: GexConvention;
  loading?: boolean;
  /** Tighter layout for embedding (dashboard). */
  compact?: boolean;
}

interface LevelRow {
  key: string;
  /** Metric key for the inline explainer, when one exists. */
  metric?: string;
  label: string;
  hint: string;
  value: number | null;
  tone: string;
  icon: typeof Target;
}

export const SELLER_REGIME_TEXT = "Writers short gamma at all levels (by construction)";

const SELLER_COPY =
  "In the seller view every strike adds short gamma, so there is no damped zone to report. Read the walls as where hedging is heaviest and the dealer-model flip as a reference line.";

const REGIME_COPY: Record<GammaRegime, { label: string; variant: "bullish" | "bearish" | "neutral"; text: string }> = {
  damped: {
    label: "Long gamma · damped",
    variant: "bullish",
    text: "Hedgers sell rallies and buy dips. Expect mean reversion and pinning.",
  },
  amplified: {
    label: "Short gamma · amplified",
    variant: "bearish",
    text: "Hedgers chase the move. Breaks of key strikes can extend quickly.",
  },
  neutral: { label: "Near flat gamma", variant: "neutral", text: "Hedging flows are roughly balanced at this spot." },
};

/** Presentational levels panel: walls, absolute gamma, flip, max pain, regime and totals. */
export function GammaLevelsPanel({
  levels,
  dealerFlip,
  spot,
  maxPain,
  regime,
  totals,
  convention,
  loading,
  compact,
}: GammaLevelsPanelProps) {
  const seller = convention === "sellerShortBoth";
  const flip = levels?.flip ?? null;
  const flipValue = flip ?? dealerFlip;
  const flipLabel = flip === null && dealerFlip !== null ? "Flip (dealer model)" : "Gamma flip";
  const fin = (v: number | undefined) => (v !== undefined && Number.isFinite(v) ? v : null);

  const rows: LevelRow[] = [
    {
      key: "cw",
      metric: "callWall",
      label: "Call wall",
      hint: "Most call gamma: resistance",
      value: fin(levels?.callWall),
      tone: "text-bearish",
      icon: ShieldAlert,
    },
    {
      key: "pw",
      metric: "putWall",
      label: "Put wall",
      hint: "Most put gamma: support",
      value: fin(levels?.putWall),
      tone: "text-bullish",
      icon: ShieldCheck,
    },
    {
      key: "ag",
      label: "Absolute gamma",
      hint: "Most total gamma: pin magnet",
      value: fin(levels?.absGamma),
      tone: "text-primary-ink",
      icon: Magnet,
    },
    {
      key: "flip",
      metric: "flip",
      label: flipLabel,
      hint: flipValue === null ? "No sign change within ±5%" : "Total GEX changes sign",
      value: flipValue,
      tone: "text-warning",
      icon: Crosshair,
    },
    {
      key: "mp",
      label: "Max pain",
      hint: "Least payout to option buyers",
      value: Number.isFinite(maxPain) && maxPain > 0 ? maxPain : null,
      tone: "text-info",
      icon: Target,
    },
  ];

  const spotVsFlip =
    flipValue !== null && spot > 0
      ? spot >= flipValue
        ? `Spot is ${pctFrom(spot, flipValue).replace("+", "")} above the flip`
        : `Spot is ${pctFrom(spot, flipValue).replace("−", "")} below the flip`
      : null;
  // The regime only means something in the dealer model; the seller view is short gamma everywhere.
  const copy = seller ? null : REGIME_COPY[regime];

  if (loading) {
    return (
      <div className="space-y-2" aria-busy="true">
        {["cw", "pw", "ag", "flip", "mp"].map((k) => (
          <Skeleton key={k} className="h-10 w-full rounded-tile" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {copy ? (
          <Badge variant={copy.variant}>{copy.label}</Badge>
        ) : (
          <p className="text-body-sm font-semibold text-foreground">{SELLER_REGIME_TEXT}</p>
        )}
        {spotVsFlip && (
          <span className="text-body-sm text-muted-foreground">
            {spotVsFlip}
            {seller ? " (dealer model)" : ""}
          </span>
        )}
      </div>
      <ul className={cn("grid gap-1.5", compact ? "grid-cols-1" : "grid-cols-1 sm:grid-cols-2 xl:grid-cols-1")}>
        {rows.map((r) => (
          <li
            key={r.key}
            className="flex items-center justify-between gap-3 rounded-tile border border-border bg-surface px-3 py-2"
          >
            <div className="flex min-w-0 items-center gap-2">
              <r.icon className={cn("h-4 w-4 shrink-0", r.tone)} aria-hidden />
              <div className="min-w-0">
                <p className="flex min-w-0 items-center gap-1 text-body font-semibold">
                  <span className="truncate">{r.label}</span>
                  {r.metric ? <MetricHelp metric={r.metric} value={r.value ?? undefined} /> : null}
                </p>
                {!compact && <p className="line-clamp-2 text-body-sm leading-snug text-muted-foreground">{r.hint}</p>}
              </div>
            </div>
            <div className="shrink-0 text-right">
              <p className={cn("font-num text-lead font-semibold", r.tone)}>{fmtLevel(r.value)}</p>
              <p className="font-num text-label text-muted-foreground">{pctFrom(r.value, spot)}</p>
            </div>
          </li>
        ))}
      </ul>
      {totals && !compact && (
        <dl className="grid grid-cols-2 gap-1.5 text-body-sm">
          <div className="rounded-tile bg-muted px-3 py-2">
            <dt className="flex items-center gap-1 text-label uppercase text-muted-foreground">
              Net GEX <MetricHelp metric="gex" />
            </dt>
            <dd
              className={cn(
                "font-num text-lead font-semibold",
                totals.netGex > 0 ? "text-bullish" : totals.netGex < 0 ? "text-bearish" : "",
              )}
            >
              {fmtCr(totals.netGex, { signed: true })}
            </dd>
          </div>
          <div className="rounded-tile bg-muted px-3 py-2">
            <dt className="text-label uppercase text-muted-foreground">Net DEX</dt>
            <dd className="font-num text-lead font-semibold">{fmtCr(totals.dex, { signed: true })}</dd>
          </div>
        </dl>
      )}
      {!compact && <p className="text-body-sm text-muted-foreground">{copy ? copy.text : SELLER_COPY}</p>}
    </div>
  );
}

/**
 * Self-contained Gamma Levels card for the dashboard. Uses the nearest expiry and the same stored
 * sign convention as the GEX page, and says which one is active.
 */
export default function GammaLevelsCard({ symbol, className }: { symbol: string; className?: string }) {
  const sym = (symbol || "NIFTY").toUpperCase();
  const { data, isLoading, isError } = useLiveOptionChain(sym);
  const [convention] = useGexConvention();

  const view = useMemo(() => {
    if (!data || data.chain.length === 0 || !(data.spotPrice > 0)) return null;
    const oiUnit = inferOiUnit(data.chain, data.lotSize);
    return buildGexView([{ expiry: data.expiry, chain: data.chain, lotSize: data.lotSize }], data.spotPrice, {
      convention,
      oiUnit,
    });
  }, [data, convention]);

  const mp = useMemo(
    () =>
      data && data.chain.length > 0
        ? Number.isFinite(data.maxPain) && data.maxPain > 0
          ? data.maxPain
          : maxPainOf(data.chain)
        : NaN,
    [data],
  );
  const info: SourceInfo | null = data
    ? {
        source: data.source,
        isLive: data.isLive,
        stale: data.stale,
        afterHours: data.afterHours,
        asOf: data.asOf,
        reason: data.reason,
      }
    : null;

  return (
    <Card className={cn("rounded-card", className)}>
      <CardHeader className="space-y-1.5 pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-lead">
            <Magnet className="h-4 w-4 text-primary-ink" aria-hidden />
            Gamma levels · {sym}
          </CardTitle>
          <Link
            to={`/gex?symbol=${encodeURIComponent(sym)}`}
            className="inline-flex items-center gap-0.5 rounded-chip text-body-sm text-primary-ink hover:underline focus-visible:shadow-ember focus-visible:outline-none"
          >
            Open GEX <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <GexSourceTag info={info} />
          <Badge variant="outline" className="normal-case" title="Change the view on the Gamma Exposure page">
            {GEX_CONVENTION_SHORT[convention]}
          </Badge>
          {data?.expiry && <span className="text-body-sm text-muted-foreground">Nearest expiry</span>}
        </div>
      </CardHeader>
      <CardContent className="space-y-2 pt-0">
        {isError ? (
          <p className="py-6 text-center text-body text-muted-foreground">
            Could not load the option chain. Try again shortly.
          </p>
        ) : !isLoading && !view ? (
          <p className="py-6 text-center text-body text-muted-foreground">
            No option chain with open interest for {sym}.
          </p>
        ) : (
          <GammaLevelsPanel
            levels={view?.levels ?? null}
            dealerFlip={view?.dealerFlip ?? null}
            spot={data?.spotPrice ?? 0}
            maxPain={mp}
            regime={view?.regime ?? "neutral"}
            totals={view?.totals ?? null}
            convention={convention}
            loading={isLoading}
            compact
          />
        )}
        <p className="text-micro text-muted-foreground">{EDU_NOTE}</p>
      </CardContent>
    </Card>
  );
}
