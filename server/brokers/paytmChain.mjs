/**
 * Paytm Money option chains.
 *
 * NSE indices (NIFTY, BANKNIFTY, FINNIFTY, MIDCPNIFTY) use the native endpoints
 * (docs: option-chain-config, option-chain):
 *   GET /fno/v1/option-chain/config?symbol=NIFTY -> {data:{exch_symbol, expires:[epoch ms]}}
 *   GET /fno/v1/option-chain?type=CALL|PUT&symbol=NIFTY&expiry=DD-MM-YYYY -> {data:{results:[{security_id,
 *       stk_price, price, oi, oi_net_chg, traded_vol, iv, delta, gamma, theta, vega, spot_price,
 *       option_type, expiry_date, lot_size}]}}
 *   The docs sample has iv "13.54" (percent) and broker Greeks, so the chain uses them (greeks: "broker"),
 *   falling back to Black-Scholes only when a row has no IV. The previous version ignored them. The
 *   native chain carries no bid/ask, so bid_price/ask_price stay 0.
 * OI change is an absolute contract count on both paths, never a percentage:
 *   - native chain: oi_net_chg is the absolute change; the same row carries a separate oi_per_chg for the
 *     percentage (docs sample: oi_net_chg "-2500.00" next to oi_per_chg "0.01"), and we ignore the latter;
 *   - FULL live quote: change_oi sits next to oi; the price change has its own change_percent/change_absolute
 *     pair, but OI has no percentage field, and Paytm Money's official pyPMClient decodes the streamed
 *     OI_change as a signed 64-bit integer (WebSocketClient.process_full_packet), i.e. a count.
 *   paytm.test.mjs pins both mappings.
 * BSE indices (SENSEX, BANKEX) are built from the option master + FULL live quotes (the native endpoint
 * is reported to return no data for SENSEX; this needs a live check). Spot comes from the index LTP;
 * if it is unavailable Greeks stay 0 rather than guessing a spot (the previous version used the
 * median strike).
 */

import { computeIVAndGreeks, daysBetween } from "../lib/blackScholes.mjs";
import { paytmGet, isoToPaytmDate, toIsoDate } from "./paytmClient.mjs";
import { INDEX_CONFIG, fetchLive, indexIdFor, optionRowsFor, optionTypeOf } from "./paytmInstruments.mjs";

export const NATIVE_CHAIN_SYMBOLS = new Set(["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY"]);
const STRIKES_AROUND_SPOT = 40;
const num = (v) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};

export async function nativeExpiries(creds, symbol) {
  const json = await paytmGet(`/fno/v1/option-chain/config?symbol=${encodeURIComponent(symbol)}`, creds);
  return [...new Set((json?.data?.expires ?? []).map(toIsoDate).filter(Boolean))].sort();
}

/** Index spot from GET /data/v1/price/live?mode=LTP (0 when unavailable). */
export async function indexSpot(creds, symbol) {
  const id = await indexIdFor(symbol);
  if (!id) return 0;
  const ex = INDEX_CONFIG[symbol].exchange;
  const row = (await fetchLive(creds, "LTP", [{ exchange: ex, id, scripType: "INDEX" }])).get(`${ex}:${id}:INDEX`);
  return num(row?.last_price);
}

function leg(row, { ltp, spot, strike, daysToExpiry, type }) {
  const iv = num(row.iv);
  const broker = iv > 0 ? { iv, delta: num(row.delta), gamma: num(row.gamma), theta: num(row.theta), vega: num(row.vega) } : null;
  return broker ?? computeIVAndGreeks({ ltp, spot, strike, daysToExpiry, type });
}

export async function nativeChain(creds, symbol, expiryIso) {
  const expiry = expiryIso || (await nativeExpiries(creds, symbol))[0];
  if (!expiry) return { oc: {}, last_price: 0 };
  const date = isoToPaytmDate(expiry);
  const sides = [];
  for (const type of ["CALL", "PUT"]) {
    const json = await paytmGet(`/fno/v1/option-chain?type=${type}&symbol=${encodeURIComponent(symbol)}&expiry=${date}`, creds);
    sides.push(...(json?.data?.results ?? []));
  }
  const spot = num(sides.find((r) => num(r.spot_price) > 0)?.spot_price);
  const daysToExpiry = daysBetween(new Date(), expiry);
  const oc = {};
  for (const r of sides) {
    const type = r.option_type === "CE" || r.option_type === "PE" ? r.option_type : null;
    const strike = num(r.stk_price);
    if (!type || !(strike > 0)) continue;
    const ltp = num(r.price);
    const key = String(strike);
    oc[key] = oc[key] || {};
    oc[key][type.toLowerCase()] = {
      last_price: ltp,
      oi: num(r.oi),
      oi_chg: num(r.oi_net_chg),
      volume: num(r.traded_vol),
      ...leg(r, { ltp, spot, strike, daysToExpiry, type }),
      bid_price: 0,
      ask_price: 0,
      security_id: String(r.security_id ?? ""),
    };
  }
  return { oc, last_price: spot };
}

export async function masterExpiries(symbol) {
  return [...new Set((await optionRowsFor(symbol)).map((r) => toIsoDate(r.expiry_date)).filter(Boolean))].sort();
}

export async function masterChain(creds, symbol, expiryIso) {
  const all = await optionRowsFor(symbol);
  const expiry = expiryIso || [...new Set(all.map((r) => toIsoDate(r.expiry_date)).filter(Boolean))].sort()[0];
  let rows = all.filter((r) => toIsoDate(r.expiry_date) === expiry);
  if (!rows.length) return { oc: {}, last_price: 0 };
  const spot = await indexSpot(creds, symbol);
  if (spot > 0) {
    const keep = new Set([...new Set(rows.map((r) => num(r.strike_price)))].sort((a, b) => Math.abs(a - spot) - Math.abs(b - spot)).slice(0, STRIKES_AROUND_SPOT));
    rows = rows.filter((r) => keep.has(num(r.strike_price)));
  }
  const ex = INDEX_CONFIG[symbol].exchange;
  const quotes = await fetchLive(creds, "FULL", rows.map((r) => ({ exchange: ex, id: String(r.security_id), scripType: "OPTION" })));
  const daysToExpiry = daysBetween(new Date(), expiry);
  const oc = {};
  for (const r of rows) {
    const q = quotes.get(`${ex}:${r.security_id}:OPTION`);
    const type = optionTypeOf(r);
    const strike = num(r.strike_price);
    if (!q || !type || !(strike > 0)) continue;
    const ltp = num(q.last_price);
    const key = String(strike);
    oc[key] = oc[key] || {};
    oc[key][type.toLowerCase()] = {
      last_price: ltp,
      oi: num(q.oi),
      oi_chg: num(q.change_oi),
      volume: num(q.volume_traded),
      ...computeIVAndGreeks({ ltp, spot, strike, daysToExpiry, type }),
      bid_price: num(q.depth?.buy?.[0]?.price),
      ask_price: num(q.depth?.sell?.[0]?.price),
      security_id: String(r.security_id),
    };
  }
  return { oc, last_price: spot };
}
