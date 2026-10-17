/**
 * Definedge Securities (INTEGRATE API) — real broker integration (see
 * registry.mjs for the shared contract).
 *
 * Auth model: paste-a-session-key, NOT an automatable TOTP/handshake login.
 * Definedge's 2-step login sends a REAL one-time OTP to the user's
 * registered mobile/email on every login — unlike Angel One/5paisa/Alice
 * Blue, there is no TOTP-app seed this server could compute on its own. So
 * this module never logs in itself: the user completes both steps
 * externally (Step 1: GET .../login/{api_token} with header `api_secret` to
 * trigger the OTP; Step 2: POST .../token with {otp_token, otp,
 * ac: sha256(otp_token+otp+api_secret)} to receive `api_session_key`) and
 * pastes that session key into Broker Settings. Its lifetime isn't publicly
 * documented — treat it like Zerodha's ~1-trading-day token and re-paste a
 * fresh one whenever calls start 401ing (see definedgeQuotes.mjs).
 *
 * No native option-chain endpoint and no bulk-quote endpoint at all — every
 * quote is one GET /quotes/{exchange}/{token} call (confirmed against
 * openalgo's production adapter), and that response carries no OI or
 * greeks. So the chain is built from the daily instrument master
 * (definedgeInstruments.mjs), windowed to strikes near spot (no bulk-quote
 * endpoint means every strike is its own round trip — see
 * STRIKE_HALF_WIDTH below), with OI backfilled from history and IV/Greeks
 * filled in via Black-Scholes (definedgeQuotes.mjs + server/lib/blackScholes.mjs).
 *
 * Noren family note: Definedge's WebSocket path is `NorenWSTRTP` — the same
 * Noren/Omnesys OMS family as Shoonya (Finvasia)/Flattrade/Tradesmart
 * elsewhere in this registry. Their adapters (once built) are worth
 * cross-checking for matching request/response shapes.
 */

import { computeIVAndGreeks, daysBetween } from "../lib/blackScholes.mjs";
import { getOptionRows, distinctExpiriesAscending, SPOT_INDEX } from "./definedgeInstruments.mjs";
import { fetchQuoteRaw, fetchQuotesBatched, fetchOIBatched, getLimits } from "./definedgeQuotes.mjs";

export const id = "definedge";
export const credentialFields = ["apiToken", "apiSecret", "apiSessionKey"];

// A full expiry's master-CSV rows can span hundreds of strikes deep into
// illiquid OTM/ITM territory (confirmed live — 227 NIFTY strikes for a
// single weekly expiry). With no bulk-quote endpoint, fetching all of them
// would take well over a minute per chain load. Instead, center on the
// strike nearest spot and take this many strikes on each side (~41 strikes
// / ≤82 legs at the default) — same tradeoff as this registry's Flattrade
// adapter, which has the identical one-call-per-contract constraint.
const STRIKE_HALF_WIDTH = 20;

function selectStrikeWindow(rows, spot, halfWidth) {
  const strikes = Array.from(new Set(rows.map((r) => r.strike))).sort((a, b) => a - b);
  if (strikes.length === 0) return [];

  let atmIdx = 0;
  let minDiff = Infinity;
  for (let i = 0; i < strikes.length; i++) {
    const diff = Math.abs(strikes[i] - spot);
    if (diff < minDiff) {
      minDiff = diff;
      atmIdx = i;
    }
  }

  const lo = Math.max(0, atmIdx - halfWidth);
  const hi = Math.min(strikes.length - 1, atmIdx + halfWidth);
  const keep = new Set(strikes.slice(lo, hi + 1));
  return rows.filter((r) => keep.has(r.strike));
}

export async function testConnection(creds = {}) {
  try {
    if (!creds.apiSessionKey) {
      return {
        status: "error",
        message: "Missing apiSessionKey — complete Definedge's 2-step OTP login and paste the resulting api_session_key.",
      };
    }
    const json = await getLimits(creds);
    if (json?.status !== "SUCCESS") {
      return { status: "error", message: json?.message || "Definedge did not return a success status" };
    }
    return { status: "success", message: "Definedge Securities connected" };
  } catch (e) {
    return { status: "error", message: e.message };
  }
}

export async function fetchExpiryList(creds, symbol) {
  const rows = await getOptionRows(symbol);
  return { status: "success", data: distinctExpiriesAscending(rows) };
}

export async function fetchLTP(creds, symbol) {
  const spotInfo = SPOT_INDEX[symbol];
  if (!spotInfo) throw new Error(`Unknown index: ${symbol}`);
  const json = await fetchQuoteRaw(creds, spotInfo.exchange, spotInfo.token);
  if (json?.status !== "SUCCESS") {
    throw new Error(`Definedge quotes failed for ${symbol}: ${json?.message || "unknown error"}`);
  }
  return { status: "success", data: { last_price: Number(json.ltp) || 0 } };
}

async function fetchSpot(creds, symbol) {
  const { data } = await fetchLTP(creds, symbol);
  return data.last_price;
}

function buildLeg(quote, oi, spot, strike, daysToExpiry, type) {
  const ltp = Number(quote?.ltp) || 0;
  const volume = Number(quote?.volume) || 0;
  const bid_price = Number(quote?.best_bid_price1) || 0;
  const ask_price = Number(quote?.best_ask_price1) || 0;
  const greeks = computeIVAndGreeks({ ltp, spot, strike, daysToExpiry, type });
  return { last_price: ltp, oi: oi || 0, volume, bid_price, ask_price, ...greeks };
}

export async function fetchOptionChain(creds, symbol, expiry) {
  let rows = await getOptionRows(symbol);
  if (rows.length === 0) return { status: "success", data: { oc: {}, last_price: 0 } };

  const expiries = distinctExpiriesAscending(rows);
  const targetExpiry = expiry || expiries[0];
  if (!targetExpiry) return { status: "success", data: { oc: {}, last_price: 0 } };

  rows = rows.filter((r) => r.expiryIso === targetExpiry);
  if (rows.length === 0) return { status: "success", data: { oc: {}, last_price: 0 } };

  const spot = await fetchSpot(creds, symbol);
  const daysToExpiry = daysBetween(new Date(), targetExpiry);

  const windowedRows = selectStrikeWindow(rows, spot, STRIKE_HALF_WIDTH);
  const legs = windowedRows.map((r) => ({ exchange: r.exchange, token: r.token, strike: r.strike, optionType: r.optionType }));

  // Quotes (integrate.definedgesecurities.com) and OI backfill
  // (data.definedgesecurities.com) are different hosts with independent
  // throttles — run both batched pipelines concurrently.
  const [quoteMap, oiMap] = await Promise.all([
    fetchQuotesBatched(creds, legs),
    fetchOIBatched(creds, legs),
  ]);

  const oc = {};
  for (const leg of legs) {
    const quote = quoteMap.get(leg.token);
    if (!quote) continue;
    const strikeKey = String(leg.strike);
    if (!oc[strikeKey]) oc[strikeKey] = {};
    const side = leg.optionType === "CE" ? "ce" : "pe";
    oc[strikeKey][side] = buildLeg(quote, oiMap.get(leg.token), spot, leg.strike, daysToExpiry, leg.optionType);
  }

  return { status: "success", data: { oc, last_price: spot } };
}
