/** NIFTY (Tuesday) vs SENSEX (Thursday) weekly expiries side by side. */
import { useMemo } from "react";
import { Scale } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useLiveOptionChain } from "@/hooks/useMarketData";
import { dteLabel, formatDateIST, formatINR, formatPct, getExpiries, getMarketParams, type MarketSession } from "@/lib/options";
import { cn } from "@/lib/utils";
import { expiryMetrics, expiryWeekday, type ExpiryMetrics } from "./expiryMath";
import { HelpTip, Panel, SampleBadge } from "./ExpiryUi";
import { useNow } from "./useExpirySession";

const PAIR = ["NIFTY", "SENSEX"] as const;

interface ColumnData {
  symbol: string;
  expiry: string;
  metrics: ExpiryMetrics;
  lotSize: number;
  source: string;
  stale: boolean;
  loading: boolean;
}

function useColumn(symbol: string, now: Date): ColumnData {
  const expiry = useMemo(() => getExpiries(symbol, now, 1)[0]?.date ?? "", [symbol, now]);
  const q = useLiveOptionChain(symbol, expiry || undefined);
  const d = q.data;
  const { r } = getMarketParams();
  const minute = Math.floor(now.getTime() / 60_000);
  const metrics = useMemo(
    () => expiryMetrics(d?.chain ?? [], { spot: d?.spotPrice ?? NaN, expiry: expiry || d?.expiry || "", now: new Date(minute * 60_000), r }),
    [d?.chain, d?.spotPrice, d?.expiry, expiry, minute, r],
  );
  return { symbol, expiry: expiry || d?.expiry || "", metrics, lotSize: d?.lotSize ?? NaN, source: d?.source ?? "none", stale: !!d?.stale, loading: q.isLoading };
}

export function WeeklyCompare({ session }: { session?: MarketSession }) {
  const now = useNow(60_000);
  const nifty = useColumn(PAIR[0], now);
  const sensex = useColumn(PAIR[1], now);
  const cols = [nifty, sensex];

  const rows: Array<{ label: string; help?: string; get: (c: ColumnData) => string; num?: (c: ColumnData) => number }> = [
    { label: "Expiry", get: (c) => (c.expiry ? `${expiryWeekday(c.expiry).slice(0, 3)}, ${formatDateIST(c.expiry)}` : "—") },
    { label: "Time left", get: (c) => (c.expiry ? dteLabel(c.expiry, now) : "—") },
    { label: "Spot", get: (c) => (Number.isFinite(c.metrics.spot) ? c.metrics.spot.toFixed(2) : "—") },
    { label: "ATM strike", get: (c) => (Number.isFinite(c.metrics.strike) ? String(c.metrics.strike) : "—") },
    { label: "ATM straddle", get: (c) => formatINR(c.metrics.straddle) },
    { label: "Straddle per lot", get: (c) => (c.lotSize > 0 ? `${formatINR(c.metrics.straddle * c.lotSize, { decimals: 0 })} (${c.lotSize})` : "—") },
    { label: "Straddle % of spot", help: "Straddle premium as a share of spot: the market's price for the whole move to expiry.", get: (c) => formatPct(c.metrics.straddlePct, { decimals: 2 }), num: (c) => c.metrics.straddlePct },
    { label: "ATM IV", get: (c) => formatPct(c.metrics.atmIv, { decimals: 1 }), num: (c) => c.metrics.atmIv },
    { label: "Expected move", help: "0.85 × straddle: the typical (mean absolute) move the straddle prices in by expiry.", get: (c) => (Number.isFinite(c.metrics.emStraddle) ? `±${c.metrics.emStraddle.toFixed(0)} (${formatPct(c.metrics.emStraddlePct, { decimals: 2 })})` : "—") },
    { label: "1σ to expiry (IV)", get: (c) => (Number.isFinite(c.metrics.emIv) ? `±${c.metrics.emIv.toFixed(0)}` : "—") },
    { label: "Implied daily move", help: "ATM IV ÷ √252: a one-day 1σ move in %. This puts both indices on the same footing even when their expiries are days apart.", get: (c) => formatPct(c.metrics.dailyMovePct, { decimals: 2 }), num: (c) => c.metrics.dailyMovePct },
  ];

  const anySample = cols.some((c) => c.source === "sample");
  const loading = cols.some((c) => c.loading);

  return (
    <Panel
      title={
        <>
          <Scale className="h-4 w-4 text-primary-ink" aria-hidden="true" />
          NIFTY Tuesday vs SENSEX Thursday
          {anySample ? <SampleBadge /> : null}
        </>
      }
      subtitle="The two weekly index expiries, nearest contract each"
    >
      {loading ? (
        <div className="space-y-2" role="status" aria-busy="true" aria-label="Loading comparison">
          {["a", "b", "c", "d", "e", "f"].map((k) => (
            <Skeleton key={k} className="h-6 w-full" />
          ))}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Metric</TableHead>
                {cols.map((c) => (
                  <TableHead key={c.symbol} scope="col" className="text-right">
                    <span className="inline-flex items-center gap-1.5">
                      {c.symbol}
                      {c.source === "sample" ? <Badge variant="warning">Sample</Badge> : c.stale || session !== "open" ? <Badge variant="neutral">Last</Badge> : <Badge variant="bullish">Live</Badge>}
                    </span>
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const vals = row.num ? cols.map((c) => row.num!(c)) : [];
                const hi = vals.length === 2 && vals.every(Number.isFinite) && vals[0] !== vals[1] ? (vals[0] > vals[1] ? 0 : 1) : -1;
                return (
                  <TableRow key={row.label}>
                    <TableHead scope="row" className="font-normal text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        {row.label}
                        {row.help ? <HelpTip text={row.help} label={`About ${row.label}`} /> : null}
                      </span>
                    </TableHead>
                    {cols.map((c, i) => (
                      <TableCell key={c.symbol} className={cn("text-right font-num tabular-nums", hi === i ? "font-semibold text-primary-ink" : "")}>
                        {row.get(c)}
                      </TableCell>
                    ))}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          <p className="mt-2 text-body-sm text-muted-foreground">
            The higher value in each comparable row is highlighted. Straddle % depends on days left, so compare the implied daily move when the expiries are on different days. {anySample ? "Sample rows are simulated, not market data." : ""}
          </p>
        </div>
      )}
    </Panel>
  );
}
