import { BuildupBadge, HelpTip, Signed } from "@/components/screener/ScreenerUi";
import { dteLabel, formatDateIST, formatNumberIN } from "@/lib/options";
import type { FuturesView } from "@/lib/futures/model";
import { cn } from "@/lib/utils";
import { fmtOi, fmtPrice } from "./format";

const DOT = ["bg-chart-1", "bg-chart-2", "bg-chart-3"];

/** Near / next / far tiles with price, basis, carry, OI and buildup, plus near-month fair value. */
export function TermStructure({ view }: { view: FuturesView }) {
  const fair = view.fair;
  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-3">
        {view.series.map((s, i) => (
          <div key={s.expiry} className="min-w-0 rounded-tile border border-border bg-card p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="flex items-center gap-1.5 text-label uppercase text-muted-foreground">
                <span aria-hidden="true" className={cn("h-2 w-2 rounded-full", DOT[i])} />
                {s.label} · {formatDateIST(s.expiry)}
              </p>
              {s.buildup ? <BuildupBadge buildup={s.buildup} short /> : null}
            </div>
            <p className="mt-1 font-num text-title tabular-nums">{fmtPrice(s.price)}</p>
            <p className="text-body-sm">
              <Signed value={s.priceChg} suffix="" /> <span className="text-muted-foreground">(</span>
              <Signed value={s.priceChgPct} />
              <span className="text-muted-foreground">)</span>
            </p>
            <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-body-sm">
              <dt className="text-muted-foreground">Basis</dt>
              <dd className="text-right">
                <Signed value={s.basis} suffix="" />
              </dd>
              <dt className="text-muted-foreground">Carry p.a.</dt>
              <dd className="text-right">
                <Signed value={s.carryPct} decimals={1} />
              </dd>
              <dt className="text-muted-foreground">OI</dt>
              <dd className="text-right font-num tabular-nums">{fmtOi(s.oi)}</dd>
              <dt className="text-muted-foreground">OI chg</dt>
              <dd className="text-right">
                <Signed value={s.oiChgPct} decimals={1} />
              </dd>
              <dt className="text-muted-foreground">Days</dt>
              <dd className="text-right font-num tabular-nums">{formatNumberIN(s.dte)}</dd>
            </dl>
          </div>
        ))}
      </div>
      {view.series.length < 3 ? (
        <p className="text-body-sm text-muted-foreground">Only {view.series.length} series traded on this day.</p>
      ) : null}

      {fair ? (
        <div className="grid grid-cols-2 gap-2 rounded-tile border border-border bg-surface p-3 text-body-sm sm:grid-cols-4">
          <div>
            <p className="flex items-center gap-1 text-label uppercase text-muted-foreground">
              Fair value
              <HelpTip
                text="Spot × e^((r − q) × t), with r from your market settings and q from the dividend table. Same maths as the Futures basis calculator."
                label="About fair value"
              />
            </p>
            <p className="font-num tabular-nums">{fmtPrice(fair.fair)}</p>
          </div>
          <div>
            <p className="text-label uppercase text-muted-foreground">Near vs fair</p>
            <Signed value={fair.mispricing} suffix="" />
          </div>
          <div>
            <p className="text-label uppercase text-muted-foreground">Implied dividend</p>
            <Signed value={fair.impliedDivYieldPct} />
          </div>
          <div>
            <p className="text-label uppercase text-muted-foreground">Carry (cont.)</p>
            <Signed value={fair.continuousCarryPct} />
          </div>
        </div>
      ) : null}
      {view.series[0] ? (
        <p className="text-body-sm text-muted-foreground">
          Near month expires {formatDateIST(view.series[0].expiry)} ({dteLabel(view.series[0].expiry)}).
        </p>
      ) : null}
    </div>
  );
}
