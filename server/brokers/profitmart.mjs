/**
 * Profitmart Securities (ProfitMax API) adapter on the broker contract (server/brokers/contract.mjs).
 *
 * Official docs: https://profitmax.profitmart.in/ApiDocs/docs/intro (Login And User Details, Orders and
 * Trades, Holdings and Limits, Watch Lists / Get Quotes, Chart Data, Websocket API, Annexure). Profitmart
 * runs Kambala's Noren OMS, so the shared engine is shoonyaNorenCore.mjs; the host-specific parts are
 * profitmartAuth.mjs (OAuth code exchange, Bearer transport) and profitmartInstruments.mjs (symbol ZIPs).
 *
 * Auth (requestTokenExchange): Client ID (Noren user id), API client ID, client secret and the one-time
 * OAuth `code`; the first call runs GenAcsTok and the token is kept in this process. A pasted `accessToken`
 * also works.
 *
 * Market data: GetQuotes is one contract per call, so the option chain is the symbol master windowed to
 * STRIKE_HALF_WIDTH strikes around spot plus per-contract quotes, with IV/Greeks solved locally.
 * Candles: TPSeries (the official page lists 1/3/5/10/15/30/60/120/240 min; the core serves 1/3/5/15/30/60)
 * and EODChartData for daily bars.
 *
 * Feed: NOT declared. The official Websocket "Connect" page documents { t: "c", uid, actid, source,
 * accesstoken } acknowledged by { t: "ck" } on /NorenStream/NorenWS, while the shared Noren feed sends the
 * OAuth form { t: "a" } / "ak" on a fixed URL. On the production host /NorenStream/NorenWS answered 404 and
 * /NorenWSAPI/ answered 426 (a WebSocket endpoint) to a plain GET, so neither the path nor the handshake is
 * confirmed. Enabling the feed needs a configurable connect message in the shared core (reported, not done).
 *
 * Orders (gated; nothing mints gates for this broker today). The official Place Order page lists prctyp
 * LMT / MKT / SL-LMT / SL-MKT and prd C / M / I / H / B / F; this adapter keeps the conservative Noren rule
 * used across the family: LMT and SL-LMT only (market orders refused locally, as the app has no market
 * protection for Noren), products C / M / I, validity DAY / IOC.
 */

import { createNorenAdapter, mapTrade, norenCapabilities } from "./shoonyaNorenCore.mjs";
import { OAUTH_LOGIN_URL, send, session } from "./profitmartAuth.mjs";
import { loadSegment } from "./profitmartInstruments.mjs";

export const id = "profitmart";
export const credentialFields = ["clientId", "apiKey", "apiSecret", "requestCode", "accessToken"];

// No published rate limit; use the Noren family's ~10 requests/second budget.
const QUOTE_BATCH = { size: 10, delayMs: 1000 };
const STRIKE_HALF_WIDTH = 20;
const PRODUCTS = ["CNC", "INTRADAY", "MARGIN"];

const core = createNorenAdapter({
  id,
  label: "Profitmart",
  uidField: "clientId",
  session,
  send,
  wsUrl: null, // feed not declared (see header)
  loadSegment,
  connectionEndpoint: "/Limits",
  quoteBatch: QUOTE_BATCH,
  strikeHalfWidth: STRIKE_HALF_WIDTH,
  orderRules: { products: PRODUCTS, allowMarket: false },
});

export const capabilities = norenCapabilities({ mtf: false, products: PRODUCTS });
delete capabilities.feed;

export const {
  testConnection, fetchInstruments, fetchExpiryList, fetchLTP, fetchOptionChain, fetchQuotes, fetchDepth, fetchHistorical,
  fetchPositions, fetchHoldings, fetchFunds, fetchOrderBook, normaliseError,
  placeOrder, modifyOrder, cancelOrder,
} = core;

const CONTRACT_EXCHANGES = new Set(["NSE", "BSE", "NFO", "BFO", "MCX", "CDS"]);

/**
 * Trade book. The official Trade Book sample returns the rows inside a second array ([[{...}]]), which the
 * shared core would read as one row with no exchange and drop. Rows are flattened one level here, so both
 * the documented shape and the plain Noren shape work.
 */
export async function fetchTradeBook(creds) {
  const raw = await core.call(creds, "/TradeBook", { actid: String(creds?.clientId ?? "") }, { list: true });
  const rows = raw.flatMap((r) => (Array.isArray(r) ? r : [r]));
  return { status: "success", data: rows.filter((r) => CONTRACT_EXCHANGES.has(String(r?.exch ?? "").toUpperCase())).map(mapTrade) };
}

export const buildOrderBody = (uid, order, resolvedLotSize) => core.buildOrderBody(uid, order, resolvedLotSize);
export const buildModifyBody = (uid, orderId, changes, original) => core.buildModifyBody(uid, orderId, changes, original);

/** Where the user gets a login code (for the Broker Settings help text). */
export const loginUrl = (apiKey) => `${OAUTH_LOGIN_URL}?client_id=${encodeURIComponent(apiKey || "")}`;
