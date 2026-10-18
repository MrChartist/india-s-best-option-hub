import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft, ChevronRight, Download, ListFilter, TableProperties } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { formatDateIST, formatNumberIN, formatStrike } from "@/lib/options";
import { printsToCSV, type FlowPrint } from "@/lib/flow";
import { contractPath } from "@/lib/history/contractSeries";
import { cn } from "@/lib/utils";
import { downloadText, istFileStamp } from "@/lib/download";
import { EmptyState } from "./FlowUi";
import { chainHref, fmtRs, hhmm, signClass } from "./format";

const PAGE_SIZE = 50;

function SideBadge({ p }: { p: FlowPrint }) {
  const variant = p.aggressor === "ASK" ? "bullish" : p.aggressor === "BID" ? "bearish" : "neutral";
  const label = p.aggressor === "ASK" ? "Ask" : p.aggressor === "BID" ? "Bid" : "Mid";
  const basis =
    p.aggressorBasis === "tick"
      ? "Inferred from the price change (no usable bid/ask)"
      : p.aggressorBasis === "none"
        ? "No quote or price change to infer the side"
        : "Position of LTP inside the bid/ask";
  return (
    <Badge variant={variant} title={basis}>
      {label}
      {p.aggressorBasis === "tick" ? <span aria-label="tick test">*</span> : null}
    </Badge>
  );
}

function TagBadge({ tag }: { tag: FlowPrint["tag"] }) {
  if (tag === "OPENING") return <Badge variant="info">Opening</Badge>;
  if (tag === "CLOSING") return <Badge variant="warning">Closing</Badge>;
  return <Badge variant="neutral">Churn</Badge>;
}

const linkCls = "rounded-chip underline-offset-4 hover:underline focus-visible:shadow-ember focus-visible:outline-none";

function ChainLink({ p, compact = false }: { p: FlowPrint; compact?: boolean }) {
  return (
    <Link
      to={chainHref(p)}
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap text-body-sm font-semibold text-primary-ink",
        linkCls,
      )}
      aria-label={`Open ${p.symbol} ${formatStrike(p.strike)} ${formatDateIST(p.expiry)} in the option chain`}
    >
      <TableProperties className="h-3.5 w-3.5" aria-hidden="true" />
      {compact ? "Chain" : "Open in chain"}
    </Link>
  );
}

interface FlowTapeProps {
  prints: FlowPrint[];
  /** Total before filters, to tell "no flow" from "filtered out". */
  totalCount: number;
  isSample: boolean;
  onResetFilters?: () => void;
}

/** Paginated interval-flow tape (newest first). */
export function FlowTape({ prints, totalCount, isSample, onResetFilters }: FlowTapeProps) {
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(prints.length / PAGE_SIZE));
  useEffect(() => {
    if (page > pages - 1) setPage(0);
  }, [page, pages]);
  const rows = useMemo(() => prints.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE), [prints, page]);

  if (totalCount === 0) {
    return (
      <EmptyState icon={<ListFilter className="h-6 w-6" aria-hidden="true" />} title="No flow yet">
        The tape fills as the chain is polled during market hours (09:15 to 15:30 IST). Each row is the change between
        two snapshots, so you need at least two polls with trading in between.
      </EmptyState>
    );
  }
  if (prints.length === 0) {
    return (
      <EmptyState
        icon={<ListFilter className="h-6 w-6" aria-hidden="true" />}
        title="Nothing matches these filters"
        action={
          onResetFilters ? (
            <Button size="sm" variant="outline" onClick={onResetFilters}>
              Reset filters
            </Button>
          ) : undefined
        }
      >
        {formatNumberIN(totalCount)} prints are hidden by the current filters.
      </EmptyState>
    );
  }

  const stamp = istFileStamp();
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {/* Not a live region: the count changes on every chain poll and would chatter at screen-reader users. */}
        <p className="text-body-sm text-muted-foreground">
          {formatNumberIN(prints.length)} print{prints.length === 1 ? "" : "s"}
          {prints.length !== totalCount ? ` of ${formatNumberIN(totalCount)}` : ""} · newest first
          {isSample ? " · sample data" : ""}
        </p>
        <Button
          variant="outline"
          size="pill"
          onClick={() => downloadText(`flow-${isSample ? "sample-" : ""}${stamp}.csv`, printsToCSV(prints))}
        >
          <Download aria-hidden="true" /> CSV
        </Button>
      </div>

      {/* Desktop table */}
      <div className="hairline hidden overflow-hidden rounded-tile md:block">
        <Table className="min-w-[960px] [&_td]:py-1">
          <caption className="sr-only">Derived interval flow prints</caption>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">Time</TableHead>
              <TableHead scope="col">Contract</TableHead>
              <TableHead scope="col">Side</TableHead>
              <TableHead scope="col" className="text-right">
                Premium
              </TableHead>
              <TableHead scope="col" className="text-right">
                Contracts
              </TableHead>
              <TableHead scope="col" className="text-right">
                LTP
              </TableHead>
              <TableHead scope="col" className="text-right">
                Bid × Ask
              </TableHead>
              <TableHead scope="col" className="text-right">
                OI chg
              </TableHead>
              <TableHead scope="col">OI</TableHead>
              <TableHead scope="col" className="text-right">
                DTE
              </TableHead>
              <TableHead scope="col">
                <span className="sr-only">Links</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((p) => (
              <TableRow key={p.id}>
                <TableCell
                  className="whitespace-nowrap tabular-nums text-muted-foreground"
                  title={`Interval ${hhmm(p.fromTs, true)} to ${hhmm(p.ts, true)} IST`}
                >
                  {hhmm(p.ts, true)}
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  <Link
                    to={contractPath(p.symbol, p.expiry, p.strike, p.type)}
                    className={linkCls}
                    title="Contract details"
                  >
                    <span className="font-semibold">{p.symbol}</span>{" "}
                    <span className="tabular-nums">{formatStrike(p.strike)}</span>{" "}
                    <span className={p.type === "CE" ? "text-bullish" : "text-bearish"}>{p.type}</span>
                  </Link>
                  <span className="ml-1.5 text-muted-foreground">{formatDateIST(p.expiry).replace(/ \d{4}$/, "")}</span>
                  <span className="ml-1.5 text-micro text-muted-foreground">{p.moneyness}</span>
                </TableCell>
                <TableCell>
                  <SideBadge p={p} />
                </TableCell>
                <TableCell className="whitespace-nowrap text-right font-semibold tabular-nums">
                  {fmtRs(p.premium)}
                </TableCell>
                <TableCell className="text-right tabular-nums">{formatNumberIN(p.dVol)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatNumberIN(p.ltp, 2)}</TableCell>
                <TableCell className="whitespace-nowrap text-right tabular-nums text-muted-foreground">
                  {p.bid > 0 && p.ask > 0 ? `${formatNumberIN(p.bid, 2)} × ${formatNumberIN(p.ask, 2)}` : "—"}
                </TableCell>
                <TableCell className={cn("text-right tabular-nums", signClass(p.dOI))}>
                  {p.dOI > 0 ? "+" : ""}
                  {formatNumberIN(p.dOI)}
                </TableCell>
                <TableCell>
                  <TagBadge tag={p.tag} />
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {p.dte === 0 ? <Badge variant="default">0DTE</Badge> : p.dte}
                </TableCell>
                <TableCell>
                  <ChainLink p={p} compact />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Mobile cards */}
      <ul className="hairline overflow-hidden rounded-tile md:hidden" aria-label="Derived interval flow prints">
        {rows.map((p) => (
          <li key={p.id} className="border-t border-separator p-3 first:border-t-0">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <Link
                  to={contractPath(p.symbol, p.expiry, p.strike, p.type)}
                  className={cn("block truncate font-semibold", linkCls)}
                  title="Contract details"
                >
                  {p.symbol} <span className="tabular-nums">{formatStrike(p.strike)}</span>{" "}
                  <span className={p.type === "CE" ? "text-bullish" : "text-bearish"}>{p.type}</span>
                </Link>
                <p className="text-body-sm text-muted-foreground">
                  {hhmm(p.ts, true)} · {formatDateIST(p.expiry)} · {p.moneyness} · {p.dte === 0 ? "0DTE" : `${p.dte}d`}
                </p>
              </div>
              <p className="shrink-0 font-num text-lead font-bold tabular-nums">{fmtRs(p.premium)}</p>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-body-sm">
              <SideBadge p={p} />
              <TagBadge tag={p.tag} />
              <span className="tabular-nums text-muted-foreground">
                {formatNumberIN(p.dVol)} @ ₹{formatNumberIN(p.ltp, 2)}
              </span>
              <span className={cn("tabular-nums", signClass(p.dOI))}>
                OI {p.dOI > 0 ? "+" : ""}
                {formatNumberIN(p.dOI)}
              </span>
              <span className="ml-auto">
                <ChainLink p={p} />
              </span>
            </div>
          </li>
        ))}
      </ul>

      <div className="flex items-center justify-between gap-2">
        <p className="text-body-sm text-muted-foreground">
          Page {page + 1} of {pages}
          <span className="ml-2 hidden sm:inline">* side inferred by tick test</span>
        </p>
        <div className="flex gap-1">
          <Button
            variant="outline"
            size="pill"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            aria-label="Previous page"
          >
            <ChevronLeft aria-hidden="true" /> Prev
          </Button>
          <Button
            variant="outline"
            size="pill"
            onClick={() => setPage((p) => Math.min(pages - 1, p + 1))}
            disabled={page >= pages - 1}
            aria-label="Next page"
          >
            Next <ChevronRight aria-hidden="true" />
          </Button>
        </div>
      </div>
    </div>
  );
}
