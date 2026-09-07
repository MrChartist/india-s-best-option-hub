/**
 * IndMoney (INDstocks) broker module — see registry.mjs for the shared contract.
 *
 * No native option-chain endpoint: this module joins the daily instrument master
 * (indmoneyInstruments.mjs — source=fno for strikes/expiries, source=index for the
 * underlying spot token) with batched /market/quotes/full calls, then back-solves IV and
 * Greeks via Black-Scholes since INDstocks' quote API returns neither. Auth (paste-a-token
 * or MPIN+TOTP) plus all paced REST calls live in indmoneyAuth.mjs.
 */

import { ensureAccessToken, apiGet } from "./indmoneyAuth.mjs";
import {
  getFnoMaster,
  getIndexMaster,
  listExpiries,
  optionRowsForExpiry,
  resolveIndexScrip,
  SYMBOL_EXCHANGE,
} from "./indmoneyInstruments.mjs";
import { computeIVAndGreeks, daysBetween } from "../lib/blackScholes.mjs";
import { batchWithDelay } from "../lib/batch.mjs";

export const id = "indmoney";
export const credentialFields = ["accessToken", "clientId", "mpin", "totpSecret"];

// Docs (06-market-quotes.md) allow up to 1,000 scrip-codes per /market/quotes/* call;
// openalgo's production adapter caps its batches at 500, which this mirrors to stay well
// clear of URL-length limits while an option chain (a few hundred strikes) still fits in
// one or two requests.
const QUOTE_BATCH_SIZE = 500;
const QUOTE_BATCH_DELAY_MS = 260; // ~4 req/s between chunks, under the documented 5/s quote cap

function assertKnownSymbol(symbol) {
  if (!SYMBOL_EXCHANGE[symbol]) throw new Error(`Unknown symbol for IndMoney: ${symbol}`);
}

export async function testConnection(creds = {}) {
  try {
    await ensureAccessToken(creds);
    const profile = await apiGet(creds, "/user/profile");
    const who = profile?.data?.email || profile?.data?.user_id;
    return { status: "success", message: who ? `IndMoney connected (${who})` : "IndMoney connected" };
  } catch (e) {
    return { status: "error", message: e.message };
  }
}

export async function fetchExpiryList(creds, symbol) {
  assertKnownSymbol(symbol);
  await ensureAccessToken(creds); // fail fast with a clear message before touching the instrument endpoint
  const fnoMaster = await getFnoMaster(creds);
  return { status: "success", data: listExpiries(fnoMaster, symbol) };
}

export async function fetchLTP(creds, symbol) {
  assertKnownSymbol(symbol);
  await ensureAccessToken(creds);
  const indexMaster = await getIndexMaster(creds);
  const spot = resolveIndexScrip(indexMaster, symbol);
  if (!spot) return { status: "success", data: { last_price: 0 } };

  const quotes = await fetchQuotesMap(creds, [spot.scripCode]);
  return { status: "success", data: { last_price: extractLtp(quotes.get(spot.scripCode)) } };
}

export async function fetchOptionChain(creds, symbol, expiry) {
  assertKnownSymbol(symbol);
  await ensureAccessToken(creds);

  const [fnoMaster, indexMaster] = await Promise.all([getFnoMaster(creds), getIndexMaster(creds)]);

  let expiryIso = expiry;
  if (!expiryIso) {
    const expiries = listExpiries(fnoMaster, symbol);
    if (!expiries.length) return { status: "success", data: { oc: {}, last_price: 0 } };
    expiryIso = expiries[0];
  }

  const optionRows = optionRowsForExpiry(fnoMaster, symbol, expiryIso);
  if (!optionRows.length) return { status: "success", data: { oc: {}, last_price: 0 } };

  const spot = resolveIndexScrip(indexMaster, symbol);
  const scripCodes = optionRows.map((r) => r.scripCode);
  if (spot) scripCodes.push(spot.scripCode);

  const quotes = await fetchQuotesMap(creds, scripCodes);
  const lastPrice = spot ? extractLtp(quotes.get(spot.scripCode)) : 0;
  const daysToExpiry = daysBetween(new Date(), expiryIso);

  const oc = {};
  for (const row of optionRows) {
    const quote = quotes.get(row.scripCode);
    if (!quote) continue; // unquotable/missing strike — skip rather than fabricate a zero leg

    const key = String(row.strike);
    if (!oc[key]) oc[key] = {};
    oc[key][row.type] = buildLeg(quote, row.scripCode, row.strike, row.type === "ce" ? "CE" : "PE", lastPrice, daysToExpiry);
  }

  return { status: "success", data: { oc, last_price: lastPrice } };
}

// ── internals ──────────────────────────────────────────────────────────────

function cleanNumber(value) {
  if (value == null) return 0;
  const n = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function extractLtp(quote) {
  if (!quote) return 0;
  return cleanNumber(quote.live_price ?? quote.ltp);
}

/**
 * Best bid/ask from a /market/quotes/full row. Docs (06-market-quotes.md) show
 * market_depth flat under the quote; openalgo's production adapter also observed an extra
 * scrip-code-keyed nesting on some live responses, so both shapes are tolerated here.
 */
function extractDepth(quote, scripCode) {
  const md = quote?.market_depth;
  if (!md || typeof md !== "object") return { bid: 0, ask: 0 };
  const nested = md[scripCode];
  const container = nested && (nested.depth || nested.aggregate) ? nested : md;
  const level = container?.depth?.[0];
  if (!level) return { bid: 0, ask: 0 };
  return { bid: cleanNumber(level.buy?.price), ask: cleanNumber(level.sell?.price) };
}

function buildLeg(quote, scripCode, strike, type, spot, daysToExpiry) {
  const ltp = extractLtp(quote);
  const oi = cleanNumber(quote.oi ?? quote.open_interest);
  const volume = cleanNumber(quote.volume);
  const { bid, ask } = extractDepth(quote, scripCode);
  const greeks = computeIVAndGreeks({ ltp, spot, strike, daysToExpiry, type });
  return { last_price: ltp, oi, volume, bid_price: bid, ask_price: ask, ...greeks };
}

/**
 * Batched /market/quotes/full, tolerating a single unquotable scrip code within a chunk —
 * INDstocks 400s the WHOLE batch if any one code can't be priced (e.g. a deep-ITM strike;
 * confirmed by openalgo's production adapter) — by falling back to per-code calls for that
 * chunk so one bad strike never blanks out an entire chain refresh.
 */
async function fetchQuotesMap(creds, scripCodes) {
  const map = new Map();
  if (!scripCodes.length) return map;

  const chunkResults = await batchWithDelay(scripCodes, QUOTE_BATCH_SIZE, QUOTE_BATCH_DELAY_MS, async (chunk) => {
    try {
      const json = await apiGet(creds, "/market/quotes/full", { "scrip-codes": chunk.join(",") });
      return json?.data || {};
    } catch {
      const merged = {};
      for (const code of chunk) {
        try {
          const single = await apiGet(creds, "/market/quotes/full", { "scrip-codes": code });
          Object.assign(merged, single?.data || {});
        } catch { /* genuinely unquotable — leave it out of the map */ }
      }
      return merged;
    }
  });

  for (const data of chunkResults) {
    for (const [scripCode, quote] of Object.entries(data)) {
      if (quote) map.set(scripCode, quote);
    }
  }
  return map;
}
