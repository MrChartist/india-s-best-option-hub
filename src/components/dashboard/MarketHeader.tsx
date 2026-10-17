/**
 * Dashboard title row: IST date, data source health, density toggle and the layout customiser.
 * Session state, the live feed pill and the clock live in the global header, so they are not repeated here.
 */
import type { ReactNode } from "react";
import { formatDateIST, nowIST } from "@/lib/options";
import { cn } from "@/lib/utils";
import type { Density } from "./dashboardModel";
import { DataSourcesBar } from "./DataSourcesBar";
import { useNow } from "./useNow";

const WEEKDAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

interface Props {
  density: Density;
  onDensity: (d: Density) => void;
  /** Extra controls (the customiser). */
  children?: ReactNode;
}

export function MarketHeader({ density, onDensity, children }: Props) {
  const now = useNow(60_000);
  const ist = nowIST(now);
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <h1 className="font-display text-title font-extrabold tracking-tight text-foreground">Market dashboard</h1>
        <p className="text-body-sm text-muted-foreground">
          <time dateTime={ist.date}>
            {WEEKDAY[ist.weekday]}, {formatDateIST(ist.date)}
          </time>{" "}
          · IST
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <DataSourcesBar />
        <div
          role="radiogroup"
          aria-label="Density"
          className="inline-flex h-8 items-center rounded-capsule border border-border bg-muted p-0.5"
          onKeyDown={(e) => {
            if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) return;
            e.preventDefault();
            const group = e.currentTarget;
            const next: Density = density === "compact" ? "comfortable" : "compact";
            onDensity(next);
            requestAnimationFrame(() => group.querySelector<HTMLButtonElement>(`[data-density="${next}"]`)?.focus());
          }}
        >
          {(["comfortable", "compact"] as const).map((d) => (
            <button
              key={d}
              type="button"
              role="radio"
              data-density={d}
              aria-checked={density === d}
              tabIndex={density === d ? 0 : -1}
              onClick={() => onDensity(d)}
              className={cn(
                "h-7 rounded-capsule px-2.5 text-body-sm font-medium capitalize transition-colors focus-visible:shadow-ember focus-visible:outline-none",
                density === d ? "bg-card text-foreground shadow-card" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {d}
            </button>
          ))}
        </div>
        {children}
      </div>
    </div>
  );
}

export default MarketHeader;
