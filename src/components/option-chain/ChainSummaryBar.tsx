import { useId, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { BuildupBadge } from "@/components/ui/buildup-badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import MetricHelp from "@/components/learn/MetricHelp";
import { cn } from "@/lib/utils";
import { expectedMoveFromIV, expectedMoveFromStraddle, formatDateIST, formatNumberIN, formatStrike, MINUS } from "@/lib/options";
import type { BuildupCounts, ChainModel } from "./chainModel";
import type { GammaLevels } from "./gammaLevels";
import { SourceBadge, type SourceBadgeProps } from "./SourceBadge";

export interface ChainSummaryBarProps {
  symbol: string;
  model: ChainModel;
  lotSize: number;
  lotEffectiveFrom?: string;
  dte: string;
  source: SourceBadgeProps;
  /** Gamma walls and flip from the GEX model (null when unavailable). */
  gamma?: GammaLevels | null;
  /** Legs per OI build-up class on each side. */
  buildup?: { ce: BuildupCounts; pe: BuildupCounts };
}

type Tone = "bullish" | "bearish" | "warning" | "primary";

interface StatProps {
  label: string;
  /** Learn metric id: wraps the label in MetricHelp. */
  metric?: string;
  metricValue?: number | string;
  value: ReactNode;
  sub?: ReactNode;
  hint: string;
  tone?: Tone;
  className?: string;
}

function Stat({ label, metric, metricValue, value, sub, hint, tone, className }: StatProps) {
  const labelEl = <span className="text-micro uppercase leading-tight text-muted-foreground [overflow-wrap:anywhere]">{label}</span>;
  return (
    <div className={cn("min-w-0 rounded-tile border border-border bg-card px-2.5 py-1.5 shadow-card", className)}>
      <div className="flex min-w-0 items-center">
        {metric ? (
          <MetricHelp metric={metric} value={metricValue}>
            {labelEl}
          </MetricHelp>
        ) : (
          labelEl
        )}
      </div>
      <Tooltip>
        <TooltipTrigger asChild>
          <div tabIndex={0} aria-label={`${label}. ${hint}`} className="rounded-chip focus-visible:shadow-ember focus-visible:outline-none">
            <div
              className={cn(
                "font-num text-[14px] font-bold tabular-nums leading-tight [overflow-wrap:anywhere]",
                tone === "bullish" && "text-bullish",
                tone === "bearish" && "text-bearish",
                tone === "warning" && "text-warning",
                tone === "primary" && "text-primary-ink",
              )}
            >
              {value}
            </div>
            {sub ? <div className="text-[10.5px] leading-snug tabular-nums text-muted-foreground [overflow-wrap:anywhere]">{sub}</div> : null}
          </div>
        </TooltipTrigger>
        <TooltipContent className="max-w-[260px] text-xs">{hint}</TooltipContent>
      </Tooltip>
    </div>
  );
}

function MethodTag({ children }: { children: ReactNode }) {
  return <span className="inline-flex h-[14px] shrink-0 items-center whitespace-nowrap rounded-chip bg-muted px-1 align-middle text-[9px] font-semibold tracking-[0.02em] text-muted-foreground">{children}</span>;
}

const n2 = (v: number) => formatNumberIN(v, 2, { minDecimals: 2 });
const ok = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v);
const signed0 = (v: number) => `${v >= 0 ? "+" : MINUS}${formatNumberIN(Math.abs(v), 0)}`;

export function ChainSummaryBar({ symbol, model, lotSize, lotEffectiveFrom, dte, source, gamma, buildup }: ChainSummaryBarProps) {
  const [moreOpen, setMoreOpen] = useState(false);
  const moreId = useId();
  const basis = ok(model.synthFuture) && ok(model.spot) ? model.synthFuture - model.spot : NaN;
  const pcrTone = ok(model.pcrOi) ? (model.pcrOi >= 1 ? "bullish" : model.pcrOi < 0.7 ? "bearish" : undefined) : undefined;
  const F = ok(model.forward) && model.forward > 0 ? model.forward : model.spot;
  const emIv = ok(model.atmIv) ? expectedMoveFromIV(F, model.atmIv / 100, model.T) : null;
  const emDay = ok(model.atmIv) ? expectedMoveFromIV(F, model.atmIv / 100, 1 / 365) : null;
  const emStraddle = ok(model.straddle.straddle) ? expectedMoveFromStraddle(model.straddle.straddle, model.spot) : null;

  const priority = (
    <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6">
      <Stat
        label={`${symbol} spot`}
        value={ok(model.spot) ? n2(model.spot) : "—"}
        sub={ok(basis) ? `Fut ${n2(model.synthFuture)}` : undefined}
        hint="Underlying spot price from the chain feed. Fut is the synthetic future (ATM strike + CE − PE)."
        tone="primary"
      />
      <Stat
        label="ATM IV"
        metric="ivr"
        metricValue={ok(model.atmIv) ? model.atmIv : undefined}
        value={ok(model.atmIv) ? `${model.atmIv.toFixed(2)}%` : "—"}
        sub={ok(emDay?.move) ? `1-day ±${formatNumberIN(emDay.move, 0)} pts` : undefined}
        hint="Implied volatility at the forward, interpolated between the two nearest strikes (OTM side preferred). 1-day is the one standard deviation move over one calendar day at this IV."
      />
      <Stat
        label="PCR (OI)"
        metric="pcr"
        metricValue={ok(model.pcrOi) ? model.pcrOi : undefined}
        value={ok(model.pcrOi) ? model.pcrOi.toFixed(2) : "—"}
        sub={ok(model.pcrChgOi) ? `ΔOI ${model.pcrChgOi.toFixed(2)}` : "ΔOI —"}
        hint="Put OI ÷ call OI across all strikes. ΔOI PCR uses today's change in OI and is shown only when both calls and puts added OI. Above 1 often reads as put writing (support)."
        tone={pcrTone}
      />
      <Stat
        label="Max pain"
        metric="maxPain"
        metricValue={ok(model.maxPain) ? model.maxPain : undefined}
        value={ok(model.maxPain) ? formatStrike(model.maxPain) : "—"}
        sub={ok(model.maxPain) && ok(model.spot) ? `${signed0(model.maxPain - model.spot)} pts` : undefined}
        hint="Settlement strike where option writers pay out the least"
        tone="warning"
      />
      <Stat
        label="Straddle"
        metric="straddle"
        value={ok(model.straddle.straddle) ? `₹${n2(model.straddle.straddle)}` : "—"}
        sub={ok(model.straddle.straddlePct) ? `${model.straddle.straddlePct.toFixed(2)}% · ${formatStrike(model.straddle.strike)}` : undefined}
        hint={`ATM straddle: CE + PE at ${ok(model.straddle.strike) ? formatStrike(model.straddle.strike) : "ATM"} (mid prices when quotes exist)`}
      />
      <Stat
        label="Exp. move"
        metric="em"
        value={
          <span className="flex flex-col">
            <span className="flex flex-wrap items-center gap-x-1">
              <span className="whitespace-nowrap">{ok(emIv?.move) ? `±${formatNumberIN(emIv.move, 0)}` : "—"}</span>
              <MethodTag>IV 1σ</MethodTag>
            </span>
            <span className="flex flex-wrap items-center gap-x-1 text-[12px] font-semibold text-muted-foreground">
              <span className="whitespace-nowrap">{ok(emStraddle?.move) ? `±${formatNumberIN(emStraddle.move, 0)}` : "—"}</span>
              <MethodTag>Straddle ×0.85</MethodTag>
            </span>
          </span>
        }
        hint="IV 1σ: one standard deviation to expiry from ATM IV (about 68% of outcomes inside). Straddle ×0.85: the market's typical move, roughly a 50% band. Both are model estimates, not forecasts."
      />
    </div>
  );

  const flip = gamma && gamma.flip !== null && ok(gamma.flip) ? gamma.flip : NaN;
  const moreTile = "w-[44%] shrink-0 snap-start sm:w-auto";
  const total = (c?: BuildupCounts) => (c ? c.LB + c.SB + c.SC + c.LU : 0);

  return (
    <section aria-label="Chain summary" className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <SourceBadge {...source} />
        <Badge variant="outline" title="Time left to the 15:30 IST expiry">{dte}</Badge>
        {model.anyDerived && (
          <Badge variant="info" title="IV and Greeks the feed sent as 0 are solved locally with Black-76 on the chain forward. Dotted underline marks them.">
            Derived IV / Greeks
          </Badge>
        )}
      </div>
      {priority}
      <div>
        <button
          type="button"
          aria-expanded={moreOpen}
          aria-controls={moreId}
          onClick={() => setMoreOpen((v) => !v)}
          className="inline-flex items-center gap-1 rounded-chip px-1 py-0.5 text-xs font-semibold text-muted-foreground transition-colors duration-fast hover:text-foreground focus-visible:shadow-ember focus-visible:outline-none"
        >
          <ChevronDown className={cn("h-3.5 w-3.5 transition-transform duration-fast", moreOpen && "rotate-180")} aria-hidden="true" />
          {moreOpen ? "Fewer stats" : "More stats"}
        </button>
        {moreOpen && (
          <div
            id={moreId}
            className="mt-1.5 flex snap-x snap-mandatory gap-1.5 overflow-x-auto pb-1 [scrollbar-width:thin] sm:grid sm:grid-cols-3 sm:overflow-visible sm:pb-0 lg:grid-cols-6"
          >
            <Stat
              className={moreTile}
              label="Synthetic fut"
              value={ok(model.synthFuture) ? n2(model.synthFuture) : "—"}
              sub={ok(basis) ? `Basis ${basis >= 0 ? "+" : MINUS}${n2(Math.abs(basis))}` : undefined}
              hint="ATM strike + CE − PE (put-call parity). Tracks the futures price without a separate feed."
            />
            <Stat
              className={moreTile}
              label="CE / PE OI"
              value={
                <span>
                  <span className="text-bearish">{formatNumberIN(model.totals.ceOi / 1e5, 1)}L</span> / <span className="text-bullish">{formatNumberIN(model.totals.peOi / 1e5, 1)}L</span>
                </span>
              }
              sub={ok(model.pcrVol) ? `Vol PCR ${model.pcrVol.toFixed(2)}` : undefined}
              hint="Total open interest in contracts (lakh) on each side"
            />
            <Stat
              className={moreTile}
              label="Max OI"
              value={
                <span>
                  <span className="text-bearish">{ok(model.maxOiStrike.ce) ? formatStrike(model.maxOiStrike.ce) : "—"}</span> / <span className="text-bullish">{ok(model.maxOiStrike.pe) ? formatStrike(model.maxOiStrike.pe) : "—"}</span>
                </span>
              }
              sub="CE resistance / PE support"
              hint="Strikes with the highest call OI (often resistance) and put OI (often support)"
            />
            <Stat
              className={moreTile}
              label="Gamma levels"
              metric="gex"
              value={
                gamma ? (
                  <span>
                    <span className="text-bearish">{formatStrike(gamma.callWall)}</span> / <span className="text-bullish">{formatStrike(gamma.putWall)}</span>
                  </span>
                ) : (
                  "—"
                )
              }
              sub={gamma ? `Flip ${ok(flip) ? formatStrike(Math.round(flip)) : "none"}` : "GEX unavailable"}
              hint="Call and put gamma walls from dealer gamma exposure (derived from OI and Greeks, assuming dealers are short calls and long puts). Flip is where net gamma changes sign."
            />
            <Stat
              className={moreTile}
              label="OI build-up"
              metric="buildup"
              value={
                buildup && total(buildup.ce) + total(buildup.pe) > 0 ? (
                  <span className="flex flex-wrap gap-0.5 text-[11px]">
                    {(["LB", "SB", "SC", "LU"] as const).map((k) => (
                      <span key={k} className="inline-flex items-center gap-0.5">
                        <BuildupBadge kind={k} variant="compact" className="h-4 min-w-0 px-1 text-[9px]" />
                        <span className="tabular-nums">{buildup.ce[k] + buildup.pe[k]}</span>
                      </span>
                    ))}
                  </span>
                ) : (
                  "—"
                )
              }
              sub={buildup ? `CE ${total(buildup.ce)} · PE ${total(buildup.pe)} legs` : undefined}
              hint="Count of legs by OI build-up (price change × OI change) across all strikes. Needs a price change from the feed."
            />
            <Stat
              className={moreTile}
              label="Lot size"
              value={lotSize > 0 ? formatNumberIN(lotSize, 0) : "—"}
              sub={lotEffectiveFrom ? `From ${formatDateIST(lotEffectiveFrom)}` : undefined}
              hint="Contract lot size for this expiry. Check the latest NSE/BSE circular before trading."
            />
          </div>
        )}
      </div>
    </section>
  );
}
