/**
 * 5paisa adapter on the broker contract (server/brokers/contract.mjs).
 *
 * Official docs: https://xstream.5paisa.com/dev-docs/ (checked 2026-10). Where observed behaviour disagrees
 * with the official pages we follow the official pages (see fivepaisaPortfolio.mjs and
 * fivepaisaMarket.mjs headers).
 *
 *  - Auth: session login (PIN + current TOTP code typed per session, never stored), fivepaisaAuth.mjs.
 *  - Instruments: the public daily scrip master (fivepaisaInstruments.mjs); index cash rows give spot tokens.
 *  - Option chain: built from the master + batched MarketSnapshot quotes. 5paisa returns no IV/Greeks over REST
 *    (its option-greeks feed is a WebSocket, NSE only), so they are solved locally with Black-Scholes; snapshots
 *    carry no bid/ask, so those stay 0 rather than one depth call per strike.
 *    Open interest: the official MarketSnapshot field table and sample have no OI field, so `capabilities.optionChain.oi`
 *    is false and a leg carries `oi` only when a response really includes OpenInterest. We never send OI as 0, which
 *    would make PCR, max pain and OI views look valid while being empty. A leg with no snapshot row is left out.
 *    5paisa's SDKs also call V2/GetExpiryForSymbolOptions and GetOptionsForSymbol (py5paisa get_expiry /
 *    get_option_chain), but neither is in the official dev-docs (checked 2026-10) and no official page gives their
 *    response fields, so they are not wired here until 5paisa documents them.
 *  - Portfolio reads and gated orders: fivepaisaPortfolio.mjs, fivepaisaOrders.mjs.
 *  - Not declared: feed (5paisa's WebSocket feed is not wired here).
 */

import { BrokerError, normaliseError as baseNormalise } from "./contract.mjs";
import { authenticatedPost, ensureSession, LOGIN_FIELDS, SESSION_FIELDS } from "./fivepaisaAuth.mjs";
import {
  assertSymbol, getInstrumentMaster, indexInstrument, listExpiries, spotScripInfo, strikeMapForExpiry, toInstrument,
} from "./fivepaisaInstruments.mjs";
import { fetchSnapshotMap, lookup } from "./fivepaisaMarket.mjs";
import { ORDER_FEATURES } from "./fivepaisaOrders.mjs";
import { computeIVAndGreeks, daysBetween } from "../lib/blackScholes.mjs";

export const id = "fivepaisa";
export const credentialFields = ["appName", "appSource", "userKey", "encryptionKey", "userId", "clientCode"];

export const capabilities = {
  auth: { kind: "sessionLogin", loginFields: LOGIN_FIELDS, sessionFields: SESSION_FIELDS },
  testConnection: true,
  instruments: true,
  expiries: true,
  optionChain: { greeks: "computed", oi: false },
  ltp: true,
  quotes: true,
  depth: true,
  historical: { intervals: ["1m", "5m", "15m", "30m", "60m", "1d"] },
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

export { login } from "./fivepaisaAuth.mjs";
export { fetchQuotes, fetchDepth, fetchHistorical } from "./fivepaisaMarket.mjs";
export { fetchPositions, fetchHoldings, fetchFunds, fetchOrderBook, fetchTradeBook } from "./fivepaisaPortfolio.mjs";
export { placeOrder, modifyOrder, cancelOrder, buildOrderBody, buildModifyBody } from "./fivepaisaOrders.mjs";

/** Contract error normaliser: our refusals stay 422; 5paisa rate limits and auth failures get their own codes. */
export function normaliseError(err, opts = {}) {
  const base = baseNormalise(err, opts);
  if (err instanceof BrokerError) return base;
  if (/HTTP 429|rate limit/i.test(base.message)) return { ...base, code: "UPSTREAM_RATE_LIMIT" };
  if (/HTTP 401|invalid token/i.test(base.message)) return { ...base, code: "UPSTREAM_AUTH" };
  return base;
}

/** One cheap authenticated call (V4/Margin) proves the stored session is alive. */
export async function testConnection(creds = {}) {
  try {
    ensureSession(creds);
    const json = await authenticatedPost(creds, "/V4/Margin", (session) => ({ ClientCode: session.clientCode }));
    if (Number(json?.body?.Status) !== 0) return { status: "error", message: `5paisa: ${json?.body?.Message || "margin check failed"}` };
    return { status: "success", message: "5paisa session authenticated" };
  } catch (e) {
    return { status: "error", message: normaliseError(e).message };
  }
}

export async function fetchInstruments(creds) {
  ensureSession(creds);
  const master = await getInstrumentMaster();
  const data = master.indices.map(indexInstrument);
  for (const d of master.derivatives) {
    const inst = toInstrument(d);
    if (inst) data.push(inst);
  }
  return { status: "success", data };
}

export async function fetchExpiryList(creds, symbol) {
  const sym = assertSymbol(symbol);
  ensureSession(creds); // refuse before the master download when not logged in
  const master = await getInstrumentMaster();
  return { status: "success", data: listExpiries(master, sym) };
}

/** One chain leg from a snapshot row, or null when 5paisa returned no row for it (never a made-up zero leg). */
function buildLeg(row, strike, type, spot, daysToExpiry) {
  if (!row) return null;
  const ltp = row.ltp ?? 0;
  const greeks = computeIVAndGreeks({ ltp, spot, strike, daysToExpiry, type });
  const leg = { last_price: ltp, volume: row.volume ?? 0, bid_price: 0, ask_price: 0, security_id: row.token, ...greeks };
  if (row.oi !== null && row.oi !== undefined) leg.oi = row.oi;
  return leg;
}

export async function fetchOptionChain(creds, symbol, expiry) {
  const sym = assertSymbol(symbol);
  ensureSession(creds);
  const master = await getInstrumentMaster();
  const expiryIso = expiry || listExpiries(master, sym)[0];
  if (!expiryIso) return { status: "success", data: { oc: {}, last_price: 0 } };
  const strikes = strikeMapForExpiry(master, sym, expiryIso);
  if (strikes.size === 0) return { status: "success", data: { oc: {}, last_price: 0 } };

  const spotInfo = spotScripInfo(master, sym);
  const items = spotInfo ? [spotInfo] : [];
  for (const legs of strikes.values()) {
    if (legs.ce) items.push(legs.ce);
    if (legs.pe) items.push(legs.pe);
  }
  const quotes = await fetchSnapshotMap(creds, items);
  const spot = spotInfo ? lookup(quotes, spotInfo.exch, spotInfo.scripCode)?.ltp ?? 0 : 0;
  const daysToExpiry = daysBetween(new Date(), expiryIso);

  const oc = {};
  for (const [strike, legs] of [...strikes.entries()].sort((a, b) => Number(a[0]) - Number(b[0]))) {
    const entry = {};
    const ce = legs.ce ? buildLeg(lookup(quotes, legs.ce.exch, legs.ce.scripCode), Number(strike), "CE", spot, daysToExpiry) : null;
    const pe = legs.pe ? buildLeg(lookup(quotes, legs.pe.exch, legs.pe.scripCode), Number(strike), "PE", spot, daysToExpiry) : null;
    if (ce) entry.ce = ce;
    if (pe) entry.pe = pe;
    if (ce || pe) oc[strike] = entry;
  }
  return { status: "success", data: { oc, last_price: spot } };
}

export async function fetchLTP(creds, symbol) {
  const sym = assertSymbol(symbol);
  ensureSession(creds);
  const master = await getInstrumentMaster();
  const info = spotScripInfo(master, sym);
  if (!info) throw new BrokerError(`5paisa: no spot instrument for ${sym} in the scrip master.`);
  const quotes = await fetchSnapshotMap(creds, [info]);
  const last_price = lookup(quotes, info.exch, info.scripCode)?.ltp ?? 0;
  if (!(last_price > 0)) throw new BrokerError(`5paisa returned no last price for ${sym}.`);
  return { status: "success", data: { last_price } };
}
