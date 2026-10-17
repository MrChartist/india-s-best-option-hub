/**
 * HDFC Sky (HDFC Securities Open API) — real broker integration
 * (see registry.mjs for the shared contract).
 *
 * Auth model: paste-token (hdfcskyClient.mjs) — same UX as Dhan/Zerodha.
 * HDFC Sky's login is a browser-redirect + OTP/PIN flow that needs a live
 * human, so it can't be driven headlessly from this server; the user
 * completes it once externally and pastes the resulting apiKey + accessToken.
 *
 * Chain construction: HDFC Sky has NO native option-chain endpoint, and —
 * unlike Zerodha/Angel/5paisa — its REST API has no full-quote or
 * market-depth endpoint at all. The only REST market-data call is a plain
 * LTP snapshot (PUT /oapi/v1/fetch-ltp); open interest, market depth and
 * traded volume are delivered exclusively over a protobuf WebSocket feed
 * (streaming/), which this module does not implement (see the note on
 * fetchOptionChain below). So the chain here is built from the daily
 * Security Master (hdfcskyInstruments.mjs) + batched /fetch-ltp calls, with
 * IV and Greeks filled in via Black-Scholes from the traded LTP.
 */

import { hdfcskyGet, fetchLtpBatch, getClientId } from "./hdfcskyClient.mjs";
import { getInstrumentMaster, listExpiries, optionRowsForExpiry, indexSpotRow } from "./hdfcskyInstruments.mjs";
import { computeIVAndGreeks, daysBetween } from "../lib/blackScholes.mjs";

export const id = "hdfcsky";
export const credentialFields = ["apiKey", "accessToken"];

export async function testConnection(creds = {}) {
  try {
    if (!creds.apiKey || !creds.accessToken) {
      return { status: "error", message: "Missing apiKey or accessToken" };
    }
    const clientId = getClientId(creds);
    const json = await hdfcskyGet(creds, "/oapi/v1/user/trading_info", clientId ? { client_id: clientId } : {});
    if (json?.status && json.status !== "success") {
      return { status: "error", message: json.message || "HDFC Sky did not return a success status" };
    }
    return { status: "success", message: "HDFC Sky connected" };
  } catch (e) {
    return { status: "error", message: e.message };
  }
}

export async function fetchExpiryList(creds, symbol) {
  const master = await getInstrumentMaster();
  return { status: "success", data: listExpiries(master, symbol) };
}

export async function fetchLTP(creds, symbol) {
  const master = await getInstrumentMaster();
  const spot = indexSpotRow(master, symbol);
  if (!spot) throw new Error(`HDFC Sky Security Master has no index-spot row for ${symbol}`);
  const quotes = await fetchLtpBatch(creds, [{ exchange: spot.ltpExchange, token: String(spot.token) }]);
  const q = quotes.get(`${spot.ltpExchange}:${spot.token}`);
  return { status: "success", data: { last_price: q ? q.ltp : 0 } };
}

/**
 * NOTE on oi/volume/bid_price/ask_price: HDFC Sky's REST API genuinely does
 * not expose these anywhere (verified against the official docs — the only
 * market-data endpoints are /fetch-ltp and historical chart candles). The
 * broker only carries them on its protobuf WebSocket feed, which needs a
 * hand-rolled WS client + a hand-written decoder for the broker's GenericDTO
 * proto schema — too much unverifiable surface to ship without live
 * credentials to test against, so (matching the "don't guess" rule) these
 * fields are returned as 0 rather than fabricated. last_price/iv/delta/
 * gamma/theta/vega are all real, computed from a genuine traded LTP.
 */
export async function fetchOptionChain(creds, symbol, expiry) {
  const master = await getInstrumentMaster();

  let expiryIso = expiry;
  if (!expiryIso) {
    const expiries = listExpiries(master, symbol);
    if (!expiries.length) return { status: "success", data: { oc: {}, last_price: 0 } };
    expiryIso = expiries[0];
  }

  const rows = optionRowsForExpiry(master, symbol, expiryIso);
  if (!rows.length) return { status: "success", data: { oc: {}, last_price: 0 } };

  const spot = indexSpotRow(master, symbol);
  const quoteTargets = rows.map((r) => ({ exchange: r.exchange, token: String(r.token) }));
  if (spot) quoteTargets.push({ exchange: spot.ltpExchange, token: String(spot.token) });

  const quotes = await fetchLtpBatch(creds, quoteTargets);
  const spotQuote = spot ? quotes.get(`${spot.ltpExchange}:${spot.token}`) : null;
  const lastPrice = spotQuote ? spotQuote.ltp : 0;
  const daysToExpiry = daysBetween(new Date(), expiryIso);

  const oc = {};
  for (const row of rows) {
    const q = quotes.get(`${row.exchange}:${row.token}`);
    if (!q) continue; // token not returned by this LTP batch — skip this leg

    const ltp = q.ltp;
    const type = row.type === "ce" ? "CE" : "PE";
    const greeks = computeIVAndGreeks({ ltp, spot: lastPrice, strike: row.strike, daysToExpiry, type });

    const strikeKey = String(row.strike);
    if (!oc[strikeKey]) oc[strikeKey] = {};
    oc[strikeKey][row.type] = {
      last_price: ltp,
      oi: 0, // WebSocket-only on HDFC Sky — see the note above
      volume: 0, // WebSocket-only on HDFC Sky — see the note above
      ...greeks,
      bid_price: 0, // WebSocket-only on HDFC Sky — see the note above
      ask_price: 0, // WebSocket-only on HDFC Sky — see the note above
    };
  }

  return { status: "success", data: { oc, last_price: lastPrice } };
}
