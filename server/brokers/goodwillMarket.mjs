/**
 * Goodwill market data. Official docs: https://developer.gwcindia.in/api/getQuote (checked 2026-10):
 *  - POST /getquote { exchange, token } (one instrument) -> { status: "success", data: { symbol_name,
 *    trading_symbl, token, last_trade_time, last_price, change, change_per, last_quantity, buy_quantity,
 *    sell_quantity, volume, average_price, open, high, low, close, tick_size, lot_size, ... } }.
 * There is no option-chain, depth or historical endpoint, and the quote carries no open interest and no best
 * bid/ask. So the chain is built from the NFO master plus one quote per contract in a window of strikes around
 * the spot, with IV/Greeks back-solved (Black-Scholes); OI shows as 0 unless a quote happens to carry `oi`.
 * Live OI, bid/ask and the full touchline come from the WebSocket feed (goodwillFeed.mjs).
 * SENSEX / BANKEX: Goodwill publishes no BFO master, so only their spot LTP is served.
 */

import { computeIVAndGreeks, daysBetween } from "../lib/blackScholes.mjs";
import { BrokerInputError, SessionRequiredError } from "./contract.mjs";
import { listExpiries, selectStrikeWindow } from "./shoonyaNorenCore.mjs";
import { gwRequest } from "./goodwillAuth.mjs";
import { getSegment, spotRef } from "./goodwillInstruments.mjs";

export const STRIKES_EACH_SIDE = 10;
const BSE_ONLY = new Set(["SENSEX", "BANKEX"]);

const n = (v) => {
  const x = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(x) ? x : 0;
};
const nOrNull = (v) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

export function getQuote(creds, ref) {
  return gwRequest(creds, "getquote", { method: "POST", body: { exchange: ref.exchange, token: String(ref.token) } });
}

/** Quotes one by one (the API takes one instrument); a single failed leg is skipped, a dead session is not. */
async function quoteMany(creds, refs) {
  const out = new Map();
  for (const ref of refs) {
    try {
      out.set(`${ref.exchange}|${ref.token}`, await getQuote(creds, ref));
    } catch (e) {
      if (e instanceof SessionRequiredError || e?.code === "UPSTREAM_RATE_LIMIT") throw e;
    }
  }
  return out;
}

function optionRowsFor(fno, symbol) {
  const u = String(symbol ?? "").toUpperCase();
  return fno.filter((m) => m.underlying === u && m.optionType);
}

export async function fetchExpiryList(creds, symbol) {
  const u = String(symbol ?? "").toUpperCase();
  if (BSE_ONLY.has(u)) return { status: "success", data: [] };
  return { status: "success", data: listExpiries(await getSegment("NFO"), u) };
}

export async function fetchLTP(creds, symbol) {
  const ref = await spotRef(symbol);
  if (!ref) throw new BrokerInputError(`Goodwill: no index or NSE stock named ${symbol}`);
  const ltp = n((await getQuote(creds, ref))?.last_price);
  if (!(ltp > 0)) throw new BrokerInputError(`Goodwill returned no price for ${symbol}`);
  return { status: "success", data: { last_price: ltp } };
}

export function buildLeg(q, ctx) {
  const ltp = n(q?.last_price);
  const g = computeIVAndGreeks({ ltp, spot: ctx.spot, strike: ctx.strike, daysToExpiry: ctx.days, type: ctx.type });
  return {
    last_price: ltp, oi: n(q?.oi ?? q?.open_interest), volume: n(q?.volume),
    iv: g.iv, delta: g.delta, gamma: g.gamma, theta: g.theta, vega: g.vega, security_id: String(ctx.token),
  };
}

export async function fetchOptionChain(creds, symbol, expiry) {
  const u = String(symbol ?? "").toUpperCase();
  if (BSE_ONLY.has(u)) throw new BrokerInputError(`Goodwill publishes no BSE F&O master, so the ${u} option chain is not available. Use another broker for SENSEX/BANKEX options.`);
  const fno = await getSegment("NFO");
  const all = optionRowsFor(fno, u);
  const expiries = listExpiries(fno, u);
  if (!expiries.length) throw new BrokerInputError(`Goodwill: no options listed for ${symbol}`);
  const target = expiry || expiries[0];
  const rows = all.filter((r) => r.expiry === target);
  if (!rows.length) throw new BrokerInputError(`Goodwill: no ${u} options expire on ${target}`);
  const sref = await spotRef(u);
  const spot = sref ? n((await getQuote(creds, sref))?.last_price) : 0;
  const window = selectStrikeWindow(rows, spot, STRIKES_EACH_SIDE);
  const quotes = await quoteMany(creds, window.map((r) => ({ exchange: "NFO", token: r.token })));
  const days = daysBetween(new Date(), target);
  const oc = {};
  for (const r of window) {
    const q = quotes.get(`NFO|${r.token}`);
    if (!q) continue;
    const key = String(r.strike);
    oc[key] = oc[key] || {};
    oc[key][r.optionType.toLowerCase()] = buildLeg(q, { spot, strike: r.strike, days, type: r.optionType, token: r.token });
  }
  return { status: "success", data: { oc, last_price: spot } };
}

export function mapQuote(ref, q) {
  return {
    token: String(ref.token), exchange: ref.exchange, ltp: n(q?.last_price), open: nOrNull(q?.open), high: nOrNull(q?.high), low: nOrNull(q?.low),
    close: nOrNull(q?.close), volume: nOrNull(q?.volume), oi: nOrNull(q?.oi ?? q?.open_interest), bid: null, ask: null,
  };
}

const EXCHANGES = new Set(["NSE", "NFO", "BSE"]);
export const MAX_QUOTES = 50;

export async function fetchQuotes(creds, refs = []) {
  if (!Array.isArray(refs) || !refs.length) return { status: "success", data: [] };
  if (refs.length > MAX_QUOTES) throw new BrokerInputError(`Goodwill quotes are fetched one by one; ask for at most ${MAX_QUOTES} at a time (or use the live feed).`);
  for (const r of refs) {
    if (!EXCHANGES.has(r?.exchange) || !/^\d+$/.test(String(r?.token ?? ""))) throw new BrokerInputError(`Goodwill: unsupported instrument ${r?.exchange}:${r?.token}`);
  }
  const quotes = await quoteMany(creds, refs);
  const data = refs.map((r) => quotes.get(`${r.exchange}|${r.token}`) && mapQuote(r, quotes.get(`${r.exchange}|${r.token}`))).filter(Boolean);
  return { status: "success", data };
}

