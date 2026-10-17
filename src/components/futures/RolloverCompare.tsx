import { Signed } from "@/components/screener/ScreenerUi";
import { formatDateIST } from "@/lib/options";
import { rolloverRead, tdteLabel, type Comparable, type RolloverComparison } from "@/lib/futures/model";
import { cn } from "@/lib/utils";

function Meter({ value, marker, label }: { value: number | null; marker: number | null; label: string }) {
  const w = value === null ? 0 : Math.max(0, Math.min(100, value));
  return (
    <div className="relative h-2 w-full overflow-hidden rounded-capsule bg-muted" role="img" aria-label={label}>
      <div className="h-full rounded-capsule bg-primary" style={{ width: `${w}%` }} />
      {marker !== null ? (
        <span
          aria-hidden="true"
          className="absolute inset-y-0 w-0.5 bg-foreground"
          style={{ left: `calc(${Math.max(0, Math.min(100, marker))}% - 1px)` }}
        />
      ) : null}
    </div>
  );
}

export interface RolloverCompareProps {
  cmp: RolloverComparison;
  comparables: Comparable[];
  tradingDte: number | null;
}

/** Rollover % and roll cost now against the average of the last three expiries at the same point in the cycle. */
export function RolloverCompare({ cmp, comparables, tradingDte }: RolloverCompareProps) {
  const point = tradingDte === null ? "" : tdteLabel(tradingDte);
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-tile border border-border p-3">
          <p className="text-label uppercase text-muted-foreground">Rollover now</p>
          <p className="font-num text-title tabular-nums">
            {cmp.current === null ? "—" : `${cmp.current.toFixed(1)}%`}
          </p>
          <p className="text-body-sm text-muted-foreground">
            {cmp.average === null ? "3-expiry avg —" : `3-expiry avg ${cmp.average.toFixed(1)}%`}
            {cmp.diff !== null ? (
              <>
                {" · "}
                <span className="whitespace-nowrap"><Signed value={cmp.diff} decimals={1} suffix=" pts" /></span>
              </>
            ) : null}
          </p>
        </div>
        <div className="rounded-tile border border-border p-3">
          <p className="text-label uppercase text-muted-foreground">Roll cost p.a.</p>
          <p className="text-title">
            <Signed value={cmp.rollCostAnn} decimals={2} />
          </p>
          <p className="text-body-sm text-muted-foreground">
            {cmp.rollCostAvgAnn === null ? "3-expiry avg —" : `3-expiry avg ${cmp.rollCostAvgAnn.toFixed(2)}%`}
            {cmp.rollCostDiff !== null ? (
              <>
                {" · "}
                <span className="whitespace-nowrap"><Signed value={cmp.rollCostDiff} decimals={2} suffix=" pts" /></span>
              </>
            ) : null}
          </p>
        </div>
      </div>
      <Meter
        value={cmp.current}
        marker={cmp.average}
        label={`Rollover ${cmp.current === null ? "unavailable" : `${cmp.current.toFixed(1)} percent`}${cmp.average === null ? "" : `, three-expiry average ${cmp.average.toFixed(1)} percent`}`}
      />
      <p className="text-body-sm text-muted-foreground">
        <span className="mr-1 inline-block h-2 w-3 rounded-capsule bg-primary align-middle" aria-hidden="true" /> now
        <span className="mx-1 ml-3 inline-block h-3 w-0.5 bg-foreground align-middle" aria-hidden="true" /> 3-expiry
        average
      </p>
      <p className="text-body">{rolloverRead(cmp)}</p>
      {comparables.length ? (
        <p className={cn("text-body-sm text-muted-foreground")}>
          Compared at {point || "the same point"} of each cycle:{" "}
          {comparables.map((c) => `${formatDateIST(c.date)} (${formatDateIST(c.expiry)} expiry)`).join(" · ")}.
        </p>
      ) : null}
    </div>
  );
}
