/**
 * Tradejini (CubePlus) — see registry.mjs for the shared broker contract.
 *
 * Auth: active login, not paste-a-token. `POST /api-gw/oauth/individual-token-v2`
 * with the app API key as a bare Bearer + the CubePlus login PIN + a live TOTP
 * code; the resulting access_token is cached in-memory for its documented
 * `expires_in` window (tradejiniAuth.mjs) — same shape as Angel One / 5paisa.
 *
 * Data: no REST option-chain or multi-quote endpoint exists in this API —
 * strike/expiry -> token resolution comes from the daily public scrip-master
 * (tradejiniInstruments.mjs), and live prices come from a persistent
 * authenticated WebSocket feed (tradejiniStream.mjs), same shape as this app's
 * Alice Blue integration. Unlike Alice Blue, Tradejini's feed also streams a
 * dedicated Greeks channel (IV + delta/gamma/theta/vega computed server-side),
 * so Black-Scholes is only a fallback for whatever legs don't report a Greeks
 * tick inside the collection window.
 *
 * Verified against marketcalls/openalgo's production broker/tradejini adapter —
 * no public Tradejini API docs mirror exists, so that adapter is the sole
 * reference for every endpoint, field name, and wire format used here.
 */

import { getSession } from "./tradejiniAuth.mjs";
import {
  OPTIONS_GROUP,
  fetchExpiries,
  resolveNearestExpiry,
  resolveStrikeTokens,
  resolveIndexSpotToken,
} from "./tradejiniInstruments.mjs";
import { subscribeAndCollect } from "./tradejiniStream.mjs";
import { computeIVAndGreeks, daysBetween } from "../lib/blackScholes.mjs";

export const id = "tradejini";
export const credentialFields = ["apiKey", "password", "totpSecret"];

export async function testConnection(creds) {
  try {
    await getSession(creds);
    return { status: "success", message: "Tradejini session established" };
  } catch (e) {
    return { status: "error", message: e.message };
  }
}

export async function fetchExpiryList(creds, symbol) {
  if (!OPTIONS_GROUP[symbol]) throw new Error(`Tradejini: unknown symbol ${symbol}`);
  const data = await fetchExpiries(symbol);
  return { status: "success", data };
}

function num(tick, key) {
  const v = Number(tick?.[key]);
  return Number.isFinite(v) ? v : 0;
}

async function resolveSpot(symbol) {
  try {
    return await resolveIndexSpotToken(symbol);
  } catch (e) {
    console.warn(`[tradejini] index spot resolution failed for ${symbol}: ${e.message}`);
    return null;
  }
}

function buildLeg(tick, { spot, strike, daysToExpiry, type }) {
  const ltp = num(tick, "ltp");
  const hasBrokerGreeks = Number.isFinite(tick?.iv) && tick.iv > 0;

  const leg = {
    last_price: ltp,
    oi: num(tick, "OI"),
    volume: num(tick, "vol"),
    bid_price: num(tick, "bidPrice"),
    ask_price: num(tick, "askPrice"),
    ...(hasBrokerGreeks
      ? { iv: num(tick, "iv"), delta: num(tick, "delta"), gamma: num(tick, "gamma"), theta: num(tick, "theta"), vega: num(tick, "vega") }
      : computeIVAndGreeks({ ltp, spot, strike, daysToExpiry, type })),
  };

  if (tick?.OI != null && tick?.prevOI != null) leg.oi_chg = tick.OI - tick.prevOI;
  return leg;
}

export async function fetchOptionChain(creds, symbol, expiry) {
  if (!OPTIONS_GROUP[symbol]) throw new Error(`Tradejini: unknown symbol ${symbol}`);

  const expiryISO = expiry || (await resolveNearestExpiry(symbol));
  const strikeMap = await resolveStrikeTokens(symbol, expiryISO);
  if (strikeMap.size === 0) return { status: "success", data: { oc: {}, last_price: 0 } };

  const spot = await resolveSpot(symbol);
  const spotKey = spot ? `${spot.token}_${spot.exch}` : null;

  const legKeys = [];
  const legMeta = new Map(); // "token_EXCH" -> { strike, type: "ce"|"pe" }
  for (const [strike, legs] of strikeMap) {
    if (legs.ce) {
      const k = `${legs.ce.token}_${legs.ce.exch}`;
      legKeys.push(k);
      legMeta.set(k, { strike, type: "ce" });
    }
    if (legs.pe) {
      const k = `${legs.pe.token}_${legs.pe.exch}`;
      legKeys.push(k);
      legMeta.set(k, { strike, type: "pe" });
    }
  }

  const allKeys = spotKey ? [...legKeys, spotKey] : legKeys;
  const ticks = await subscribeAndCollect(creds, allKeys);

  const spotPrice = spotKey ? num(ticks.get(spotKey), "ltp") : 0;
  const daysToExpiry = daysBetween(new Date(), expiryISO);

  const oc = {};
  for (const key of legKeys) {
    const meta = legMeta.get(key);
    const tick = ticks.get(key);
    if (!tick) continue; // no tick arrived in the collection window — omit this leg rather than fake zeros

    const leg = buildLeg(tick, { spot: spotPrice, strike: Number(meta.strike), daysToExpiry, type: meta.type.toUpperCase() });
    if (!oc[meta.strike]) oc[meta.strike] = {};
    oc[meta.strike][meta.type] = leg;
  }

  return { status: "success", data: { oc, last_price: spotPrice } };
}

export async function fetchLTP(creds, symbol) {
  const spot = await resolveIndexSpotToken(symbol);
  const key = `${spot.token}_${spot.exch}`;
  const ticks = await subscribeAndCollect(creds, [key], { withGreeks: false });
  return { status: "success", data: { last_price: num(ticks.get(key), "ltp") } };
}
