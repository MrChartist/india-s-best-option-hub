/**
 * Motilal Oswal (MOFSL) adapter on the broker contract (server/brokers/contract.mjs).
 *
 * Official docs: https://invest.motilaloswal.com/moAPI/APIDocumentation/Introduction (checked 2026-10). OpenAlgo (AGPL)
 * was read for facts only.
 *
 *  - Auth: session login (password, 2FA value and current TOTP code typed per session; none stored), motilalAuth.mjs.
 *  - Instruments: public scrip-master and index-master CSVs (motilalInstruments.mjs).
 *  - Option chain: master + one getltpdata call per leg (the REST API has no multi-quote call), limited to
 *    STRIKES_EACH_SIDE strikes either side of ATM so a chain stays to a few seconds instead of ~40 s for a full NIFTY
 *    expiry. getltpdata carries no OI, so legs have no `oi` field and capabilities.optionChain.oi is false (OI, OI
 *    change and PCR are unavailable for Motilal, not zero). Motilal returns no IV/Greeks, so they are solved locally
 *    with Black-Scholes. A leg whose quote call failed is left out rather than shown as a zero price.
 *  - Portfolio reads and gated orders: motilalPortfolio.mjs, motilalOrders.mjs.
 *  - Not declared: depth and historical (not offered over REST), feed (Motilal's broadcast WebSocket is not wired here).
 */

import { BrokerError, CANONICAL_UNDERLYINGS, normaliseError as baseNormalise } from "./contract.mjs";
import { authPostOk, ensureSession, LOGIN_FIELDS, SESSION_FIELDS } from "./motilalAuth.mjs";
import {
  assertSymbol, getFoMaster, getOptionMaster, listExpiries, resolveIndexInfo, resolveStockSpot, strikeMapForExpiry, toInstrument,
} from "./motilalInstruments.mjs";
import { fetchIndexLtp, fetchScripQuote, fetchScripQuotes } from "./motilalMarket.mjs";
import { ORDER_FEATURES } from "./motilalOrders.mjs";
import { computeIVAndGreeks, daysBetween } from "../lib/blackScholes.mjs";

export const id = "motilal";
export const credentialFields = ["apiKey", "apiSecret", "clientId"];

export const capabilities = {
  auth: { kind: "sessionLogin", loginFields: LOGIN_FIELDS, sessionFields: SESSION_FIELDS },
  testConnection: true,
  instruments: true,
  expiries: true,
  optionChain: { greeks: "computed", oi: false, strikeWindow: 15 },
  ltp: true,
  quotes: true,
  positions: true,
  holdings: true,
  funds: true,
  orderBook: true,
  tradeBook: true,
  placeOrder: true,
  modifyOrder: true,
  cancelOrder: true,
  normaliseError: true,
  ...ORDER_FEATURES,
};

export { login } from "./motilalAuth.mjs";
export { fetchQuotes } from "./motilalMarket.mjs";
export { fetchPositions, fetchHoldings, fetchFunds, fetchOrderBook, fetchTradeBook } from "./motilalPortfolio.mjs";
export { placeOrder, modifyOrder, cancelOrder, buildOrderBody, buildModifyBody } from "./motilalOrders.mjs";

/** Motilal error codes -> contract codes; our refusals keep 422. */
export function normaliseError(err, opts = {}) {
  const base = baseNormalise(err, opts);
  if (err instanceof BrokerError && err.statusCode === 422) return base;
  const m = base.message;
  if (/MO8000|MO500[0-2]/.test(m)) return { ...base, code: "UPSTREAM_ERROR" };
  if (/MO100[0-7]|MO1093|MO1094|MO2035|MO200[5-7]/.test(m)) return { ...base, code: "UPSTREAM_AUTH" };
  if (/HTTP 429|too many/i.test(m)) return { ...base, code: "UPSTREAM_RATE_LIMIT" };
  if (/MO10[5-9]\d|MO5003/.test(m)) return { ...base, code: "UPSTREAM_INPUT" };
  return base;
}

/** One cheap authenticated call (getprofile) proves the session is alive. */
export async function testConnection(creds = {}) {
  try {
    ensureSession(creds);
    await authPostOk(creds, "getprofile");
    return { status: "success", message: "Motilal Oswal session authenticated" };
  } catch (e) {
    return { status: "error", message: normaliseError(e).message };
  }
}

export async function fetchInstruments(creds) {
  ensureSession(creds);
  const data = [];
  for (const fo of ["NSEFO", "BSEFO"]) {
    for (const r of await getFoMaster(fo)) {
      const inst = toInstrument(r);
      if (inst) data.push(inst);
    }
  }
  return { status: "success", data };
}

export async function fetchExpiryList(creds, symbol) {
  const sym = assertSymbol(symbol);
  ensureSession(creds); // refuse before the master download when not logged in
  return { status: "success", data: listExpiries(await getOptionMaster(sym)) };
}

const isIndex = (sym) => CANONICAL_UNDERLYINGS.includes(sym);

async function spotOf(creds, sym) {
  if (isIndex(sym)) {
    const info = await resolveIndexInfo(sym);
    return info ? fetchIndexLtp(creds, info) : 0;
  }
  const info = await resolveStockSpot(sym);
  if (!info) return 0;
  return (await fetchScripQuote(creds, info.exchangename, info.token))?.ltp ?? 0;
}

export async function fetchLTP(creds, symbol) {
  const sym = assertSymbol(symbol);
  ensureSession(creds);
  const last_price = await spotOf(creds, sym);
  if (!(last_price > 0)) throw new BrokerError(`Motilal Oswal returned no last price for ${sym}.`);
  return { status: "success", data: { last_price } };
}

/** Strikes quoted per side of ATM. One REST call per leg, so this bounds the chain to about 62 calls. */
export const STRIKES_EACH_SIDE = 15;

/**
 * The [strikeKey, pair] entries nearest the money, ascending: STRIKES_EACH_SIDE below and above the strike closest to
 * spot. With no spot price the middle strike of the expiry stands in for ATM.
 */
export function strikesAroundAtm(entries, spot, eachSide = STRIKES_EACH_SIDE) {
  const sorted = [...entries].sort((a, b) => Number(a[0]) - Number(b[0]));
  if (sorted.length <= eachSide * 2 + 1) return sorted;
  let atm = Math.floor(sorted.length / 2);
  if (spot > 0) {
    atm = 0;
    for (let i = 1; i < sorted.length; i++) {
      if (Math.abs(Number(sorted[i][0]) - spot) < Math.abs(Number(sorted[atm][0]) - spot)) atm = i;
    }
  }
  const start = Math.max(0, Math.min(atm - eachSide, sorted.length - (eachSide * 2 + 1)));
  return sorted.slice(start, start + eachSide * 2 + 1);
}

export async function fetchOptionChain(creds, symbol, expiry) {
  const sym = assertSymbol(symbol);
  ensureSession(creds);
  const rows = await getOptionMaster(sym);
  const expiryIso = expiry || listExpiries(rows)[0];
  const strikes = expiryIso ? strikeMapForExpiry(rows, expiryIso) : new Map();
  if (strikes.size === 0) return { status: "success", data: { oc: {}, last_price: 0 } };

  const spot = await spotOf(creds, sym);
  const daysToExpiry = daysBetween(new Date(), expiryIso);
  const legs = [];
  for (const [strikeKey, pair] of strikesAroundAtm([...strikes.entries()], spot)) {
    if (pair.ce) legs.push({ strikeKey, side: "ce", ...pair.ce });
    if (pair.pe) legs.push({ strikeKey, side: "pe", ...pair.pe });
  }
  const quotes = await fetchScripQuotes(creds, legs);

  const oc = {};
  legs.forEach((leg, i) => {
    const q = quotes[i];
    if (!q) return; // quote call failed: leave the leg out rather than show a zero price
    const ltp = q.ltp ?? 0;
    const greeks = computeIVAndGreeks({ ltp, spot, strike: Number(leg.strikeKey), daysToExpiry, type: leg.side === "ce" ? "CE" : "PE" });
    oc[leg.strikeKey] = oc[leg.strikeKey] || {};
    // No `oi`: getltpdata has none, and a 0 would read as real open interest.
    oc[leg.strikeKey][leg.side] = { last_price: ltp, volume: q.volume ?? 0, bid_price: q.bid ?? 0, ask_price: q.ask ?? 0, security_id: String(leg.token), ...greeks };
  });
  return { status: "success", data: { oc, last_price: spot } };
}

