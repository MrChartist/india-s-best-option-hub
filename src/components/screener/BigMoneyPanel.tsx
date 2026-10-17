import { useMemo, useState } from "react";
import { Landmark, TrendingUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { formatCompactIN, formatDateIST, formatINR, formatNumberIN } from "@/lib/options";
import { OI_JUMP_PCT, dealValue, oiJumps, summariseDeals, type DealRow } from "@/lib/screener/bigMoney";
import type { FeedMeta } from "@/lib/screener/banList";
import type { ScreenerRow } from "@/lib/screener/metrics";
import { useDeals } from "@/lib/screener/useScreener";
import { cn } from "@/lib/utils";
import { BuildupBadge, EmptyState, FeedBadge, PanelHeader, SampleBadge, Signed } from "./ScreenerUi";

function DealsTable({ deals, fnoSet }: { deals: DealRow[]; fnoSet: Set<string> }) {
  const sorted = useMemo(() => [...deals].sort((a, b) => dealValue(b) - dealValue(a)).slice(0, 30), [deals]);
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-body-sm">
        <caption className="sr-only">Deals sorted by value</caption>
        <thead>
          <tr className="border-y border-border bg-muted/40 text-label uppercase text-muted-foreground">
            <th scope="col" className="px-4 py-2 text-left">Symbol</th>
            <th scope="col" className="px-2 py-2 text-left">Client</th>
            <th scope="col" className="px-2 py-2 text-left">Side</th>
            <th scope="col" className="px-2 py-2 text-right">Qty</th>
            <th scope="col" className="px-2 py-2 text-right">Price</th>
            <th scope="col" className="px-4 py-2 text-right">Value</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((d, i) => (
            <tr key={`${d.symbol}-${d.client}-${i}`} className="border-b border-border/60">
              <th scope="row" className="px-4 py-1.5 text-left font-semibold">
                {d.symbol}
                {fnoSet.has(d.symbol) ? <span className="ml-1.5 rounded-chip bg-wash-brand px-1 text-micro uppercase text-primary-ink">F&amp;O</span> : null}
                {d.date ? <div className="text-micro font-normal text-muted-foreground">{formatDateIST(d.date)}</div> : null}
              </th>
              <td className="max-w-[220px] truncate px-2" title={d.client}>
                {d.client || "—"}
              </td>
              <td className="px-2">
                <Badge variant={d.side === "BUY" ? "bullish" : "bearish"}>{d.side === "BUY" ? "Buy" : "Sell"}</Badge>
              </td>
              <td className="px-2 text-right font-num tabular-nums">{formatNumberIN(d.qty)}</td>
              <td className="px-2 text-right font-num tabular-nums">{formatINR(d.price, { decimals: 2 })}</td>
              <td className="px-4 text-right font-num font-semibold tabular-nums">{formatCompactIN(dealValue(d), { decimals: 2, symbol: true })}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function BigMoneyPanel({ rows, isSample, spurtsMeta }: { rows: ScreenerRow[]; isSample: boolean; spurtsMeta: FeedMeta | null }) {
  const [kind, setKind] = useState<"bulk" | "block">("block");
  const bulk = useDeals("bulk");
  const block = useDeals("block");
  const active = kind === "bulk" ? bulk : block;
  const deals = useMemo(() => active.data?.data ?? [], [active.data]);
  const summary = useMemo(() => summariseDeals(deals).slice(0, 6), [deals]);
  const jumps = useMemo(() => oiJumps(rows), [rows]);
  const fnoSet = useMemo(() => new Set(rows.map((r) => r.symbol)), [rows]);
  const rowMap = useMemo(() => new Map(rows.map((r) => [r.symbol, r])), [rows]);

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
      <Card>
        <PanelHeader
          title="Bulk and block deals"
          icon={<Landmark className="h-4 w-4 text-primary-ink" aria-hidden="true" />}
          help="Exchange-reported large trades in the cash market. Block deals go through the separate block window (minimum ₹10 crore); bulk deals are trades above 0.5% of a company's shares. Client names are as published by NSE."
        >
          <FeedBadge meta={active.data?.meta} eod />
          <ToggleGroup type="single" value={kind} onValueChange={(v) => v && setKind(v as "bulk" | "block")} size="sm" aria-label="Deal type">
            <ToggleGroupItem value="block">Block</ToggleGroupItem>
            <ToggleGroupItem value="bulk">Bulk</ToggleGroupItem>
          </ToggleGroup>
        </PanelHeader>
        {active.isLoading ? (
          <div className="space-y-2 p-4" aria-busy="true">
            {Array.from({ length: 5 }, (_, i) => (
              <div key={i} className="h-7 animate-pulse rounded-md bg-muted" />
            ))}
          </div>
        ) : deals.length === 0 ? (
          <EmptyState title={`No ${kind} deals reported`} body="NSE has not published any for the latest session yet." />
        ) : (
          <>
            {summary.length > 0 ? (
              <div className="flex flex-wrap gap-2 px-4 py-3" aria-label="Net value by symbol">
                {summary.map((s) => (
                  <div key={s.symbol} className="rounded-tile border border-border px-2.5 py-1.5">
                    <p className="text-label uppercase text-muted-foreground">{s.symbol}</p>
                    <p className={cn("font-num text-body font-semibold tabular-nums", s.net >= 0 ? "text-bullish" : "text-bearish")}>
                      {s.net >= 0 ? "Net buy " : "Net sell "}
                      {formatCompactIN(Math.abs(s.net), { decimals: 1, symbol: true })}
                    </p>
                  </div>
                ))}
              </div>
            ) : null}
            <DealsTable deals={deals} fnoSet={fnoSet} />
          </>
        )}
      </Card>

      <Card>
        <PanelHeader
          title={`Futures OI jumps > ${OI_JUMP_PCT}%`}
          icon={<TrendingUp className="h-4 w-4 text-primary-ink" aria-hidden="true" />}
          help="Underlyings whose futures open interest rose more than 10% (end-of-day futures rows once scanned, NSE OI spurts during the day). A jump with price up is fresh longs; with price down, fresh shorts."
        >
          {isSample ? <SampleBadge /> : <FeedBadge meta={spurtsMeta} label="OI spurts" />}
        </PanelHeader>
        {jumps.length === 0 ? (
          <EmptyState title="No OI jump above 10%" body="Nothing has crossed the threshold in the data received so far." />
        ) : (
          <ul className="divide-y divide-border/60">
            {jumps.slice(0, 20).map((j) => {
              const r = rowMap.get(j.symbol);
              return (
                <li key={j.symbol} className="flex items-center gap-3 px-4 py-2 text-body-sm">
                  <span className="w-28 font-semibold">{j.symbol}</span>
                  <span className="w-16 text-right">
                    <Signed value={j.oiChangePct} decimals={1} />
                  </span>
                  <span className="w-14 text-right">
                    <Signed value={j.changePct} />
                  </span>
                  <span className="ml-auto">{r ? <BuildupBadge buildup={r.buildup} short /> : null}</span>
                </li>
              );
            })}
          </ul>
        )}
        <p className="border-t border-border px-4 py-2 text-micro text-muted-foreground">OI change · price change · buildup</p>
      </Card>
    </div>
  );
}
