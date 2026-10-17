/**
 * The single ordered column definition array. Header, body and footer all map over the visible
 * subset of columnDefs, so colSpans can never drift. CALL side renders the array as is (outer → strike),
 * PUT side renders it reversed (strike → outer).
 */
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { BUILDUP_LABEL, formatCompactIN, formatGreek, formatNumberIN, type OptionType, type Side } from "@/lib/options";
import { BUILDUP_SHORT, type ChainModel, type LegView, type RowView } from "./chainModel";
import { COLUMN_ORDER, type ColumnId } from "./preferences";
import { ChangeText, DerivedMark, LiquidityDots, LtpCell, OIBarCell } from "./cells";

export type ColumnGroup = "OI & volume" | "Price" | "Greeks" | "Probability" | "Liquidity";

export interface CellContext {
  side: OptionType;
  row: RowView;
  model: Pick<ChainModel, "maxOi" | "maxVol" | "maxAbsOiChg" | "maxOiStrike" | "maxVolStrike">;
  onTrade: (strike: number, type: OptionType, side: Side) => void;
}

export interface ColumnDef {
  id: ColumnId;
  /** Full name (column picker, tooltips). */
  label: string;
  /** Compact header text. */
  header: string;
  description: string;
  group: ColumnGroup;
  /** Tailwind min-width class for the cell. */
  width: string;
  cell: (lv: LegView, ctx: CellContext) => ReactNode;
  footer?: (m: ChainModel, side: OptionType) => ReactNode;
}

const DASH = "—";
const fin = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

function num(v: number, dp = 2): string {
  return fin(v) ? formatNumberIN(v, dp, { minDecimals: dp }) : DASH;
}

const BUILDUP_VARIANT = {
  LONG_BUILDUP: "bullish",
  SHORT_BUILDUP: "bearish",
  SHORT_COVERING: "info",
  LONG_UNWINDING: "warning",
  NEUTRAL: "neutral",
} as const;

function pctCell(p: number): ReactNode {
  return fin(p) ? `${(p * 100).toFixed(p >= 0.995 || p < 0.005 ? 0 : 1)}%` : DASH;
}

export const columnDefs: ColumnDef[] = [
  {
    id: "buildup",
    label: "Buildup",
    header: "Buildup",
    description: "LB long build-up, SB short build-up, SC short covering, LU long unwinding (price change × OI change)",
    group: "OI & volume",
    width: "min-w-[52px]",
    cell: (lv) =>
      lv.buildup && lv.buildup !== "NEUTRAL" ? (
        <Badge variant={BUILDUP_VARIANT[lv.buildup]} title={BUILDUP_LABEL[lv.buildup]} className="px-1">
          {BUILDUP_SHORT[lv.buildup]}
        </Badge>
      ) : (
        <span className="text-muted-foreground" title={lv.buildup ? "Neutral" : "No price change in the feed"}>{DASH}</span>
      ),
  },
  {
    id: "premium",
    label: "Premium traded",
    header: "Prem ₹",
    description: "Premium turnover today: volume × lot size × LTP (derived)",
    group: "Liquidity",
    width: "min-w-[64px]",
    cell: (lv) => (lv.premiumTraded > 0 ? formatCompactIN(lv.premiumTraded) : DASH),
    footer: (m, s) => formatCompactIN(s === "CE" ? m.totals.cePremium : m.totals.pePremium, { symbol: true }),
  },
  {
    id: "liquidity",
    label: "Liquidity score",
    header: "Liq",
    description: "1 (thin) to 5 (very liquid), from the bid-ask spread and volume rank",
    group: "Liquidity",
    width: "min-w-[48px]",
    cell: (lv) => <LiquidityDots score={lv.liquidity} />,
  },
  {
    id: "probTouch",
    label: "Probability of touch",
    header: "P.Touch",
    description: "Chance the underlying touches this strike before expiry (lognormal, from strike IV)",
    group: "Probability",
    width: "min-w-[56px]",
    cell: (lv) => pctCell(lv.probTouch),
  },
  {
    id: "probITM",
    label: "Probability ITM",
    header: "P.ITM",
    description: "Chance this option expires in the money, N(d2) on the forward",
    group: "Probability",
    width: "min-w-[52px]",
    cell: (lv) => pctCell(lv.probITM),
  },
  {
    id: "rho",
    label: "Rho (ρ)",
    header: "ρ",
    description: "Change in premium for a 1% change in interest rate (Black-Scholes, spot based)",
    group: "Greeks",
    width: "min-w-[52px]",
    cell: (lv) => formatGreek("rho", lv.rho),
  },
  {
    id: "vega",
    label: "Vega (ν)",
    header: "ν",
    description: "Change in premium for a 1 point change in IV",
    group: "Greeks",
    width: "min-w-[52px]",
    cell: (lv) => <DerivedMark on={lv.greeksDerived}>{lv.leg.vega ? formatGreek("vega", lv.leg.vega) : DASH}</DerivedMark>,
  },
  {
    id: "theta",
    label: "Theta (Θ)",
    header: "Θ",
    description: "Premium decay per calendar day, in rupees",
    group: "Greeks",
    width: "min-w-[56px]",
    cell: (lv) => <DerivedMark on={lv.greeksDerived}>{lv.leg.theta ? formatGreek("theta", lv.leg.theta) : DASH}</DerivedMark>,
  },
  {
    id: "gamma",
    label: "Gamma (Γ)",
    header: "Γ",
    description: "Change in delta for a 1 point move in the underlying",
    group: "Greeks",
    width: "min-w-[64px]",
    cell: (lv) => <DerivedMark on={lv.greeksDerived}>{lv.leg.gamma ? formatGreek("gamma", lv.leg.gamma) : DASH}</DerivedMark>,
  },
  {
    id: "delta",
    label: "Delta (Δ)",
    header: "Δ",
    description: "Change in premium for a 1 point move in the underlying",
    group: "Greeks",
    width: "min-w-[56px]",
    cell: (lv) => <DerivedMark on={lv.greeksDerived}>{lv.leg.delta ? formatGreek("delta", lv.leg.delta) : DASH}</DerivedMark>,
  },
  {
    id: "spread",
    label: "Spread %",
    header: "Sprd %",
    description: "Bid-ask spread as a percentage of mid price",
    group: "Liquidity",
    width: "min-w-[52px]",
    cell: (lv) =>
      fin(lv.spreadPct) ? <span className={cn(lv.spreadPct > 10 ? "text-bearish" : lv.spreadPct > 5 ? "text-warning" : "")}>{lv.spreadPct.toFixed(1)}%</span> : DASH,
  },
  {
    id: "bid",
    label: "Bid",
    header: "Bid",
    description: "Best bid price",
    group: "Price",
    width: "min-w-[56px]",
    cell: (lv) => (lv.leg.bidPrice > 0 ? num(lv.leg.bidPrice) : DASH),
  },
  {
    id: "ask",
    label: "Ask",
    header: "Ask",
    description: "Best ask price",
    group: "Price",
    width: "min-w-[56px]",
    cell: (lv) => (lv.leg.askPrice > 0 ? num(lv.leg.askPrice) : DASH),
  },
  {
    id: "volume",
    label: "Volume",
    header: "Volume",
    description: "Contracts traded today",
    group: "OI & volume",
    width: "min-w-[64px]",
    cell: (lv, ctx) => {
      const isMax = ctx.model.maxVolStrike[ctx.side === "CE" ? "ce" : "pe"] === ctx.row.strike;
      return (
        <span className="inline-flex items-center gap-1">
          {isMax && <Badge variant="info" className="h-4 px-1 text-[9px]" title="Highest volume on this side">MAX</Badge>}
          <span className={cn(isMax && "font-semibold text-foreground")}>{lv.leg.volume > 0 ? formatCompactIN(lv.leg.volume) : DASH}</span>
        </span>
      );
    },
    footer: (m, s) => formatCompactIN(s === "CE" ? m.totals.ceVol : m.totals.peVol),
  },
  {
    id: "oiChg",
    label: "OI change",
    header: "OI chg",
    description: "Change in open interest today, with % of the previous OI",
    group: "OI & volume",
    width: "min-w-[92px]",
    cell: (lv) => <ChangeText value={lv.leg.oiChange} pct={fin(lv.oiChgPct) ? lv.oiChgPct : null} compact />,
    footer: (m, s) => <ChangeText value={s === "CE" ? m.totals.ceOiChg : m.totals.peOiChg} compact />,
  },
  {
    id: "oi",
    label: "Open interest",
    header: "OI",
    description: "Open interest in contracts (lakh / crore)",
    group: "OI & volume",
    width: "min-w-[64px]",
    cell: (lv, ctx) => {
      const isMax = ctx.model.maxOiStrike[ctx.side === "CE" ? "ce" : "pe"] === ctx.row.strike;
      return (
        <span className="inline-flex items-center gap-1">
          {isMax && (
            <Badge variant={ctx.side === "CE" ? "bearish" : "bullish"} className="h-4 px-1 text-[9px]" title={`Highest ${ctx.side} OI`}>
              MAX
            </Badge>
          )}
          <span className={cn(isMax && (ctx.side === "CE" ? "font-bold text-bearish" : "font-bold text-bullish"))}>{lv.leg.oi > 0 ? formatCompactIN(lv.leg.oi) : DASH}</span>
        </span>
      );
    },
    footer: (m, s) => <span className={s === "CE" ? "text-bearish" : "text-bullish"}>{formatCompactIN(s === "CE" ? m.totals.ceOi : m.totals.peOi)}</span>,
  },
  {
    id: "oiBar",
    label: "OI bar",
    header: "OI bar",
    description: "OI relative to the largest strike (thick) and OI change (thin). CE in red, PE in green",
    group: "OI & volume",
    width: "min-w-[72px]",
    cell: (lv, ctx) => <OIBarCell lv={lv} ctx={ctx} />,
  },
  {
    id: "iv",
    label: "Implied volatility",
    header: "IV",
    description: "Implied volatility in %. Dotted underline = solved locally from the price",
    group: "Price",
    width: "min-w-[48px]",
    cell: (lv) => <DerivedMark on={lv.ivDerived}>{lv.leg.iv > 0 ? lv.leg.iv.toFixed(1) : DASH}</DerivedMark>,
  },
  {
    id: "ltpChg",
    label: "LTP change %",
    header: "Chg %",
    description: "LTP change vs previous close",
    group: "Price",
    width: "min-w-[60px]",
    cell: (lv) => <ChangeText value={null} pct={lv.ltpChgPct} />,
  },
  {
    id: "ltp",
    label: "LTP",
    header: "LTP",
    description: "Last traded price. Hover for B / S buttons that add the leg to your basket",
    group: "Price",
    width: "min-w-[84px]",
    cell: (lv, ctx) => <LtpCell lv={lv} ctx={ctx} />,
  },
];

// Keep columnDefs in canonical order (guards against accidental re-ordering above).
const ORDER_INDEX = new Map<ColumnId, number>(COLUMN_ORDER.map((id, i) => [id, i]));
columnDefs.sort((a, b) => (ORDER_INDEX.get(a.id) ?? 0) - (ORDER_INDEX.get(b.id) ?? 0));

export const columnById: Record<ColumnId, ColumnDef> = Object.fromEntries(columnDefs.map((c) => [c.id, c])) as Record<ColumnId, ColumnDef>;

export function visibleColumns(ids: readonly ColumnId[]): ColumnDef[] {
  const set = new Set(ids);
  return columnDefs.filter((c) => set.has(c.id));
}
