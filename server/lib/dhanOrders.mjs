/**
 * Dhan v2 Order Management — real order placement/status/cancel.
 *
 * Verified against Dhan's live official docs (dhanhq.co/docs/v2/orders/), not
 * assumed from memory, given the real-money stakes of getting this wrong.
 *
 * IMPORTANT: Dhan's order placement/modification/cancellation APIs require the
 * calling IP to be a static IP registered with Dhan. This app runs local-first
 * by default (a dynamic home IP), so these calls will likely be rejected
 * unless the proxy is deployed somewhere with a whitelisted static IP. Callers
 * must surface Dhan's real rejection message rather than guessing/hiding it.
 */

import { dhanFetch } from "../brokers/dhan.mjs";

const VALID_TRANSACTION_TYPES = new Set(["BUY", "SELL"]);
const VALID_PRODUCT_TYPES = new Set(["CNC", "INTRADAY", "MARGIN", "MTF", "CO", "BO"]);
const VALID_ORDER_TYPES = new Set(["LIMIT", "MARKET", "STOP_LOSS", "STOP_LOSS_MARKET"]);
const VALID_VALIDITY = new Set(["DAY", "IOC"]);

/**
 * Pure request-body builder, separated from placeOrder() so the payload
 * construction — the part most likely to have a real-money-costing mistake —
 * is directly unit-testable without a network call.
 *
 * `resolvedLotSize` is a SEPARATE, REQUIRED parameter rather than a field on
 * `order`, and that separation is the point. It previously arrived inside the
 * order object, which meant it came from the browser — sourced from a hardcoded
 * LOT_SIZE_MAP that had drifted from NSE's actual lot sizes. Since quantity is
 * lots × lotSize, a stale constant silently placed the wrong size at market.
 *
 * Callers must obtain it from resolveLotSize() in instrumentLookup.mjs, which
 * reads the exchange's own instrument master and throws rather than guessing.
 * Any lotSize present on `order` is ignored on purpose.
 */
export function buildOrderBody(clientId, order, resolvedLotSize) {
  const {
    transactionType, exchangeSegment, productType = "INTRADAY", orderType,
    validity = "DAY", securityId, lots, price, triggerPrice, correlationId,
  } = order || {};

  if (!VALID_TRANSACTION_TYPES.has(transactionType)) throw new Error(`Invalid transactionType: ${transactionType}`);
  if (!VALID_PRODUCT_TYPES.has(productType)) throw new Error(`Invalid productType: ${productType}`);
  if (!VALID_ORDER_TYPES.has(orderType)) throw new Error(`Invalid orderType: ${orderType}`);
  if (!VALID_VALIDITY.has(validity)) throw new Error(`Invalid validity: ${validity}`);
  if (!securityId) throw new Error("Missing securityId");
  if (!Number.isFinite(lots) || lots <= 0) throw new Error("Invalid lots");
  if (!Number.isFinite(resolvedLotSize) || resolvedLotSize <= 0) {
    throw new Error(
      "Missing resolved lot size — it must come from the exchange instrument master, not from the client",
    );
  }
  const lotSize = resolvedLotSize;
  const needsTrigger = orderType === "STOP_LOSS" || orderType === "STOP_LOSS_MARKET";
  if (needsTrigger && !Number.isFinite(triggerPrice)) throw new Error(`triggerPrice required for ${orderType}`);

  const body = {
    dhanClientId: clientId,
    transactionType,
    exchangeSegment: exchangeSegment || "NSE_FNO",
    productType,
    orderType,
    validity,
    securityId: String(securityId),
    quantity: Math.round(lots * lotSize),
    price: orderType === "MARKET" ? 0 : price,
  };
  if (needsTrigger) body.triggerPrice = triggerPrice;
  if (correlationId) body.correlationId = correlationId;
  return body;
}

/**
 * Places a real order. See buildOrderBody() for payload construction/validation.
 *
 * `resolvedLotSize` must come from resolveLotSize() (instrumentLookup.mjs). The
 * proxy's place-order route resolves it via validateOrder() and passes it here;
 * there is no path that lets a browser-supplied lot size reach the exchange.
 */
export async function placeOrder(creds, order, resolvedLotSize) {
  const body = buildOrderBody(creds?.clientId, order, resolvedLotSize);
  return dhanFetch("/orders", body, "POST", creds?.clientId, creds?.accessToken);
}

export async function getOrders(creds) {
  return dhanFetch("/orders", null, "GET", creds?.clientId, creds?.accessToken);
}

export async function getOrderStatus(creds, orderId) {
  if (!orderId) throw new Error("Missing orderId");
  return dhanFetch(`/orders/${encodeURIComponent(orderId)}`, null, "GET", creds?.clientId, creds?.accessToken);
}

export async function cancelOrder(creds, orderId) {
  if (!orderId) throw new Error("Missing orderId");
  return dhanFetch(`/orders/${encodeURIComponent(orderId)}`, null, "DELETE", creds?.clientId, creds?.accessToken);
}
