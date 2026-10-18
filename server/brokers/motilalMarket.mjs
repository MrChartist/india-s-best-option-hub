/**
 * Motilal Oswal market data over REST.
 *
 * Official docs (https://invest.motilaloswal.com/moAPI/APIDocumentation/Introduction, "Price/LTP" and
 * "INDEX LTP DATA API", checked 2026-10):
 *  - POST /rest/report/v3/getltpdata       { exchange, scripcode } -> data { exchange, scripcode, open, high, low, close,
 *    ltp, volume, ask, bid }. The docs' note reads "The values of open, high, low, close and ltp are in paisa".
 *    It is silent on bid/ask; we divide them by 100 as well, because in the docs' own Price/LTP sample (BSE
 *    500317, re-read 2026-10 on the page above) both quotes sit within half a percent of ltp, which only holds
 *    if they share ltp's unit. volume is a share count and is left as is. One scrip per call; no OI field.
 *  - POST /rest/report/v3/getindexltpdata  { exchange|exchangename, scripcode } -> data [{ exchange, scripcode, open, high,
 *    low, close, ltp }] in rupees. The field table names the exchange key "exchangename" while the sample body sends
 *    "exchange"; the sample spelling is tried first and the other only after an MO1051 (invalid exchange) reply.
 * Depth (5 levels) and historical candles are WebSocket/not offered over REST, so they are not declared.
 * No rate limit is documented. A full chain needs one call per leg, so calls go out 5 at a time, 400 ms apart.
 */

import { BrokerError, BrokerInputError } from "./contract.mjs";
import { authPost } from "./motilalAuth.mjs";
import { motilalExchange } from "./motilalInstruments.mjs";
import { sleep } from "../lib/batch.mjs";

export const QUOTE_CONCURRENCY = 5;
const QUOTE_BATCH_DELAY_MS = 400;

const paise = (v) => (v === undefined || v === null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v) / 100);

/** One getltpdata reply -> rupee quote, or null when Motilal has no data for the scrip. */
export function readLtpData(json) {
  if (String(json?.status).toUpperCase() !== "SUCCESS" || !json?.data) return null;
  const d = json.data;
  return { ltp: paise(d.ltp) ?? 0, open: paise(d.open), high: paise(d.high), low: paise(d.low), close: paise(d.close),
    volume: d.volume === undefined ? null : Number(d.volume) || 0, bid: paise(d.bid), ask: paise(d.ask) };
}

export async function fetchScripQuote(creds, exchangename, token) {
  return readLtpData(await authPost(creds, "getltpdata", { exchange: exchangename, scripcode: Number(token) }));
}

/**
 * Quotes for [{ exchangename, token }] with bounded concurrency. Returns an array aligned with `items` (null for
 * misses). A refusal (SessionRequiredError) aborts; any other per-scrip failure leaves that leg null.
 */
export async function fetchScripQuotes(creds, items) {
  const out = new Array(items.length).fill(null);
  for (let i = 0; i < items.length; i += QUOTE_CONCURRENCY) {
    if (i > 0) await sleep(QUOTE_BATCH_DELAY_MS);
    const chunk = items.slice(i, i + QUOTE_CONCURRENCY);
    const settled = await Promise.allSettled(chunk.map((it) => fetchScripQuote(creds, it.exchangename, it.token)));
    settled.forEach((r, j) => {
      if (r.status === "fulfilled") out[i + j] = r.value;
      else if (r.reason instanceof BrokerError && r.reason.statusCode === 422) throw r.reason;
    });
  }
  return out;
}

const EXCHANGE_KEYS = ["exchange", "exchangename"];
let indexExchangeKey = null;

/** Index LTP in rupees (0 when Motilal has none). */
export async function fetchIndexLtp(creds, indexInfo) {
  const keys = indexExchangeKey ? [indexExchangeKey] : EXCHANGE_KEYS;
  for (const key of keys) {
    const json = await authPost(creds, "getindexltpdata", { [key]: indexInfo.exchangename, scripcode: String(indexInfo.token) });
    if (String(json?.status).toUpperCase() === "SUCCESS") {
      indexExchangeKey = key;
      const rows = Array.isArray(json.data) ? json.data : json.data ? [json.data] : [];
      const row = rows.find((r) => String(r?.scripcode) === String(indexInfo.token)) ?? rows[0];
      return Number(row?.ltp) || 0;
    }
    if (String(json?.errorcode || "").toUpperCase() !== "MO1051") {
      throw new BrokerError(`Motilal Oswal getindexltpdata: ${json?.message || "request refused"}${json?.errorcode ? ` (${json.errorcode})` : ""}`);
    }
  }
  return 0;
}

/** Contract quotes for [{ token, exchange }] (one getltpdata call per instrument). */
export async function fetchQuotes(creds, refs = []) {
  const items = refs.map((ref) => {
    const token = String(ref?.token ?? "");
    if (!/^\d{1,12}$/.test(token)) throw new BrokerInputError("Motilal Oswal: instrument token must be a numeric scrip code");
    return { token, exchangename: motilalExchange(ref.exchange), exchange: ref.exchange };
  });
  const quotes = await fetchScripQuotes(creds, items);
  const data = [];
  items.forEach((it, i) => {
    const q = quotes[i];
    if (q) data.push({ token: it.token, exchange: it.exchange, ltp: q.ltp, open: q.open, high: q.high, low: q.low, close: q.close, volume: q.volume, oi: null, bid: q.bid, ask: q.ask });
  });
  return { status: "success", data };
}
