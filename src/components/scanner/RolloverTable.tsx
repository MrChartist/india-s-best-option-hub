import { useMemo, useState } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowUpDown } from "lucide-react";
import type { RolloverRow } from "@/lib/futuresUtils";

type SortKey = "symbol" | "rolloverPercent" | "nearOI" | "nextOI" | "daysToNearExpiry";

interface Props {
  rows: RolloverRow[];
}

function fmtLakh(v: number | null): string {
  if (v === null || v === 0) return "—";
  return `${(v / 100000).toFixed(1)}L`;
}

// Rollover% = how much of the combined near+next OI already sits in the next
// series. Rises through expiry week as traders shift positions forward;
// unusually low rollover close to expiry can signal reluctance to carry the
// position, unusually high can signal strong conviction on continuation.
export function RolloverTable({ rows }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>("rolloverPercent");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const sorted = useMemo(() => {
    return [...rows].sort((a, b) => {
      if (sortKey === "symbol") {
        return sortDir === "asc" ? a.symbol.localeCompare(b.symbol) : b.symbol.localeCompare(a.symbol);
      }
      const diff = a[sortKey] - b[sortKey];
      return sortDir === "asc" ? diff : -diff;
    });
  }, [rows, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("desc"); }
  };

  const SortHead = ({ label, sortKeyName, className }: { label: string; sortKeyName: SortKey; className?: string }) => (
    <TableHead className={className}>
      <button onClick={() => toggleSort(sortKeyName)} className="inline-flex items-center gap-1 hover:text-foreground transition-colors">
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
          <TableHead className="text-right">Near Expiry</TableHead>
          <SortHead label="Days Left" sortKeyName="daysToNearExpiry" className="text-right" />
          <SortHead label="Near OI" sortKeyName="nearOI" className="text-right" />
          <SortHead label="Next OI" sortKeyName="nextOI" className="text-right" />
          <SortHead label="Rollover%" sortKeyName="rolloverPercent" className="text-right" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {sorted.map((row) => (
          <TableRow key={row.symbol} className="text-xs font-mono hover:bg-accent/30 transition-colors">
            <TableCell className="font-sans font-medium">{row.symbol}</TableCell>
            <TableCell className="text-right text-muted-foreground">{row.nearExpiry}</TableCell>
            <TableCell className="text-right">{row.daysToNearExpiry}d</TableCell>
            <TableCell className="text-right text-muted-foreground">{fmtLakh(row.nearOI)}</TableCell>
            <TableCell className="text-right text-muted-foreground">{fmtLakh(row.nextOI)}</TableCell>
            <TableCell className={`text-right font-semibold ${row.rolloverPercent >= 50 ? "text-bullish" : "text-warning"}`}>
              {row.rolloverPercent.toFixed(1)}%
            </TableCell>
          </TableRow>
        ))}
        {sorted.length === 0 && (
          <TableRow>
            <TableCell colSpan={6} className="text-center py-8 text-muted-foreground text-sm">
              No rollover data available
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  );
}
