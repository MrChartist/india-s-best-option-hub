import { Fragment, forwardRef, useCallback, useMemo, useState, type MouseEvent, type ProfilerOnRenderCallback } from "react";
import { Bell, BarChart3, FileSearch, Layers, TrendingDown, TrendingUp, Crosshair } from "lucide-react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { cn } from "@/lib/utils";
import { formatDateIST, formatINR, formatNumberIN, formatStrike, type OptionType, type Side } from "@/lib/options";
import { spotDividerIndex, type ChainModel, type DeltaTargets, type RowView } from "./chainModel";
import type { CellContext, ColumnDef } from "./columns";
import { ChainRow, type DeltaMark } from "./ChainRow";
import type { GammaBadge } from "./gammaLevels";

export interface ChainMenuActions {
  onTrade: (strike: number, type: OptionType, side: Side) => void;
  onStraddle: (strike: number, side: Side) => void;
  onStrangle: (strike: number, side: Side) => void;
  onIronFly: (strike: number) => void;
  onAlert: (strike: number, type: OptionType) => void;
  onOIAnalysis: (strike: number) => void;
  /** Open the single-contract page for this strike and side. */
  onOpenContract: (strike: number, type: OptionType) => void;
}

export interface ChainTableProps extends ChainMenuActions {
  symbol: string;
  expiry: string;
  model: ChainModel;
  rows: RowView[];
  columns: ColumnDef[];
  deltaView: boolean;
  deltas: DeltaTargets;
  gammaMap: Map<number, GammaBadge[]>;
  focusedStrike: number | null;
  focusedSide: OptionType;
  onFocusRow: (strike: number, side: OptionType) => void;
  sigmaPoints: number;
  /** Optional per-row React Profiler callback (performance tests). */
  onRowRender?: ProfilerOnRenderCallback;
}

/** Sticky strike column: the shared spine between calls and puts, on the surface tone. */
const STRIKE_COL = "sticky left-0 right-0 z-[2] border-x border-separator bg-surface";
/** Column header cell: sentence case, 11px semibold, compact (Activity Monitor). */
const HEAD_CELL = "whitespace-nowrap !px-2 !py-1 font-semibold";

function deltaMark(strike: number, s16: number, s30: number): DeltaMark | undefined {
  if (strike === s16) return "16Δ";
  if (strike === s30) return "30Δ";
  return undefined;
}

export const ChainTable = forwardRef<HTMLDivElement, ChainTableProps>(function ChainTable(
  {
    symbol,
    expiry,
    model,
    rows,
    columns,
    deltaView,
    deltas,
    gammaMap,
    focusedStrike,
    focusedSide,
    onFocusRow,
    sigmaPoints,
    onTrade,
    onStraddle,
    onStrangle,
    onIronFly,
    onAlert,
    onOIAnalysis,
    onOpenContract,
    onRowRender,
  },
  ref,
) {
  const [menuStrike, setMenuStrike] = useState<number | null>(null);
  const peColumns = useMemo(() => [...columns].reverse(), [columns]);
  const n = columns.length;
  // Depend on scalars only: the model (and its nested objects) is rebuilt on every poll.
  const { maxOi, maxVol, maxAbsOiChg } = model;
  const { ce: maxOiCe, pe: maxOiPe } = model.maxOiStrike;
  const { ce: maxVolCe, pe: maxVolPe } = model.maxVolStrike;
  const cellModel = useMemo<CellContext["model"]>(
    () => ({ maxOi, maxVol, maxAbsOiChg, maxOiStrike: { ce: maxOiCe, pe: maxOiPe }, maxVolStrike: { ce: maxVolCe, pe: maxVolPe } }),
    [maxOi, maxVol, maxAbsOiChg, maxOiCe, maxOiPe, maxVolCe, maxVolPe],
  );
  const divider = spotDividerIndex(rows, model.spot);
  const atmIdx = useMemo(() => rows.findIndex((r) => r.strike === model.atmStrike), [rows, model.atmStrike]);
  const menuRow = menuStrike !== null ? rows.find((r) => r.strike === menuStrike) : undefined;

  const handleContextMenu = useCallback((e: MouseEvent<HTMLDivElement>) => {
    const tr = (e.target as HTMLElement).closest("tr[data-strike]");
    const k = tr ? Number(tr.getAttribute("data-strike")) : NaN;
    setMenuStrike(Number.isFinite(k) ? k : null);
  }, []);

  const spotRow = (
    <tr aria-hidden="true" className="pointer-events-none">
      <td colSpan={n + 1} className="p-0">
        <div className="flex items-center justify-end gap-2 pr-2">
          {Number.isFinite(model.synthFuture) && (
            <span className="whitespace-nowrap text-micro tabular-nums text-muted-foreground">Synth fut {formatNumberIN(model.synthFuture, 2, { minDecimals: 2 })}</span>
          )}
          <div className="h-px flex-1 bg-primary/50" />
        </div>
      </td>
      <td className="sticky left-0 right-0 z-[1] p-0 py-0.5 text-center">
        <span className="inline-flex h-[18px] items-center gap-1 whitespace-nowrap rounded-capsule bg-primary px-2 text-label tabular-nums text-primary-foreground shadow-control">
          {formatNumberIN(model.spot, 2, { minDecimals: 2 })}
        </span>
      </td>
      <td colSpan={n + 1} className="p-0">
        <div className="flex items-center gap-2 pl-2">
          <div className="h-px flex-1 bg-primary/50" />
          <span className="whitespace-nowrap text-micro text-muted-foreground">{symbol} spot</span>
        </div>
      </td>
    </tr>
  );

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          ref={ref}
          onContextMenu={handleContextMenu}
          className="relative max-h-[68vh] overflow-auto overscroll-contain"
          role="region"
          aria-label={`${symbol} option chain, ${rows.length} strikes. Right-click a row for actions.`}
        >
          <table className="w-full border-collapse font-num text-body">
            {/* Opaque sticky header and footer with hairline edges: the numbers never show through. */}
            <thead className="sticky top-0 z-10 bg-card [&_tr:last-child_th]:shadow-[inset_0_calc(-1*var(--hairline))_0_hsl(var(--separator-strong))]">
              <tr className="text-label">
                <th colSpan={n + 1} scope="colgroup" className="!py-1 text-center text-bearish">Calls</th>
                <th scope="col" className={cn(STRIKE_COL, "!py-1 text-center text-foreground")}>Strike</th>
                <th colSpan={n + 1} scope="colgroup" className="!py-1 text-center text-bullish">Puts</th>
              </tr>
              <tr className="text-label text-muted-foreground">
                {columns.map((c) => (
                  <th key={`h-ce-${c.id}`} scope="col" title={`${c.label}: ${c.description}`} className={cn(HEAD_CELL, "text-right", c.width)}>
                    {c.header}
                  </th>
                ))}
                <th scope="col" className={cn(HEAD_CELL, "!px-0.5 text-center")}>
                  <span className="sr-only">Trade calls</span>
                </th>
                <th scope="col" className={cn(STRIKE_COL, HEAD_CELL, "text-center tabular-nums")}>
                  {expiry ? formatDateIST(expiry).replace(/ \d{4}$/, "") : "—"}
                </th>
                <th scope="col" className={cn(HEAD_CELL, "!px-0.5 text-center")}>
                  <span className="sr-only">Trade puts</span>
                </th>
                {peColumns.map((c, i) => (
                  <th key={`h-pe-${c.id}`} scope="col" title={`${c.label}: ${c.description}`} className={cn(HEAD_CELL, "text-left", c.width, i === n - 1 && "!pr-3")}>
                    {c.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="zebra-rows">
              {divider === -1 && spotRow}
              {rows.map((row, i) => {
                const el = (
                  <ChainRow
                    key={row.strike}
                    row={row}
                    ceCols={columns}
                    peCols={peColumns}
                    cellModel={cellModel}
                    onTrade={onTrade}
                    onFocusRow={onFocusRow}
                    isATM={row.strike === model.atmStrike}
                    nearATM={atmIdx >= 0 && Math.abs(i - atmIdx) <= 3}
                    onRender={onRowRender}
                    isMaxPain={row.strike === model.maxPain}
                    focused={row.strike === focusedStrike}
                    focusedSide={row.strike === focusedStrike ? focusedSide : "CE"}
                    ceDelta={deltaView ? deltaMark(row.strike, deltas.ce16, deltas.ce30) : undefined}
                    peDelta={deltaView ? deltaMark(row.strike, deltas.pe16, deltas.pe30) : undefined}
                    gamma={gammaMap.get(row.strike)}
                  />
                );
                return divider === i ? (
                  <Fragment key={row.strike}>
                    {el}
                    {spotRow}
                  </Fragment>
                ) : (
                  el
                );
              })}
            </tbody>
            <tfoot className="sticky bottom-0 z-10 bg-surface [&_td]:shadow-[inset_0_var(--hairline)_0_hsl(var(--separator-strong))]">
              <tr className="text-body-sm font-semibold tabular-nums">
                {columns.map((c) => (
                  <td key={`f-ce-${c.id}`} className="whitespace-nowrap px-2 py-1.5 text-right text-muted-foreground">
                    {c.footer ? <span className="text-foreground">{c.footer(model, "CE")}</span> : null}
                  </td>
                ))}
                <td aria-hidden="true" />
                <td className={cn(STRIKE_COL, "px-2 py-1.5 text-center")}>
                  <span className="font-medium text-muted-foreground">PCR </span>
                  <span className={cn("font-bold", model.pcrOi >= 1 ? "text-bullish" : "text-bearish")}>{Number.isFinite(model.pcrOi) ? model.pcrOi.toFixed(2) : "—"}</span>
                </td>
                <td aria-hidden="true" />
                {peColumns.map((c, i) => (
                  <td key={`f-pe-${c.id}`} className={cn("whitespace-nowrap px-2 py-1.5 text-left text-muted-foreground", i === n - 1 && "pr-3")}>
                    {c.footer ? <span className="text-foreground">{c.footer(model, "PE")}</span> : null}
                  </td>
                ))}
              </tr>
            </tfoot>
          </table>
        </div>
      </ContextMenuTrigger>

      <ContextMenuContent className="w-60">
        {!menuRow ? (
          <ContextMenuLabel className="font-normal text-muted-foreground">Right-click a strike row for actions</ContextMenuLabel>
        ) : (
          <>
            <ContextMenuLabel className="tabular-nums">
              {symbol} {formatStrike(menuRow.strike)}
              <span className="ml-1 font-normal text-muted-foreground">· {expiry ? formatDateIST(expiry) : ""}</span>
            </ContextMenuLabel>
            <ContextMenuSeparator />
            <ContextMenuSub>
              <ContextMenuSubTrigger className="gap-2"><TrendingUp className="h-3.5 w-3.5 text-bullish" /> Buy</ContextMenuSubTrigger>
              <ContextMenuSubContent>
                <ContextMenuItem onSelect={() => onTrade(menuRow.strike, "CE", "BUY")}>Buy CE @ {formatINR(menuRow.ce.mid || menuRow.ce.leg.ltp)}</ContextMenuItem>
                <ContextMenuItem onSelect={() => onTrade(menuRow.strike, "PE", "BUY")}>Buy PE @ {formatINR(menuRow.pe.mid || menuRow.pe.leg.ltp)}</ContextMenuItem>
              </ContextMenuSubContent>
            </ContextMenuSub>
            <ContextMenuSub>
              <ContextMenuSubTrigger className="gap-2"><TrendingDown className="h-3.5 w-3.5 text-bearish" /> Sell</ContextMenuSubTrigger>
              <ContextMenuSubContent>
                <ContextMenuItem onSelect={() => onTrade(menuRow.strike, "CE", "SELL")}>Sell CE @ {formatINR(menuRow.ce.mid || menuRow.ce.leg.ltp)}</ContextMenuItem>
                <ContextMenuItem onSelect={() => onTrade(menuRow.strike, "PE", "SELL")}>Sell PE @ {formatINR(menuRow.pe.mid || menuRow.pe.leg.ltp)}</ContextMenuItem>
              </ContextMenuSubContent>
            </ContextMenuSub>
            <ContextMenuSeparator />
            <ContextMenuSub>
              <ContextMenuSubTrigger className="gap-2"><Layers className="h-3.5 w-3.5" /> Straddle (CE + PE)</ContextMenuSubTrigger>
              <ContextMenuSubContent>
                <ContextMenuItem onSelect={() => onStraddle(menuRow.strike, "BUY")}>Long straddle</ContextMenuItem>
                <ContextMenuItem onSelect={() => onStraddle(menuRow.strike, "SELL")}>Short straddle</ContextMenuItem>
              </ContextMenuSubContent>
            </ContextMenuSub>
            <ContextMenuSub>
              <ContextMenuSubTrigger className="gap-2" disabled={!(sigmaPoints > 0)}>
                <Layers className="h-3.5 w-3.5" /> Strangle (±1σ)
              </ContextMenuSubTrigger>
              <ContextMenuSubContent>
                <ContextMenuItem onSelect={() => onStrangle(menuRow.strike, "BUY")}>Long strangle</ContextMenuItem>
                <ContextMenuItem onSelect={() => onStrangle(menuRow.strike, "SELL")}>Short strangle</ContextMenuItem>
              </ContextMenuSubContent>
            </ContextMenuSub>
            <ContextMenuItem className="gap-2" onSelect={() => onIronFly(menuRow.strike)}>
              <Crosshair className="h-3.5 w-3.5" /> Short iron fly
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem className="gap-2" onSelect={() => onAlert(menuRow.strike, focusedSide)}>
              <Bell className="h-3.5 w-3.5" /> Set alert…
            </ContextMenuItem>
            <ContextMenuItem className="gap-2" onSelect={() => onOpenContract(menuRow.strike, focusedSide)}>
              <FileSearch className="h-3.5 w-3.5" /> Open contract
              <ContextMenuShortcut>{focusedSide}</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuItem className="gap-2 pl-8 text-muted-foreground" onSelect={() => onOpenContract(menuRow.strike, focusedSide === "CE" ? "PE" : "CE")}>
              Open the {focusedSide === "CE" ? "PE" : "CE"} contract
            </ContextMenuItem>
            <ContextMenuItem className="gap-2" onSelect={() => onOIAnalysis(menuRow.strike)}>
              <BarChart3 className="h-3.5 w-3.5" /> View in OI Analysis
              <ContextMenuShortcut>↗</ContextMenuShortcut>
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
});

