/**
 * Angel One trade book export (Reports → Trade Book → CSV). Columns such as Trade Date, Trade Time,
 * Symbol / Scrip Name, Trans Type (B/S), Quantity, Trade Price, Exchange, Order No, Trade No. Angel's
 * symbols put the day first: NIFTY27OCT2625000CE (DD MMM YY strike) or NIFTY27OCT26FUT.
 */
import type { ParseResult } from "../types";
import { parseWithSpec, type BrokerSpec } from "./engine";

export const ANGEL_SPEC: BrokerSpec = {
  source: "angel",
  style: "angel",
  columns: {
    symbol: ["Symbol", "Scrip Name", "Trading Symbol", "Scrip"],
    date: ["Trade Date", "Date"],
    time: ["Trade Time", "Time"],
    side: ["Trans Type", "Buy/Sell", "Transaction Type", "B/S"],
    qty: ["Quantity", "Qty", "Trade Qty"],
    price: ["Trade Price", "Price", "Rate"],
    tradeId: ["Trade No", "Trade Number", "Trade ID"],
    orderId: ["Order No", "Order Number", "Order ID"],
    exchange: ["Exchange"],
    segment: ["Segment"],
  },
  signature: ["trans type", "order no", "trade no", "b/s"],
};

export function parseAngel(text: string): ParseResult {
  return parseWithSpec(text, ANGEL_SPEC);
}
