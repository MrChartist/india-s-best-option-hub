/**
 * Dhan trade history export (Statements → Trade History → CSV). Typical columns:
 * Date, Time, Name / Security Name, Buy/Sell, Order Type, Exchange, Segment, Quantity, Trade Price,
 * Trade Value, Order ID, Trade ID. Instrument names look like "NIFTY 27 OCT 25000 CALL" or
 * "NIFTY-Oct2026-25000-CE".
 */
import type { ParseResult } from "../types";
import { parseWithSpec, type BrokerSpec } from "./engine";

export const DHAN_SPEC: BrokerSpec = {
  source: "dhan",
  style: "auto",
  columns: {
    symbol: ["Security Name", "Name", "Scrip Name", "Instrument", "Trading Symbol", "Symbol"],
    date: ["Date", "Trade Date"],
    time: ["Time", "Trade Time"],
    side: ["Buy/Sell", "Transaction Type", "Txn Type", "Side"],
    // "Quantity/Lot" last: parseQtyUnits reads "65/1" as 65 units and converts a lot count
    // (a value that is not a whole number of lots) to units, so P&L and charges are not understated.
    qty: ["Quantity", "Qty", "Traded Qty", "Quantity/Lot"],
    price: ["Trade Price", "Price", "Avg Price", "Traded Price"],
    tradeId: ["Trade ID", "Trade No", "Exchange Trade ID"],
    orderId: ["Order ID", "Order No", "Exchange Order ID"],
    exchange: ["Exchange"],
    segment: ["Segment"],
  },
  signature: ["security name", "buy/sell", "trade value", "exchange trade id"],
};

export function parseDhan(text: string): ParseResult {
  return parseWithSpec(text, DHAN_SPEC);
}
