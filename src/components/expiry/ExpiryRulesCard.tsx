/** Expiry-day rules for Indian index options, with worked ₹ examples for one lot. */
import type { ReactNode } from "react";
import { BadgeIndianRupee, CalendarX2, Gavel, Receipt, Scale3d } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatDateIST, formatINR, formatPct, istDateString } from "@/lib/options";
import { cn } from "@/lib/utils";
import { elmPerLot, exerciseExample, settlementWindowState } from "./expiryMath";
import { Panel } from "./ExpiryUi";
import { useNow } from "./useExpirySession";

interface Props {
  symbol: string;
  spot: number;
  lotSize: number;
  step: number;
  expiry: string;
  /** True when spot comes from sample data. */
  sample?: boolean;
}

function Rule({ icon, title, children, tone }: { icon: ReactNode; title: string; children: ReactNode; tone?: "warning" }) {
  return (
    <li className={cn("flex gap-3 rounded-tile border p-3", tone === "warning" ? "border-warning/40 bg-wash-warning" : "border-border bg-surface")}>
      <div className={cn("mt-0.5 shrink-0", tone === "warning" ? "text-warning" : "text-primary-ink")} aria-hidden="true">
        {icon}
      </div>
      <div className="min-w-0">
        <p className="font-semibold">{title}</p>
        <div className="mt-0.5 text-body-sm text-muted-foreground">{children}</div>
      </div>
    </li>
  );
}

export function ExpiryRulesCard({ symbol, spot, lotSize, step, expiry, sample }: Props) {
  const now = useNow(30_000);
  const today = istDateString(now);
  const elm = elmPerLot(spot, lotSize);
  const ex = exerciseExample(spot, step, lotSize, today);
  const settle = expiry ? settlementWindowState(now, expiry) : "not-today";
  const spotNote = sample ? " (sample spot)" : "";

  return (
    <Panel
      title={
        <>
          <Gavel className="h-4 w-4 text-primary-ink" aria-hidden="true" />
          Expiry-day rules
          {sample ? <Badge variant="warning">Sample spot</Badge> : null}
        </>
      }
      subtitle={`What changes on the day ${symbol} options expire${expiry ? ` (${formatDateIST(expiry)})` : ""}`}
    >
      <ul className="space-y-2">
        <Rule icon={<BadgeIndianRupee className="h-5 w-5" />} title="Extra 2% ELM on short index options">
          Sellers of index options expiring that day pay an additional extreme-loss margin of 2% of the notional value.
          {Number.isFinite(elm) ? (
            <>
              {" "}
              For one {symbol} lot ({lotSize} × {spot.toFixed(0)}{spotNote}) that is about <span className="font-num font-semibold text-foreground">{formatINR(elm, { decimals: 0 })}</span> more per short lot.
            </>
          ) : null}
        </Rule>
        <Rule icon={<CalendarX2 className="h-5 w-5" />} title="No calendar-spread benefit on expiry day">
          Positions in the contract expiring today no longer offset positions in later expiries for margin. A short weekly hedged with next week&apos;s long is margined as if unhedged on the last day.
        </Rule>
        <Rule icon={<Scale3d className="h-5 w-5" />} title="Settlement price: average of the last 30 minutes" tone={settle === "averaging" ? "warning" : undefined}>
          Index options are cash-settled against the official index close, which is built from each stock&apos;s volume-weighted price between 15:00 and 15:30 IST. A spike in the final minute barely moves it.
          {settle === "averaging" ? <span className="mt-1 block font-semibold text-warning">The averaging window is running now.</span> : null}
          {settle === "settled" ? <span className="mt-1 block">Today&apos;s contract has settled.</span> : null}
        </Rule>
        <Rule icon={<Receipt className="h-5 w-5" />} title="STT on exercise of in-the-money longs" tone="warning">
          If you hold a long option that finishes in the money, it is exercised automatically and STT is charged on the full intrinsic value, not on what you paid.
          {ex ? (
            <span className="mt-2 block rounded-chip bg-card p-2 text-foreground">
              Example{spotNote}: one {symbol} {ex.strike} CE lot, spot {spot.toFixed(0)}, intrinsic {formatINR(ex.intrinsic)} × {ex.qty}.
              <span className="mt-1 grid grid-cols-1 gap-1 font-num tabular-nums sm:grid-cols-2">
                <span>
                  Left to exercise: <strong>{formatINR(ex.sttExercise)}</strong> STT ({formatPct(ex.exerciseRate * 100, { decimals: 3 })} of intrinsic)
                </span>
                <span>
                  Sold before 15:30: <strong>{formatINR(ex.sttSell)}</strong> STT ({formatPct(ex.sellRate * 100, { decimals: 3 })} of premium)
                </span>
              </span>
              <span className="mt-1 block text-body-sm text-muted-foreground">
                {ex.sttExercise > ex.sttSell * 1.01
                  ? "Exercise costs more: square off deep ITM longs before the close."
                  : "At the current rates the two are close, but squaring off still avoids exercise surprises and broker exercise fees."}{" "}
                Rates effective {formatDateIST(ex.rateFrom)}; check the latest notification.
              </span>
            </span>
          ) : null}
        </Rule>
      </ul>
    </Panel>
  );
}
