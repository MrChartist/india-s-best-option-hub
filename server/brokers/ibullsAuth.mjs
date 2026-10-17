/**
 * IndiaBulls Securities market-data session login + in-memory session cache.
 *
 * IndiaBulls Securities runs on Symphony Fintech's white-label "XTS" trading
 * platform (https://symphonyfintech.com/xts-trading-front-end-api/) at host
 * xts.ibullssecurities.com — confirmed against marketcalls/openalgo's
 * broker/ibulls adapter, whose master-contract helper functions are even
 * still named `*_compositedge_*` internally (CompositEdge is another broker
 * on the exact same XTS backend, just at xts.compositedge.com with a
 * slightly different market-data path segment: "apimarketdata" there vs
 * "apibinarymarketdata" here). Endpoint paths, payload shapes, field names
 * and message codes below are otherwise identical across XTS-family brokers.
 *
 * XTS separates two credential pairs: "Interactive" (order placement) and
 * "Market Data" (quotes/instruments). This module only needs — and only
 * asks the user for — the Market Data pair, since option-chain reads never
 * touch the Interactive/order API.
 *
 * Login: POST {MARKET_DATA_URL}/auth/login {appKey, secretKey, source:"WebAPI"}
 * -> { type: "success", result: { token, userID } }. The docs don't publish
 * an exact feed-token TTL; like every other XTS-derivative broker in this
 * app (Angel One, 5paisa, Alice Blue) we treat the session as good "for the
 * trading day" and cache it in memory until the next IST midnight.
 */

import { batchWithDelay } from "../lib/batch.mjs";

const BASE_URL = "https://xts.ibullssecurities.com";
export const MARKET_DATA_URL = `${BASE_URL}/apibinarymarketdata`;

// Confirmed from openalgo's production ibulls adapter: "XTS API limit: only
// 50 instruments allowed per request". Inter-batch delay (100ms in openalgo)
// is bumped slightly here as a safety margin since the exact per-second cap
// isn't publicly documented.
export const QUOTE_BATCH_SIZE = 50;
export const QUOTE_BATCH_DELAY_MS = 150;

// XTS message codes for the /instruments/quotes endpoint.
export const MSG_CODE_TOUCHLINE = 1502; // LTP, OHLC, bid/ask, traded volume
export const MSG_CODE_OI = 1510; // open interest (separate call — not included in touchline)

const sessionCache = new Map(); // credsKey -> { feedToken, userId, expiresAt }

function credsKey(creds) {
  // In-process cache key only — never persisted, never logged.
  return JSON.stringify({ k: creds?.marketApiKey, s: creds?.marketApiSecret });
}

/** Next IST midnight as epoch ms — matches the same "valid for the trading day" convention used by angeloneAuth/aliceblueAuth. */
function nextMidnightIST(now = Date.now()) {
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
  const istShifted = new Date(now + IST_OFFSET_MS);
  istShifted.setUTCHours(0, 0, 0, 0);
  return istShifted.getTime() + 24 * 60 * 60 * 1000 - IST_OFFSET_MS;
}

async function loginFresh(creds) {
  if (!creds?.marketApiKey || !creds?.marketApiSecret) {
    throw new Error("IndiaBulls credentials missing: marketApiKey and marketApiSecret are required");
  }

  const res = await fetch(`${MARKET_DATA_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      appKey: creds.marketApiKey,
      secretKey: creds.marketApiSecret,
      source: "WebAPI",
    }),
  });
  const json = await res.json().catch(() => null);

  if (!res.ok || json?.type !== "success" || !json?.result?.token) {
    const msg = json?.description || json?.result?.description || `HTTP ${res.status}`;
    console.log(`[ibulls] market-data login failed (status ${res.status})`);
    throw new Error(`IndiaBulls (XTS) market-data login failed: ${msg}`);
  }

  const session = {
    feedToken: json.result.token,
    userId: json.result.userID || null,
    expiresAt: nextMidnightIST(),
  };
  sessionCache.set(credsKey(creds), session);
  return session;
}

/** Returns a cached, still-valid feed session or performs a fresh login. Throws on any auth failure. */
export async function ensureSession(creds) {
  const key = credsKey(creds);
  const cached = sessionCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached;
  return loginFresh(creds);
}

/**
 * One /instruments/quotes call for up to QUOTE_BATCH_SIZE instruments at a
 * given XTS message code. Retries once with a fresh login if the feed token
 * has expired mid-session. Returns the parsed listQuotes entries (already
 * JSON.parse'd — the API wraps each quote as a JSON string).
 *
 * Reads the session via ensureSession() (cache-aware) on every call rather
 * than accepting a pre-fetched session from the caller — that way, if an
 * earlier chunk in a batched run had to re-login (e.g. IST-midnight
 * rollover mid-batch), later chunks pick up the already-refreshed cached
 * session instead of each independently re-detecting the same stale token
 * and re-logging in on their own.
 */
async function fetchQuotesOnce(creds, instruments, messageCode) {
  let session = await ensureSession(creds);
  const doCall = async (feedToken) => {
    const res = await fetch(`${MARKET_DATA_URL}/instruments/quotes`, {
      method: "POST",
      headers: { "Content-Type": "application/json", authorization: feedToken },
      body: JSON.stringify({ instruments, xtsMessageCode: messageCode, publishFormat: "JSON" }),
    });
    const json = await res.json().catch(() => null);
    return { res, json };
  };

  let { res, json } = await doCall(session.feedToken);

  if ((!res.ok || json?.type !== "success") && /invalid token/i.test(json?.description || "")) {
    console.log(`[ibulls] feed token rejected on quotes call (code ${messageCode}) — re-logging in`);
    sessionCache.delete(credsKey(creds));
    session = await loginFresh(creds);
    ({ res, json } = await doCall(session.feedToken));
  }

  if (!res.ok || json?.type !== "success") {
    throw new Error(`IndiaBulls quotes API error (code ${messageCode}): ${json?.description || `HTTP ${res.status}`}`);
  }

  const rawList = json?.result?.listQuotes || [];
  return rawList
    .map((raw) => {
      try { return typeof raw === "string" ? JSON.parse(raw) : raw; } catch { return null; }
    })
    .filter(Boolean);
}

/**
 * Batched quote fetch respecting XTS's 50-instrument cap, one messageCode at
 * a time (touchline and OI are separate calls in this API — there's no
 * single call that returns both). `instruments` = [{exchangeSegment, exchangeInstrumentID}].
 */
export async function fetchQuotesBatched(creds, instruments, messageCode) {
  if (!instruments.length) return [];
  const chunks = await batchWithDelay(instruments, QUOTE_BATCH_SIZE, QUOTE_BATCH_DELAY_MS, (chunk) =>
    fetchQuotesOnce(creds, chunk, messageCode)
  );
  return chunks.flat();
}
