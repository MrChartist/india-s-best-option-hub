import { Profiler, memo, type ProfilerOnRenderCallback } from "react";
import { cn } from "@/lib/utils";
import { formatStrike, type OptionType, type Side } from "@/lib/options";
import type { RowView } from "./chainModel";
import type { CellContext, ColumnDef } from "./columns";
import { GAMMA_BADGE_TITLE, type GammaBadge } from "./gammaLevels";
import { TradeButtons } from "./cells";

export type DeltaMark = "16Δ" | "30Δ";

export interface ChainRowProps {
  row: RowView;
  ceCols: ColumnDef[];
  peCols: ColumnDef[];
  cellModel: CellContext["model"];
  onTrade: (strike: number, type: OptionType, side: Side) => void;
  onFocusRow: (strike: number, side: OptionType) => void;
  isATM: boolean;
  /** Within ±3 strikes of ATM (trade buttons stay faintly visible). */
  nearATM: boolean;
  isMaxPain: boolean;
  focused: boolean;
  focusedSide: OptionType;
  ceDelta?: DeltaMark;
  peDelta?: DeltaMark;
  gamma?: GammaBadge[];
  /** Optional React Profiler callback, called once per commit of this row (performance tests). */
  onRender?: ProfilerOnRenderCallback;
}

const GAMMA_CLASS: Record<GammaBadge, string> = {
  CW: "bg-wash-loss text-bearish",
  PW: "bg-wash-profit text-bullish",
  AG: "bg-wash-info text-info",
  FLIP: "bg-wash-warning text-warning",
};

/** Inline level badge next to the strike: 14px tall so the row keeps its fixed 32px height. */
const LEVEL_BADGE = "inline-flex h-[14px] shrink-0 items-center rounded-chip px-1 text-[9px] font-bold leading-none";

function ChainRowInner({
  row,
  ceCols,
  peCols,
  cellModel,
  onTrade,
  onFocusRow,
  isATM,
  nearATM,
  isMaxPain,
  focused,
  focusedSide,
  ceDelta,
  peDelta,
  gamma,
  onRender,
}: ChainRowProps) {
  const ceCtx: CellContext = { side: "CE", row, model: cellModel, onTrade };
  const peCtx: CellContext = { side: "PE", row, model: cellModel, onTrade };
  const ceItm = row.ce.itm;
  const peItm = row.pe.itm;

  const sideCell = (itm: boolean, delta: DeltaMark | undefined, isFocusedSide: boolean) =>
    cn(
      "h-8 px-2 py-0 tabular-nums whitespace-nowrap transition-colors duration-fast",
      itm && !isATM && "bg-[hsl(var(--wash-itm))]",
      delta && "bg-wash-info/80",
      focused && isFocusedSide && "bg-primary/[0.07]",
    );
  const lastPe = peCols.length - 1;

  const tr = (
    <tr
      data-strike={row.strike}
      aria-selected={focused}
      onClick={(e) => {
        const td = (e.target as HTMLElement).closest("td[data-side]");
        const side = (td?.getAttribute("data-side") as OptionType | null) ?? focusedSide;
        onFocusRow(row.strike, side);
      }}
      className={cn(
        "group/row h-8 border-b border-border/60 text-[12.5px] transition-colors duration-fast [contain-intrinsic-size:auto_32px] [content-visibility:auto] hover:bg-accent/50",
        isATM && "bg-wash-brand/30 shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.55)]",
        focused && "shadow-[inset_0_0_0_2px_hsl(var(--primary)/0.7)]",
      )}
    >
      {ceCols.map((c) => (
        <td key={`ce-${c.id}`} data-side="CE" className={cn(sideCell(ceItm, ceDelta, focusedSide === "CE"), c.width, "text-right")}>
          <div className="flex justify-end">{c.cell(row.ce, ceCtx)}</div>
        </td>
      ))}

      <td data-side="CE" className={cn("h-8 w-[52px] px-0.5 py-0 [@media(pointer:coarse)]:w-[62px]", ceItm && !isATM && "bg-[hsl(var(--wash-itm))]")}>
        <TradeButtons strike={row.strike} side="CE" onTrade={onTrade} near={nearATM} />
      </td>

      <th
        scope="row"
        className={cn(
          "sticky left-0 right-0 z-[1] h-8 whitespace-nowrap border-x border-border !px-2 !py-0 !text-center font-normal",
          isATM ? "bg-wash-brand" : "bg-surface",
        )}
      >
        <div className="flex min-w-[72px] items-center justify-center gap-1 sm:min-w-[88px]">
          {ceDelta && (
            <span className={cn(LEVEL_BADGE, "bg-info/15 text-info")} title={`CE nearest ${ceDelta}`}>
              {ceDelta}
            </span>
          )}
          <span className={cn("font-bold tabular-nums", isATM ? "text-primary-ink" : isMaxPain ? "text-warning" : "text-foreground")}>{formatStrike(row.strike)}</span>
          {isATM && <span className={cn(LEVEL_BADGE, "bg-primary text-primary-foreground")}>ATM</span>}
          {isMaxPain && (
            <span className={cn(LEVEL_BADGE, "bg-wash-warning text-warning")} title="Max pain: settlement strike with the least writer payout">
              MP
            </span>
          )}
          {gamma?.map((g) => (
            <span key={g} className={cn(LEVEL_BADGE, GAMMA_CLASS[g])} title={GAMMA_BADGE_TITLE[g]}>
              {g}
            </span>
          ))}
          {peDelta && (
            <span className={cn(LEVEL_BADGE, "bg-info/15 text-info")} title={`PE nearest ${peDelta}`}>
              {peDelta}
            </span>
          )}
        </div>
      </th>

      <td data-side="PE" className={cn("h-8 w-[52px] px-0.5 py-0 [@media(pointer:coarse)]:w-[62px]", peItm && !isATM && "bg-[hsl(var(--wash-itm))]")}>
        <TradeButtons strike={row.strike} side="PE" onTrade={onTrade} near={nearATM} />
      </td>

      {peCols.map((c, i) => (
        <td key={`pe-${c.id}`} data-side="PE" className={cn(sideCell(peItm, peDelta, focusedSide === "PE"), c.width, "text-left", i === lastPe && "pr-3")}>
          <div className="flex justify-start">{c.cell(row.pe, peCtx)}</div>
        </td>
      ))}
    </tr>
  );

  return onRender ? (
    <Profiler id={`chain-row-${row.strike}`} onRender={onRender}>
      {tr}
    </Profiler>
  ) : (
    tr
  );
}

export const ChainRow = memo(ChainRowInner);
