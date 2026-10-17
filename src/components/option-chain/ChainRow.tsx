import { memo } from "react";
import { cn } from "@/lib/utils";
import { formatStrike, type OptionType, type Side } from "@/lib/options";
import type { RowView } from "./chainModel";
import type { CellContext, ColumnDef } from "./columns";
import { GAMMA_BADGE_TITLE, type GammaBadge } from "./gammaLevels";

export type DeltaMark = "16Δ" | "30Δ";

export interface ChainRowProps {
  row: RowView;
  ceCols: ColumnDef[];
  peCols: ColumnDef[];
  cellModel: CellContext["model"];
  onTrade: (strike: number, type: OptionType, side: Side) => void;
  onFocusRow: (strike: number, side: OptionType) => void;
  isATM: boolean;
  isMaxPain: boolean;
  focused: boolean;
  focusedSide: OptionType;
  ceDelta?: DeltaMark;
  peDelta?: DeltaMark;
  gamma?: GammaBadge[];
}

const GAMMA_CLASS: Record<GammaBadge, string> = {
  CW: "bg-wash-loss text-bearish",
  PW: "bg-wash-profit text-bullish",
  AG: "bg-wash-info text-info",
  FLIP: "bg-wash-warning text-warning",
};

function ChainRowInner({
  row,
  ceCols,
  peCols,
  cellModel,
  onTrade,
  onFocusRow,
  isATM,
  isMaxPain,
  focused,
  focusedSide,
  ceDelta,
  peDelta,
  gamma,
}: ChainRowProps) {
  const ceCtx: CellContext = { side: "CE", row, model: cellModel, onTrade };
  const peCtx: CellContext = { side: "PE", row, model: cellModel, onTrade };
  const ceItm = row.ce.itm;
  const peItm = row.pe.itm;

  const sideCell = (itm: boolean, delta: DeltaMark | undefined, isFocusedSide: boolean) =>
    cn(
      "px-2 py-1.5 tabular-nums whitespace-nowrap transition-colors duration-fast",
      itm && !isATM && "bg-wash-warning/45",
      delta && "bg-wash-info/80",
      focused && isFocusedSide && "bg-primary/[0.07]",
    );

  return (
    <tr
      data-strike={row.strike}
      aria-selected={focused}
      onClick={(e) => {
        const td = (e.target as HTMLElement).closest("td[data-side]");
        const side = (td?.getAttribute("data-side") as OptionType | null) ?? focusedSide;
        onFocusRow(row.strike, side);
      }}
      className={cn(
        "group/row border-b border-border/60 text-[12.5px] transition-colors duration-fast hover:bg-accent/50",
        isATM && "bg-wash-brand/55 shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.45)]",
        focused && "shadow-[inset_0_0_0_2px_hsl(var(--primary)/0.7)]",
      )}
    >
      {ceCols.map((c) => (
        <td key={`ce-${c.id}`} data-side="CE" className={cn(sideCell(ceItm, ceDelta, focusedSide === "CE"), c.width, "text-right")}>
          <div className="flex justify-end">{c.cell(row.ce, ceCtx)}</div>
        </td>
      ))}

      <td className={cn("border-x border-border px-2 py-1 text-center", isATM ? "bg-wash-brand" : "bg-surface")}>
        <div className="flex min-w-[92px] flex-col items-center gap-0.5">
          <div className="flex items-center gap-1">
            {ceDelta && <span className="rounded-chip bg-info/15 px-1 text-[9px] font-semibold text-info" title={`CE nearest ${ceDelta}`}>{ceDelta}</span>}
            <span className={cn("font-bold tabular-nums", isATM ? "text-primary-ink" : isMaxPain ? "text-warning" : "text-foreground")}>{formatStrike(row.strike)}</span>
            {peDelta && <span className="rounded-chip bg-info/15 px-1 text-[9px] font-semibold text-info" title={`PE nearest ${peDelta}`}>{peDelta}</span>}
          </div>
          {(isATM || isMaxPain || (gamma && gamma.length > 0)) && (
            <div className="flex flex-wrap items-center justify-center gap-0.5">
              {isATM && <span className="rounded-chip bg-primary px-1 text-[9px] font-bold leading-[14px] text-primary-foreground">ATM</span>}
              {isMaxPain && <span className="rounded-chip bg-wash-warning px-1 text-[9px] font-bold leading-[14px] text-warning" title="Max pain: settlement strike with the least writer payout">MP</span>}
              {gamma?.map((g) => (
                <span key={g} className={cn("rounded-chip px-1 text-[9px] font-bold leading-[14px]", GAMMA_CLASS[g])} title={GAMMA_BADGE_TITLE[g]}>
                  {g}
                </span>
              ))}
            </div>
          )}
        </div>
      </td>

      {peCols.map((c) => (
        <td key={`pe-${c.id}`} data-side="PE" className={cn(sideCell(peItm, peDelta, focusedSide === "PE"), c.width, "text-left")}>
          <div className="flex justify-start">{c.cell(row.pe, peCtx)}</div>
        </td>
      ))}
    </tr>
  );
}

export const ChainRow = memo(ChainRowInner);
