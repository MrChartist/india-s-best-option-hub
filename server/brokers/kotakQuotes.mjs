/**
 * Kotak Securities (Neo) — batched quote fetching via the neosymbol Quotes API
 * (broker-api-docs/kotak-api-docs/05-market-data-quotes.md).
 *
 * GET {baseUrl}/script-details/1.0/quotes/neosymbol/<exch>|<instrument>[,<exch>|<instrument>...]/<filter>
 * authenticated with just the plain Authorization: <accessToken> header — the
 * trade token/sid from login are not involved in reads at all.
 *
 * Kotak doesn't document a hard per-call symbol cap. marketcalls/openalgo's
 * production Kotak plugin (broker/kotak/api/data.py) notes 42 symbols returns
 * 200 but 50 returns HTTP 400 "Please set the Neo symbol max value to 50.",
 * and settled on 25/batch with a 200ms gap between batches (~5 req/s) as a
 * safe margin — reused verbatim here since it comes from an observed live cap,
 * not the (silent) official docs.
 */

import { batchWithDelay } from "../lib/batch.mjs";

const QUOTES_PATH = "/script-details/1.0/quotes/neosymbol";
export const QUOTE_BATCH_SIZE = 25;
export const QUOTE_BATCH_DELAY_MS = 200;

/** Kotak's neosymbol query only needs spaces escaped — '|' and ',' must stay literal (they're the query's own separators). */
function encodeNeoQuery(query) {
  return query.replace(/ /g, "%20");
}

async function requestBatch(session, queries) {
  const combined = queries.join(",");
  const url = `${session.baseUrl}${QUOTES_PATH}/${encodeNeoQuery(combined)}/all`;
  const res = await fetch(url, {
    headers: { Authorization: session.accessToken, "Content-Type": "application/json" },
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-JSON error body */ }

  if (!res.ok) {
    throw new Error(`Kotak Neo quotes API error [${res.status}]: ${text.slice(0, 200)}`);
  }
  // Kotak returns HTTP 200 with {"stat":"Not_Ok", ...} for a bad/unresolvable query.
  if (json && !Array.isArray(json) && json.stat === "Not_Ok") {
    console.log(`[kotak] quotes API rejected batch (stCode=${json.stCode})`);
    return [];
  }
  return Array.isArray(json) ? json : [];
}

/**
 * Fetches quotes for `targets` ({exchSeg, query} where `query` is the exact
 * instrument portion of `<exchSeg>|<query>` — pSymbol token or index name),
 * batched + rate-limited. Returns Map<"exchSeg|query", quoteObject>.
 */
export async function fetchQuotesBatched(session, targets) {
  const map = new Map();
  if (!targets.length) return map;

  const chunkResults = await batchWithDelay(targets, QUOTE_BATCH_SIZE, QUOTE_BATCH_DELAY_MS, async (chunk) => {
    const queries = chunk.map((t) => `${t.exchSeg}|${t.query}`);
    return requestBatch(session, queries);
  });

  // Match results back to requested keys by exchange + exchange_token (Kotak
  // echoes exchange_token as the pSymbol/index-name that was actually queried).
  for (const items of chunkResults) {
    for (const q of items) {
      if (!q?.exchange || q?.exchange_token == null) continue;
      map.set(`${q.exchange}|${q.exchange_token}`, q);
    }
  }
  return map;
}

/** Parses one Kotak quote object into {ltp, oi, volume, bid, ask}. */
export function parseQuote(q) {
  if (!q) return { ltp: 0, oi: 0, volume: 0, bid: 0, ask: 0 };
  const ltp = Number(q.ltp) || 0;
  const depth = q.depth || {};
  const buy = Array.isArray(depth.buy) ? depth.buy : [];
  const sell = Array.isArray(depth.sell) ? depth.sell : [];
  return {
    ltp,
    oi: Number(q.open_int) || 0,
    volume: Number(q.last_volume) || 0,
    bid: buy[0]?.price != null ? Number(buy[0].price) : 0,
    ask: sell[0]?.price != null ? Number(sell[0].price) : 0,
  };
}
