/** Spot ±1/2/3% × IV ±5 points scenario grid, repriced with Black-76 at the chosen horizon. */
import { useMemo, useState, type CSSProperties } from "react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { formatPct } from "@/lib/options";
import type { TrackedPosition } from "@/lib/positionStore";
import { cn } from "@/lib/utils";
import { SCENARIO_IV_SHIFTS, SCENARIO_SPOT_PCTS, scenarioGrid, type PositionLive } from "./analytics";
import { signedClass, signedINR } from "./helpers";

const HORIZONS = [
  { value: "0", label: "Now", days: 0 },
  { value: "1", label: "+1 day", days: 1 },
  { value: "3", label: "+3 days", days: 3 },
] as const;

/** Background tint by sign and size, using the semantic tokens. */
function cellStyle(v: number, maxAbs: number): CSSProperties {
  if (!Number.isFinite(v) || maxAbs <= 0 || Math.abs(v) < 0.5) return {};
  const a = 0.3 + 0.7 * Math.min(1, Math.abs(v) / maxAbs);
  return { backgroundColor: `hsl(var(${v > 0 ? "--wash-profit" : "--wash-loss"}) / ${a.toFixed(3)})` };
}

export function ScenarioGrid({
  positions,
  live,
  spots,
  r,
  now,
}: {
  positions: TrackedPosition[];
  live: Record<string, PositionLive>;
  spots: Record<string, number>;
  r: number;
  now: Date;
}) {
  const [horizon, setHorizon] = useState<string>("0");
  const days = HORIZONS.find((h) => h.value === horizon)?.days ?? 0;
  const grid = useMemo(() => {
    const atDate = new Date(now.getTime() + days * 86_400_000);
    return scenarioGrid(positions, live, spots, { now, r, atDate });
  }, [positions, live, spots, r, now, days]);
  const base = grid[1]?.[3] ?? 0;
  const maxAbs = Math.max(1, ...grid.flat().map((v) => Math.abs(v)));
  const symbols = Object.keys(spots).filter((s) => positions.some((p) => p.symbol === s));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-body-sm text-muted-foreground">
          Total P&L in ₹ versus entry, before exit charges. Every underlying moves by the same %. Current cell is outlined.
        </p>
        <ToggleGroup type="single" value={horizon} onValueChange={(v) => v && setHorizon(v)} aria-label="Horizon" size="sm">
          {HORIZONS.map((h) => (
            <ToggleGroupItem key={h.value} value={h.value} className="px-2.5 text-body-sm">
              {h.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
      <div className="overflow-x-auto rounded-tile border border-separator">
        <table className="w-full min-w-[640px] border-collapse font-num text-body-sm tabular-nums">
          <caption className="sr-only">Scenario P&L by spot move (columns) and IV shift (rows)</caption>
          <thead>
            <tr className="bg-surface">
              <th scope="col" className="px-2 py-2 text-left text-label text-muted-foreground">
                IV \ Spot
              </th>
              {SCENARIO_SPOT_PCTS.map((pct) => (
                <th key={pct} scope="col" className={cn("px-2 py-2 text-right text-label", pct === 0 ? "text-foreground" : "text-muted-foreground")}>
                  {pct === 0 ? "Spot" : formatPct(pct * 100, { decimals: 0, signed: true })}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {SCENARIO_IV_SHIFTS.map((shift, i) => (
              <tr key={shift} className="border-t border-separator">
                <th scope="row" className="whitespace-nowrap bg-surface px-2 py-2 text-left text-label text-muted-foreground">
                  {shift === 0 ? "IV now" : `IV ${shift > 0 ? "+" : "−"}${Math.abs(shift * 100)} pts`}
                </th>
                {SCENARIO_SPOT_PCTS.map((pct, j) => {
                  const v = grid[i]?.[j] ?? NaN;
                  const isNow = shift === 0 && pct === 0 && days === 0;
                  return (
                    <td
                      key={pct}
                      className={cn("px-2 py-2 text-right", signedClass(v), isNow && "font-semibold outline outline-2 -outline-offset-2 outline-primary")}
                      style={cellStyle(v, maxAbs)}
                      title={`Change vs now: ${signedINR(v - base)}`}
                    >
                      {signedINR(v)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {symbols.length > 0 ? (
        <p className="text-body-sm text-muted-foreground">
          Base spots:{" "}
          {symbols.map((s, k) => (
            <span key={s}>
              {k ? " · " : ""}
              {s} {spots[s].toLocaleString("en-IN", { maximumFractionDigits: 2 })}
            </span>
          ))}
        </p>
      ) : null}
    </div>
  );
}
