import type { ReactNode } from "react";
import { BarChart3, Bell, FileSearch, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatCompactIN, formatDateIST, formatGreek, formatNumberIN, formatStrike, type OptionType, type Side } from "@/lib/options";
import type { LegView, RowView } from "./chainModel";
import { ChangePct, ChangeText, DerivedMark } from "./cells";

export interface StrikeInspectorProps {
  symbol: string;
  expiry: string;
  /** The focused row, or the ATM row when nothing is focused. */
  row: RowView | undefined;
  /** True when the row is the keyboard / click focus (false: showing ATM as the default). */
  focused: boolean;
  isATM: boolean;
  isMaxPain: boolean;
  onTrade: (strike: number, type: OptionType, side: Side) => void;
  onOpenContract: (strike: number, type: OptionType) => void;
  onAlert: (strike: number, type: OptionType) => void;
  onOIAnalysis: (strike: number) => void;
  onClose: () => void;
  className?: string;
}

const DASH = "—";
const fin = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const price = (v: number) => (v > 0 ? formatNumberIN(v, 2, { minDecimals: 2 }) : DASH);
const pct = (p: number) => (fin(p) ? `${(p * 100).toFixed(p >= 0.995 || p < 0.005 ? 0 : 1)}%` : DASH);

interface Field {
  label: string;
  value: (lv: LegView) => ReactNode;
}

const FIELDS: Field[] = [
  { label: "LTP", value: (lv) => <span className="font-semibold text-foreground">{price(lv.leg.ltp)}</span> },
  { label: "Change", value: (lv) => (lv.ltpChgPct !== null && fin(lv.ltpChgPct) ? <ChangePct pct={lv.ltpChgPct} /> : DASH) },
  { label: "Bid", value: (lv) => price(lv.leg.bidPrice) },
  { label: "Ask", value: (lv) => price(lv.leg.askPrice) },
  { label: "Spread", value: (lv) => (fin(lv.spreadPct) ? <span className={cn(lv.spreadPct > 10 ? "text-bearish" : lv.spreadPct > 5 ? "text-warning" : "")}>{lv.spreadPct.toFixed(1)}%</span> : DASH) },
  { label: "IV", value: (lv) => <DerivedMark on={lv.ivDerived}>{lv.leg.iv > 0 ? `${lv.leg.iv.toFixed(1)}%` : DASH}</DerivedMark> },
  { label: "Delta", value: (lv) => <DerivedMark on={lv.greeksDerived}>{lv.leg.delta ? formatGreek("delta", lv.leg.delta) : DASH}</DerivedMark> },
  { label: "Gamma", value: (lv) => <DerivedMark on={lv.greeksDerived}>{lv.leg.gamma ? formatGreek("gamma", lv.leg.gamma) : DASH}</DerivedMark> },
  { label: "Theta", value: (lv) => <DerivedMark on={lv.greeksDerived}>{lv.leg.theta ? formatGreek("theta", lv.leg.theta) : DASH}</DerivedMark> },
  { label: "Vega", value: (lv) => <DerivedMark on={lv.greeksDerived}>{lv.leg.vega ? formatGreek("vega", lv.leg.vega) : DASH}</DerivedMark> },
  { label: "OI", value: (lv) => (lv.leg.oi > 0 ? formatCompactIN(lv.leg.oi) : DASH) },
  { label: "OI change", value: (lv) => <ChangeText value={lv.leg.oiChange} compact /> },
  { label: "Volume", value: (lv) => (lv.leg.volume > 0 ? formatCompactIN(lv.leg.volume) : DASH) },
  { label: "Chance ITM", value: (lv) => pct(lv.probITM) },
];

/**
 * macOS-style inspector for one strike: calls and puts side by side as a grouped inset list, with
 * the row's actions underneath. Shown beside the chain on wide screens when toggled on.
 */
export function StrikeInspector({ symbol, expiry, row, focused, isATM, isMaxPain, onTrade, onOpenContract, onAlert, onOIAnalysis, onClose, className }: StrikeInspectorProps) {
  return (
    <aside aria-label="Strike inspector" className={cn("flex min-w-0 flex-col overflow-hidden rounded-tile border border-separator bg-card shadow-card", className)}>
      <header className="hairline-b flex h-10 shrink-0 items-center gap-2 bg-surface pl-3 pr-1.5">
        <h2 className="min-w-0 flex-1 truncate text-headline">
          {row ? (
            <>
              <span className="tabular-nums">{formatStrike(row.strike)}</span>
              {isATM ? <span className="ml-1.5 text-body-sm font-medium text-primary-ink">ATM</span> : null}
              {isMaxPain ? <span className="ml-1.5 text-body-sm font-medium text-warning">Max pain</span> : null}
            </>
          ) : (
            "Strike inspector"
          )}
        </h2>
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onClose} aria-label="Close the strike inspector">
          <X className="!size-3.5" />
        </Button>
      </header>

      {!row ? (
        <p className="p-4 text-body-sm text-muted-foreground">Click a row, or press J / K, to inspect a strike.</p>
      ) : (
        <div className="space-y-3 p-3">
          <p className="px-1 text-body-sm text-muted-foreground">
            {symbol} · {expiry ? formatDateIST(expiry) : DASH}
            {focused ? "" : " · nearest the money"}
          </p>

          <div className="overflow-hidden rounded-[8px] bg-surface shadow-[0_0_0_var(--hairline)_hsl(var(--separator))]">
            <table className="w-full font-num text-body-sm tabular-nums">
              <caption className="sr-only">
                Calls and puts at {formatStrike(row.strike)}
              </caption>
              <thead>
                <tr className="hairline-b">
                  <th scope="col" className="!py-1 text-left">
                    <span className="sr-only">Field</span>
                  </th>
                  <th scope="col" className="!py-1 text-right text-bearish">CE</th>
                  <th scope="col" className="!py-1 text-right text-bullish">PE</th>
                </tr>
              </thead>
              <tbody className="zebra-rows">
                {FIELDS.map((f) => (
                  <tr key={f.label}>
                    <th scope="row" className="!py-[3px] !font-normal text-muted-foreground">{f.label}</th>
                    <td className="!py-[3px] text-right">{f.value(row.ce)}</td>
                    <td className="!py-[3px] text-right">{f.value(row.pe)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="grid grid-cols-2 gap-1.5">
            {(["CE", "PE"] as const).map((t) => (
              <div key={t} role="group" aria-label={`${formatStrike(row.strike)} ${t}`} className="space-y-1.5">
                <p className={cn("px-1 text-label", t === "CE" ? "text-bearish" : "text-bullish")}>{t === "CE" ? "Call" : "Put"}</p>
                <div className="grid grid-cols-2 gap-1">
                  <Button size="sm" variant="outline" className="font-semibold text-bullish" onClick={() => onTrade(row.strike, t, "BUY")}>
                    Buy
                  </Button>
                  <Button size="sm" variant="outline" className="font-semibold text-bearish" onClick={() => onTrade(row.strike, t, "SELL")}>
                    Sell
                  </Button>
                </div>
                <Button size="sm" variant="outline" className="w-full" onClick={() => onOpenContract(row.strike, t)}>
                  <FileSearch aria-hidden="true" /> Contract
                </Button>
                <Button size="sm" variant="ghost" className="w-full" onClick={() => onAlert(row.strike, t)}>
                  <Bell aria-hidden="true" /> Alert…
                </Button>
              </div>
            ))}
          </div>

          <Button size="sm" variant="ghost" className="w-full" onClick={() => onOIAnalysis(row.strike)}>
            <BarChart3 aria-hidden="true" /> View in OI Analysis
          </Button>
          <p className="px-1 text-micro text-muted-foreground">Buy and Sell add a leg to the basket. Nothing is sent to a broker.</p>
        </div>
      )}
    </aside>
  );
}
