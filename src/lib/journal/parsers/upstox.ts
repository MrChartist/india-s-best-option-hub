/**
 * Upstox trade report (Reports → Trade → CSV). Upstox exports separate columns for the underlying,
 * strike, expiry and option type: Date, Company / Scrip Name, Exchange, Segment, Scrip Code,
 * Instrument Type, Strike Price, Option Type, Expiry, Trade Num, Trade Time, Side, Quantity, Price.
 * When those columns are missing the scrip name is parsed as a symbol.
 */
import type { ParseResult } from "../types";
import { parseWithSpec, type BrokerSpec } from "./engine";

export const UPSTOX_SPEC: BrokerSpec = {
  source: "upstox",
  style: "auto",
  columns: {
    symbol: ["Company", "Scrip Name", "Symbol", "Instrument Name", "Underlying"],
    date: ["Date", "Trade Date"],
    time: ["Trade Time", "Time"],
    side: ["Side", "Buy/Sell", "Transaction Type"],
    qty: ["Quantity", "Qty"],
    price: ["Price", "Trade Price", "Rate"],
    tradeId: ["Trade Num", "Trade No", "Trade ID"],
    orderId: ["Order Num", "Order No", "Order ID"],
    exchange: ["Exchange"],
    expiry: ["Expiry", "Expiry Date"],
    strike: ["Strike Price", "Strike"],
    optionType: ["Option Type", "CE/PE"],
    instrument: ["Instrument Type", "Instrument"],
    segment: ["Segment"],
  },
  signature: ["scrip code", "trade num", "instrument type", "strike price"],
};

export function parseUpstox(text: string): ParseResult {
  return parseWithSpec(text, UPSTOX_SPEC);
}
