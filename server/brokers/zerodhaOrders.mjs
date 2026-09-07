/**
 * Zerodha (Kite Connect) v3 Order Management — real order placement/status/cancel.
 *
 * Verified against Kite Connect's official docs (kite.trade/docs/connect/v3/orders/)
 * AND confirmed live: unauthenticated POST/GET/DELETE against api.kite.trade
 * (harmless — no credentials sent, no order can be placed without a real
 * token) all returned Kite's own `{"status":"error","message":"Incorrect
 * \`api_key\` or \`access_token\`.","data":null,"error_type":"TokenException"}`
 * rather than a 404/405 — i.e. every route this file calls exists and reaches
 * the same auth layer zerodha.mjs's existing 403-detection already targets.
 *
 * Only the "regular" order variety is implemented. Kite also supports amo,
 * co (cover), iceberg and auction varieties — real features, but out of
 * scope for this pass. `capabilities.cover = true` records that Kite itself
 * supports it even though this module doesn't wire a CO-specific call yet.
 *
 * `market_protection` (an aggressive-limit market order, 1-100 or -1 for
 * "auto") is documented as a real optional field but is NOT sent by
 * buildOrderBody() here — the spec's own Market Protection maths (§8) is
 * computed at the app layer instead, so double-applying protection at both
 * layers is avoided. capabilities.nativeMarketProtection records that Kite
 * *could* do this broker-side if a future change wants it.
 */

import { authHeaders, KITE_BASE } from "./zerodhaInstruments.mjs";

const VALID_TRANSACTION_TYPES = new Set(["BUY", "SELL"]);
const VALID_ORDER_TYPES = new Set(["MARKET", "LIMIT", "SL", "SL-M"]);
const VALID_PRODUCTS = new Set(["MIS", "NRML", "CNC", "MTF"]);
// TTL excluded — it requires a companion `validity_ttl` field the spec never
// calls for (index-option intents use DAY or IOC only); adding it unused
// would be an untested code path in a real-money file.
const VALID_VALIDITY = new Set(["DAY", "IOC"]);
const VARIETY = "regular";

/**
 * Capabilities descriptor — the UI must never offer a control this object
 * doesn't declare. Every value here is confirmed directly from Kite's own
 * documented `variety`/`product`/`validity` enums and optional-field list
 * (see file header) — none are guessed.
 */
export const capabilities = {
  bracket: false, // "bo" is NOT in Kite's documented variety enum (regular, amo, co, iceberg, auction) — Zerodha discontinued Bracket Orders API access.
  cover: true, // "co" IS a documented variety.
  ioc: true, // validity: DAY, IOC, or TTL — documented directly.
  mtf: true, // product: CNC, NRML, MIS, or MTF — documented directly.
  nativeMarketProtection: true, // market_protection (1-100 or -1 for auto) is a documented optional field — see file header for why it's unused here regardless.
  maxLegQty: null, // NEEDS VERIFICATION — Kite's order docs state no broker-specific per-order qty cap distinct from the NSE exchange-wide freeze quantity (spec §8 slicing); treat freeze-qty slicing as the effective limit until confirmed otherwise.
  products: ["CNC", "NRML", "MIS", "MTF"],
};

/**
 * Pure request-body builder, separated from placeOrder() so the payload
 * construction is directly unit-testable without a network call — same
 * separation dhanOrders.mjs uses and for the same reason.
 *
 * `resolvedLotSize` is a SEPARATE, REQUIRED parameter, never a field on
 * `order` — see dhanOrders.mjs's header for why trusting a client-supplied
 * lot size is a real-money bug (B1 in the spec). Unlike Dhan's payload,
 * Kite's order body carries no client-id field — the account is identified
 * entirely by the apiKey:accessToken in the Authorization header.
 */
export function buildOrderBody(order, resolvedLotSize) {
  const {
    tradingsymbol, exchange = "NFO", transactionType, orderType,
    product = "MIS", validity = "DAY", lots, price, triggerPrice, tag,
  } = order || {};

  if (!tradingsymbol) throw new Error("Missing tradingsymbol");
  if (!VALID_TRANSACTION_TYPES.has(transactionType)) throw new Error(`Invalid transactionType: ${transactionType}`);
  if (!VALID_ORDER_TYPES.has(orderType)) throw new Error(`Invalid orderType: ${orderType}`);
  if (!VALID_PRODUCTS.has(product)) throw new Error(`Invalid product: ${product}`);
  if (!VALID_VALIDITY.has(validity)) throw new Error(`Invalid validity: ${validity}`);
  if (!Number.isFinite(resolvedLotSize) || resolvedLotSize <= 0) {
    throw new Error(
      "Missing resolved lot size — it must come from the exchange instrument master, not from the client",
    );
  }
  if (!Number.isFinite(lots) || lots <= 0) throw new Error("Invalid lots");

  const needsTrigger = orderType === "SL" || orderType === "SL-M";
  if (needsTrigger && !Number.isFinite(triggerPrice)) throw new Error(`trigger_price required for ${orderType}`);
  const needsPrice = orderType === "LIMIT" || orderType === "SL";
  if (needsPrice && !Number.isFinite(price)) throw new Error(`price required for ${orderType}`);

  const body = {
    tradingsymbol,
    exchange,
    transaction_type: transactionType,
    order_type: orderType,
    quantity: Math.round(lots * resolvedLotSize),
    product,
    validity,
    price: needsPrice ? price : 0,
  };
  if (needsTrigger) body.trigger_price = triggerPrice;
  if (tag) body.tag = String(tag).slice(0, 20); // Kite documents tag as an alphanumeric identifier, max 20 chars
  return body;
}

function toFormBody(obj) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined && value !== null) params.append(key, String(value));
  }
  return params;
}

async function kiteOrdersFetch(path, creds, { method = "GET", form } = {}) {
  const res = await fetch(`${KITE_BASE}${path}`, {
    method,
    headers: {
      ...authHeaders(creds),
      ...(form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    body: form ? toFormBody(form) : undefined,
  });

  const json = await res.json().catch(() => null);
  if (!json) throw new Error(`Zerodha order API error [${res.status}] on ${path}`);
  if (json.status !== "success") {
    if (res.status === 403 || json.error_type === "TokenException") {
      throw new Error("Zerodha access token expired or invalid — generate a fresh token and paste it in Broker Settings.");
    }
    throw new Error(`Zerodha order API error: ${json.message || json.error_type || "unknown error"}`);
  }
  return json.data;
}

/**
 * Places a real order against Kite's "regular" variety. See buildOrderBody()
 * for payload construction/validation.
 */
export async function placeOrder(creds, order, resolvedLotSize) {
  const body = buildOrderBody(order, resolvedLotSize);
  const data = await kiteOrdersFetch(`/orders/${VARIETY}`, creds, { method: "POST", form: body });
  // Kite's place-order response carries only { order_id } — no status field
  // (see kite.trade/docs/connect/v3/orders/). This orderStatus is a LOCAL
  // placeholder, not a broker-native value; callers must call
  // getOrderStatus()/getOrders() for the real, current state.
  return { orderId: data.order_id, orderStatus: "SUBMITTED_TO_EXCHANGE", raw: data };
}

export async function getOrders(creds) {
  return kiteOrdersFetch("/orders", creds);
}

/** Kite's GET /orders/:order_id returns the full status-history array for that order; the last entry is current. */
export async function getOrderStatus(creds, orderId) {
  if (!orderId) throw new Error("Missing orderId");
  const history = await kiteOrdersFetch(`/orders/${encodeURIComponent(orderId)}`, creds);
  return Array.isArray(history) ? history[history.length - 1] : history;
}

export async function cancelOrder(creds, orderId) {
  if (!orderId) throw new Error("Missing orderId");
  const data = await kiteOrdersFetch(`/orders/${VARIETY}/${encodeURIComponent(orderId)}`, creds, { method: "DELETE" });
  return { orderId: data.order_id, orderStatus: "CANCELLED", raw: data };
}
