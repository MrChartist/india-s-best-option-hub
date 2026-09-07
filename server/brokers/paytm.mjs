/**
 * Paytm Money — real broker integration (see registry.mjs for the shared
 * contract).
 *
 * Auth model: paste-token (apiKey + apiSecret + accessToken), same UX as
 * Zerodha/Upstox — see paytmClient.mjs for the full auth-flow writeup and
 * the shared HTTP client.
 *
 * Option chain: NIFTY/BANKNIFTY/FINNIFTY/MIDCPNIFTY use Paytm's native
 * /fno/v1/option-chain endpoint (paytmChain.mjs). SENSEX falls back to an
 * instrument-master + batched-quotes approach (paytmInstruments.mjs)
 * because the native endpoint is confirmed to return empty data for SENSEX
 * in production — see paytmChain.mjs's header for the source.
 */

import { paytmGet, INDEX_IDS } from "./paytmClient.mjs";
import { CHAIN_SYMBOLS, fetchNativeExpiries, fetchNativeChain } from "./paytmChain.mjs";
import { fetchInstrumentExpiries, fetchInstrumentChain, fetchIndexSpot } from "./paytmInstruments.mjs";

export const id = "paytm";
export const credentialFields = ["apiKey", "apiSecret", "accessToken"];

export async function testConnection(creds = {}) {
  try {
    if (!creds.accessToken) {
      return { status: "error", message: "Missing accessToken" };
    }
    await paytmGet("/accounts/v1/user/details", creds);
    return { status: "success", message: "Paytm Money connected" };
  } catch (e) {
    return { status: "error", message: e.message };
  }
}

export async function fetchExpiryList(creds, symbol) {
  const data = CHAIN_SYMBOLS.has(symbol)
    ? await fetchNativeExpiries(creds, symbol)
    : await fetchInstrumentExpiries(symbol);
  return { status: "success", data };
}

export async function fetchOptionChain(creds, symbol, expiry) {
  const data = CHAIN_SYMBOLS.has(symbol)
    ? await fetchNativeChain(creds, symbol, expiry)
    : await fetchInstrumentChain(creds, symbol, expiry);
  return { status: "success", data };
}

export async function fetchLTP(creds, symbol) {
  if (!INDEX_IDS[symbol]) throw new Error(`Unknown index: ${symbol}`);

  const spot = await fetchIndexSpot(creds, symbol);
  if (spot > 0) return { status: "success", data: { last_price: spot } };

  // INDEX security_id fallback: derive spot from a live option-chain
  // response's spot_price field instead (independently confirmed working —
  // see paytmChain.mjs). Only possible for the 4 native-chain symbols.
  if (CHAIN_SYMBOLS.has(symbol)) {
    const chain = await fetchNativeChain(creds, symbol);
    if (chain.last_price > 0) return { status: "success", data: { last_price: chain.last_price } };
  }

  throw new Error(`Paytm Money returned no LTP for ${symbol}`);
}
