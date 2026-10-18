/**
 * Dhan API v2 — the reference broker adapter on the canonical contract (server/brokers/contract.mjs).
 *
 * Official docs (checked October 2026): https://dhanhq.co/docs/v2/
 *   authentication (GET /profile), option-chain, market-quote, historical-data, instruments,
 *   live-market-feed, orders, portfolio, funds, annexure (segments, error codes).
 *
 * Auth: apiKeyToken. The user pastes the Client ID and a 24-hour access token generated on Dhan Web;
 * every call sends the `access-token` and `client-id` headers. There is no login call here.
 *
 * Index ids (IDX_I segment) verified against Dhan's detailed instrument master:
 *   NIFTY 13, BANKNIFTY 25, FINNIFTY 27, MIDCPNIFTY 442, SENSEX 51, BANKEX 69.
 *   (SENSEX was wrongly 1 here before: 1 is the UNDERLYING_SECURITY_ID printed on BSE derivative
 *   rows, not the IDX_I id the option-chain and quote APIs expect.)
 * The option-chain expiry list takes UnderlyingSeg "IDX_I" for indices (official sample), not
 * "NSE_FNO" as this file used to send.
 *
 * `dhanFetch` + the index/underlying maps are also imported by server/lib/dhanOrders.mjs and
 * dhanPortfolio.mjs, so its signature and error text stay as they were. proxy-server.mjs keeps its
 * own richer /api/dhan-proxy path.
 *
 * Futures/MCX helpers live in dhanFutures.mjs, market data beyond the chain in dhanMarket.mjs, the
 * WebSocket feed in dhanFeed.mjs and the portfolio/order surface in dhanContract.mjs; all are
 * re-exported below so `registry.get("dhan")` sees one module.
 */

import { BrokerError, brokerFetch } from "./contract.mjs";

const DHAN_BASE = "https://api.dhan.co/v2";

export const id = "dhan";
export const credentialFields = ["clientId", "accessToken"];

/** Canonical contract declaration. Fixtures: __fixtures__/dhan/. Tests: contract.test.mjs, dhan.test.mjs. */
export const capabilities = {
  auth: { kind: "apiKeyToken" },
  testConnection: true,
  instruments: true,
  expiries: true,
  optionChain: { greeks: "broker" },
  ltp: true,
  quotes: true,
  depth: true,
  historical: { intervals: ["1m", "5m", "15m", "60m", "1d"] },
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

export const INDEX_SECURITY_IDS = {
  NIFTY: { secId: 13, exchSeg: "IDX_I" },
  BANKNIFTY: { secId: 25, exchSeg: "IDX_I" },
  FINNIFTY: { secId: 27, exchSeg: "IDX_I" },
  MIDCPNIFTY: { secId: 442, exchSeg: "IDX_I" },
  SENSEX: { secId: 51, exchSeg: "IDX_I" },
  BANKEX: { secId: 69, exchSeg: "IDX_I" },
};

/** Option-chain underlyings. `expirySegment` and `ocSegment` are both IDX_I per the official samples. */
export const UNDERLYING_MAP = Object.fromEntries(
  Object.entries(INDEX_SECURITY_IDS).map(([sym, { secId }]) => [sym, { underlyingScrip: secId, expirySegment: "IDX_I", ocSegment: "IDX_I" }]),
);

/** Upstream refusal or failure. Message format "Dhan API error [<status>]: <body>" is relied on by callers. */
export class DhanApiError extends BrokerError {
  constructor(status, bodyText) {
    super(`Dhan API error [${status}]: ${String(bodyText ?? "").slice(0, 400)}`, { code: "UPSTREAM_ERROR", statusCode: 502 });
    this.name = "DhanApiError";
    this.httpStatus = status;
  }
}

export async function dhanFetch(path, body, method = "POST", customClientId, customAccessToken) {
  // No implicit .env fallback here: proxy-server.mjs decides when the .env keys may be used
  // (browser or loopback callers only, see mayUseEnvCreds) and passes them explicitly.
  const clientId = customClientId;
  const accessToken = customAccessToken;
  if (!clientId || !accessToken) {
    throw new Error("Dhan credentials not configured (Broker settings or .env).");
  }

  const options = {
    method,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "access-token": accessToken,
      "client-id": clientId,
    },
  };
  // PUT carries a body for dhanPortfolio.modifyOrder() (PUT /orders/{orderId}).
  if (body && (method === "POST" || method === "PUT")) options.body = JSON.stringify(body);

  const res = await brokerFetch(`${DHAN_BASE}${path}`, options);
  if (!res.ok) throw new DhanApiError(res.status, await res.text().catch(() => ""));
  const json = await res.json();
  // Data APIs can answer HTTP 200 with { status: "failed", data: { "805": "..." } } (annexure, Data API errors).
  if (json && (json.status === "failed" || json.status === "failure")) throw new DhanApiError(res.status, JSON.stringify(json));
  return json;
}

const creds2 = (creds) => [creds?.clientId, creds?.accessToken];

// ── Registry basics ──

/** One cheap authenticated call: GET /profile (token validity and Data API plan). */
export async function testConnection(creds = {}) {
  try {
    const profile = await dhanFetch("/profile", null, "GET", ...creds2(creds));
    if (profile?.dataPlan && String(profile.dataPlan).toLowerCase() !== "active") {
      return { status: "error", message: "Dhan token works, but the Data API plan is not active on this account (needed for option chain and quotes)." };
    }
    const until = profile?.tokenValidity ? ` Token valid until ${profile.tokenValidity}.` : "";
    return { status: "success", message: `Dhan API connected.${until}` };
  } catch (e) {
    return { status: "error", message: e.message };
  }
}

function underlyingOf(symbol) {
  const u = UNDERLYING_MAP[symbol];
  if (!u) throw new Error(`Unknown symbol for Dhan: ${symbol}. Supported: ${Object.keys(UNDERLYING_MAP).join(", ")}`);
  return u;
}

export async function fetchExpiryList(creds, symbol) {
  const u = underlyingOf(symbol);
  const raw = await dhanFetch("/optionchain/expirylist", { UnderlyingScrip: u.underlyingScrip, UnderlyingSeg: u.expirySegment }, "POST", ...creds2(creds));
  const list = (Array.isArray(raw?.data) ? raw.data : [])
    .map((d) => String(d).slice(0, 10))
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
  return { status: "success", data: [...new Set(list)].sort() };
}

/** Already the app's normalised option-chain schema: Dhan IS the reference shape (IV in percent). */
export async function fetchOptionChain(creds, symbol, expiry) {
  const u = underlyingOf(symbol);
  const body = { UnderlyingScrip: u.underlyingScrip, UnderlyingSeg: u.ocSegment };
  if (expiry) body.Expiry = expiry;
  const raw = await dhanFetch("/optionchain", body, "POST", ...creds2(creds));
  const data = raw?.data && typeof raw.data === "object" ? raw.data : {};
  return { status: "success", data: { ...data, oc: data.oc ?? {}, last_price: Number(data.last_price) || 0 } };
}

/** Contract shape { status, data: { last_price } }, unwrapped from Dhan's { data: { IDX_I: { "13": { last_price } } } }. */
export async function fetchLTP(creds, symbol) {
  const secInfo = INDEX_SECURITY_IDS[symbol];
  if (!secInfo) throw new Error(`Unknown index: ${symbol}`);
  const raw = await dhanFetch("/marketfeed/ltp", { [secInfo.exchSeg]: [secInfo.secId] }, "POST", ...creds2(creds));
  const lastPrice = Number(raw?.data?.[secInfo.exchSeg]?.[String(secInfo.secId)]?.last_price);
  return { status: "success", data: { last_price: Number.isFinite(lastPrice) ? lastPrice : 0 } };
}

// Futures/MCX data (unchanged; the generic proxy path reaches fetchFuturesQuotes through the registry).
export { fetchMCXExpiryList, fetchFuturesQuotes, fetchRolloverData } from "./dhanFutures.mjs";

// Instruments, quotes, depth and historical candles.
export { fetchInstruments, fetchQuotes, fetchDepth, fetchHistorical } from "./dhanMarket.mjs";

// Live market feed (binary WebSocket).
export { createFeed } from "./dhanFeed.mjs";

// Portfolio reads, gated order calls and the error normaliser on the canonical contract.
export {
  fetchPositions, fetchHoldings, fetchFunds, fetchOrderBook, fetchTradeBook,
  placeOrder, modifyOrder, cancelOrder, normaliseError,
} from "./dhanContract.mjs";
