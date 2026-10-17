/**
 * Shared order-management logic for the "Noren" OMS family — Flattrade,
 * Shoonya, TradeSmart and Zebu all run white-label deployments of the same
 * backend (NorenWClientAPI / NorenWClientAPIv2). Their own module headers in
 * this repo already establish the shared lineage for market data (identical
 * jData envelope, identical {stat,emsg} error shape, identical GetQuotes/
 * Limits field names) — order placement/status/cancel share that same
 * backend, so this is the ONE copy of that HTTP glue. Each broker file
 * supplies only what actually differs: its own `postJData` (base URL + auth
 * transport, already built in <broker>Auth.mjs) and which credential field
 * holds the trading `uid`.
 *
 * NEEDS VERIFICATION (no live account, no network access from this repo's
 * tests): the endpoint paths and field names below (PlaceOrder / OrderBook /
 * SingleOrdStatus / CancelOrder, tsym/qty/prc/prd/trantype/prctyp/ret/trgprc/
 * norenordno) follow the Noren OMS API surface documented across this
 * broker family's own public docs and the openalgo adapters this repo's
 * other Noren-family files already cite for GetQuotes/Limits. None of it has
 * been exercised against a live order-placement endpoint — this codebase
 * never mocks HTTP in tests (see dhanOrders.test.mjs precedent), so only the
 * pure buildOrderBody() below is unit-tested. Confirm every field name
 * against a live sandbox account before any live order flows through this.
 *
 * Deliberately mirrors dhanOrders.mjs:
 *  - buildOrderBody() is pure and separated from the network call, so the
 *    part most likely to have a real-money-costing mistake is directly
 *    unit-testable without a network call.
 *  - `resolvedLotSize` is a SEPARATE, REQUIRED parameter, never trusted from
 *    `order.lotSize` — see dhanOrders.mjs's header for why (B1: a stale
 *    client-side lot-size map silently doubled/halved order size in prod).
 *  - `order.securityId` carries whatever uniquely identifies the instrument
 *    to THIS broker's OMS. Dhan uses a numeric security ID there; the Noren
 *    family has no such numeric id at the order layer, so this field is
 *    expected to hold the broker's trading symbol (tsym) string instead —
 *    resolution from strike/expiry to that string happens upstream, the same
 *    place Dhan's numeric id gets resolved. `order.tradingSymbol` is
 *    accepted as an explicit alias if a caller prefers to name it that way.
 *
 * One quirk worth flagging: every <broker>Auth.mjs's postJData() already
 * unconditionally injects `uid`/`actid` from `creds` into the request body
 * before sending (see e.g. flattradeAuth.mjs's postJData). So the uid/actid
 * this module puts into buildOrderBody's output is advisory/testable shape,
 * not load-bearing — the network boundary overwrites it either way. `uid` is
 * still taken as an explicit parameter (rather than reached for internally)
 * to mirror dhanOrders.mjs's buildOrderBody(clientId, order, resolvedLotSize)
 * signature exactly.
 */

const VALID_TRANSACTION_TYPES = new Set(["BUY", "SELL"]);
const VALID_PRODUCT_TYPES = new Set(["CNC", "INTRADAY", "MARGIN", "MTF", "CO", "BO"]);
const VALID_ORDER_TYPES = new Set(["LIMIT", "MARKET", "STOP_LOSS", "STOP_LOSS_MARKET"]);
const VALID_VALIDITY = new Set(["DAY", "IOC"]);

// App-wide exchangeSegment values (see instrumentLookup.mjs's SEGMENT_MAP) ->
// Noren's own `exch` codes.
const EXCHANGE_SEGMENT_MAP = { NSE_FNO: "NFO", BSE_FNO: "BFO", MCX_COMM: "MCX" };

// Generic wire-format product/order-type/side -> Noren's native short codes.
// MTF has no distinct Noren product code in any doc found in this repo or
// cited by it; mapped to the same "M" (margin/NRML) code pending broker
// confirmation — see the capabilities block in each adapter file (mtf: false
// until verified).
const PRODUCT_CODE_MAP = { CNC: "C", INTRADAY: "I", MARGIN: "M", MTF: "M", CO: "H", BO: "B" };
const ORDER_TYPE_CODE_MAP = { LIMIT: "LMT", MARKET: "MKT", STOP_LOSS: "SL-LMT", STOP_LOSS_MARKET: "SL-MKT" };
const TRANSACTION_CODE_MAP = { BUY: "B", SELL: "S" };

/**
 * Pure request-body builder, separated from placeOrder() so the payload
 * construction is directly unit-testable without a network call. See the
 * file header for how each field maps and why `resolvedLotSize` is required
 * and separate from `order`.
 */
export function buildOrderBody(uid, order, resolvedLotSize) {
  const {
    transactionType, exchangeSegment = "NSE_FNO", productType = "INTRADAY", orderType,
    validity = "DAY", securityId, tradingSymbol, lots, price, triggerPrice, correlationId,
  } = order || {};

  if (!VALID_TRANSACTION_TYPES.has(transactionType)) throw new Error(`Invalid transactionType: ${transactionType}`);
  if (!VALID_PRODUCT_TYPES.has(productType)) throw new Error(`Invalid productType: ${productType}`);
  if (!VALID_ORDER_TYPES.has(orderType)) throw new Error(`Invalid orderType: ${orderType}`);
  if (!VALID_VALIDITY.has(validity)) throw new Error(`Invalid validity: ${validity}`);

  const symbol = tradingSymbol || securityId;
  if (!symbol) throw new Error("Missing securityId");
  if (!Number.isFinite(lots) || lots <= 0) throw new Error("Invalid lots");
  if (!Number.isFinite(resolvedLotSize) || resolvedLotSize <= 0) {
    throw new Error(
      "Missing resolved lot size — it must come from the exchange instrument master, not from the client",
    );
  }

  const needsTrigger = orderType === "STOP_LOSS" || orderType === "STOP_LOSS_MARKET";
  if (needsTrigger && !Number.isFinite(triggerPrice)) throw new Error(`triggerPrice required for ${orderType}`);

  const body = {
    uid,
    actid: uid,
    exch: EXCHANGE_SEGMENT_MAP[exchangeSegment] || exchangeSegment,
    tsym: String(symbol),
    // NEEDS VERIFICATION: several Noren-family doc examples show qty/prc/
    // trgprc stringified in the live jData payload rather than as JSON
    // numbers. Kept numeric here to match this repo's testable buildOrderBody
    // convention (dhanOrders.mjs does the same) — stringify at the postJData
    // call site instead of here if a live account rejects numeric fields.
    qty: Math.round(lots * resolvedLotSize),
    prc: orderType === "MARKET" ? 0 : price,
    prd: PRODUCT_CODE_MAP[productType],
    trantype: TRANSACTION_CODE_MAP[transactionType],
    prctyp: ORDER_TYPE_CODE_MAP[orderType],
    ret: validity,
    ordersource: "API",
  };
  if (needsTrigger) body.trgprc = triggerPrice;
  // "remarks" is the closest free-text tag field Noren's PlaceOrder exposes
  // (no native correlationId concept) — NEEDS VERIFICATION against live docs.
  if (correlationId) body.remarks = String(correlationId);
  return body;
}

function uidFor(config, creds) {
  return creds?.[config.uidField];
}

/**
 * Places a real order. `config` supplies the one broker-specific seam:
 * `postJData` (that broker's authenticated request helper) and `uidField`
 * (which credential field is this broker's trading uid). See buildOrderBody()
 * for payload construction/validation.
 */
export async function placeOrder(config, creds, order, resolvedLotSize) {
  const body = buildOrderBody(uidFor(config, creds), order, resolvedLotSize);
  const json = await config.postJData(creds, "/PlaceOrder", body);
  if (json?.stat !== "Ok" || !json?.norenordno) {
    throw new Error(`${config.label} order placement failed: ${json?.emsg || "unknown error"}`);
  }
  return { orderId: json.norenordno, orderStatus: "PENDING" };
}

/**
 * Noren's OrderBook returns a bare JSON array on success and a
 * {stat:"Not_Ok", emsg} object both for real errors and for "no orders
 * placed today" (a well-known Noren-family quirk). postJData already throws
 * on session-shaped errors (see <broker>Auth.mjs's isSessionError), so a
 * Not_Ok reaching here reads as an empty book, not a fault.
 */
export async function getOrders(config, creds) {
  const json = await config.postJData(creds, "/OrderBook", { uid: uidFor(config, creds) });
  if (Array.isArray(json)) return json;
  if (json?.stat === "Not_Ok") return [];
  return json;
}

export async function getOrderStatus(config, creds, orderId) {
  if (!orderId) throw new Error("Missing orderId");
  const json = await config.postJData(creds, "/SingleOrdStatus", {
    uid: uidFor(config, creds),
    norenordno: String(orderId),
  });
  if (json?.stat === "Not_Ok") {
    throw new Error(`${config.label} order status lookup failed for ${orderId}: ${json.emsg || "unknown error"}`);
  }
  return json;
}

export async function cancelOrder(config, creds, orderId) {
  if (!orderId) throw new Error("Missing orderId");
  const json = await config.postJData(creds, "/CancelOrder", {
    uid: uidFor(config, creds),
    norenordno: String(orderId),
  });
  if (json?.stat !== "Ok") {
    throw new Error(`${config.label} cancel failed for ${orderId}: ${json?.emsg || "unknown error"}`);
  }
  return { orderId: json.result || orderId, orderStatus: "CANCELLED" };
}
