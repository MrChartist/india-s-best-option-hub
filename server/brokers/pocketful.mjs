/**
 * Pocketful — see registry.mjs for the shared broker-module contract.
 *
 * Auth: full OAuth2 authorization-code flow (browser consent + client_secret
 * exchange, no redirect endpoint this server can host) — same paste-token UX
 * as Upstox/Fyers in this codebase: the user completes that flow externally
 * once and pastes the resulting long-lived `access_token` here
 * (pocketfulAuth.mjs auto-derives the client_id the WS feed needs from it).
 *
 * Data: Pocketful's REST API has no option-chain or multi-symbol quote
 * endpoint at all — every quote, including this module's, has to come from
 * its authenticated WebSocket feed (pocketfulWs.mjs), same shape as this
 * codebase's Alice Blue integration. Strike/expiry/index token resolution
 * comes from Pocketful's daily contract-master ZIP (pocketfulInstruments.mjs).
 * The feed carries OI/volume/bid/ask/LTP but no IV/Greeks, so those are
 * computed locally via blackScholes.mjs.
 *
 * Not observed to share a backend with any other broker already integrated
 * in this codebase (no XTS/Omnesys-style endpoint paths or field names) —
 * Pocketful's WebSocket wire format is its own bespoke binary protocol.
 *
 * NEVER log creds.accessToken — only field names / presence / status codes.
 */

import { resolveClientId } from "./pocketfulAuth.mjs";
import { resolveIndexToken, resolveExpiries, resolveStrikeMap } from "./pocketfulInstruments.mjs";
import { subscribeAndCollect } from "./pocketfulWs.mjs";
import { computeIVAndGreeks, daysBetween } from "../lib/blackScholes.mjs";

export const id = "pocketful";
export const credentialFields = ["accessToken"];

function tickKey(entry) {
  return `${entry.exchangeCode}|${entry.token}`;
}

export async function testConnection(creds = {}) {
  try {
    await resolveClientId(creds);
    return { status: "success", message: "Pocketful account connected" };
  } catch (e) {
    return { status: "error", message: e.message };
  }
}

export async function fetchExpiryList(creds, symbol) {
  const data = await resolveExpiries(symbol);
  return { status: "success", data };
}

export async function fetchOptionChain(creds, symbol, expiry) {
  const expiryISO = expiry || (await resolveExpiries(symbol))[0];
  if (!expiryISO) return { status: "success", data: { oc: {}, last_price: 0 } };

  const strikeMap = await resolveStrikeMap(symbol, expiryISO);
  if (strikeMap.size === 0) return { status: "success", data: { oc: {}, last_price: 0 } };

  let spotEntry = null;
  try {
    spotEntry = await resolveIndexToken(symbol);
  } catch (e) {
    console.warn(`[pocketful] index token resolution failed for ${symbol}: ${e.message}`);
  }
  const spotKey = spotEntry ? tickKey(spotEntry) : null;

  const legKeys = [];
  const legMeta = new Map(); // key -> { strike, type: "ce"|"pe" }
  for (const [strike, legs] of strikeMap) {
    if (legs.ce) {
      const k = tickKey(legs.ce);
      legKeys.push(k);
      legMeta.set(k, { strike, type: "ce" });
    }
    if (legs.pe) {
      const k = tickKey(legs.pe);
      legKeys.push(k);
      legMeta.set(k, { strike, type: "pe" });
    }
  }

  const allKeys = spotKey ? [...legKeys, spotKey] : legKeys;
  const ticks = await subscribeAndCollect(creds, allKeys);

  const spotPrice = spotKey ? ticks.get(spotKey)?.lastTradedPrice || 0 : 0;
  const daysToExpiry = daysBetween(new Date(), expiryISO);

  const oc = {};
  for (const key of legKeys) {
    const meta = legMeta.get(key);
    const tick = ticks.get(key);
    if (!tick) continue; // no tick arrived in the collection window — omit this leg rather than fake zeros

    const ltp = tick.lastTradedPrice || 0;
    const leg = {
      last_price: ltp,
      oi: tick.currentOpenInterest || 0,
      volume: tick.tradeVolume || 0,
      bid_price: tick.bestBidPrice || 0,
      ask_price: tick.bestAskPrice || 0,
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
  const spotEntry = await resolveIndexToken(symbol);
  const key = tickKey(spotEntry);
  const ticks = await subscribeAndCollect(creds, [key]);
  return { status: "success", data: { last_price: ticks.get(key)?.lastTradedPrice || 0 } };
}
