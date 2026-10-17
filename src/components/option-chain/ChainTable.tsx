import { Fragment, forwardRef, useCallback, useMemo, useState, type MouseEvent } from "react";
import { Bell, BarChart3, Layers, TrendingDown, TrendingUp, Crosshair } from "lucide-react";
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
}

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
  },
  ref,
) {
  const [menuStrike, setMenuStrike] = useState<number | null>(null);
  const peColumns = useMemo(() => [...columns].reverse(), [columns]);
  const n = columns.length;
  const cellModel = useMemo<CellContext["model"]>(
    () => ({ maxOi: model.maxOi, maxVol: model.maxVol, maxAbsOiChg: model.maxAbsOiChg, maxOiStrike: model.maxOiStrike, maxVolStrike: model.maxVolStrike }),
    [model.maxOi, model.maxVol, model.maxAbsOiChg, model.maxOiStrike, model.maxVolStrike],
  );
  const divider = spotDividerIndex(rows, model.spot);
  const menuRow = menuStrike !== null ? rows.find((r) => r.strike === menuStrike) : undefined;

  const handleContextMenu = useCallback((e: MouseEvent<HTMLDivElement>) => {
    const tr = (e.target as HTMLElement).closest("tr[data-strike]");
    const k = tr ? Number(tr.getAttribute("data-strike")) : NaN;
    setMenuStrike(Number.isFinite(k) ? k : null);
  }, []);

  const spotRow = (
    <tr aria-hidden="true" className="pointer-events-none">
      <td colSpan={n} className="p-0">
        <div className="flex items-center justify-end gap-2 pr-2">
          {Number.isFinite(model.synthFuture) && (
            <span className="whitespace-nowrap text-[10px] font-semibold uppercase tracking-[0.07em] text-muted-foreground">Synth fut {formatNumberIN(model.synthFuture, 2, { minDecimals: 2 })}</span>
          )}
          <div className="h-px flex-1 bg-primary/60" />
        </div>
      </td>
      <td className="relative p-0 py-1 text-center">
        <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-capsule bg-primary px-2 py-0.5 text-[11px] font-bold tabular-nums text-primary-foreground shadow-card">
          {formatNumberIN(model.spot, 2, { minDecimals: 2 })}
        </span>
      </td>
      <td colSpan={n} className="p-0">
        <div className="flex items-center gap-2 pl-2">
          <div className="h-px flex-1 bg-primary/60" />
          <span className="whitespace-nowrap text-[10px] font-semibold uppercase tracking-[0.07em] text-muted-foreground">{symbol} spot</span>
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
          className="relative max-h-[68vh] overflow-auto overscroll-contain rounded-b-card"
          role="region"
          aria-label={`${symbol} option chain, ${rows.length} strikes. Right-click a row for actions.`}
        >
          <table className="w-full border-collapse font-num text-[12.5px]">
            <thead className="sticky top-0 z-10 bg-card shadow-[0_1px_0_hsl(var(--border))]">
              <tr className="text-label uppercase">
                <th colSpan={n} scope="colgroup" className="bg-wash-loss/50 py-1.5 text-center text-bearish">Calls</th>
                <th scope="col" className="border-x border-border bg-surface py-1.5 text-center text-foreground">Strike</th>
                <th colSpan={n} scope="colgroup" className="bg-wash-profit/50 py-1.5 text-center text-bullish">Puts</th>
              </tr>
              <tr className="text-[10.5px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                {columns.map((c) => (
                  <th key={`h-ce-${c.id}`} scope="col" title={`${c.label}: ${c.description}`} className={cn("whitespace-nowrap px-2 py-1.5 text-right font-semibold", c.width)}>
                    {c.header}
                  </th>
                ))}
                <th scope="col" className="border-x border-border bg-surface px-2 py-1.5 text-center font-semibold">
                  {expiry ? formatDateIST(expiry).replace(/ \d{4}$/, "") : "—"}
                </th>
                {peColumns.map((c) => (
                  <th key={`h-pe-${c.id}`} scope="col" title={`${c.label}: ${c.description}`} className={cn("whitespace-nowrap px-2 py-1.5 text-left font-semibold", c.width)}>
                    {c.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
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
            <tfoot className="sticky bottom-0 z-10 bg-card shadow-[0_-1px_0_hsl(var(--border))]">
              <tr className="text-[11.5px] font-semibold tabular-nums">
                {columns.map((c) => (
                  <td key={`f-ce-${c.id}`} className="whitespace-nowrap px-2 py-2 text-right text-muted-foreground">
                    {c.footer ? <span className="text-foreground">{c.footer(model, "CE")}</span> : null}
                  </td>
                ))}
                <td className="border-x border-border bg-surface px-2 py-2 text-center">
                  <span className="text-[10px] uppercase tracking-[0.07em] text-muted-foreground">PCR </span>
                  <span className={cn("font-bold", model.pcrOi >= 1 ? "text-bullish" : "text-bearish")}>{Number.isFinite(model.pcrOi) ? model.pcrOi.toFixed(2) : "—"}</span>
                </td>
                {peColumns.map((c) => (
                  <td key={`f-pe-${c.id}`} className="whitespace-nowrap px-2 py-2 text-left text-muted-foreground">
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
          <ContextMenuLabel className="text-xs font-normal text-muted-foreground">Right-click a strike row for actions</ContextMenuLabel>
        ) : (
          <>
            <ContextMenuLabel className="text-xs">
              {symbol} {formatStrike(menuRow.strike)}
              <span className="ml-1 font-normal text-muted-foreground">· {expiry ? formatDateIST(expiry) : ""}</span>
            </ContextMenuLabel>
            <ContextMenuSeparator />
            <ContextMenuSub>
              <ContextMenuSubTrigger className="gap-2 text-xs"><TrendingUp className="h-3.5 w-3.5 text-bullish" /> Buy</ContextMenuSubTrigger>
              <ContextMenuSubContent>
                <ContextMenuItem className="text-xs" onSelect={() => onTrade(menuRow.strike, "CE", "BUY")}>Buy CE @ {formatINR(menuRow.ce.mid || menuRow.ce.leg.ltp)}</ContextMenuItem>
                <ContextMenuItem className="text-xs" onSelect={() => onTrade(menuRow.strike, "PE", "BUY")}>Buy PE @ {formatINR(menuRow.pe.mid || menuRow.pe.leg.ltp)}</ContextMenuItem>
              </ContextMenuSubContent>
            </ContextMenuSub>
            <ContextMenuSub>
              <ContextMenuSubTrigger className="gap-2 text-xs"><TrendingDown className="h-3.5 w-3.5 text-bearish" /> Sell</ContextMenuSubTrigger>
              <ContextMenuSubContent>
                <ContextMenuItem className="text-xs" onSelect={() => onTrade(menuRow.strike, "CE", "SELL")}>Sell CE @ {formatINR(menuRow.ce.mid || menuRow.ce.leg.ltp)}</ContextMenuItem>
                <ContextMenuItem className="text-xs" onSelect={() => onTrade(menuRow.strike, "PE", "SELL")}>Sell PE @ {formatINR(menuRow.pe.mid || menuRow.pe.leg.ltp)}</ContextMenuItem>
              </ContextMenuSubContent>
            </ContextMenuSub>
            <ContextMenuSeparator />
            <ContextMenuSub>
              <ContextMenuSubTrigger className="gap-2 text-xs"><Layers className="h-3.5 w-3.5" /> Straddle (CE + PE)</ContextMenuSubTrigger>
              <ContextMenuSubContent>
                <ContextMenuItem className="text-xs" onSelect={() => onStraddle(menuRow.strike, "BUY")}>Long straddle</ContextMenuItem>
                <ContextMenuItem className="text-xs" onSelect={() => onStraddle(menuRow.strike, "SELL")}>Short straddle</ContextMenuItem>
              </ContextMenuSubContent>
            </ContextMenuSub>
            <ContextMenuSub>
              <ContextMenuSubTrigger className="gap-2 text-xs" disabled={!(sigmaPoints > 0)}>
                <Layers className="h-3.5 w-3.5" /> Strangle (±1σ)
              </ContextMenuSubTrigger>
              <ContextMenuSubContent>
                <ContextMenuItem className="text-xs" onSelect={() => onStrangle(menuRow.strike, "BUY")}>Long strangle</ContextMenuItem>
                <ContextMenuItem className="text-xs" onSelect={() => onStrangle(menuRow.strike, "SELL")}>Short strangle</ContextMenuItem>
              </ContextMenuSubContent>
            </ContextMenuSub>
            <ContextMenuItem className="gap-2 text-xs" onSelect={() => onIronFly(menuRow.strike)}>
              <Crosshair className="h-3.5 w-3.5" /> Short iron fly
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem className="gap-2 text-xs" onSelect={() => onAlert(menuRow.strike, focusedSide)}>
              <Bell className="h-3.5 w-3.5" /> Set alert…
            </ContextMenuItem>
            <ContextMenuItem className="gap-2 text-xs" onSelect={() => onOIAnalysis(menuRow.strike)}>
              <BarChart3 className="h-3.5 w-3.5" /> View in OI Analysis
              <ContextMenuShortcut>↗</ContextMenuShortcut>
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
});

