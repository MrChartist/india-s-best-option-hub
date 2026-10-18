/**
 * HDFC Securities (InvestRight): order request building and the three real-money calls. The raw calls are
 * module-private; only the withOrderGate-wrapped placeOrder/modifyOrder/cancelOrder are exported.
 *
 * Official docs (https://developer.hdfcsec.com/ir-docs/docs/place_order, modify_order, cancel_order):
 *   POST   /oapi/v1/orders/regular              -> {status:"success", data:{order_id}}
 *   PUT    /oapi/v1/orders/regular/:order_id    (quantity, order_type, validity, disclosed_quantity,
 *                                                product, price, trigger_price, amo)
 *   DELETE /oapi/v1/orders/regular/:order_id
 * Enums from the glossary: order_type MARKET | LIMIT | SL | SL-M; product DELIVERY (cash) |
 * OVERNIGHT (F&O carry) | INTRADAY | MTF; validity DAY | IOC | GTD.
 * Where the docs disagree with themselves we follow the worked curl samples, which are real requests:
 *   - expiry_date: the table says YYYY-MM-DD, the samples send "20240425" (YYYYMMDD). We send YYYYMMDD.
 *   - option_type: the table says CALL/PUT, the samples send "CE". We send CE/PE.
 *   - transaction_type: the table says BUY or SELL, the samples send "Buy". We send BUY/SELL (the table),
 *     which OpenAlgo also sends; flagged for live verification.
 *   - security_id / underlying_symbol come from the security master (security_id, underline_symbol).
 * Quantity is lots x resolvedLotSize. resolvedLotSize comes from the server's own instrument lookup,
 * never from the client.
 */

import { BrokerInputError, withOrderGate } from "./contract.mjs";
import { irRequest } from "./hdfcsecuritiesAuth.mjs";
import { contractExchangeOf, findRow } from "./hdfcsecuritiesInstruments.mjs";
import { fetchRawOrders, orderStatusOf } from "./hdfcsecuritiesPortfolio.mjs";

const ORDER_TYPES = { MARKET: "MARKET", LIMIT: "LIMIT", SL: "SL", "SL-M": "SL-M", SLM: "SL-M" };
const VALIDITIES = new Set(["DAY", "IOC"]);
const CASH_PRODUCTS = { CNC: "DELIVERY", INTRADAY: "INTRADAY", MTF: "MTF" };
const DERIV_PRODUCTS = { INTRADAY: "INTRADAY", MARGIN: "OVERNIGHT" };

function positiveInt(v, what) {
  const x = Number(v);
  if (!Number.isInteger(x) || x <= 0) throw new BrokerInputError(`HDFC Securities order: ${what} must be a positive whole number.`);
  return x;
}

function price(v, what, required) {
  const x = Number(v ?? 0);
  if (!Number.isFinite(x) || x < 0) throw new BrokerInputError(`HDFC Securities order: ${what} is not a valid price.`);
  if (required && x <= 0) throw new BrokerInputError(`HDFC Securities order: ${what} is required for this order type.`);
  return x;
}

function orderTypeOf(v) {
  const t = ORDER_TYPES[String(v ?? "").toUpperCase()];
  if (!t) throw new BrokerInputError("HDFC Securities order: orderType must be MARKET, LIMIT, SL or SL-M.");
  return t;
}

function validityOf(v) {
  const s = String(v ?? "DAY").toUpperCase();
  if (!VALIDITIES.has(s)) throw new BrokerInputError("HDFC Securities order: validity must be DAY or IOC.");
  return s;
}

/**
 * Pure: InvestRight place-order body for a security-master row.
 * order = { exchange, token, side: BUY|SELL, product: CNC|INTRADAY|MARGIN|MTF, orderType, validity?, lots,
 *           price?, triggerPrice?, amo?, tag? }
 */
export function buildOrderBody(row, order, resolvedLotSize, { reference = String(Date.now()) } = {}) {
  if (!row) throw new BrokerInputError("HDFC Securities order: instrument not found in the security master.");
  const exchange = contractExchangeOf(row);
  if (!exchange || exchange !== String(order?.exchange ?? "").toUpperCase()) throw new BrokerInputError("HDFC Securities order: exchange does not match the instrument.");
  const isDeriv = exchange === "NFO" || exchange === "BFO";
  const lot = positiveInt(resolvedLotSize, "resolvedLotSize");
  const lots = positiveInt(order.lots, "lots");
  const orderType = orderTypeOf(order.orderType);
  const side = String(order.side ?? "").toUpperCase();
  if (side !== "BUY" && side !== "SELL") throw new BrokerInputError("HDFC Securities order: side must be BUY or SELL.");
  const product = (isDeriv ? DERIV_PRODUCTS : CASH_PRODUCTS)[String(order.product ?? "").toUpperCase()];
  if (!product) throw new BrokerInputError(`HDFC Securities order: product ${order.product} is not allowed on ${exchange}.`);

  const body = {
    exchange: String(row.exchange).toUpperCase(),
    security_id: String(row.security_id),
    instrument_segment: String(row.instrument_segment).toUpperCase(),
    transaction_type: side,
    product,
    order_type: orderType,
    quantity: lots * lot,
    price: price(order.price, "price", orderType === "LIMIT" || orderType === "SL"),
    trigger_price: price(order.triggerPrice, "triggerPrice", orderType === "SL" || orderType === "SL-M"),
    disclosed_quantity: 0,
    validity: validityOf(order.validity),
    amo: order.amo === true,
    external_reference_number: String(reference).replace(/\D/g, "").slice(0, 20) || "1",
  };
  if (orderType === "MARKET" || orderType === "SL-M") body.price = 0;
  if (orderType === "MARKET" || orderType === "LIMIT") body.trigger_price = 0;
  if (isDeriv) {
    body.expiry_date = String(row.expiry_date).replace(/-/g, "");
    body.underlying_symbol = String(row.underline_symbol || "");
    if (body.instrument_segment.startsWith("OPT")) {
      body.option_type = String(row.option_type).toUpperCase();
      body.strike_price = Number(row.strike_price);
    }
  }
  return body;
}

/** Pure: modify body from an order-book row plus the requested changes. */
export function buildModifyBody(existing, changes = {}) {
  const orderType = orderTypeOf(changes.orderType ?? existing?.order_type);
  const body = {
    quantity: positiveInt(changes.quantity ?? existing?.quantity, "quantity"),
    order_type: orderType,
    validity: validityOf(changes.validity ?? existing?.validity),
    disclosed_quantity: 0,
    product: String(existing?.product ?? "").toUpperCase(),
    price: price(changes.price ?? existing?.price, "price", orderType === "LIMIT" || orderType === "SL"),
    trigger_price: price(changes.triggerPrice ?? existing?.trigger_price, "triggerPrice", orderType === "SL" || orderType === "SL-M"),
    amo: false,
  };
  if (!body.product) throw new BrokerInputError("HDFC Securities modify: the order's product is unknown.");
  if (orderType === "MARKET" || orderType === "SL-M") body.price = 0;
  if (orderType === "MARKET" || orderType === "LIMIT") body.trigger_price = 0;
  return body;
}

function idOf(orderId) {
  const id = String(orderId ?? "").trim();
  if (!/^[A-Za-z0-9-]{1,40}$/.test(id)) throw new BrokerInputError("HDFC Securities: orderId is not valid.");
  return id;
}

async function placeOrderImpl(creds, order, resolvedLotSize) {
  const row = await findRow(order?.exchange, order?.token);
  const body = buildOrderBody(row, order, resolvedLotSize);
  const json = await irRequest(creds, "POST", "/oapi/v1/orders/regular", { body });
  const orderId = String(json?.data?.order_id ?? "");
  if (!orderId) throw new BrokerInputError("HDFC Securities did not return an order id.");
  return { orderId, orderStatus: "OPEN" };
}

async function modifyOrderImpl(creds, orderId, changes) {
  const id = idOf(orderId);
  const existing = (await fetchRawOrders(creds)).find((o) => String(o.order_id) === id);
  if (!existing) throw new BrokerInputError(`HDFC Securities: order ${id} is not in today's order book.`);
  const json = await irRequest(creds, "PUT", `/oapi/v1/orders/regular/${encodeURIComponent(id)}`, { body: buildModifyBody(existing, changes) });
  return { orderId: String(json?.data?.order_id ?? id), orderStatus: orderStatusOf(existing.status) === "TRIGGER_PENDING" ? "TRIGGER_PENDING" : "OPEN" };
}

async function cancelOrderImpl(creds, orderId) {
  const id = idOf(orderId);
  const json = await irRequest(creds, "DELETE", `/oapi/v1/orders/regular/${encodeURIComponent(id)}`);
  // The cancel call only acknowledges the request; callers re-read the order book for the final state.
  return { orderId: String(json?.data?.order_id ?? id), orderStatus: "UNKNOWN" };
}

// The raw calls above stay module-private: only these gated wrappers can reach the broker.
export const placeOrder = withOrderGate("placeOrder", placeOrderImpl, { brokerId: "hdfcsecurities" });
export const modifyOrder = withOrderGate("modifyOrder", modifyOrderImpl, { brokerId: "hdfcsecurities" });
export const cancelOrder = withOrderGate("cancelOrder", cancelOrderImpl, { brokerId: "hdfcsecurities" });
