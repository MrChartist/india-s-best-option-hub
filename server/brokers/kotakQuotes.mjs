/**
 * Kotak Securities (Neo) quotes via the neosymbol Quotes API.
 *
 * Official source: https://github.com/Kotak-Neo/Kotak-neo-api-v2 docs/Quotes.md and
 * neo_api_client/api/quotes_neo_symbol_api.py (checked 2026-10):
 *   GET <baseUrl>/script-details/1.0/quotes/neosymbol/<seg>|<token>[,<seg>|<token>...]/<quote_type>
 *   header Authorization: <app access token>; quote_type all|depth|ohlc|ltp|oi|52w|circuit_limits|scrip_details.
 *   The SDK URL-encodes the whole "<seg>|<token>,..." list (urllib.parse.quote), which we follow (the previous
 *   module sent "|" and "," raw; Kotak decodes both forms).
 * The docs publish no response sample. Field names used here (exchange, exchange_token, display_symbol, ltp,
 * last_volume, open_int, ohlc{open,high,low,close}, depth{buy[],sell[]} with price/quantity/orders) are the ones
 * this repo's previous module and OpenAlgo read; a bad query answers HTTP 200 { stat: "Not_Ok", stCode, emsg }.
 * Limits: no cap is documented. OpenAlgo observed HTTP 400 at 50 symbols per call and HTTP 429 with more than ~4
 * requests in flight; we send at most 25 symbols per call, one call at a time, 200 ms apart.
 */

import { BrokerError, brokerFetch, BrokerInputError } from "./contract.mjs";
import { throwForResponse } from "./kotakAuth.mjs";
import { kotakSegment } from "./kotakInstruments.mjs";
import { sleep } from "../lib/batch.mjs";

const QUOTES_PATH = "/script-details/1.0/quotes/neosymbol";
export const QUOTE_BATCH_SIZE = 25;
export const QUOTE_BATCH_DELAY_MS = 200;

const numOrNull = (v) => (v === undefined || v === null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const num = (v) => numOrNull(v) ?? 0;

async function requestBatch(session, targets, quoteType = "all") {
  const list = encodeURIComponent(targets.map((t) => `${t.exchSeg}|${t.query}`).join(","));
  const res = await brokerFetch(`${session.baseUrl}${QUOTES_PATH}/${list}/${quoteType}`, {
    headers: { Authorization: session.accessToken, accept: "application/json" },
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* handled below */ }
  if (!res.ok || json === null) throwForResponse(res, json, text, "quotes", { sessionCall: false });
  if (!Array.isArray(json)) {
    if (json?.stat === "Not_Ok") return []; // unresolvable query: no rows for this batch
    throw new BrokerError("Kotak Neo quotes: unexpected response shape");
  }
  return json;
}

/**
 * Quotes for [{ exchSeg, query }] -> Map<"seg|query", quote>. Rows are matched by exchange + exchange_token;
 * when a batch answers with the same number of rows but different keys (index names), they are matched by position.
 */
export async function fetchQuotesBatched(session, targets) {
  const map = new Map();
  for (let i = 0; i < targets.length; i += QUOTE_BATCH_SIZE) {
    if (i > 0) await sleep(QUOTE_BATCH_DELAY_MS);
    const chunk = targets.slice(i, i + QUOTE_BATCH_SIZE);
    const rows = await requestBatch(session, chunk);
    const keyed = new Map(rows.filter((q) => q?.exchange && q?.exchange_token != null).map((q) => [`${q.exchange}|${q.exchange_token}`, q]));
    const keys = chunk.map((t) => `${t.exchSeg}|${t.query}`);
    const byPosition = rows.length === chunk.length && !keys.some((k) => keyed.has(k));
    keys.forEach((key, j) => {
      const q = keyed.get(key) ?? (byPosition ? rows[j] : undefined);
      if (q) map.set(key, q);
    });
  }
  return map;
}

/** First spot candidate that answers with a positive ltp (index names can differ by spelling). */
export async function fetchSpotQuote(session, candidates) {
  for (const c of candidates) {
    const q = (await fetchQuotesBatched(session, [c])).get(`${c.exchSeg}|${c.query}`);
    if (q && num(q.ltp) > 0) return q;
  }
  return null;
}

/** One Kotak quote -> { ltp, oi, volume, bid, ask }. */
export function parseQuote(q) {
  if (!q) return { ltp: 0, oi: 0, volume: 0, bid: 0, ask: 0 };
  const buy = Array.isArray(q.depth?.buy) ? q.depth.buy : [];
  const sell = Array.isArray(q.depth?.sell) ? q.depth.sell : [];
  return {
    ltp: num(q.ltp),
    oi: num(q.open_int),
    volume: num(q.last_volume),
    bid: buy[0]?.price != null ? num(buy[0].price) : 0,
    ask: sell[0]?.price != null ? num(sell[0].price) : 0,
  };
}

function refTarget(ref) {
  const token = String(ref?.token ?? "");
  if (!/^[A-Za-z0-9 ]{1,30}$/.test(token)) throw new BrokerInputError("Kotak Neo: invalid instrument token");
  return { exchSeg: kotakSegment(ref.exchange), query: token, exchange: ref.exchange };
}

/** Contract quotes for [{ token, exchange }]. */
export async function fetchQuotes(session, refs = []) {
  const targets = refs.map(refTarget);
  const map = await fetchQuotesBatched(session, targets);
  const data = [];
  for (const t of targets) {
    const q = map.get(`${t.exchSeg}|${t.query}`);
    if (!q) continue;
    const p = parseQuote(q);
    data.push({
      token: t.query, exchange: t.exchange, ltp: p.ltp,
      open: numOrNull(q.ohlc?.open), high: numOrNull(q.ohlc?.high), low: numOrNull(q.ohlc?.low), close: numOrNull(q.ohlc?.close),
      volume: numOrNull(q.last_volume), oi: numOrNull(q.open_int),
      bid: Array.isArray(q.depth?.buy) && q.depth.buy.length ? p.bid : null,
      ask: Array.isArray(q.depth?.sell) && q.depth.sell.length ? p.ask : null,
    });
  }
  return { status: "success", data };
}

/** Five-level depth for one { token, exchange } (quote_type "all": the "depth" filter drops nothing we need). */
export async function fetchDepth(session, ref) {
  const t = refTarget(ref);
  const q = (await fetchQuotesBatched(session, [t])).get(`${t.exchSeg}|${t.query}`);
  const level = (l) => ({ price: num(l?.price), qty: num(l?.quantity), orders: numOrNull(l?.orders) });
  const bids = (Array.isArray(q?.depth?.buy) ? q.depth.buy : []).map(level);
  const asks = (Array.isArray(q?.depth?.sell) ? q.depth.sell : []).map(level);
  return { status: "success", data: { bids, asks } };
}
