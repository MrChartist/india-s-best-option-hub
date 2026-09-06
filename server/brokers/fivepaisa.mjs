/**
 * 5paisa broker integration. See registry.mjs for the shared contract.
 *
 * 5paisa has no native, reliable option-chain endpoint, so this module builds
 * the chain itself: a daily instrument (scrip) master resolves strike/expiry
 * -> ScripCode (fivepaisaInstruments.mjs), a TOTP-based two-step login yields a
 * session token good until 23:59 IST (fivepaisaAuth.mjs), and batched
 * MarketSnapshot quote calls fill in price/OI/volume. IV + Greeks aren't
 * returned by 5paisa at all, so every leg is back-solved via Black-Scholes.
 */

import { ensureSession, authenticatedPost } from "./fivepaisaAuth.mjs";
import { getInstrumentMaster, listExpiries, strikeMapForExpiry, indexScripInfo, INDEX_ROOTS } from "./fivepaisaInstruments.mjs";
import { batchWithDelay } from "../lib/batch.mjs";
import { computeIVAndGreeks, daysBetween } from "../lib/blackScholes.mjs";

export const id = "fivepaisa";
export const credentialFields = ["appName", "appSource", "userKey", "encryptionKey", "userId", "clientCode", "pin", "totpSecret"];

// 5paisa's MarketSnapshot endpoint silently returns empty results above ~50
// instruments per call (confirmed in openalgo's production adapter) — never raise this.
const QUOTE_BATCH_SIZE = 50;
const QUOTE_BATCH_DELAY_MS = 500;

function assertKnownSymbol(symbol) {
  if (!INDEX_ROOTS[symbol]) throw new Error(`Unknown symbol for 5paisa: ${symbol}`);
}

/** Batched MarketSnapshot lookup -> Map<scripCode string, raw quote item>. */
async function fetchQuotesMap(creds, items) {
  if (items.length === 0) return new Map();
  const chunkResults = await batchWithDelay(items, QUOTE_BATCH_SIZE, QUOTE_BATCH_DELAY_MS, async (chunk) => {
    // buildBody is re-invoked against a fresh session if authenticatedPost has to
    // re-login mid-call (e.g. ClientCode must match whichever session actually authenticated).
    const json = await authenticatedPost(creds, "/MarketSnapshot", (session) => ({
      head: { key: creds.userKey }, // lowercase "key" for data calls (TOTPLogin/GetAccessToken use capital "Key")
      body: {
        ClientCode: session.clientCode,
        Data: chunk.map((it) => ({
          Exchange: it.exch,
          ExchangeType: it.exchType,
          ScripCode: Number(it.scripCode),
          ScripData: "",
        })),
      },
    }));
    return json?.body?.Data || [];
  });

  const map = new Map();
  for (const rows of chunkResults) {
    for (const row of rows) {
      if (row?.ScripCode != null) map.set(String(row.ScripCode), row);
    }
  }
  return map;
}

/**
 * MarketSnapshot has no bid/ask (confirmed — 5paisa only exposes depth via a
 * separate per-scrip V2/MarketDepth call). Issuing one depth call per strike on
 * every chain refresh would multiply request volume across a full chain and risk
 * 5paisa's per-minute rate limit, so v1 leaves bid/ask at 0 rather than doing that
 * — matches the tradeoff openalgo's own production adapter makes for this endpoint.
 */
function buildLeg(quote, strike, type, spot, daysToExpiry) {
  const ltp = Number(quote?.LastTradedPrice) || 0;
  const oi = Number(quote?.OpenInterest) || 0;
  const volume = Number(quote?.Volume) || 0;
  const greeks = computeIVAndGreeks({ ltp, spot, strike, daysToExpiry, type });
  return { last_price: ltp, oi, volume, bid_price: 0, ask_price: 0, ...greeks };
}

export async function testConnection(creds = {}) {
  try {
    await ensureSession(creds);
    return { status: "success", message: "5paisa session authenticated" };
  } catch (e) {
    return { status: "error", message: e.message };
  }
}

export async function fetchExpiryList(creds, symbol) {
  assertKnownSymbol(symbol);
  // The scrip master CSV is public (no auth) — no need to log in just to list expiries.
  const master = await getInstrumentMaster();
  return { status: "success", data: listExpiries(master, symbol) };
}

export async function fetchOptionChain(creds, symbol, expiry) {
  assertKnownSymbol(symbol);

  await ensureSession(creds); // throws on bad/expired credentials — fail fast before touching the instrument master
  const master = await getInstrumentMaster();

  let expiryIso = expiry;
  if (!expiryIso) {
    const expiries = listExpiries(master, symbol);
    expiryIso = expiries[0];
  }
  if (!expiryIso) return { status: "success", data: { oc: {}, last_price: 0 } };

  const strikes = strikeMapForExpiry(master, symbol, expiryIso);
  const indexInfo = indexScripInfo(master, symbol);
  if (strikes.size === 0) return { status: "success", data: { oc: {}, last_price: 0 } };

  const quoteItems = indexInfo ? [indexInfo] : [];
  for (const legs of strikes.values()) {
    if (legs.ce) quoteItems.push(legs.ce);
    if (legs.pe) quoteItems.push(legs.pe);
  }

  const quotes = await fetchQuotesMap(creds, quoteItems);
  const spot = indexInfo ? Number(quotes.get(String(indexInfo.scripCode))?.LastTradedPrice) || 0 : 0;
  const daysToExpiry = daysBetween(new Date(), expiryIso);

  const oc = {};
  for (const [strike, legs] of strikes.entries()) {
    const entry = {};
    if (legs.ce) entry.ce = buildLeg(quotes.get(String(legs.ce.scripCode)), Number(strike), "CE", spot, daysToExpiry);
    if (legs.pe) entry.pe = buildLeg(quotes.get(String(legs.pe.scripCode)), Number(strike), "PE", spot, daysToExpiry);
    if (entry.ce || entry.pe) oc[strike] = entry;
  }

  return { status: "success", data: { oc, last_price: spot } };
}

export async function fetchLTP(creds, symbol) {
  assertKnownSymbol(symbol);
  await ensureSession(creds);
  const master = await getInstrumentMaster();
  const indexInfo = indexScripInfo(master, symbol);
  if (!indexInfo) return { status: "success", data: { last_price: 0 } };

  const quotes = await fetchQuotesMap(creds, [indexInfo]);
  const last_price = Number(quotes.get(String(indexInfo.scripCode))?.LastTradedPrice) || 0;
  return { status: "success", data: { last_price } };
}
