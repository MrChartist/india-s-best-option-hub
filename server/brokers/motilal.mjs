/**
 * Motilal Oswal (MOFSL) — real broker integration (see registry.mjs for the
 * shared contract). Researched entirely from marketcalls/openalgo's
 * production Python adapter (`broker/motilal/**`) — no public
 * broker-api-docs mirror exists for this broker.
 *
 * Auth model: active login, not paste-a-token. Every session requires a
 * fresh SHA-256(password + apiKey) hash + a live TOTP code + a "2FA" date of
 * birth (motilalAuth.mjs); the resulting AuthToken is cached in memory and
 * reused until Motilal's documented daily 6 AM IST reset.
 *
 * No native option-chain endpoint: Motilal's REST surface has exactly one
 * quote call (getltpdata) and it only accepts a SINGLE scripcode per
 * request — there is no batch/multi-quote endpoint in the documented API
 * (openalgo's own adapter routes batch quotes through an undocumented,
 * SDK-only WebSocket instead, which is out of reach here given the
 * no-new-npm-deps / Node-builtins-only constraint). So the chain is built
 * from Motilal's public CSV instrument master (motilalInstruments.mjs) with
 * one getltpdata call issued per strike leg, rate-limited via batchWithDelay.
 * getltpdata also carries no open interest field at all (confirmed in
 * openalgo's adapter comments) — oi is reported as 0, and since Motilal
 * returns no IV/Greeks either, both are back-solved via Black-Scholes.
 */

import { authPost, ensureSession } from "./motilalAuth.mjs";
import {
  KNOWN_SYMBOLS,
  getOptionMaster,
  listExpiries,
  strikeMapForExpiry,
  resolveIndexInfo,
} from "./motilalInstruments.mjs";
import { batchWithDelay } from "../lib/batch.mjs";
import { computeIVAndGreeks, daysBetween } from "../lib/blackScholes.mjs";

export const id = "motilal";
export const credentialFields = ["apiKey", "apiSecret", "clientId", "password", "dob", "totpSecret"];

// No documented per-endpoint rate limit was found anywhere in openalgo's Motilal
// adapter or its inline doc citations. Since getltpdata takes only one scrip per
// call and a full chain needs one call per leg, pacing is chosen defensively
// rather than assumed — small concurrent bursts, paced between bursts.
const QUOTE_CONCURRENCY = 5;
const QUOTE_BATCH_DELAY_MS = 400;

function assertKnownSymbol(symbol) {
  if (!KNOWN_SYMBOLS.has(symbol)) throw new Error(`Unknown symbol for Motilal Oswal: ${symbol}`);
}

/** getltpdata: single-scrip LTP/OHLC/bid/ask, values in paisa (documented explicitly) except when 0/absent. */
function paisaToRupees(v) {
  return v ? Number(v) / 100 : 0;
}

async function fetchLegQuote(creds, item) {
  const json = await authPost(creds, "getltpdata", { exchange: item.exchangename, scripcode: Number(item.token) });
  if (json?.status !== "SUCCESS" || !json?.data) return null;
  const d = json.data;
  return {
    last_price: paisaToRupees(d.ltp),
    volume: Number(d.volume) || 0,
    bid_price: paisaToRupees(d.bid),
    ask_price: paisaToRupees(d.ask),
    // getltpdata has no OI field at all — a real, documented Motilal API gap, not a bug here.
    oi: 0,
  };
}

// Doc 42 contradicts itself on the field name ("exchangename" in the parameter
// table vs. "exchange" in its own sample body); remembered per-process once the
// working spelling is found so every subsequent call skips the extra round trip.
let indexExchangeField = null;

async function fetchIndexLtp(creds, indexInfo) {
  const candidates = indexExchangeField ? [indexExchangeField] : ["exchangename", "exchange"];
  let lastJson = null;
  for (const field of candidates) {
    const json = await authPost(creds, "getindexltpdata", { [field]: indexInfo.exchangename, scripcode: String(indexInfo.token) });
    lastJson = json;
    if (json?.status === "SUCCESS") {
      indexExchangeField = field;
      const rows = Array.isArray(json.data) ? json.data : json.data ? [json.data] : [];
      const row = rows.find((r) => String(r?.scripcode) === String(indexInfo.token)) || rows[0];
      return row ? Number(row.ltp) || 0 : 0;
    }
    // Only an exchange-field rejection (MO1051) is worth retrying with the other spelling.
    if (String(json?.errorcode || "").toUpperCase() !== "MO1051") break;
  }
  console.log(`[motilal] getindexltpdata failed: ${lastJson?.message || "unknown error"}`);
  return 0;
}

function buildLeg({ quote, spot, strike, daysToExpiry, type }) {
  if (!quote) return { last_price: 0, oi: 0, volume: 0, bid_price: 0, ask_price: 0, iv: 0, delta: 0, gamma: 0, theta: 0, vega: 0 };
  const greeks = computeIVAndGreeks({ ltp: quote.last_price, spot, strike, daysToExpiry, type });
  return {
    last_price: quote.last_price,
    oi: quote.oi,
    volume: quote.volume,
    bid_price: quote.bid_price,
    ask_price: quote.ask_price,
    ...greeks,
  };
}

export async function testConnection(creds = {}) {
  try {
    await ensureSession(creds);
    return { status: "success", message: "Motilal Oswal session authenticated" };
  } catch (e) {
    return { status: "error", message: e.message };
  }
}

export async function fetchExpiryList(creds, symbol) {
  assertKnownSymbol(symbol);
  // The scrip master CSV is public (no auth) — no need to log in just to list expiries.
  const rows = await getOptionMaster(symbol);
  return { status: "success", data: listExpiries(rows) };
}

export async function fetchOptionChain(creds, symbol, expiry) {
  assertKnownSymbol(symbol);

  const rows = await getOptionMaster(symbol);
  if (rows.length === 0) return { status: "success", data: { oc: {}, last_price: 0 } };

  const expiryIso = expiry || listExpiries(rows)[0];
  if (!expiryIso) return { status: "success", data: { oc: {}, last_price: 0 } };

  const strikes = strikeMapForExpiry(rows, expiryIso);
  if (strikes.size === 0) return { status: "success", data: { oc: {}, last_price: 0 } };

  await ensureSession(creds); // throws on bad/expired/incomplete credentials

  const indexInfo = await resolveIndexInfo(symbol);
  const spot = indexInfo ? await fetchIndexLtp(creds, indexInfo) : 0;
  const daysToExpiry = daysBetween(new Date(), expiryIso);

  const legItems = [];
  for (const [strikeKey, legs] of strikes.entries()) {
    if (legs.ce) legItems.push({ strikeKey, side: "ce", ...legs.ce });
    if (legs.pe) legItems.push({ strikeKey, side: "pe", ...legs.pe });
  }

  const chunks = await batchWithDelay(legItems, QUOTE_CONCURRENCY, QUOTE_BATCH_DELAY_MS, (chunk) =>
    Promise.all(
      chunk.map((item) =>
        fetchLegQuote(creds, item).catch((e) => {
          console.log(`[motilal] getltpdata failed for scrip ${item.token}: ${e.message}`);
          return null;
        })
      )
    )
  );
  const quotes = chunks.flat();

  const oc = {};
  legItems.forEach((item, i) => {
    const quote = quotes[i];
    if (!oc[item.strikeKey]) oc[item.strikeKey] = {};
    oc[item.strikeKey][item.side] = buildLeg({
      quote,
      spot,
      strike: Number(item.strikeKey),
      daysToExpiry,
      type: item.side === "ce" ? "CE" : "PE",
    });
  });

  return { status: "success", data: { oc, last_price: spot } };
}

export async function fetchLTP(creds, symbol) {
  assertKnownSymbol(symbol);
  await ensureSession(creds);
  const indexInfo = await resolveIndexInfo(symbol);
  if (!indexInfo) return { status: "success", data: { last_price: 0 } };
  const last_price = await fetchIndexLtp(creds, indexInfo);
  return { status: "success", data: { last_price } };
}
