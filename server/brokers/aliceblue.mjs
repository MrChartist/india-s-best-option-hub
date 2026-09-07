/**
 * Alice Blue (legacy "Ant API") — see registry.mjs for the shared broker contract.
 *
 * Auth: 2-call SHA-256 session handshake (aliceblueAuth.mjs), cached per trading day.
 * Data: no REST option-chain/multi-quote endpoint in this API family — quotes come
 * from a persistent authenticated NorenWS WebSocket (aliceblueAuth.mjs), with
 * strike/expiry -> token resolution from the daily contract-master CSV
 * (aliceblueInstruments.mjs). IV/Greeks are computed locally via blackScholes.mjs
 * since Alice Blue's feed carries no Greeks.
 */

import { getSession, subscribeAndCollect } from "./aliceblueAuth.mjs";
import {
  OPTIONS_EXCHANGE,
  fetchExpiries,
  resolveNearestExpiry,
  resolveStrikeTokens,
  resolveIndexSpotToken,
} from "./aliceblueInstruments.mjs";
import { computeIVAndGreeks, daysBetween } from "../lib/blackScholes.mjs";

export const id = "aliceblue";
export const credentialFields = ["userId", "apiKey"];

/**
 * Capabilities descriptor — informational only. placeOrder is intentionally
 * NOT implemented for Alice Blue in this pass; it stays read-only (market
 * data/quotes) until order code is written and held to the same
 * verification bar as fyersOrders.mjs/zerodhaOrders.mjs.
 *
 * Sourced from a direct fetch of Alice Blue's own docs
 * (ant.aliceblueonline.com/productdocumentation/orders Management/), which
 * documents an `orderType` field with values Regular/BO/CO/AMO (order
 * *category* — LIMIT/MARKET/SL/SLM is a separate price-type field per the
 * same docs' appendix), a `product` field with MIS/CNC/NRML, a `ret`
 * (validity) field showing "DAY" in the worked example and "IOC" referenced
 * only in the appendix, and `mktProtection` + `disclosedQty` fields on the
 * place-order request itself.
 */
export const capabilities = {
  bracket: false, // "BO" is a documented orderType value, but nothing found this session confirms whether Alice Blue's Ant API currently executes it end-to-end vs. accepting-then-rejecting it. NEEDS VERIFICATION before ever enabling.
  cover: false, // Same as bracket — "CO" is documented but its current live behaviour is unconfirmed.
  ioc: false, // NEEDS VERIFICATION — "IOC" appears only in the docs' appendix, not in the worked place-order example (which shows "DAY").
  mtf: false, // NEEDS VERIFICATION — no MTF product code found anywhere in Alice Blue's own docs.
  nativeMarketProtection: true, // CONFIRMED — `mktProtection` is a real field on Alice Blue's own place-order request.
  maxLegQty: null, // NEEDS VERIFICATION — no broker-specific per-order qty cap found; the NSE exchange-wide freeze quantity (spec §8 slicing) is the only confirmed ceiling. Do not read null as "unlimited".
  products: ["CNC", "MIS", "NRML"], // Confirmed from the same docs page.
};

export async function testConnection(creds) {
  try {
    await getSession(creds);
    return { status: "success", message: "Alice Blue session established" };
  } catch (e) {
    return { status: "error", message: e.message };
  }
}

export async function fetchExpiryList(creds, symbol) {
  const data = await fetchExpiries(symbol);
  return { status: "success", data };
}

function tickLtp(tick) {
  if (!tick) return 0;
  const v = Number(tick.lp ?? tick.c ?? 0);
  return Number.isFinite(v) ? v : 0;
}

async function resolveSpot(symbol) {
  try {
    return await resolveIndexSpotToken(symbol);
  } catch (e) {
    console.warn(`[aliceblue] index spot token resolution failed for ${symbol}: ${e.message}`);
    return null;
  }
}

export async function fetchOptionChain(creds, symbol, expiry) {
  if (!OPTIONS_EXCHANGE[symbol]) throw new Error(`Alice Blue: unknown symbol ${symbol}`);

  const expiryISO = expiry || (await resolveNearestExpiry(symbol));
  const strikeMap = await resolveStrikeTokens(symbol, expiryISO);

  if (strikeMap.size === 0) {
    return { status: "success", data: { oc: {}, last_price: 0 } };
  }

  const spot = await resolveSpot(symbol);
  const spotKey = spot ? `${spot.exch}|${spot.token}` : null;

  const legKeys = []; // "EXCH|token"
  const legMeta = new Map(); // key -> { strike, type: "ce"|"pe" }
  for (const [strike, legs] of strikeMap) {
    if (legs.ce) {
      const k = `${legs.ce.exch}|${legs.ce.token}`;
      legKeys.push(k);
      legMeta.set(k, { strike, type: "ce" });
    }
    if (legs.pe) {
      const k = `${legs.pe.exch}|${legs.pe.token}`;
      legKeys.push(k);
      legMeta.set(k, { strike, type: "pe" });
    }
  }

  const allKeys = spotKey ? [...legKeys, spotKey] : legKeys;
  const ticks = await subscribeAndCollect(creds, allKeys);

  const spotPrice = spotKey ? tickLtp(ticks.get(spotKey)) : 0;
  const daysToExpiry = daysBetween(new Date(), expiryISO);

  const oc = {};
  for (const key of legKeys) {
    const meta = legMeta.get(key);
    const tick = ticks.get(key);
    if (!tick) continue; // no tick arrived in the collection window — omit this leg rather than fake zeros

    const ltp = tickLtp(tick);
    const leg = {
      last_price: ltp,
      oi: Number(tick.oi ?? 0) || 0,
      volume: Number(tick.v ?? 0) || 0,
      bid_price: Number(tick.bp1 ?? 0) || 0,
      ask_price: Number(tick.sp1 ?? 0) || 0,
      ...computeIVAndGreeks({
        ltp,
        spot: spotPrice,
        strike: Number(meta.strike),
        daysToExpiry,
        type: meta.type.toUpperCase(),
      }),
    };

    if (!oc[meta.strike]) oc[meta.strike] = {};
    oc[meta.strike][meta.type] = leg;
  }

  return { status: "success", data: { oc, last_price: spotPrice } };
}

export async function fetchLTP(creds, symbol) {
  const spot = await resolveIndexSpotToken(symbol);
  const key = `${spot.exch}|${spot.token}`;
  const ticks = await subscribeAndCollect(creds, [key]);
  return { status: "success", data: { last_price: tickLtp(ticks.get(key)) } };
}
