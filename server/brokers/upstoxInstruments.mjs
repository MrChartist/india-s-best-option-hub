/**
 * Upstox underlying instrument_key resolution.
 *
 * Upstox's instrument_key format is "<SEGMENT>|<name>" and the exact casing of
 * the <name> part is not fully doc-confirmed for every index, so instead of
 * hardcoding guessed pipe-strings we download Upstox's own public instrument
 * master (no auth required) once a day and read each row's own instrument_key.
 *
 * Field names below (segment, trading_symbol, name, instrument_type,
 * instrument_key) and the exact trading_symbol values used for matching were
 * confirmed by live-downloading and inspecting
 * https://assets.upstox.com/market-quote/instruments/exchange/{NSE,BSE}.json.gz
 * — trading_symbol happens to already equal this app's own symbol names
 * (BANKNIFTY, FINNIFTY, MIDCPNIFTY, SENSEX) for these five indices.
 */

import { gunzipSync } from "node:zlib";
import { getCachedOrFetch, ONE_DAY_MS } from "../lib/instrumentCache.mjs";

const ASSET_BASE = "https://assets.upstox.com/market-quote/instruments/exchange";

// Doc-confirmed literal (Upstox's own API docs give this exact string) — used
// directly, no need to hit the instrument master for NIFTY.
const DOC_CONFIRMED_KEYS = {
  NIFTY: "NSE_INDEX|Nifty 50",
};

// exchange: which instrument master file to search. segment: the row's own
// `segment` field for an index on that exchange. trading_symbol values below
// were verified live (see file header) — NIFTY MID SELECT's trading_symbol is
// literally "MIDCPNIFTY", etc.
const INDEX_LOOKUP = {
  BANKNIFTY: { exchange: "NSE", segment: "NSE_INDEX" },
  FINNIFTY: { exchange: "NSE", segment: "NSE_INDEX" },
  MIDCPNIFTY: { exchange: "NSE", segment: "NSE_INDEX" },
  SENSEX: { exchange: "BSE", segment: "BSE_INDEX" },
};

// Last-resort fallback if the instrument-master download/parse fails for some
// reason (e.g. CDN hiccup) — the exact values confirmed live per the header
// comment, kept only as a safety net; the primary path is always the dynamic
// lookup below.
const FALLBACK_KEYS = {
  BANKNIFTY: "NSE_INDEX|Nifty Bank",
  FINNIFTY: "NSE_INDEX|Nifty Fin Service",
  MIDCPNIFTY: "NSE_INDEX|NIFTY MID SELECT",
  SENSEX: "BSE_INDEX|SENSEX",
};

async function downloadInstrumentMaster(exchange) {
  const res = await fetch(`${ASSET_BASE}/${exchange}.json.gz`);
  if (!res.ok) throw new Error(`Upstox instrument master download failed [${exchange}]: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const json = gunzipSync(buf).toString("utf-8");
  return JSON.parse(json);
}

function getInstrumentMaster(exchange) {
  return getCachedOrFetch(`upstox:instruments:${exchange}`, () => downloadInstrumentMaster(exchange), ONE_DAY_MS);
}

/** Resolve an index symbol (NIFTY | BANKNIFTY | FINNIFTY | MIDCPNIFTY | SENSEX) to its Upstox instrument_key. */
export async function resolveInstrumentKey(symbol) {
  if (DOC_CONFIRMED_KEYS[symbol]) return DOC_CONFIRMED_KEYS[symbol];

  const lookup = INDEX_LOOKUP[symbol];
  if (!lookup) throw new Error(`Unknown symbol for Upstox: ${symbol}`);

  try {
    const rows = await getInstrumentMaster(lookup.exchange);
    const row = rows.find(
      (r) =>
        r.segment === lookup.segment &&
        r.instrument_type === "INDEX" &&
        String(r.trading_symbol || "").toUpperCase() === symbol
    );
    if (row?.instrument_key) return row.instrument_key;
  } catch {
    // fall through to the hardcoded safety net below
  }

  if (FALLBACK_KEYS[symbol]) return FALLBACK_KEYS[symbol];
  throw new Error(`Could not resolve Upstox instrument key for ${symbol}`);
}
