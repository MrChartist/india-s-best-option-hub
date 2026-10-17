import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Download, ListFilter } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDateIST, formatNumberIN, formatStrike } from "@/lib/options";
import { printsToCSV, type FlowPrint } from "@/lib/flow";
import { cn } from "@/lib/utils";
import { EmptyState } from "./FlowUi";
import { fmtRs, hhmm, signClass } from "./format";

const PAGE_SIZE = 50;

function SideBadge({ p }: { p: FlowPrint }) {
  const variant = p.aggressor === "ASK" ? "bullish" : p.aggressor === "BID" ? "bearish" : "neutral";
  const label = p.aggressor === "ASK" ? "Ask" : p.aggressor === "BID" ? "Bid" : "Mid";
  const basis = p.aggressorBasis === "tick" ? "Inferred from the price change (no usable bid/ask)" : p.aggressorBasis === "none" ? "No quote or price change to infer the side" : "Position of LTP inside the bid/ask";
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

function download(name: string, text: string) {
  try {
    const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch {
    /* download blocked */
  }
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
        The tape fills as the chain is polled during market hours (09:15 to 15:30 IST). Each row is the change between two snapshots, so you need at least two polls with trading in between.
      </EmptyState>
    );
  }
  if (prints.length === 0) {
    return (
      <EmptyState icon={<ListFilter className="h-6 w-6" aria-hidden="true" />} title="Nothing matches these filters" action={onResetFilters ? <Button size="sm" variant="outline" onClick={onResetFilters}>Reset filters</Button> : undefined}>
        {formatNumberIN(totalCount)} prints are hidden by the current filters.
      </EmptyState>
    );
  }

  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-body-sm text-muted-foreground" aria-live="polite">
          {formatNumberIN(prints.length)} print{prints.length === 1 ? "" : "s"}
          {prints.length !== totalCount ? ` of ${formatNumberIN(totalCount)}` : ""} · newest first
          {isSample ? " · sample data" : ""}
        </p>
        <Button variant="outline" size="pill" onClick={() => download(`flow-${isSample ? "sample-" : ""}${stamp}.csv`, printsToCSV(prints))}>
          <Download aria-hidden="true" /> CSV
        </Button>
      </div>

      {/* Desktop table */}
      <div className="hidden overflow-x-auto rounded-tile border border-border md:block">
        <table className="w-full min-w-[900px] text-body-sm">
          <caption className="sr-only">Derived interval flow prints</caption>
          <thead className="bg-surface text-left text-label uppercase text-muted-foreground">
            <tr>
              <th scope="col" className="px-3 py-2">Time</th>
              <th scope="col" className="px-3 py-2">Contract</th>
              <th scope="col" className="px-3 py-2">Side</th>
              <th scope="col" className="px-3 py-2 text-right">Premium</th>
              <th scope="col" className="px-3 py-2 text-right">Contracts</th>
              <th scope="col" className="px-3 py-2 text-right">LTP</th>
              <th scope="col" className="px-3 py-2 text-right">Bid × Ask</th>
              <th scope="col" className="px-3 py-2 text-right">OI chg</th>
              <th scope="col" className="px-3 py-2">OI</th>
              <th scope="col" className="px-3 py-2 text-right">DTE</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((p) => (
              <tr key={p.id} className="hover:bg-muted/40">
                <td className="whitespace-nowrap px-3 py-1.5 tabular-nums text-muted-foreground" title={`Interval ${hhmm(p.fromTs, true)} to ${hhmm(p.ts, true)} IST`}>
                  {hhmm(p.ts, true)}
                </td>
                <td className="whitespace-nowrap px-3 py-1.5">
                  <span className="font-semibold">{p.symbol}</span> <span className="tabular-nums">{formatStrike(p.strike)}</span>{" "}
                  <span className={p.type === "CE" ? "text-bullish" : "text-bearish"}>{p.type}</span>
                  <span className="ml-1.5 text-muted-foreground">{formatDateIST(p.expiry).replace(/ \d{4}$/, "")}</span>
                  <span className="ml-1.5 text-micro uppercase text-muted-foreground">{p.moneyness}</span>
                </td>
                <td className="px-3 py-1.5">
                  <SideBadge p={p} />
                </td>
                <td className="whitespace-nowrap px-3 py-1.5 text-right font-semibold tabular-nums">{fmtRs(p.premium)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{formatNumberIN(p.dVol)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{formatNumberIN(p.ltp, 2)}</td>
                <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums text-muted-foreground">
                  {p.bid > 0 && p.ask > 0 ? `${formatNumberIN(p.bid, 2)} × ${formatNumberIN(p.ask, 2)}` : "—"}
                </td>
                <td className={cn("px-3 py-1.5 text-right tabular-nums", signClass(p.dOI))}>{p.dOI > 0 ? "+" : ""}{formatNumberIN(p.dOI)}</td>
                <td className="px-3 py-1.5">
                  <TagBadge tag={p.tag} />
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums">{p.dte === 0 ? <Badge variant="default">0DTE</Badge> : p.dte}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <ul className="space-y-2 md:hidden" aria-label="Derived interval flow prints">
        {rows.map((p) => (
          <li key={p.id} className="rounded-tile border border-border bg-card p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate font-semibold">
                  {p.symbol} <span className="tabular-nums">{formatStrike(p.strike)}</span> <span className={p.type === "CE" ? "text-bullish" : "text-bearish"}>{p.type}</span>
                </p>
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
              <span className={cn("tabular-nums", signClass(p.dOI))}>OI {p.dOI > 0 ? "+" : ""}{formatNumberIN(p.dOI)}</span>
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
          <Button variant="outline" size="pill" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} aria-label="Previous page">
            <ChevronLeft aria-hidden="true" /> Prev
          </Button>
          <Button variant="outline" size="pill" onClick={() => setPage((p) => Math.min(pages - 1, p + 1))} disabled={page >= pages - 1} aria-label="Next page">
            Next <ChevronRight aria-hidden="true" />
          </Button>
        </div>
      </div>
    </div>
  );
}
