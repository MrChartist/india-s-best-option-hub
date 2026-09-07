import { useMemo, useState } from "react";
import {
  type ColumnDef, type SortingState, flexRender, getCoreRowModel, getSortedRowModel, useReactTable,
} from "@tanstack/react-table";
import { ArrowDownUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { Position } from "@/lib/mockData";
import { RiskTriggerCell } from "./RiskTriggerCell";
import { slLevel, tgtLevel } from "../lib/riskLevels";
import type { useLegRiskArm } from "../hooks/useLegRiskArm";

interface Props {
  positions: Position[];
  onExitPercent: (position: Position, pct: 25 | 50 | 75 | 100) => void;
  riskArm: ReturnType<typeof useLegRiskArm>;
  /** The terminal's currently selected instrument + its live spot — the only
   * symbol whose spot is actually streamed right now (see header note below). */
  activeSymbol: string;
  activeSpot: number | null;
}

/**
 * The positions grid.
 *
 * Phase 1 shows PAPER positions only, and says so — the reference terminal's
 * Holdings / Funds / Trade Book tabs have no backend here yet, and inventing a
 * funds figure in an execution terminal is the worst available failure mode.
 *
 * Built on @tanstack/react-table (1CLIQ-TRADE-SPEC.md §10) rendered through
 * the existing shadcn Table primitives, rather than hand-rolled sort state —
 * adding the Set-SL/Set-Target columns on top of hand-rolled sorting was
 * exactly the "concentrates a 300-line violation" the spec warns about.
 *
 * SL/Target can only be armed for a row whose symbol matches the terminal's
 * currently selected instrument: that is the only spot price actually
 * streaming (useLegQuote subscribes one symbol at a time), and arming with
 * the WRONG underlying's spot as S0 would silently corrupt the whole
 * direction-agnostic bias/adv calculation (spec §13 failure mode #3) — so a
 * mismatched row disables the Arm control instead of guessing.
 */
export function PositionsGrid({ positions, onExitPercent, riskArm, activeSymbol, activeSpot }: Props) {
  const [sorting, setSorting] = useState<SortingState>([{ id: "pnl", desc: true }]);

  const columns = useMemo<ColumnDef<Position>[]>(() => [
    {
      id: "symbol",
      accessorFn: (p) => `${p.symbol} ${p.strike} ${p.type}`,
      header: "Symbol",
      cell: (ctx) => <span className="font-sans">{ctx.getValue<string>()}</span>,
    },
    {
      id: "side",
      accessorKey: "action",
      header: "Side",
      enableSorting: false,
      cell: (ctx) => {
        const action = ctx.getValue<Position["action"]>();
        return <span className={action === "BUY" ? "text-bullish" : "text-bearish"}>{action}</span>;
      },
    },
    {
      id: "lots",
      accessorKey: "lots",
      header: "Net Qty",
      cell: (ctx) => {
        const p = ctx.row.original;
        const qty = p.lots * p.lotSize;
        return (
          <span className="tabular-nums">
            {p.action === "SELL" ? "−" : ""}{qty}
            <span className="text-muted-foreground"> ({p.lots}L)</span>
          </span>
        );
      },
    },
    {
      id: "entryPrice",
      accessorKey: "entryPrice",
      header: "Avg Price",
      cell: (ctx) => <span className="tabular-nums">{ctx.getValue<number>().toFixed(2)}</span>,
    },
    {
      id: "currentPrice",
      accessorKey: "currentPrice",
      header: "LTP",
      cell: (ctx) => <span className="tabular-nums">{ctx.getValue<number>().toFixed(2)}</span>,
    },
    {
      id: "pnl",
      accessorKey: "pnl",
      header: "UR. P&L",
      cell: (ctx) => {
        const v = ctx.getValue<number>();
        return <span className={`tabular-nums ${v >= 0 ? "text-bullish" : "text-bearish"}`}>{v >= 0 ? "+" : ""}{v.toLocaleString("en-IN")}</span>;
      },
    },
    {
      id: "sl",
      header: "Set SL",
      enableSorting: false,
      cell: (ctx) => {
        const p = ctx.row.original;
        const cell = riskArm.getState(p.id);
        const canArm = p.symbol === activeSymbol && Number.isFinite(activeSpot ?? NaN) && (activeSpot ?? 0) > 0;
        const level = cell.slPts != null && activeSpot ? slLevel(activeSpot, p.action, p.type, cell.slPts) : null;
        return (
          <RiskTriggerCell
            value={cell.slPts}
            level={level}
            status={cell.status}
            hitAt={cell.hitAt}
            failureReason={cell.failureReason}
            editable={cell.status === "idle" || cell.status === "failed"}
            onChange={(v) => riskArm.setDraft(p.id, "slPts", v)}
            onArm={() => activeSpot && riskArm.arm(p, activeSpot, cell.slPts ?? 0, cell.tgtPts ?? 0)}
            onDisarm={() => riskArm.disarm(p.id)}
            armDisabledReason={canArm ? undefined : `Switch the terminal to ${p.symbol} to arm — spot isn't live here.`}
          />
        );
      },
    },
    {
      id: "target",
      header: "Set Target",
      enableSorting: false,
      cell: (ctx) => {
        const p = ctx.row.original;
        const cell = riskArm.getState(p.id);
        const canArm = p.symbol === activeSymbol && Number.isFinite(activeSpot ?? NaN) && (activeSpot ?? 0) > 0;
        const level = cell.tgtPts != null && activeSpot ? tgtLevel(activeSpot, p.action, p.type, cell.tgtPts) : null;
        return (
          <RiskTriggerCell
            value={cell.tgtPts}
            level={level}
            status={cell.status}
            hitAt={cell.hitAt}
            failureReason={cell.failureReason}
            editable={cell.status === "idle" || cell.status === "failed"}
            onChange={(v) => riskArm.setDraft(p.id, "tgtPts", v)}
            onArm={() => activeSpot && riskArm.arm(p, activeSpot, cell.slPts ?? 0, cell.tgtPts ?? 0)}
            onDisarm={() => riskArm.disarm(p.id)}
            armDisabledReason={canArm ? undefined : `Switch the terminal to ${p.symbol} to arm — spot isn't live here.`}
          />
        );
      },
    },
    {
      id: "exit",
      header: "Exit",
      enableSorting: false,
      cell: (ctx) => {
        const p = ctx.row.original;
        return (
          <div className="flex gap-0.5 justify-end">
            {([25, 50, 75, 100] as const).map((pct) => {
              // Lots are indivisible. 25% of 3 lots is 0.75, which rounds to
              // zero — so the button is disabled and says why, rather than
              // silently rounding up to a bigger exit than asked for.
              const exitLots = pct === 100 ? p.lots : Math.floor((p.lots * pct) / 100);
              const impossible = exitLots < 1;
              return (
                <Button
                  key={pct} size="sm" variant="ghost" tabIndex={-1} disabled={impossible}
                  className="h-6 px-1.5 text-[10px]"
                  title={impossible
                    ? `${pct}% of ${p.lots} lot${p.lots > 1 ? "s" : ""} rounds to 0 — minimum 1 lot`
                    : `Exit ${exitLots} of ${p.lots} lots`}
                  onClick={() => onExitPercent(p, pct)}
                >
                  {pct}%
                </Button>
              );
            })}
          </div>
        );
      },
    },
  ], [riskArm, activeSymbol, activeSpot, onExitPercent]);

  const table = useReactTable({
    data: positions,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  if (positions.length === 0) {
    return (
      <div className="text-center py-10 text-sm text-muted-foreground">
        No Rows To Show
        <div className="text-xs mt-1">Paper positions you open here appear in this grid and in Position Tracker.</div>
      </div>
    );
  }

  const NUMERIC_COLS = new Set(["lots", "entryPrice", "currentPrice", "pnl", "sl", "target", "exit"]);

  return (
    <Table>
      <TableHeader>
        {table.getHeaderGroups().map((hg) => (
          <TableRow key={hg.id} className="text-xs">
            {hg.headers.map((header) => (
              <TableHead key={header.id} className={NUMERIC_COLS.has(header.column.id) ? "text-right" : undefined}>
                {header.column.getCanSort() ? (
                  <button
                    type="button"
                    onClick={header.column.getToggleSortingHandler()}
                    className="inline-flex items-center gap-1 hover:text-foreground"
                  >
                    {flexRender(header.column.columnDef.header, header.getContext())}
                    {header.column.getIsSorted() && <ArrowDownUp className="h-3 w-3" />}
                  </button>
                ) : (
                  flexRender(header.column.columnDef.header, header.getContext())
                )}
              </TableHead>
            ))}
          </TableRow>
        ))}
      </TableHeader>
      <TableBody>
        {table.getRowModel().rows.map((row) => (
          <TableRow key={row.id} className="text-xs font-mono">
            {row.getVisibleCells().map((cell) => (
              <TableCell key={cell.id} className={NUMERIC_COLS.has(cell.column.id) ? "text-right" : undefined}>
                {flexRender(cell.column.columnDef.cell, cell.getContext())}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
