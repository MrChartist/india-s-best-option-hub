/** Portfolio risk tiles and the per-underlying Greeks / beta-weighted delta table. */
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCompactIN, formatINR, formatNumberIN } from "@/lib/options";
import { cn } from "@/lib/utils";
import type { PortfolioSummary } from "./analytics";
import { signedClass, signedINR, type QuoteSource } from "./helpers";
import type { BetaInfo } from "./useBetas";
import { HelpTip, SourceBadge, Stat } from "./ui";

const lotsText = (v: number) => (Number.isFinite(v) ? `${v > 0 ? "+" : v < 0 ? "−" : ""}${formatNumberIN(Math.abs(v), 2)}` : "—");

export function PortfolioTiles({ summary, closedNet }: { summary: PortfolioSummary; closedNet: number }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-8">
      <Stat
        label="Net MTM"
        value={signedINR(summary.netPnl)}
        tone={summary.netPnl > 0 ? "bullish" : summary.netPnl < 0 ? "bearish" : "muted"}
        sub={`gross ${signedINR(summary.grossPnl)}`}
        help="Open P&L after deducting entry charges and the charges for squaring off at the current price."
        className="col-span-2 sm:col-span-1"
      />
      <Stat label="Realised" value={signedINR(closedNet)} tone={closedNet > 0 ? "bullish" : closedNet < 0 ? "bearish" : "muted"} sub="closed, net of charges" />
      <Stat
        label="Theta"
        value={`${signedINR(summary.theta)}`}
        sub="per calendar day"
        tone={summary.theta > 0 ? "bullish" : summary.theta < 0 ? "bearish" : "muted"}
        help="Rupees gained (+) or lost (−) per calendar day from time decay if spot and IV stay where they are."
      />
      <Stat label="Vega" value={signedINR(summary.vega)} sub="per 1 vol point" help="Rupee change for a one-point rise in implied volatility across every leg." />
      <Stat
        label="Γ P&L, 1% move"
        value={signedINR(summary.gammaPnl1pct)}
        tone={summary.gammaPnl1pct > 0 ? "bullish" : summary.gammaPnl1pct < 0 ? "bearish" : "muted"}
        sub={summary.gammaPnl1pct < 0 ? "short gamma" : summary.gammaPnl1pct > 0 ? "long gamma" : "flat gamma"}
        help={
          <>
            Rupees made (+) or lost (−) from gamma alone if every underlying moves 1% either way: ½ · Γ · (1% of spot)² · qty, summed across legs. Delta P&L comes on top.
            <span className="mt-1.5 block">
              Notional gamma: your rupee delta changes by <strong className="font-num">{signedINR(summary.gamma1pct)}</strong> for a 1% move.
            </span>
          </>
        }
      />
      <Stat
        label="NIFTY Δ (β-wtd)"
        value={`${lotsText(summary.niftyLots)} lots`}
        tone={Math.abs(summary.niftyLots) >= 1 ? "warning" : undefined}
        sub={Number.isFinite(summary.niftyDeltaUnits) ? `${formatNumberIN(summary.niftyDeltaUnits, 0)} NIFTY units` : undefined}
        help="Every underlying's delta converted to NIFTY lots: Δ × spot × β ÷ NIFTY spot ÷ NIFTY lot size. β uses one year of daily returns."
      />
      <Stat label="Margin used" value={formatCompactIN(summary.margin, { symbol: true })} sub="SPAN-style estimate" help="Approximate SPAN + exposure margin for the open legs (16 scenarios, hedge benefit included). Your broker's figure will differ." />
      <Stat
        label="Capital at risk"
        value={summary.unlimitedRisk ? "Unlimited" : formatCompactIN(summary.capitalAtRisk, { symbol: true })}
        tone={summary.unlimitedRisk ? "bearish" : undefined}
        sub={summary.unlimitedRisk ? "naked short leg" : "worst case at expiry"}
        help="The most you can lose at expiry for defined-risk structures. A naked short option has no cap; size it by margin and a stop instead."
      />
    </div>
  );
}

export function UnderlyingGreeksTable({
  summary,
  betas,
  spotSources,
}: {
  summary: PortfolioSummary;
  betas: Record<string, BetaInfo>;
  spotSources: Record<string, { source: QuoteSource; asOf?: number }>;
}) {
  return (
    <Table className="min-w-[920px]">
      <TableHeader>
        <TableRow>
          <TableHead className="sticky left-0 z-10 bg-surface">Underlying</TableHead>
          <TableHead className="text-right">Spot</TableHead>
          <TableHead className="text-right">Δ lots</TableHead>
          <TableHead className="text-right">
            <span className="inline-flex items-center gap-1">
              β <HelpTip text="Beta to NIFTY from one year of daily log returns, cached for a day. Marked 'assumed' (1.0) when history is unavailable." />
            </span>
          </TableHead>
          <TableHead className="text-right">NIFTY lots</TableHead>
          <TableHead className="text-right">
            <span className="inline-flex items-center gap-1">
              Hedge <HelpTip text="Futures lots that would flatten delta: −Δ ÷ lot size. Positive = buy futures, negative = sell." />
            </span>
          </TableHead>
          <TableHead className="text-right">θ ₹/day</TableHead>
          <TableHead className="text-right">Vega ₹/pt</TableHead>
          <TableHead className="text-right">
            <span className="inline-flex items-center gap-1">
              Γ P&L 1% <HelpTip text="Gamma P&L for a 1% move: ½ · Γ · (1% of spot)² · qty. Hover a value for the notional figure (change in rupee delta for a 1% move)." />
            </span>
          </TableHead>
          <TableHead className="text-right">Margin</TableHead>
          <TableHead className="text-right">At risk</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {summary.underlyings.map((u) => {
          const b = betas[u.symbol];
          const src = spotSources[u.symbol];
          return (
            <TableRow key={u.symbol}>
              <TableCell className="sticky left-0 z-[1] bg-card font-semibold">
                {u.symbol}
                <span className="ml-1.5 text-micro text-muted-foreground">
                  {u.positions} leg{u.positions === 1 ? "" : "s"}
                </span>
              </TableCell>
              <TableCell className="text-right tabular-nums">
                <div className="flex items-center justify-end gap-1.5">
                  {Number.isFinite(u.spot) ? formatNumberIN(u.spot, 2) : "—"}
                  {src ? <SourceBadge source={src.source} asOf={src.asOf} /> : null}
                </div>
              </TableCell>
              <TableCell className={cn("text-right tabular-nums", signedClass(u.deltaLots))}>{lotsText(u.deltaLots)}</TableCell>
              <TableCell className="text-right tabular-nums">
                {formatNumberIN(u.beta, 2)}
                {b?.basis === "assumed" ? (
                  <Badge variant="neutral" className="ml-1">
                    {b.loading ? "…" : "assumed"}
                  </Badge>
                ) : null}
              </TableCell>
              <TableCell className={cn("text-right tabular-nums", signedClass(u.niftyLots))}>{lotsText(u.niftyLots)}</TableCell>
              <TableCell className="text-right tabular-nums">{Number.isFinite(u.hedgeFutLots) && Math.abs(u.hedgeFutLots) >= 0.05 ? `${u.hedgeFutLots > 0 ? "Buy" : "Sell"} ${formatNumberIN(Math.abs(u.hedgeFutLots), 2)}` : "—"}</TableCell>
              <TableCell className={cn("text-right tabular-nums", signedClass(u.theta))}>{signedINR(u.theta)}</TableCell>
              <TableCell className={cn("text-right tabular-nums", signedClass(u.vega))}>{signedINR(u.vega)}</TableCell>
              <TableCell className={cn("text-right tabular-nums", signedClass(u.gammaPnl1pct))} title={`Notional: ₹ delta changes by ${signedINR(u.gamma1pct)} for a 1% move`}>
                {signedINR(u.gammaPnl1pct)}
              </TableCell>
              <TableCell className="text-right tabular-nums">{u.margin ? formatINR(u.margin.total, { decimals: 0 }) : "—"}</TableCell>
              <TableCell className={cn("text-right tabular-nums", u.unlimitedRisk && "text-bearish")}>{u.unlimitedRisk ? "Unlimited" : formatINR(u.capitalAtRisk, { decimals: 0 })}</TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
