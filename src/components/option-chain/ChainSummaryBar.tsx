import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { formatDateIST, formatNumberIN, formatStrike, MINUS } from "@/lib/options";
import type { ChainModel } from "./chainModel";
import { SourceBadge, type SourceBadgeProps } from "./SourceBadge";

export interface ChainSummaryBarProps {
  symbol: string;
  model: ChainModel;
  lotSize: number;
  lotEffectiveFrom?: string;
  dte: string;
  source: SourceBadgeProps;
}

function Stat({ label, value, sub, hint, tone }: { label: string; value: ReactNode; sub?: ReactNode; hint: string; tone?: "bullish" | "bearish" | "warning" | "primary" }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div tabIndex={0} className="min-w-0 rounded-tile border border-border bg-card px-2.5 py-1.5 shadow-card focus-visible:shadow-ember focus-visible:outline-none">
          <p className="text-micro uppercase leading-tight text-muted-foreground [overflow-wrap:anywhere]">{label}</p>
          <p
            className={cn(
              // Values may wrap to a second line rather than being cut off with an ellipsis.
              "font-num text-[14px] font-bold tabular-nums leading-tight [overflow-wrap:anywhere]",
              tone === "bullish" && "text-bullish",
              tone === "bearish" && "text-bearish",
              tone === "warning" && "text-warning",
              tone === "primary" && "text-primary-ink",
            )}
          >
            {value}
          </p>
          {sub ? <p className="text-[10.5px] leading-snug tabular-nums text-muted-foreground [overflow-wrap:anywhere]">{sub}</p> : null}
        </div>
      </TooltipTrigger>
      <TooltipContent className="max-w-[240px] text-xs">{hint}</TooltipContent>
    </Tooltip>
  );
}

const n2 = (v: number) => formatNumberIN(v, 2, { minDecimals: 2 });
const ok = (v: number) => Number.isFinite(v);

export function ChainSummaryBar({ symbol, model, lotSize, lotEffectiveFrom, dte, source }: ChainSummaryBarProps) {
  const basis = ok(model.synthFuture) && ok(model.spot) ? model.synthFuture - model.spot : NaN;
  const pcrTone = ok(model.pcrOi) ? (model.pcrOi >= 1 ? "bullish" : model.pcrOi < 0.7 ? "bearish" : undefined) : undefined;
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
      <div className="grid grid-cols-[repeat(auto-fit,minmax(9rem,1fr))] gap-1.5">
        <Stat label={`${symbol} spot`} value={ok(model.spot) ? n2(model.spot) : "—"} hint="Underlying spot price from the chain feed" tone="primary" />
        <Stat
          label="Synthetic fut"
          value={ok(model.synthFuture) ? n2(model.synthFuture) : "—"}
          sub={ok(basis) ? `Basis ${basis >= 0 ? "+" : MINUS}${n2(Math.abs(basis))}` : undefined}
          hint="ATM strike + CE − PE (put-call parity). Tracks the futures price without a separate feed."
        />
        <Stat label="ATM IV" value={ok(model.atmIv) ? `${model.atmIv.toFixed(2)}%` : "—"} hint="Implied volatility at the forward, interpolated between the two nearest strikes (OTM side preferred)" />
        <Stat
          label="PCR (OI)"
          value={ok(model.pcrOi) ? model.pcrOi.toFixed(2) : "—"}
          sub={ok(model.pcrChgOi) ? `ΔOI PCR ${model.pcrChgOi.toFixed(2)}` : "ΔOI PCR —"}
          hint="Put OI ÷ call OI across all strikes. ΔOI PCR uses today's change in OI and is shown only when both calls and puts added OI. Above 1 often reads as put writing (support)."
          tone={pcrTone}
        />
        <Stat label="Max pain" value={ok(model.maxPain) ? formatStrike(model.maxPain) : "—"} sub={ok(model.maxPain) && ok(model.spot) ? `${model.maxPain - model.spot >= 0 ? "+" : MINUS}${formatNumberIN(Math.abs(model.maxPain - model.spot), 0)} pts` : undefined} hint="Settlement strike where option writers pay out the least" tone="warning" />
        <Stat
          label="ATM straddle"
          value={ok(model.straddle.straddle) ? `₹${n2(model.straddle.straddle)}` : "—"}
          sub={ok(model.straddle.straddlePct) ? `${model.straddle.straddlePct.toFixed(2)}% of spot` : undefined}
          hint={`CE + PE at ${ok(model.straddle.strike) ? formatStrike(model.straddle.strike) : "ATM"} (mid prices when quotes exist)`}
        />
        <Stat
          label="Expected move"
          value={ok(model.expectedMove.move) ? `±${formatNumberIN(model.expectedMove.move, 0)}` : "—"}
          sub={ok(model.expectedMove.lower) ? `${formatNumberIN(model.expectedMove.lower, 0)} – ${formatNumberIN(model.expectedMove.upper, 0)}` : undefined}
          hint="0.85 × ATM straddle: the market-implied typical move to expiry (about 0.68σ, so roughly half of outcomes land inside this band). A one standard deviation move is about 1.25 × straddle."
        />
        <Stat
          label="CE / PE OI"
          value={<span><span className="text-bearish">{formatNumberIN(model.totals.ceOi / 1e5, 1)}L</span> / <span className="text-bullish">{formatNumberIN(model.totals.peOi / 1e5, 1)}L</span></span>}
          sub={ok(model.pcrVol) ? `Vol PCR ${model.pcrVol.toFixed(2)}` : undefined}
          hint="Total open interest in contracts (lakh) on each side"
        />
        <Stat
          label="Lot size"
          value={lotSize > 0 ? formatNumberIN(lotSize, 0) : "—"}
          sub={lotEffectiveFrom ? `From ${formatDateIST(lotEffectiveFrom)}` : undefined}
          hint="Contract lot size for this expiry. Check the latest NSE/BSE circular before trading."
        />
        <Stat
          label="Max OI"
          value={<span><span className="text-bearish">{ok(model.maxOiStrike.ce) ? formatStrike(model.maxOiStrike.ce) : "—"}</span> / <span className="text-bullish">{ok(model.maxOiStrike.pe) ? formatStrike(model.maxOiStrike.pe) : "—"}</span></span>}
          sub="CE resistance / PE support"
          hint="Strikes with the highest call OI (often resistance) and put OI (often support)"
        />
      </div>
    </section>
  );
}
