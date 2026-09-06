/**
 * Native option-chain path for Paytm Money — used for NIFTY, BANKNIFTY,
 * FINNIFTY, MIDCPNIFTY. SENSEX is routed through the instrument-master +
 * batched-quotes fallback in paytmInstruments.mjs instead, because this
 * endpoint is confirmed (by a real-world integration, Manvendra08/
 * TradingBot's src/fetchers/paytm_fetcher.py, which explicitly documents
 * "SENSEX: Endpoint exists at /fno/v1 but returns empty data") to return no
 * data for SENSEX. See paytm.mjs for the dispatch.
 *
 * Endpoints (confirmed against Paytm's own official pyPMClient/jsPMClient
 * SDK source, which is more authoritative here than openalgo's plugin —
 * openalgo's Paytm plugin predates this endpoint and uses the heavier
 * instrument-master + /data/v1/price/live approach unconditionally):
 *
 *   GET /fno/v1/option-chain/config?symbol=<SYMBOL>
 *     -> { data: { exch_symbol, expires: [epochMs, ...] } }
 *   GET /fno/v1/option-chain?type=CALL|PUT&symbol=<SYMBOL>&expiry=DD-MM-YYYY
 *     -> { data: { results: [{ option_type, stk_price, price, oi,
 *                               oi_net_chg, traded_vol, iv, spot_price }] } }
 *
 * Two calls (type=CALL and type=PUT) are required per expiry — there is no
 * combined "both sides" type. The response carries no bid/ask depth and no
 * Greeks (only a scalar `iv` whose unit convention — percentage vs decimal
 * fraction — is unverified), so IV/Greeks are recomputed from LTP via
 * Black-Scholes for consistency with the rest of the app, and
 * bid_price/ask_price are reported as 0.
 */

import { computeIVAndGreeks, daysBetween } from "../lib/blackScholes.mjs";
import { paytmGet, isoToPaytmDate, toIsoDate } from "./paytmClient.mjs";

export const CHAIN_SYMBOLS = new Set(["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY"]);

export async function fetchNativeExpiries(creds, symbol) {
  const json = await paytmGet(`/fno/v1/option-chain/config?symbol=${encodeURIComponent(symbol)}`, creds);
  const expires = json?.data?.expires || [];
  const dates = Array.from(new Set(expires.map((e) => toIsoDate(e)))).filter(Boolean);
  dates.sort();
  return dates;
}

async function fetchSide(creds, symbol, expiryDdMmYyyy, type) {
  const json = await paytmGet(
    `/fno/v1/option-chain?type=${type}&symbol=${encodeURIComponent(symbol)}&expiry=${expiryDdMmYyyy}`,
    creds
  );
  return json?.data?.results || [];
}

export async function fetchNativeChain(creds, symbol, expiryIso) {
  let resolvedIso = expiryIso;
  if (!resolvedIso) {
    const expiries = await fetchNativeExpiries(creds, symbol);
    resolvedIso = expiries[0];
    if (!resolvedIso) return { oc: {}, last_price: 0 };
  }
  const expiryDdMmYyyy = isoToPaytmDate(resolvedIso);

  const [calls, puts] = await Promise.all([
    fetchSide(creds, symbol, expiryDdMmYyyy, "CALL"),
    fetchSide(creds, symbol, expiryDdMmYyyy, "PUT"),
  ]);
  const rows = [...calls, ...puts];
  if (rows.length === 0) return { oc: {}, last_price: 0 };

  const spotRow = rows.find((r) => Number(r.spot_price) > 0);
  const spot = spotRow ? Number(spotRow.spot_price) : 0;
  const daysToExpiry = daysBetween(new Date(), resolvedIso);

  const oc = {};
  for (const row of rows) {
    const type = row.option_type === "PE" ? "PE" : row.option_type === "CE" ? "CE" : null;
    const strike = Number(row.stk_price);
    if (!type || !(strike > 0)) continue;

    const ltp = Number(row.price) || 0;
    const greeks = computeIVAndGreeks({ ltp, spot, strike, daysToExpiry, type });
    const strikeKey = String(strike);
    if (!oc[strikeKey]) oc[strikeKey] = {};
    oc[strikeKey][type.toLowerCase()] = {
      last_price: ltp,
      oi: Number(row.oi) || 0,
      oi_chg: Number(row.oi_net_chg) || 0,
      volume: Number(row.traded_vol) || 0,
      ...greeks,
      bid_price: 0,
      ask_price: 0,
    };
  }
  return { oc, last_price: spot };
}
