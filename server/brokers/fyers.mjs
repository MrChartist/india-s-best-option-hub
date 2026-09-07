/**
 * Fyers API v3 — paste-token auth, same UX as Dhan: the user completes
 * Fyers' OAuth login externally once per trading day (their app + secretKey
 * are only needed client-side, on Fyers' own site, to mint the token) and
 * pastes the resulting accessToken here. There is NO server-side login flow
 * — the Authorization header is built fresh on every request as
 * `<appId>:<accessToken>` (colon-joined, NOT "Bearer"). secretKey is
 * collected for completeness but unused at request time.
 *
 * Option chain: Fyers' native /data/options-chain-v3 endpoint returns every
 * CE/PE strike (LTP, OI, bid/ask, volume, and optionally greeks) for ONE
 * expiry in a single call, but per Fyers' own docs/openalgo's production
 * usage it reliably only serves the NEAREST expiry — the `timestamp` param
 * documented for picking other expiries is unverified/unreliable. v1 of
 * this integration therefore only supports the nearest expiry; requesting
 * any other expiry throws a clear error rather than silently returning the
 * wrong chain (a heavier instrument-master fallback would be needed for
 * full multi-expiry support).
 *
 * Docs: https://myapi.fyers.in/docs/ (Option Chain, Quotes)
 * Rate limit: 10 req/sec, 200/min, 100,000/day PER API KEY across ALL
 * endpoints combined. Every exported function here makes exactly one
 * upstream request, so no internal batching/pacing is needed.
 */

import { computeIVAndGreeks, daysBetween } from "../lib/blackScholes.mjs";
import { buildOptionsChain, parseExpiryDate } from "./fyersChain.mjs";

// Order placement (real money) — see fyersOrders.mjs for the verification
// tier this is held to, and capabilities' inline comments for what's confirmed
// vs. NEEDS VERIFICATION. Re-exported here so registry.get("fyers") matches
// the module contract documented in registry.mjs, same as every other
// exported function in this file.
export { capabilities, buildOrderBody, placeOrder, getOrders, getOrderStatus, cancelOrder } from "./fyersOrders.mjs";

const FYERS_BASE = "https://api-t1.fyers.in";

export const id = "fyers";
export const credentialFields = ["appId", "secretKey", "accessToken"];

// All five confirmed 2026-09 directly against Fyers' own live public symbol-master
// CSVs (https://public.fyers.in/sym_details/NSE_CM.csv and .../BSE_CM.csv, no auth
// required) — each row's `fySymbol` column matches exactly. options-chain-v3 will
// still surface Fyers' own error message if one ever changes, so failures here
// stay debuggable rather than silent.
export const INDEX_SYMBOL_MAP = {
  NIFTY: "NSE:NIFTY50-INDEX",
  BANKNIFTY: "NSE:NIFTYBANK-INDEX",
  FINNIFTY: "NSE:FINNIFTY-INDEX",
  MIDCPNIFTY: "NSE:MIDCPNIFTY-INDEX",
  SENSEX: "BSE:SENSEX-INDEX",
};

function authHeader(creds) {
  const appId = creds?.appId;
  const accessToken = creds?.accessToken;
  if (!appId || !accessToken) {
    throw new Error("Fyers appId/accessToken missing — add credentials in Broker Settings.");
  }
  return `${appId}:${accessToken}`;
}

async function fyersFetch(path, creds) {
  const res = await fetch(`${FYERS_BASE}${path}`, {
    headers: { Authorization: authHeader(creds), "Content-Type": "application/json" },
  });

  let json = null;
  try {
    json = await res.json();
  } catch {
    /* fall through to the !json check below */
  }

  if (!res.ok || !json) {
    throw new Error(`Fyers API error [${res.status}] on ${path.split("?")[0]}`);
  }
  if (json.s !== "ok") {
    const msg = json.message || `Fyers API error (code ${json.code ?? "unknown"})`;
    if (/token|auth|expire/i.test(msg)) {
      throw new Error(`Fyers session token expired or invalid — re-paste a fresh accessToken from Fyers login. (${msg})`);
    }
    throw new Error(`Fyers API error: ${msg}`);
  }
  return json;
}

async function fetchRawChain(creds, symbol, strikecount = 50) {
  const fyersSymbol = INDEX_SYMBOL_MAP[symbol];
  if (!fyersSymbol) throw new Error(`Unknown symbol: ${symbol}`);
  const n = Math.max(1, Math.min(strikecount, 50));
  try {
    return await fyersFetch(
      `/data/options-chain-v3?symbol=${encodeURIComponent(fyersSymbol)}&strikecount=${n}&greeks=1`,
      creds
    );
  } catch (e) {
    throw new Error(`Fyers option-chain fetch failed for ${symbol} (${fyersSymbol}): ${e.message}`);
  }
}

export async function testConnection(creds = {}) {
  try {
    await fetchRawChain(creds, "NIFTY", 1);
    return { status: "success", message: "Fyers API connected" };
  } catch (e) {
    return { status: "error", message: e.message };
  }
}

export async function fetchExpiryList(creds, symbol) {
  const raw = await fetchRawChain(creds, symbol, 1);
  const expiryData = raw?.data?.expiryData || [];
  const dates = expiryData.map((e) => parseExpiryDate(e.date)).filter(Boolean).sort();
  return { status: "success", data: dates };
}

export async function fetchOptionChain(creds, symbol, expiry) {
  const raw = await fetchRawChain(creds, symbol, 50);
  const data = raw?.data;
  if (!data || !Array.isArray(data.optionsChain) || data.optionsChain.length === 0) {
    return { status: "success", data: { oc: {}, last_price: 0 } };
  }

  const expiryData = data.expiryData || [];
  const nearestIso = expiryData[0] ? parseExpiryDate(expiryData[0].date) : null;
  if (expiry && nearestIso && expiry !== nearestIso) {
    throw new Error(
      "Fyers integration currently supports only the nearest expiry — full multi-expiry support requires a heavier instrument-master fallback."
    );
  }

  const resolvedExpiry = expiry || nearestIso;
  const daysToExpiry = resolvedExpiry ? daysBetween(new Date(), resolvedExpiry) : 0;

  return {
    status: "success",
    data: buildOptionsChain(data.optionsChain, { daysToExpiry, computeIVAndGreeks }),
  };
}

export async function fetchLTP(creds, symbol) {
  const fyersSymbol = INDEX_SYMBOL_MAP[symbol];
  if (!fyersSymbol) throw new Error(`Unknown symbol: ${symbol}`);

  const json = await fyersFetch(`/data/quotes?symbols=${encodeURIComponent(fyersSymbol)}`, creds);
  const rows = Array.isArray(json.d) ? json.d : [];
  const entry = rows.find((row) => row.n === fyersSymbol) || rows[0];
  const lp = entry?.v?.lp;
  if (lp == null) throw new Error(`Fyers quotes returned no LTP for ${symbol} (${fyersSymbol})`);
  return { status: "success", data: { last_price: Number(lp) } };
}
