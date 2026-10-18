/** Daily realised P&L heatmap (net of charges), one month at a time, weeks starting Monday (IST dates). */
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatCompactIN, istDateString } from "@/lib/options";
import { cn } from "@/lib/utils";
import { signedClass, signedINR } from "@/components/positions/helpers";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Cells for a month grid: leading blanks so the 1st lands on its weekday (Mon = 0). */
function monthCells(year: number, month: number): Array<{ key: string; date: string | null }> {
  const first = new Date(Date.UTC(year, month, 1)).getUTCDay(); // 0 = Sun
  const lead = (first + 6) % 7;
  const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const cells: Array<{ key: string; date: string | null }> = Array.from({ length: lead }, (_, k) => ({ key: `lead-${k}`, date: null }));
  for (let d = 1; d <= days; d++) {
    const date = `${year}-${pad(month + 1)}-${pad(d)}`;
    cells.push({ key: date, date });
  }
  let tail = 0;
  while (cells.length % 7) cells.push({ key: `tail-${tail++}`, date: null });
  return cells;
}

function tint(v: number, maxAbs: number): CSSProperties {
  if (!Number.isFinite(v) || Math.abs(v) < 0.5 || maxAbs <= 0) return {};
  const a = 0.35 + 0.65 * Math.min(1, Math.abs(v) / maxAbs);
  return { backgroundColor: `hsl(var(${v > 0 ? "--wash-profit" : "--wash-loss"}) / ${a.toFixed(3)})` };
}

export function PnLCalendar({ daily, initialMonth, footnote }: { daily: Record<string, number>; /** "yyyy-mm" to open on (default: this month in IST). */ initialMonth?: string; footnote?: string }) {
  const today = istDateString();
  const start = initialMonth && /^\d{4}-\d{2}$/.test(initialMonth) ? initialMonth : today.slice(0, 7);
  const [cursor, setCursor] = useState(() => ({ y: +start.slice(0, 4), m: +start.slice(5, 7) - 1 }));
  useEffect(() => {
    if (initialMonth && /^\d{4}-\d{2}$/.test(initialMonth)) setCursor({ y: +initialMonth.slice(0, 4), m: +initialMonth.slice(5, 7) - 1 });
  }, [initialMonth]);
  const cells = useMemo(() => monthCells(cursor.y, cursor.m), [cursor]);
  const prefix = `${cursor.y}-${pad(cursor.m + 1)}`;
  const monthDays = Object.entries(daily).filter(([d]) => d.startsWith(prefix));
  const total = monthDays.reduce((a, [, v]) => a + v, 0);
  const wins = monthDays.filter(([, v]) => v > 0).length;
  const losses = monthDays.filter(([, v]) => v < 0).length;
  const best = monthDays.reduce((a, [, v]) => Math.max(a, v), 0);
  const worst = monthDays.reduce((a, [, v]) => Math.min(a, v), 0);
  const maxAbs = Math.max(1, ...monthDays.map(([, v]) => Math.abs(v)));
  const allTotal = Object.values(daily).reduce((a, v) => a + v, 0);

  const shift = (k: number) =>
    setCursor((c) => {
      const m = c.m + k;
      return { y: c.y + Math.floor(m / 12), m: ((m % 12) + 12) % 12 };
    });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => shift(-1)} aria-label="Previous month">
            <ChevronLeft />
          </Button>
          <p className="min-w-[150px] text-center font-display text-lead font-semibold" aria-live="polite">
            {MONTHS[cursor.m]} {cursor.y}
          </p>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => shift(1)} aria-label="Next month">
            <ChevronRight />
          </Button>
        </div>
        <dl className="flex flex-wrap gap-x-4 gap-y-1 text-body-sm">
          <div className="flex gap-1">
            <dt className="text-muted-foreground">Month</dt>
            <dd className={cn("font-num font-semibold tabular-nums", signedClass(total))}>{signedINR(total)}</dd>
          </div>
          <div className="flex gap-1">
            <dt className="text-muted-foreground">Days</dt>
            <dd className="font-num tabular-nums">
              <span className="text-bullish">{wins}↑</span> <span className="text-bearish">{losses}↓</span>
            </dd>
          </div>
          <div className="flex gap-1">
            <dt className="text-muted-foreground">Best / worst</dt>
            <dd className="font-num tabular-nums">
              {signedINR(best)} / {signedINR(worst)}
            </dd>
          </div>
          <div className="flex gap-1">
            <dt className="text-muted-foreground">All time</dt>
            <dd className={cn("font-num tabular-nums", signedClass(allTotal))}>{signedINR(allTotal)}</dd>
          </div>
        </dl>
      </div>
      <div className="grid grid-cols-7 gap-1" role="grid" aria-label={`Realised P&L for ${MONTHS[cursor.m]} ${cursor.y}`}>
        {WEEKDAYS.map((d) => (
          <div key={d} role="columnheader" className="pb-1 text-center text-label text-muted-foreground">
            {d}
          </div>
        ))}
        {cells.map(({ key, date: d }) => {
          if (!d) return <div key={key} role="gridcell" aria-hidden="true" />;
          const v = daily[d];
          const has = v !== undefined;
          return (
            <div
              key={d}
              role="gridcell"
              tabIndex={has ? 0 : -1}
              aria-label={`${d}: ${has ? signedINR(v) : "no trades"}`}
              title={has ? `${d}: ${signedINR(v)} net` : d}
              className={cn(
                "flex aspect-square min-h-[44px] flex-col justify-between rounded-chip border border-separator p-1 focus-visible:shadow-focus focus-visible:outline-none sm:aspect-[4/3] sm:p-1.5",
                d === today && "ring-1 ring-primary",
                !has && "bg-surface/40",
              )}
              style={has ? tint(v, maxAbs) : undefined}
            >
              <span className="text-micro text-muted-foreground">{+d.slice(8)}</span>
              {has ? <span className={cn("truncate text-right font-num text-micro font-semibold tabular-nums sm:text-body-sm", signedClass(v))}>{formatCompactIN(v)}</span> : null}
            </div>
          );
        })}
      </div>
      <p className="text-body-sm text-muted-foreground">{footnote ?? "Realised P&L per IST trading day after all charges (entry charges count on the day they are paid). Expiry settlements land on the expiry date."}</p>
    </div>
  );
}
