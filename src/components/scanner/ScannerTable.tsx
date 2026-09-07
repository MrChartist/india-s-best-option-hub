import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowUpDown, ExternalLink, TrendingUp, TrendingDown } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { BUILDUP_COLOR, type FuturesQuoteRow } from "@/lib/futuresUtils";

type SortKey = "symbol" | "futuresLtp" | "priceChangePercent" | "oi" | "oiChangePercent" | "volume" | "basisPercent";

interface Props {
  rows: FuturesQuoteRow[];
}

function fmtLakh(v: number | null): string {
  if (v === null || v === 0) return "—";
  return `${(v / 100000).toFixed(1)}L`;
}

function fmtPercent(v: number | null): string {
  if (v === null) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
}

export function ScannerTable({ rows }: Props) {
  const navigate = useNavigate();
  const [sortKey, setSortKey] = useState<SortKey>("oiChangePercent");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const sorted = useMemo(() => {
    const withFallback = (v: number | null) => v ?? (sortDir === "desc" ? -Infinity : Infinity);
    return [...rows].sort((a, b) => {
      if (sortKey === "symbol") {
        return sortDir === "asc" ? a.symbol.localeCompare(b.symbol) : b.symbol.localeCompare(a.symbol);
      }
      const diff = withFallback(a[sortKey]) - withFallback(b[sortKey]);
      return sortDir === "asc" ? diff : -diff;
    });
  }, [rows, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const SortHead = ({ label, sortKeyName, className }: { label: string; sortKeyName: SortKey; className?: string }) => (
    <TableHead className={className}>
      <button
        onClick={() => toggleSort(sortKeyName)}
        className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
      >
        {label}
        <ArrowUpDown className={`h-2.5 w-2.5 ${sortKey === sortKeyName ? "text-primary" : "opacity-40"}`} />
      </button>
    </TableHead>
  );

  return (
    <Table>
      <TableHeader className="sticky top-0 z-10 bg-card">
        <TableRow className="text-xs">
          <SortHead label="Symbol" sortKeyName="symbol" />
          <SortHead label="Fut LTP" sortKeyName="futuresLtp" className="text-right" />
          <SortHead label="Chg%" sortKeyName="priceChangePercent" className="text-right" />
          <SortHead label="OI" sortKeyName="oi" className="text-right" />
          <SortHead label="OI Chg%" sortKeyName="oiChangePercent" className="text-right" />
          <SortHead label="Volume" sortKeyName="volume" className="text-right" />
          <TableHead className="text-right">Spot</TableHead>
          <SortHead label="Basis%" sortKeyName="basisPercent" className="text-right" />
          <TableHead>Signal</TableHead>
          <TableHead className="text-center">Chain</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {sorted.map((row) => (
          <TableRow
            key={row.symbol}
            className={`text-xs font-mono transition-all duration-150 group border-l-2 ${
              (row.priceChangePercent ?? 0) >= 0 ? "hover:bg-bullish/[0.03] border-transparent hover:border-bullish/50" : "hover:bg-bearish/[0.03] border-transparent hover:border-bearish/50"
            }`}
          >
            <TableCell className="font-sans font-medium">
              <div className="flex items-center gap-1">
                {(row.priceChangePercent ?? 0) >= 0
                  ? <TrendingUp className="h-3 w-3 text-bullish opacity-0 group-hover:opacity-100 transition-opacity" />
                  : <TrendingDown className="h-3 w-3 text-bearish opacity-0 group-hover:opacity-100 transition-opacity" />}
                {row.symbol}
                <span className="text-2xs text-muted-foreground/60 font-mono">{row.instrumentType === "FUTIDX" ? "IDX" : ""}</span>
              </div>
            </TableCell>
            <TableCell className="text-right font-semibold">
              {row.futuresLtp !== null ? row.futuresLtp.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—"}
            </TableCell>
            <TableCell className={`text-right ${(row.priceChangePercent ?? 0) >= 0 ? "text-bullish" : "text-bearish"}`}>
              {fmtPercent(row.priceChangePercent)}
            </TableCell>
            <TableCell className="text-right text-muted-foreground">{fmtLakh(row.oi)}</TableCell>
            <TableCell className={`text-right ${(row.oiChangePercent ?? 0) >= 0 ? "text-bullish" : "text-bearish"}`}>
              {fmtPercent(row.oiChangePercent)}
            </TableCell>
            <TableCell className="text-right text-muted-foreground">{fmtLakh(row.volume)}</TableCell>
            <TableCell className="text-right text-muted-foreground">
              {row.spotLtp !== null ? row.spotLtp.toLocaleString("en-IN", { maximumFractionDigits: 2 }) : "—"}
            </TableCell>
            <TableCell className={`text-right ${row.basisPercent === null ? "text-muted-foreground" : row.basisPercent >= 0 ? "text-bullish" : "text-bearish"}`}>
              {fmtPercent(row.basisPercent)}
            </TableCell>
            <TableCell>
              <span className={`px-1.5 py-0.5 rounded text-2xs font-medium bg-current/10 ${BUILDUP_COLOR[row.buildupSignal]}`}>
                {row.buildupSignal}
              </span>
            </TableCell>
            <TableCell className="text-center">
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => navigate(`/option-chain?symbol=${row.symbol}`)} title="View Option Chain">
                <ExternalLink className="h-3 w-3" />
              </Button>
            </TableCell>
          </TableRow>
        ))}
        {sorted.length === 0 && (
          <TableRow>
            <TableCell colSpan={10} className="text-center py-8 text-muted-foreground text-sm">
              No contracts match the current filters
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  );
}
