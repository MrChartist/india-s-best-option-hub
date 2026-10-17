/**
 * Nubra (Nuvama Nubra) REST API V3 — see registry.mjs for the shared contract.
 *
 * Auth model: TOTP-based server-side login (like Angel One / 5paisa), NOT a
 * paste-a-token model — see nubraAuth.mjs for why (phone-OTP is interactive;
 * TOTP is the only non-interactive path once the user has enabled it once on
 * their own Nubra account). Session is cached in-memory, keyed off creds, and
 * sized from the session JWT's own `exp` claim.
 *
 * Option chain: Nubra has a NATIVE option-chain snapshot endpoint
 * (`GET /optionchains/{asset}?exchange=...&expiry=...`) that returns every
 * CE/PE strike for one expiry in a single call, complete with OI, volume and
 * (usually) delta/gamma/theta/vega — the same shape family as Dhan/Upstox,
 * no instrument-master + batched-quotes needed. The same response also
 * carries `all_expiries`, so fetchExpiryList is just one more call to the
 * same endpoint. `iv` frequently comes back null in this snapshot even when
 * the other Greeks are populated (confirmed in the docs' own sample
 * response), so IV is filled in via Black-Scholes whenever the broker
 * doesn't supply it; native delta/gamma/theta/vega are used as-is when
 * present since they're broker-computed off the live chain.
 *
 * Not provided by this endpoint at all: bid/ask (despite the docs' prose
 * mentioning "top bid/ask", the documented JSON response has no such field —
 * real per-level bid/ask on Nubra only exists via the WebSocket order-book
 * stream or the REST `/orderbooks/{ref_id}` endpoint, which needs a numeric
 * ref_id resolved from the (large, exchange-wide) instrument master. Out of
 * scope for this lightweight snapshot-only integration; bid/ask are reported
 * as 0, same fallback fivepaisa.mjs uses for the same reason.
 *
 * FINNIFTY/MIDCPNIFTY asset names are unverified — only NIFTY, BANKNIFTY and
 * SENSEX appear in Nubra's own docs examples. They're assumed to match their
 * official NSE index-derivative names (consistent with how `asset` is
 * documented to be "the underlying name" off the instruments master), and
 * Nubra's own error message will surface plainly if a name is wrong.
 *
 * Rate limits (V3 docs): historical/REST market data 60 req/min; this module
 * never issues more than one market-data call per exported function, so no
 * internal batching is needed — nubraFetch's 429 backoff is the only pacing
 * mechanism required.
 */

import { nubraFetch, NUBRA_BASE } from "./nubraAuth.mjs";
import { computeIVAndGreeks, daysBetween } from "../lib/blackScholes.mjs";

export const id = "nubra";
export const credentialFields = ["phone", "mpin", "totpSecret"];

// asset name (as used by /optionchains/{asset}) + exchange for each index.
// Only NIFTY/BANKNIFTY/SENSEX are confirmed against Nubra's docs; the rest
// are best-effort per the module comment above.
const SYMBOL_MAP = {
  NIFTY: { asset: "NIFTY", exchange: "NSE" },
  BANKNIFTY: { asset: "BANKNIFTY", exchange: "NSE" },
  FINNIFTY: { asset: "FINNIFTY", exchange: "NSE" }, // unverified
  MIDCPNIFTY: { asset: "MIDCPNIFTY", exchange: "NSE" }, // unverified
  SENSEX: { asset: "SENSEX", exchange: "BSE" },
};

function isoToYyyymmdd(iso) {
  return iso.replaceAll("-", "");
}

function yyyymmddToIso(s) {
  const str = String(s);
  return `${str.slice(0, 4)}-${str.slice(4, 6)}-${str.slice(6, 8)}`;
}

/** GET /optionchains/{asset}?exchange=...&expiry=... — expiryIso is optional (omit for the nearest chain). */
async function fetchRawChain(creds, symbol, expiryIso) {
  const info = SYMBOL_MAP[symbol];
  if (!info) throw new Error(`Unknown symbol: ${symbol}`);
  const params = new URLSearchParams({ exchange: info.exchange });
  if (expiryIso) params.set("expiry", isoToYyyymmdd(expiryIso));
  const json = await nubraFetch(creds, `/optionchains/${info.asset}?${params.toString()}`);
  const chain = json?.chain;
  if (!chain) throw new Error(`Nubra returned no option chain for ${symbol}`);
  return chain;
}

export async function testConnection(creds = {}) {
  try {
    const chain = await fetchRawChain(creds, "NIFTY");
    if (!chain) return { status: "error", message: "Nubra returned no chain data" };
    return { status: "success", message: "Nubra (Nuvama) API connected" };
  } catch (e) {
    return { status: "error", message: e.message };
  }
}

export async function fetchExpiryList(creds, symbol) {
  const chain = await fetchRawChain(creds, symbol);
  const dates = (chain.all_expiries || []).map(yyyymmddToIso).sort();
  return { status: "success", data: dates };
}

/** Builds one Leg from a raw Nubra chain row (`sp`/`ltp` are paise; delta/gamma/theta/vega/iv are raw, not scaled). */
function buildLeg(row, { spot, daysToExpiry, type }) {
  const strike = Number(row.sp || 0) / 100;
  const lastPrice = Number(row.ltp || 0) / 100;
  const oi = Number(row.oi) || 0;
  const volume = Number(row.volume) || 0;

  const hasNativeGreeks =
    row.delta != null && row.gamma != null && row.theta != null && row.vega != null;

  let greeks;
  if (hasNativeGreeks) {
    let ivPct = row.iv != null ? Number(row.iv) * 100 : null;
    if (ivPct == null) {
      ivPct = computeIVAndGreeks({ ltp: lastPrice, spot, strike, daysToExpiry, type }).iv;
    }
    greeks = {
      iv: ivPct,
      delta: Number(row.delta) || 0,
      gamma: Number(row.gamma) || 0,
      theta: Number(row.theta) || 0,
      vega: Number(row.vega) || 0,
    };
  } else {
    greeks = computeIVAndGreeks({ ltp: lastPrice, spot, strike, daysToExpiry, type });
  }

  return {
    last_price: lastPrice,
    oi,
    volume,
    ...greeks,
    // Nubra's option-chain snapshot carries no bid/ask (see module header) —
    // real depth needs a separate WebSocket/orderbooks lookup, out of scope.
    bid_price: 0,
    ask_price: 0,
  };
}

export async function fetchOptionChain(creds, symbol, expiry) {
  const chain = await fetchRawChain(creds, symbol, expiry);

  const resolvedExpiryIso = expiry || (chain.expiry ? yyyymmddToIso(chain.expiry) : null);
  const spot = Number(chain.cp || 0) / 100;
  const daysToExpiry = resolvedExpiryIso ? daysBetween(new Date(), resolvedExpiryIso) : 0;

  const ceRows = Array.isArray(chain.ce) ? chain.ce : [];
  const peRows = Array.isArray(chain.pe) ? chain.pe : [];
  if (ceRows.length === 0 && peRows.length === 0) {
    return { status: "success", data: { oc: {}, last_price: spot } };
  }

  const oc = {};
  for (const row of ceRows) {
    const strikeKey = String(Number(row.sp || 0) / 100);
    (oc[strikeKey] ||= {}).ce = buildLeg(row, { spot, daysToExpiry, type: "CE" });
  }
  for (const row of peRows) {
    const strikeKey = String(Number(row.sp || 0) / 100);
    (oc[strikeKey] ||= {}).pe = buildLeg(row, { spot, daysToExpiry, type: "PE" });
  }

  return { status: "success", data: { oc, last_price: spot } };
}

export async function fetchLTP(creds, symbol) {
  // No dedicated spot-price endpoint is documented for Nubra V3 (unlike the
  // option-chain snapshot endpoint, which IS confirmed against the docs) —
  // rather than invent an unverified `/price` route, reuse the same chain
  // snapshot and read its `cp` (spot) field, exactly like fetchOptionChain does.
  const chain = await fetchRawChain(creds, symbol);
  const price = Number(chain?.cp || 0) / 100;
  return { status: "success", data: { last_price: price } };
}

// Re-exported for parity with other broker modules that expose their base URL
// (e.g. dhanFetch is imported directly elsewhere) — currently unused outside
// this file, kept for consistency/debuggability.
export { NUBRA_BASE };
