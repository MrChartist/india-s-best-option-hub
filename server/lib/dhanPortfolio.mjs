/**
 * Dhan v2 Portfolio reads — positions, holdings, funds, trade book, and
 * order modification.
 *
 * Verified against Dhan's live official docs this session (not assumed from
 * memory — dhanhq.co/docs/v2/portfolio/ for positions/holdings,
 * dhanhq.co/docs/v2/funds/ for fundlimit, dhanhq.co/docs/v2/orders/ for
 * trades and order modification), the same verification discipline
 * dhanOrders.mjs's header describes, given the real-money stakes of a wrong
 * path or field name here.
 *
 * Kept as its own file, separate from dhanOrders.mjs (which only ever
 * places/reads-one/cancels an order), because this repo's one-purpose-per-
 * file rule treats "read the account's current book" and "mutate a single
 * order" as two different reasons to change (CLAUDE.md golden rule #2).
 * modifyOrder lives here rather than in dhanOrders.mjs for the same reason
 * getOrderStatus/cancelOrder there take an id + verb, not a payload — this
 * file is the one place that PATCHes existing broker state instead of only
 * creating/reading/deleting it.
 *
 * getPositions/getHoldings/getFunds/getTrades are thin dhanFetch() wrappers
 * with no branching worth extracting — same as placeOrder/getOrders/
 * getOrderStatus/cancelOrder in dhanOrders.mjs, none of which that file's
 * test suite covers either. Real error surfaced verbatim, never swallowed:
 * a caller that silently ate a Dhan error here would show a trader a stale
 * or wrong portfolio and call it live.
 *
 * Anyone wiring these reads for another broker should look at how the
 * Noren-family shared order module (server/brokers/oms-noren.mjs, used by
 * flattrade/shoonya/tradesmart/zebu/firstock/rmoney/wisdom) and the
 * OAuth-family order modules (server/brokers/zerodhaOrders.mjs,
 * server/brokers/fyersOrders.mjs) shaped their own buildOrderBody/
 * placeOrder/getOrders/getOrderStatus/cancelOrder exports — as of this
 * writing none of those files has a portfolio read yet, so this file is the
 * first shape to mirror, not a second one to reconcile with.
 */

import { dhanFetch } from "../brokers/dhan.mjs";

const VALID_ORDER_TYPES = new Set(["LIMIT", "MARKET", "STOP_LOSS", "STOP_LOSS_MARKET"]);
const VALID_VALIDITY = new Set(["DAY", "IOC"]);

/** GET /positions — every open (and closed-today) position on the account,
 * Dhan's own untransformed shape. proxy-server.mjs's mapDhanPositionToOpenPosition()
 * calls this same endpoint directly today for the narrower panic-layer shape;
 * this function is the one the portfolio tab reads for the full record. */
export async function getPositions(creds) {
  return dhanFetch("/positions", null, "GET", creds?.clientId, creds?.accessToken);
}

/** GET /holdings — long-term (CNC) equity/ETF holdings. Distinct from
 * /positions: a holding carries no product type or expiry and never shows up there. */
export async function getHoldings(creds) {
  return dhanFetch("/holdings", null, "GET", creds?.clientId, creds?.accessToken);
}

/** GET /fundlimit — available balance / margin utilised. This is the
 * broker's own authoritative number, unlike estimateBasketMargin() in
 * basketEngine.mjs's caller, which is explicitly an unverified estimate. */
export async function getFunds(creds) {
  return dhanFetch("/fundlimit", null, "GET", creds?.clientId, creds?.accessToken);
}

/** GET /trades (every fill for the day) or GET /trades/{orderId} (fills for
 * one order) when orderId is supplied — same endpoint family, Dhan just
 * branches on whether an order id is present in the path. */
export async function getTrades(creds, orderId) {
  const path = orderId ? `/trades/${encodeURIComponent(orderId)}` : "/trades";
  return dhanFetch(path, null, "GET", creds?.clientId, creds?.accessToken);
}

/**
 * Pure request-body builder for PUT /orders/{orderId}, separated from
 * modifyOrder() the same way dhanOrders.mjs separates buildOrderBody() from
 * placeOrder() — so the part most likely to have a real-money-costing
 * mistake is directly unit-testable without a network call.
 *
 * Dhan documents dhanClientId, orderId, orderType and validity as always
 * required on a modify, with quantity/price/triggerPrice/legName required
 * only for certain orderTypes and disclosedQuantity optional. `clientId` and
 * `orderId` are separate, authoritative parameters rather than fields on
 * `changes` on purpose: a caller must not be able to smuggle a different
 * account id or a different order id in through the payload it's editing.
 */
export function buildModifyOrderBody(clientId, orderId, changes) {
  if (!orderId) throw new Error("Missing orderId");
  const { orderType, validity, quantity, price, triggerPrice, legName, disclosedQuantity } = changes || {};

  if (!VALID_ORDER_TYPES.has(orderType)) throw new Error(`Invalid orderType: ${orderType}`);
  if (!VALID_VALIDITY.has(validity)) throw new Error(`Invalid validity: ${validity}`);
  const needsTrigger = orderType === "STOP_LOSS" || orderType === "STOP_LOSS_MARKET";
  if (needsTrigger && !Number.isFinite(triggerPrice)) throw new Error(`triggerPrice required for ${orderType}`);

  const body = {
    dhanClientId: clientId,
    orderId: String(orderId),
    orderType,
    validity,
  };
  if (Number.isFinite(quantity)) body.quantity = quantity;
  if (Number.isFinite(price)) body.price = price;
  if (needsTrigger) body.triggerPrice = triggerPrice;
  if (legName) body.legName = legName;
  if (Number.isFinite(disclosedQuantity)) body.disclosedQuantity = disclosedQuantity;
  return body;
}

/**
 * Modifies a resting order. See buildModifyOrderBody() for payload
 * construction/validation. Dhan takes the full documented field set back on
 * a modify, not a sparse patch, so callers must pass every field they want
 * to keep (e.g. the existing orderType/validity), not only the ones changing.
 */
export async function modifyOrder(creds, orderId, changes) {
  const body = buildModifyOrderBody(creds?.clientId, orderId, changes);
  return dhanFetch(`/orders/${encodeURIComponent(orderId)}`, body, "PUT", creds?.clientId, creds?.accessToken);
}
