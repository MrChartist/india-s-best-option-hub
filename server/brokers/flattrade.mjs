/**
 * Flattrade (Pi) adapter on the broker contract (server/brokers/contract.mjs).
 *
 * Official docs: https://pi.flattrade.in/docs (v2.0, 31 Mar 2026). Flattrade runs Kambala's Noren OMS,
 * so the request/response handling is the shared engine in shoonyaNorenCore.mjs; this file supplies the
 * Flattrade-specific parts: the request-code exchange and jKey transport (flattradeAuth.mjs), the S3
 * scrip-master CSVs (flattradeInstruments.mjs), rate limits and order rules.
 *
 * Auth (requestTokenExchange): the user saves Client ID, API key, API secret and the one-time
 * request_code from https://auth.flattrade.in/?app_key=<API key>. The first call swaps it for a token
 * kept in this process until 5 AM IST (or 24 h). A pasted `accessToken` (jKey) is also accepted.
 *
 * Market data: GetQuotes takes one contract per call (no bulk quotes) and carries no IV/Greeks, so the
 * option chain is the scrip master windowed to STRIKE_HALF_WIDTH strikes either side of spot plus
 * per-contract GetQuotes, with IV/Greeks solved locally (Black-Scholes). GetOptionChain only returns
 * contract identity, so it saves nothing over the master. Candles: TPSeries (1/3/5/10/15/30/60/120 min)
 * and EODChartData (daily). Feed: wss://piconnect.flattrade.in/PiConnectWSAPI/ touchline.
 *
 * Orders (gated; nothing mints gates for this broker today): PlaceOrder documents prctyp LMT / SL-LMT
 * only, so MARKET and SL-M orders are refused locally. Products C (CNC), M (NRML), I (MIS), F (MTF);
 * H/B (cover/bracket) are not offered. ret DAY / EOS / IOC (DAY and IOC used).
 */

import { createNorenAdapter, norenCapabilities } from "./shoonyaNorenCore.mjs";
import { LOGIN_URL, WS_URL, send, session } from "./flattradeAuth.mjs";
import { loadSegment } from "./flattradeInstruments.mjs";

export const id = "flattrade";
export const credentialFields = ["clientId", "apiKey", "apiSecret", "requestCode", "accessToken"];

// 40 req/s and 200 req/min for data calls (official "API Rate Limit"). Eight quotes every 2.5 s is
// ~192/min, under the per-minute cap, and far below the per-second one.
const QUOTE_BATCH = { size: 8, delayMs: 2500 };
// ~41 strikes / <=82 legs per chain refresh; widen only together with the rate budget above.
const STRIKE_HALF_WIDTH = 20;

const core = createNorenAdapter({
  id,
  label: "Flattrade",
  uidField: "clientId",
  session,
  send,
  wsUrl: WS_URL,
  loadSegment,
  connectionEndpoint: "/UserDetails",
  quoteBatch: QUOTE_BATCH,
  strikeHalfWidth: STRIKE_HALF_WIDTH,
  orderRules: { products: ["CNC", "INTRADAY", "MARGIN", "MTF"], allowMarket: false },
});

export const capabilities = norenCapabilities({
  // Product F (MTF) is listed on Flattrade's PlaceOrder page.
  mtf: true,
  products: ["CNC", "INTRADAY", "MARGIN", "MTF"],
});

export const {
  testConnection, fetchInstruments, fetchExpiryList, fetchLTP, fetchOptionChain, fetchQuotes, fetchDepth, fetchHistorical,
  fetchPositions, fetchHoldings, fetchFunds, fetchOrderBook, fetchTradeBook, normaliseError, createFeed,
  placeOrder, modifyOrder, cancelOrder,
} = core;

/** Pure order-body builders (exported for tests). */
export const buildOrderBody = (uid, order, resolvedLotSize) => core.buildOrderBody(uid, order, resolvedLotSize);
export const buildModifyBody = (uid, orderId, changes, original) => core.buildModifyBody(uid, orderId, changes, original);

/** Where the user gets a request code (for the Broker Settings help text). */
export const loginUrl = (apiKey) => `${LOGIN_URL}?app_key=${encodeURIComponent(apiKey || "")}`;
