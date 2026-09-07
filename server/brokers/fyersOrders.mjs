/**
 * Fyers API v3 Order Management — real order placement/status/cancel.
 *
 * VERIFICATION TIER for this file (2026-09-06), stated explicitly given the
 * real-money stakes of getting an order payload wrong:
 *
 *  1. Routes CONFIRMED LIVE by unauthenticated probing of api-t1.fyers.in
 *     (harmless — no credentials sent, no order can be placed without a real
 *     token): POST /api/v3/orders/sync, DELETE /api/v3/orders/sync,
 *     GET /api/v3/orders, GET /api/v3/orders?id=..., and PATCH /api/v3/orders/sync
 *     all returned Fyers' own `{"s":"error","code":-16,"message":"Could not
 *     authenticate the user"}` rather than a 404/405 — i.e. every route this
 *     file calls exists and reaches Fyers' auth middleware. The `{s, code,
 *     message}` envelope matches fyers.mjs's existing `json.s !== "ok"` check.
 *  2. Request/response FIELD NAMES cross-referenced across three independent
 *     sources that agree on every field with no contradictions: FyersDev's own
 *     sample_v2/apiCalls.py (github.com/FyersDev/fyers-api-sample-code), the
 *     published @extra-fyers/http TypeScript definitions (npm — which enumerate
 *     PlaceOrderRequest/ModifyOrderRequest/CancelOrderRequest/Order field-by-
 *     field with doc comments), and multiple Fyers community-forum threads.
 *  3. NOT independently confirmed against Fyers' own interactive docs site
 *     (myapi.fyers.in/docsv3) — it is a JS-rendered SPA this tool could not
 *     render (repeated fetches 404'd). The numeric `type`/`side` enums below
 *     come from consistent secondary-source agreement, not a primary enum
 *     table screenshot.
 *
 * NEEDS VERIFICATION before the first real order (tracked here, not guessed
 * away — see capabilities below, which are deliberately conservative until
 * each is confirmed):
 *  - The exact numeric `type`/`side` enum against Fyers' own docs table.
 *  - Whether `validity: "IOC"` is honoured — only "DAY" appears in a
 *    Fyers-authored example; third-party guides assert IOC but no primary
 *    source was found. buildOrderBody() rejects anything but "DAY" so a bad
 *    value can't silently reach the exchange.
 *  - Whether "MTF" is a valid `productType` for F&O orders — a live 2026
 *    community bug report enumerates the accepted set as exactly
 *    CNC/INTRADAY/MARGIN (and shows BO/CO being rejected outright under v3).
 *  - Whether Fyers has any field equivalent to Kite's `tag`/`market_protection`
 *    — none appeared in any of the three cross-referenced sources, so no such
 *    field is sent, and `capabilities.nativeMarketProtection` is false.
 */

const FYERS_ORDERS_BASE = "https://api-t1.fyers.in/api/v3";

// Fyers' own vocabulary (Limit / Market / Stop (SL-M) / Stoplimit (SL-L)),
// kept broker-native like Dhan's STOP_LOSS/STOP_LOSS_MARKET naming — do not
// rename to another broker's terms, that's how a mapping bug hides.
const ORDER_TYPE_CODE = { LIMIT: 1, MARKET: 2, STOP: 3, STOPLIMIT: 4 };
const ORDER_SIDE_CODE = { BUY: 1, SELL: -1 };

// MTF intentionally excluded — see file header "NEEDS VERIFICATION". BO/CO
// intentionally excluded — confirmed rejected by Fyers API v3 (see capabilities).
const VALID_PRODUCT_TYPES = new Set(["CNC", "INTRADAY", "MARGIN"]);
// IOC intentionally excluded — see file header "NEEDS VERIFICATION".
const VALID_VALIDITY = new Set(["DAY"]);

/**
 * Capabilities descriptor — the UI must never offer a control this object
 * doesn't declare. Anything not independently confirmed defaults to the
 * SAFE/false/null value rather than an optimistic guess; see file header for
 * exactly what backs each `true`/populated value.
 */
export const capabilities = {
  bracket: false, // BO productType rejected by Fyers API v3 (community-confirmed error: only CNC/INTRADAY/MARGIN accepted).
  cover: false, // CO productType rejected alongside BO under v3 — same source.
  ioc: false, // NEEDS VERIFICATION — see file header.
  mtf: false, // NEEDS VERIFICATION — see file header.
  nativeMarketProtection: false, // NEEDS VERIFICATION — no equivalent field found in any cross-referenced source.
  maxLegQty: null, // NEEDS VERIFICATION — no Fyers-specific per-order qty cap found; do not read null as "unlimited". The NSE exchange-wide freeze quantity (spec §8 slicing) is the only confirmed ceiling.
  products: ["CNC", "INTRADAY", "MARGIN"],
};

/**
 * Pure request-body builder, separated from placeOrder() so the payload
 * construction is directly unit-testable without a network call — same
 * separation dhanOrders.mjs uses and for the same reason.
 *
 * `resolvedLotSize` is a SEPARATE, REQUIRED parameter, never a field on
 * `order` — see dhanOrders.mjs's header for why trusting a client-supplied
 * lot size is a real-money bug (B1 in the spec). Unlike Dhan's payload, Fyers'
 * order body carries no client-id field — the account is identified entirely
 * by the Authorization header, so buildOrderBody() here takes no clientId arg.
 */
export function buildOrderBody(order, resolvedLotSize) {
  const {
    symbol, side, orderType, productType = "INTRADAY", validity = "DAY",
    lots, limitPrice, stopPrice, disclosedQty = 0, offlineOrder = false,
  } = order || {};

  if (typeof symbol !== "string" || !symbol.includes(":")) {
    throw new Error(`Invalid Fyers symbol: ${symbol} (expected "EXCH:TRADINGSYMBOL", e.g. "NSE:NIFTY25SEP25000CE")`);
  }
  if (!ORDER_SIDE_CODE[side]) throw new Error(`Invalid side: ${side}`);
  if (!VALID_PRODUCT_TYPES.has(productType)) {
    throw new Error(
      `Unsupported Fyers productType: ${productType} (supported: ${[...VALID_PRODUCT_TYPES].join(", ")} — ` +
      `BO/CO are rejected by Fyers API v3, MTF is unverified for F&O orders)`,
    );
  }
  if (!VALID_VALIDITY.has(validity)) {
    throw new Error(`Unsupported Fyers validity: ${validity} (only "DAY" is verified — IOC needs confirmation against live docs first)`);
  }
  const typeCode = ORDER_TYPE_CODE[orderType];
  if (!typeCode) throw new Error(`Invalid orderType: ${orderType} (expected LIMIT, MARKET, STOP, or STOPLIMIT)`);
  if (!Number.isFinite(resolvedLotSize) || resolvedLotSize <= 0) {
    throw new Error(
      "Missing resolved lot size — it must come from the exchange instrument master, not from the client",
    );
  }
  if (!Number.isFinite(lots) || lots <= 0) throw new Error("Invalid lots");

  const needsLimit = orderType === "LIMIT" || orderType === "STOPLIMIT";
  const needsStop = orderType === "STOP" || orderType === "STOPLIMIT";
  if (needsLimit && !Number.isFinite(limitPrice)) throw new Error(`limitPrice required for ${orderType}`);
  if (needsStop && !Number.isFinite(stopPrice)) throw new Error(`stopPrice required for ${orderType}`);

  return {
    symbol,
    qty: Math.round(lots * resolvedLotSize),
    type: typeCode,
    side: ORDER_SIDE_CODE[side],
    productType,
    limitPrice: needsLimit ? limitPrice : 0,
    stopPrice: needsStop ? stopPrice : 0,
    disclosedQty,
    validity,
    offlineOrder: offlineOrder === true,
  };
}

function authHeader(creds) {
  const appId = creds?.appId;
  const accessToken = creds?.accessToken;
  if (!appId || !accessToken) {
    throw new Error("Fyers appId/accessToken missing — add credentials in Broker Settings.");
  }
  return `${appId}:${accessToken}`;
}

async function fyersOrdersFetch(path, creds, { method = "GET", body } = {}) {
  const res = await fetch(`${FYERS_ORDERS_BASE}${path}`, {
    method,
    headers: { Authorization: authHeader(creds), "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });

  let json = null;
  try {
    json = await res.json();
  } catch {
    /* fall through to the !json check below */
  }

  if (!res.ok || !json) {
    throw new Error(`Fyers order API error [${res.status}] on ${path.split("?")[0]}`);
  }
  if (json.s !== "ok") {
    const msg = json.message || `Fyers order API error (code ${json.code ?? "unknown"})`;
    if (/token|auth|expire/i.test(msg)) {
      throw new Error(`Fyers session token expired or invalid — re-paste a fresh accessToken from Fyers login. (${msg})`);
    }
    throw new Error(`Fyers order API error: ${msg}`);
  }
  return json;
}

/**
 * Places a real order via Fyers' synchronous order endpoint. See
 * buildOrderBody() for payload construction/validation.
 */
export async function placeOrder(creds, order, resolvedLotSize) {
  const body = buildOrderBody(order, resolvedLotSize);
  const json = await fyersOrdersFetch("/orders/sync", creds, { method: "POST", body });
  // Fyers' OrderResponse carries no status field on placement (only
  // {s, code, message, id} per the cross-referenced TS definitions) — this
  // orderStatus is a LOCAL placeholder, not a broker-native value. Callers
  // must call getOrderStatus()/getOrders() for the real, current state.
  return { orderId: json.id, orderStatus: "PENDING_CONFIRMATION", raw: json };
}

export async function getOrders(creds) {
  const json = await fyersOrdersFetch("/orders", creds);
  return json.orderBook || [];
}

export async function getOrderStatus(creds, orderId) {
  if (!orderId) throw new Error("Missing orderId");
  const json = await fyersOrdersFetch(`/orders?id=${encodeURIComponent(orderId)}`, creds);
  const rows = json.orderBook || [];
  const row = rows.find((r) => String(r.id) === String(orderId)) || rows[0];
  if (!row) throw new Error(`Fyers returned no order matching id ${orderId}`);
  return row;
}

export async function cancelOrder(creds, orderId) {
  if (!orderId) throw new Error("Missing orderId");
  const json = await fyersOrdersFetch("/orders/sync", creds, { method: "DELETE", body: { id: String(orderId) } });
  return { orderId: json.id, orderStatus: "CANCELLED", raw: json };
}
