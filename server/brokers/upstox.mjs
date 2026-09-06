/**
 * Upstox API v2 — paste-token model, same UX as Dhan. The user completes
 * Upstox's OAuth2 browser login externally once per trading day and pastes
 * the resulting accessToken here; this module never performs a login call
 * itself, it just sends `Authorization: Bearer <accessToken>` on every
 * request. accessToken always expires at a fixed 3:30 AM IST cutoff the next
 * calendar day (not a rolling TTL) — on 401 we surface a clear
 * "generate a fresh token" error instead of trying to auto-recover.
 *
 * Option chain uses Upstox's native /v2/option/chain endpoint, which already
 * returns LTP/OI/bid-ask/Greeks/IV per strike in one call — no instrument
 * master + batched-quotes workaround needed there. See registry.mjs for the
 * shared broker-module contract.
 */

import { computeIVAndGreeks, daysBetween } from "../lib/blackScholes.mjs";
import { resolveInstrumentKey } from "./upstoxInstruments.mjs";

const UPSTOX_BASE = "https://api.upstox.com/v2";

export const id = "upstox";
export const credentialFields = ["apiKey", "apiSecret", "accessToken"];

async function upstoxFetch(path, params, accessToken) {
  if (!accessToken) throw new Error("Upstox accessToken is not configured.");

  const qs = new URLSearchParams(params || {});
  const url = `${UPSTOX_BASE}${path}${qs.toString() ? `?${qs.toString()}` : ""}`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });

  if (res.status === 401) {
    throw new Error("Upstox access token expired — generate a fresh one (tokens expire daily at 3:30 AM IST).");
  }

  const body = await res.json().catch(() => null);
  if (!res.ok || !body || body.status !== "success") {
    const msg = body?.errors?.[0]?.message || body?.message || `HTTP ${res.status}`;
    throw new Error(`Upstox API error [${res.status}]: ${msg}`);
  }
  return body;
}

/**
 * Upstox's option_greeks.iv has been observed reported both as a percentage
 * (e.g. 14.2) and as a raw decimal fraction (e.g. 0.142) depending on API
 * version — unverified against a live account, so we sanity-check against a
 * known-liquid strike's typical 10-25% range and scale up if it looks like a
 * decimal.
 */
function normalizeIv(rawIv) {
  if (!(rawIv > 0)) return 0;
  return rawIv < 2 ? rawIv * 100 : rawIv;
}

function buildLeg(marketData, greeks, ctx) {
  const md = marketData || {};
  const ltp = Number(md.ltp) || 0;
  const oi = Number(md.oi) || 0;
  const hasPrevOi = typeof md.prev_oi === "number";

  const rawIv = Number(greeks?.iv) || 0;
  const ivGreeks =
    rawIv > 0
      ? {
          iv: normalizeIv(rawIv),
          delta: Number(greeks.delta) || 0,
          gamma: Number(greeks.gamma) || 0,
          theta: Number(greeks.theta) || 0,
          vega: Number(greeks.vega) || 0,
        }
      : computeIVAndGreeks({
          ltp,
          spot: ctx.spot,
          strike: ctx.strike,
          daysToExpiry: ctx.daysToExpiry,
          type: ctx.type,
        });

  const leg = {
    last_price: ltp,
    oi,
    volume: Number(md.volume) || 0,
    ...ivGreeks,
    bid_price: Number(md.bid_price) || 0,
    ask_price: Number(md.ask_price) || 0,
  };
  if (hasPrevOi) leg.oi_chg = oi - md.prev_oi;
  return leg;
}

export async function testConnection(creds = {}) {
  try {
    const instrumentKey = await resolveInstrumentKey("NIFTY");
    await upstoxFetch("/option/contract", { instrument_key: instrumentKey }, creds.accessToken);
    return { status: "success", message: "Upstox API connected" };
  } catch (e) {
    return { status: "error", message: e.message };
  }
}

export async function fetchExpiryList(creds, symbol) {
  const instrumentKey = await resolveInstrumentKey(symbol);
  const body = await upstoxFetch("/option/contract", { instrument_key: instrumentKey }, creds?.accessToken);
  const expiries = Array.from(new Set((body.data || []).map((c) => c.expiry).filter(Boolean)));
  expiries.sort();
  return { status: "success", data: expiries };
}

export async function fetchOptionChain(creds, symbol, expiry) {
  const instrumentKey = await resolveInstrumentKey(symbol);

  let resolvedExpiry = expiry;
  if (!resolvedExpiry) {
    const list = await fetchExpiryList(creds, symbol);
    resolvedExpiry = list.data?.[0];
    if (!resolvedExpiry) return { status: "success", data: { oc: {}, last_price: 0 } };
  }

  const body = await upstoxFetch(
    "/option/chain",
    { instrument_key: instrumentKey, expiry_date: resolvedExpiry },
    creds?.accessToken
  );
  const rows = body.data || [];
  if (rows.length === 0) return { status: "success", data: { oc: {}, last_price: 0 } };

  const spot = Number(rows[0].underlying_spot_price) || 0;
  const daysToExpiry = daysBetween(new Date(), resolvedExpiry);

  const oc = {};
  for (const row of rows) {
    const strike = Number(row.strike_price);
    const strikeKey = String(strike);
    const entry = {};
    if (row.call_options) {
      entry.ce = buildLeg(row.call_options.market_data, row.call_options.option_greeks, {
        spot,
        strike,
        daysToExpiry,
        type: "CE",
      });
    }
    if (row.put_options) {
      entry.pe = buildLeg(row.put_options.market_data, row.put_options.option_greeks, {
        spot,
        strike,
        daysToExpiry,
        type: "PE",
      });
    }
    oc[strikeKey] = entry;
  }

  return { status: "success", data: { oc, last_price: spot } };
}

// Not covered by the Upstox research brief (which only verified /option/chain
// and /option/contract) — unverified against a live account. Best-effort per
// Upstox's public v2 docs: response data is keyed by "EXCHANGE:Name" (colon,
// not the pipe-based instrument_key used in the request), but each row's own
// `instrument_token` field echoes back the pipe-based instrument_key we sent,
// which is what we match on below.
export async function fetchLTP(creds, symbol) {
  const instrumentKey = await resolveInstrumentKey(symbol);
  const body = await upstoxFetch("/market-quote/ltp", { instrument_key: instrumentKey }, creds?.accessToken);
  const rows = Object.values(body.data || {});
  const match = rows.find((r) => r.instrument_token === instrumentKey) || rows[0];
  return { status: "success", data: { last_price: Number(match?.last_price) || 0 } };
}
