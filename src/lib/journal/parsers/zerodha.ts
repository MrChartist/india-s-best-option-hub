/**
 * Zerodha Console tradebook (Reports → Tradebook → F&O → CSV). Columns:
 * symbol, isin, trade_date, exchange, segment, series, trade_type, auction, quantity, price, trade_id,
 * order_id, order_execution_time, expiry_date. Symbols use Zerodha's weekly (NIFTY2610625000CE) or
 * monthly (NIFTY26OCT25000CE) format.
 */
import type { ParseResult } from "../types";
import { parseWithSpec, type BrokerSpec } from "./engine";

export const ZERODHA_SPEC: BrokerSpec = {
  source: "zerodha",
  style: "zerodha",
  columns: {
    symbol: ["symbol", "tradingsymbol", "instrument"],
    date: ["trade_date", "date"],
    time: ["order_execution_time", "execution_time", "time"],
    side: ["trade_type", "type", "transaction_type"],
    qty: ["quantity", "qty"],
    price: ["price", "average_price"],
    tradeId: ["trade_id"],
    orderId: ["order_id"],
    exchange: ["exchange"],
    expiry: ["expiry_date"],
    segment: ["segment"],
  },
  signature: ["trade_type", "order_execution_time", "isin", "auction", "series"],
};

export function parseZerodha(text: string): ParseResult {
  return parseWithSpec(text, ZERODHA_SPEC);
}
