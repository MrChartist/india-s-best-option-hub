import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowDown, ArrowUp, ArrowUpDown, Ban, Clock, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatCompactIN, formatNumberIN } from "@/lib/options";
import type { SortDir, SortKey } from "@/lib/screener/filters";
import type { ScreenerRow } from "@/lib/screener/metrics";
import { cn } from "@/lib/utils";
import { BuildupBadge, EmptyState, MwplMeter, Signed } from "./ScreenerUi";

interface Column {
  key: SortKey;
  label: string;
  title: string;
  align?: "left" | "right";
  className?: string;
}

const COLUMNS: readonly Column[] = [
  { key: "symbol", label: "Symbol", title: "Underlying symbol and sector", align: "left" },
  { key: "ltp", label: "LTP", title: "Last traded price of the underlying (₹)" },
  { key: "changePct", label: "Chg %", title: "Day change in the underlying" },
  { key: "oiChangePct", label: "Fut OI %", title: "Change in futures open interest (EOD bhavcopy, or NSE OI spurts during the day)" },
  { key: "buildup", label: "Buildup", title: "Price and OI direction: long buildup, short buildup, short covering, long unwinding", align: "left" },
  { key: "atmIv", label: "ATM IV", title: "Near-expiry at-the-money implied volatility (Black-76 on the parity forward)" },
  { key: "ivp", label: "IVP", title: "IV percentile against recorded end-of-day ATM IV (needs 20 recorded days)" },
  { key: "ivHvRatio", label: "IV/HV", title: "ATM IV ÷ 20-day historical volatility" },
  { key: "pcrOi", label: "PCR", title: "Put OI ÷ call OI. Clock = older than the refresh window; EOD = end-of-day bhavcopy" },
  { key: "volRatio", label: "Vol ×5d", title: "Today's volume ÷ the previous 5-session average" },
  { key: "mwplStatus", label: "MWPL", title: "Combined OI as % of market-wide position limit. Ban at 95%, exit below 80%", align: "left" },
  { key: "carryPct", label: "Carry", title: "Annualised cost of carry from the near-month future (EOD)" },
  { key: "rolloverPct", label: "Rollover", title: "Share of futures OI in next and far months (EOD)" },
];

const PAGE = 50;

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) return <ArrowUpDown className="h-3 w-3 opacity-40" aria-hidden="true" />;
  return dir === "asc" ? <ArrowUp className="h-3 w-3" aria-hidden="true" /> : <ArrowDown className="h-3 w-3" aria-hidden="true" />;
}

function num(v: number | null, dp = 2, suffix = "") {
  if (v === null || !Number.isFinite(v)) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="font-num tabular-nums">
      {formatNumberIN(v, dp)}
      {suffix}
    </span>
  );
}

function PcrCell({ row, scanning }: { row: ScreenerRow; scanning: boolean }) {
  if (row.pcrOi === null) {
    return scanning ? (
      <Loader2 className="ml-auto h-3.5 w-3.5 animate-spin text-muted-foreground" aria-label="Scanning" />
    ) : (
      <span className="text-muted-foreground" title="Not scanned yet">—</span>
    );
  }
  const tone = row.pcrOi >= 1.2 ? "text-bullish" : row.pcrOi <= 0.7 ? "text-bearish" : "";
  return (
    <span className="inline-flex items-center justify-end gap-1">
      {row.chainStale ? <Clock className="h-3 w-3 text-muted-foreground" aria-label="Stale: older than the refresh window" /> : null}
      {row.pcrSource === "eod" ? <span className="text-micro uppercase text-muted-foreground">EOD</span> : null}
      <span className={cn("font-num tabular-nums", tone)}>{row.pcrOi.toFixed(2)}</span>
    </span>
  );
}

export interface ScreenerTableProps {
  rows: ScreenerRow[];
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (key: SortKey) => void;
  scanningSymbol: string | null;
  onClearFilters?: () => void;
  isLoading?: boolean;
}

export function ScreenerTable({ rows, sortKey, sortDir, onSort, scanningSymbol, onClearFilters, isLoading }: ScreenerTableProps) {
  const [limit, setLimit] = useState(PAGE);
  useEffect(() => setLimit(PAGE), [sortKey, sortDir, rows.length]);

  if (isLoading) {
    return (
      <div className="space-y-2 p-4" aria-busy="true" aria-label="Loading screener">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="h-8 animate-pulse rounded-md bg-muted" />
        ))}
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <EmptyState
        title="No stocks match these filters"
        body="Loosen a rule or pick another preset. Metrics that are still being scanned count as not matching."
        action={onClearFilters ? <Button variant="outline" size="sm" onClick={onClearFilters}>Clear filters</Button> : undefined}
      />
    );
  }

  const shown = rows.slice(0, limit);
  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1100px] border-collapse text-body-sm">
          <caption className="sr-only">F&amp;O screener results, {rows.length} rows. Use the column buttons to sort.</caption>
          <thead>
            <tr className="border-b border-border bg-muted/40">
              {COLUMNS.map((c, i) => {
                const active = sortKey === c.key;
                return (
                  <th
                    key={c.key}
                    scope="col"
                    aria-sort={active ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
                    className={cn(
                      "whitespace-nowrap px-2 py-2 text-label uppercase text-muted-foreground",
                      c.align === "left" ? "text-left" : "text-right",
                      i === 0 && "sticky left-0 z-10 bg-card pl-4",
                    )}
                  >
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          onClick={() => onSort(c.key)}
                          className={cn(
                            "inline-flex items-center gap-1 rounded-chip px-1 py-0.5 uppercase hover:text-foreground focus-visible:shadow-ember focus-visible:outline-none",
                            active && "text-foreground",
                          )}
                        >
                          {c.label}
                          <SortIcon active={active} dir={sortDir} />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-[260px] text-xs normal-case">{c.title}</TooltipContent>
                    </Tooltip>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const scanning = scanningSymbol === r.symbol;
              return (
                <tr key={r.symbol} className={cn("group border-b border-border/60 transition-colors duration-fast hover:bg-accent/50", r.banned && "bg-wash-loss/40")}>
                  <th scope="row" className="sticky left-0 z-10 bg-card py-1.5 pl-4 pr-2 text-left font-normal group-hover:bg-accent/50">
                    <div className="flex items-center gap-1.5">
                      <Link
                        to={`/option-chain?symbol=${encodeURIComponent(r.symbol)}`}
                        className="rounded-chip font-semibold text-foreground hover:text-primary-ink focus-visible:shadow-ember focus-visible:outline-none"
                        title={`Open ${r.symbol} option chain`}
                      >
                        {r.symbol}
                      </Link>
                      {r.banned ? (
                        <span className="inline-flex items-center gap-0.5 rounded-chip bg-wash-loss px-1 text-micro uppercase text-bearish" title="In F&O ban period">
                          <Ban className="h-2.5 w-2.5" aria-hidden="true" />
                          Ban
                        </span>
                      ) : null}
                      {scanning ? <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" aria-label={`Scanning ${r.symbol}`} /> : null}
                    </div>
                    <div className="max-w-[140px] truncate text-micro normal-case tracking-normal text-muted-foreground">{r.kind === "INDEX" ? "Index" : r.sector}</div>
                  </th>
                  <td className="px-2 text-right">{num(r.ltp, 2)}</td>
                  <td className="px-2 text-right">
                    <Signed value={r.changePct} />
                  </td>
                  <td className="px-2 text-right" title={r.oiSource === "oi-spurts" ? "From NSE OI spurts (all F&O contracts)" : r.oiSource === "futures-eod" ? "From the futures rows of the EOD bhavcopy" : undefined}>
                    <Signed value={r.oiChangePct} />
                  </td>
                  <td className="px-2">
                    {r.oiChangePct === null ? <span className="text-muted-foreground">—</span> : <BuildupBadge buildup={r.buildup} short />}
                  </td>
                  <td className="px-2 text-right">{num(r.atmIv, 1, "%")}</td>
                  <td className="px-2 text-right">{r.ivp === null ? <span className="text-muted-foreground" title="Needs 20 recorded days of ATM IV">—</span> : num(r.ivp, 0)}</td>
                  <td className={cn("px-2 text-right", r.ivHvRatio !== null && r.ivHvRatio >= 1.3 && "text-warning", r.ivHvRatio !== null && r.ivHvRatio < 1 && "text-info")}>
                    {r.ivHvRatio === null ? <span className="text-muted-foreground">—</span> : <span className="font-num tabular-nums">{r.ivHvRatio.toFixed(2)}×</span>}
                  </td>
                  <td className="px-2 text-right">
                    <PcrCell row={r} scanning={scanning} />
                  </td>
                  <td className={cn("px-2 text-right", r.volRatio !== null && r.volRatio >= 3 && "font-semibold text-primary-ink")}>
                    {r.volRatio === null ? <span className="text-muted-foreground">—</span> : <span className="font-num tabular-nums">{r.volRatio.toFixed(1)}×</span>}
                    {r.volume > 0 ? <div className="text-micro text-muted-foreground">{formatCompactIN(r.volume, { decimals: 1 })}</div> : null}
                  </td>
                  <td className="px-2">{r.kind === "INDEX" ? <span className="text-muted-foreground">n/a</span> : <MwplMeter pct={r.mwplPct} status={r.mwplStatus} banned={r.banned} />}</td>
                  <td className="px-2 text-right">
                    <Signed value={r.carryPct} decimals={1} />
                  </td>
                  <td className="px-2 pr-4 text-right">{num(r.rolloverPct, 0, "%")}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-2 text-body-sm text-muted-foreground">
        <span>
          Showing {shown.length} of {rows.length}
        </span>
        {rows.length > shown.length ? (
          <Button variant="outline" size="sm" onClick={() => setLimit((l) => l + PAGE)}>
            Show {Math.min(PAGE, rows.length - shown.length)} more
          </Button>
        ) : null}
      </div>
    </div>
  );
}
