/** Paper-account trades as journal fills (charges and expiry settlements come from the paper ledger). */
import type { PaperState } from "@/lib/paperTrading";
import type { JournalFill } from "./types";

export function fillsFromPaper(state: Pick<PaperState, "trades"> | null | undefined): JournalFill[] {
  if (!state) return [];
  return state.trades.map((t) => ({
    id: `paper:${t.id}`,
    source: "paper" as const,
    orderId: t.orderId,
    underlying: t.symbol,
    expiry: t.expiry,
    strike: t.strike,
    type: t.type,
    side: t.side,
    qty: t.lots * t.lotSize,
    price: t.price,
    date: t.date,
    ts: t.ts,
    exchange: t.symbol === "SENSEX" || t.symbol === "BANKEX" ? ("BSE" as const) : ("NSE" as const),
    settlement: t.kind === "SETTLEMENT" ? true : undefined,
    knownCharges: t.charges,
    label: `${t.symbol} ${t.strike} ${t.type}`,
  }));
}
