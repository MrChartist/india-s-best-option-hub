/**
 * Pocketful adapter (contract v1, server/brokers/contract.mjs).
 *
 * Official docs: https://api.pocketful.in/docs/curl (checked 2026-10) and the official JavaScript SDK
 * (github.com/pocketful-tech/pocketfulapi-javascript). Base URL https://algo.pocketful.in.
 *
 * Auth (pocketfulAuth.mjs): the user generates an access token on the Pocketful API portal each day (valid until
 * midnight) and pastes it with their client id; contract auth.kind "apiKeyToken". No password, PIN or TOTP is handled.
 * Market data (pocketfulMarket.mjs): REST LTP and quotes; chain prices from the WebSocket feed (pocketfulWs.mjs) over
 * contract-master strikes (pocketfulInstruments.mjs) with locally computed IV/greeks; 1-minute F&O history.
 * Portfolio (pocketfulPortfolio.mjs) and gated LIMIT/SL orders (pocketfulOrders.mjs).
 * Not declared: depth (the snapquote feed mode is not wired in v1).
 *
 * Differences from OpenAlgo (official sources followed): base URL algo.pocketful.in (OpenAlgo: trade.pocketful.in);
 * `x-authorization-token` header (OpenAlgo: Authorization: Bearer; both are sent); MARKET/SL-M are refused rather than
 * converted (the annexure forbids them over the API).
 */

import { BrokerError, BrokerInputError, normaliseError as baseNormalise } from "./contract.mjs";
import { pfRequest, resolveClientId } from "./pocketfulAuth.mjs";
import { findByRef } from "./pocketfulInstruments.mjs";
import { getConnection, subscribe, tickKey, unsubscribe } from "./pocketfulWs.mjs";
import { ORDER_FEATURES } from "./pocketfulOrders.mjs";

export { fetchInstruments, fetchExpiryList, fetchOptionChain, fetchLTP, fetchQuotes, fetchHistorical } from "./pocketfulMarket.mjs";
export { fetchPositions, fetchHoldings, fetchFunds, fetchOrderBook, fetchTradeBook } from "./pocketfulPortfolio.mjs";
export { buildOrderBody, buildModifyBody, placeOrder, modifyOrder, cancelOrder } from "./pocketfulOrders.mjs";

export const id = "pocketful";
export const credentialFields = ["accessToken", "clientId"];

export const capabilities = {
  ...ORDER_FEATURES,
  auth: { kind: "apiKeyToken" },
  testConnection: true,
  instruments: true,
  expiries: true,
  optionChain: { greeks: "computed" },
  ltp: true,
  quotes: true,
  historical: { intervals: ["1m"], segments: ["NFO"] },
  feed: true,
  positions: true,
  holdings: true,
  funds: true,
  orderBook: true,
  tradeBook: true,
  placeOrder: true,
  modifyOrder: true,
  cancelOrder: true,
  normaliseError: true,
};

/** One cheap authenticated call: GET /api/v1/user/profile?client_id. Never throws. */
export async function testConnection(creds = {}) {
  try {
    const client_id = await resolveClientId(creds);
    await pfRequest(creds, "/api/v1/user/profile", { query: { client_id } });
    return { status: "success", message: "Pocketful account connected" };
  } catch (e) {
    return { status: "error", message: normaliseError(e, { secrets: [creds.accessToken] }).message };
  }
}

/** Feed tick (paise already scaled by the decoder) -> contract Quote. */
function tickQuote(row, t) {
  return {
    token: row.token,
    exchange: row.exchange,
    ltp: t.lastTradedPrice,
    open: t.openPrice,
    high: t.highPrice,
    low: t.lowPrice,
    close: t.closePrice,
    volume: t.tradeVolume,
    oi: t.currentOpenInterest,
    bid: t.bestBidPrice,
    ask: t.bestAskPrice,
  };
}

/** Live feed over the detailed-marketdata stream. refs are { token, exchange } from the contract master. */
export function createFeed(creds, { onTick, onStatus } = {}) {
  const mine = new Map(); // tickKey -> row
  let entry = null;
  let closed = false;
  const tickFn = (k, t) => { const row = mine.get(k); if (row) onTick?.(tickQuote(row, t)); };
  const statusFn = (s) => onStatus?.(s);
  const ready = getConnection(creds).then((e) => {
    entry = e;
    if (!closed) { e.tickListeners.add(tickFn); e.statusListeners.add(statusFn); onStatus?.({ connected: true }); }
    return e;
  });
  ready.catch((e) => onStatus?.({ connected: false, reason: e.message }));
  const rows = async (refs) => {
    const out = [];
    for (const ref of refs || []) {
      const r = await findByRef(ref);
      if (!r) throw new BrokerInputError(`Pocketful: unknown instrument ${ref?.exchange}:${ref?.token}`);
      out.push(r);
    }
    return out;
  };
  return {
    subscribe(refs) {
      rows(refs).then(async (rs) => {
        const e = await ready;
        rs.forEach((r) => mine.set(tickKey(r.exchangeCode, r.token), r));
        if (!closed) await subscribe(e, rs.map((r) => tickKey(r.exchangeCode, r.token)));
      }).catch((err) => onStatus?.({ connected: Boolean(entry?.connected), reason: err.message }));
    },
    unsubscribe(refs) {
      rows(refs).then(async (rs) => {
        const e = await ready;
        const keys = rs.map((r) => tickKey(r.exchangeCode, r.token));
        keys.forEach((k) => mine.delete(k));
        unsubscribe(e, keys);
      }).catch(() => {});
    },
    close() {
      closed = true;
      if (entry) { entry.tickListeners.delete(tickFn); entry.statusListeners.delete(statusFn); unsubscribe(entry, [...mine.keys()]); }
      mine.clear();
    },
  };
}

/**
 * Pocketful errors arrive as "Pocketful error [<http>] <error_code?>: <message>". 401/403 = token invalid or expired
 * (UPSTREAM_AUTH, already tagged by pfRequest); 429 = rate limit; error codes 44000/45000/45010 = bad parameters,
 * price/quantity or instrument (UPSTREAM_INPUT). All stay 502; our own refusals keep 422.
 */
export function normaliseError(err, opts = {}) {
  const base = baseNormalise(err, opts);
  if (err instanceof BrokerError && (err.statusCode === 422 || err.code !== "UPSTREAM_ERROR")) return base;
  const m = base.message;
  if (/\[429\]|rate limit/i.test(m)) return { ...base, code: "UPSTREAM_RATE_LIMIT" };
  if (/\b4[45]0[01]0\b/.test(m)) return { ...base, code: "UPSTREAM_INPUT" };
  if (/\b40000\b/.test(m)) return { ...base, code: "UPSTREAM_AUTH" };
  return base;
}
