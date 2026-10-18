/**
 * 5paisa market data: MarketSnapshot quotes, V2 MarketDepth and V2 historical candles.
 *
 * Official docs (https://xstream.5paisa.com/dev-docs/, market-data-system/*, checked 2026-10):
 *  - POST .../Service1.svc/MarketSnapshot  body { ClientCode, Data: [{ Exchange, ExchangeType, ScripCode, ScripData }] }
 *    -> body.Data[] { Exch, ExchType, Token, LastRate, High, Low, PClose, TotalQty, Chg, ChgPcnt, TickDt }.
 *    The doc's field table says Exch/ExchType for the request items but its sample sends Exchange/ExchangeType;
 *    we follow the sample (OpenAlgo does the same). OpenAlgo reads LastTradedPrice / Volume / OpenInterest from
 *    this endpoint while the doc sample shows LastRate / TotalQty and no OI, so both spellings are accepted and a
 *    missing OI stays 0 (chain) / null (quotes). No bid/ask in a snapshot.
 *  - POST .../Service1.svc/V2/MarketDepth  body { ClientCode, Exchange, ExchangeType, ScripCode, ScripData }
 *    -> body.MarketDepthData[] { BbBuySellFlag (66 buy, 83 sell), Price, Quantity, NumberOfOrders } (5 levels).
 *  - GET  https://openapi.5paisa.com/V2/historical/{Exch}/{ExchType}/{ScripCode}/{interval}?from=YYYY-MM-DD&end=YYYY-MM-DD
 *    interval 1m 5m 10m 15m 30m 60m 1d -> { status: "success", data: { candles: [[ "YYYY-MM-DDTHH:MM:SS", o, h, l, c, v ]] } }
 *    (timestamps are IST without an offset).
 * Batch size: OpenAlgo observed MarketSnapshot returning empty data above ~50 instruments; 5paisa does not
 * document a cap, so we stay at 50 per call, sequential, with a short pause.
 */

import { BrokerError, BrokerInputError } from "./contract.mjs";
import { authenticatedGet, authenticatedPost } from "./fivepaisaAuth.mjs";
import { brokerSegment } from "./fivepaisaInstruments.mjs";
import { sleep } from "../lib/batch.mjs";

export const QUOTE_BATCH_SIZE = 50;
const QUOTE_BATCH_DELAY_MS = 300;

const numOrNull = (v) => (v === undefined || v === null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const num = (v) => numOrNull(v) ?? 0;

/** Quote key used across the chain/quotes code: "<Exch>|<ScripCode>". */
export const quoteKey = (exch, scripCode) => `${exch}|${scripCode}`;

/** Normalise one MarketSnapshot row (either spelling) to { key, token, exch, exchType, ltp, ... }. */
export function readSnapshotRow(row) {
  const token = String(row?.Token ?? row?.ScripCode ?? "");
  return {
    key: quoteKey(row?.Exch ?? row?.Exchange ?? "", token),
    token,
    exch: row?.Exch ?? row?.Exchange ?? "",
    exchType: row?.ExchType ?? row?.ExchangeType ?? "",
    ltp: num(row?.LastTradedPrice ?? row?.LastRate),
    open: numOrNull(row?.Open),
    high: numOrNull(row?.High),
    low: numOrNull(row?.Low),
    close: numOrNull(row?.PClose),
    volume: numOrNull(row?.Volume ?? row?.TotalQty),
    oi: numOrNull(row?.OpenInterest),
  };
}

/**
 * Snapshot quotes for `items` ([{ scripCode, exch, exchType }]) -> Map<"Exch|ScripCode", row>.
 * Sequential batches; a session/refusal error (422) aborts the whole call instead of being swallowed.
 */
export async function fetchSnapshotMap(creds, items) {
  const map = new Map();
  for (let i = 0; i < items.length; i += QUOTE_BATCH_SIZE) {
    const chunk = items.slice(i, i + QUOTE_BATCH_SIZE);
    if (i > 0) await sleep(QUOTE_BATCH_DELAY_MS);
    const json = await authenticatedPost(creds, "/MarketSnapshot", (session) => ({
      ClientCode: session.clientCode,
      Data: chunk.map((it) => ({ Exchange: it.exch, ExchangeType: it.exchType, ScripCode: String(it.scripCode), ScripData: "" })),
    }));
    const rows = Array.isArray(json?.body?.Data) ? json.body.Data : [];
    for (const raw of rows) {
      const row = readSnapshotRow(raw);
      if (!row.token) continue;
      map.set(row.key, row);
      // Some responses omit Exch; also index by token for the single-exchange lookups.
      if (!map.has(`|${row.token}`)) map.set(`|${row.token}`, row);
    }
  }
  return map;
}

export function lookup(map, exch, scripCode) {
  return map.get(quoteKey(exch, scripCode)) || map.get(`|${scripCode}`) || null;
}

function refItem(ref) {
  const token = String(ref?.token ?? "");
  if (!/^\d{1,12}$/.test(token)) throw new BrokerInputError("5paisa: instrument token must be a numeric ScripCode");
  return { ...brokerSegment(ref.exchange), scripCode: token, exchange: ref.exchange };
}

/** Contract quotes for [{ token, exchange }]. */
export async function fetchQuotes(creds, refs = []) {
  const items = refs.map(refItem);
  const map = await fetchSnapshotMap(creds, items);
  const data = [];
  for (const it of items) {
    const row = lookup(map, it.exch, it.scripCode);
    if (!row) continue;
    data.push({ token: it.scripCode, exchange: it.exchange, ltp: row.ltp, open: row.open, high: row.high, low: row.low,
      close: row.close, volume: row.volume, oi: row.oi, bid: null, ask: null });
  }
  return { status: "success", data };
}

/** Five-level depth for one { token, exchange }. */
export async function fetchDepth(creds, ref) {
  const it = refItem(ref);
  const json = await authenticatedPost(creds, "/V2/MarketDepth", (session) => ({
    ClientCode: session.clientCode, Exchange: it.exch, ExchangeType: it.exchType, ScripCode: Number(it.scripCode), ScripData: "",
  }));
  const levels = Array.isArray(json?.body?.MarketDepthData) ? json.body.MarketDepthData : [];
  const level = (l) => ({ price: num(l.Price), qty: num(l.Quantity), orders: numOrNull(l.NumberOfOrders) });
  const bids = levels.filter((l) => Number(l.BbBuySellFlag) === 66).map(level).sort((a, b) => b.price - a.price);
  const asks = levels.filter((l) => Number(l.BbBuySellFlag) === 83).map(level).sort((a, b) => a.price - b.price);
  return { status: "success", data: { bids, asks } };
}

const INTERVALS = { "1m": "1m", "5m": "5m", "15m": "15m", "30m": "30m", "60m": "60m", "1d": "1d" };
const ISO_DAY = /^\d{4}-\d{2}-\d{2}/;

/** IST "YYYY-MM-DDTHH:MM:SS" -> epoch seconds. */
export function istToEpochSeconds(ts) {
  const t = String(ts ?? "");
  const withTime = t.length === 10 ? `${t}T00:00:00` : t.slice(0, 19);
  const ms = Date.parse(`${withTime}+05:30`);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

/** Candles for { instrument: { token, exchange }, interval, from, to }. */
export async function fetchHistorical(creds, { instrument, interval, from, to } = {}) {
  const it = refItem(instrument);
  const iv = INTERVALS[interval];
  if (!iv) throw new BrokerInputError(`5paisa historical candles support 1m, 5m, 15m, 30m, 60m and 1d (not ${interval}).`);
  if (!ISO_DAY.test(String(from)) || !ISO_DAY.test(String(to))) throw new BrokerInputError("5paisa historical: from/to must be YYYY-MM-DD dates.");
  const path = `/V2/historical/${it.exch}/${it.exchType}/${it.scripCode}/${iv}?from=${String(from).slice(0, 10)}&end=${String(to).slice(0, 10)}`;
  const json = await authenticatedGet(creds, path);
  if (json?.status !== "success") {
    throw new BrokerError(`5paisa historical API: ${json?.head?.Status_description || json?.message || "request failed"}`);
  }
  const rows = Array.isArray(json?.data?.candles) ? json.data.candles : [];
  const byTime = new Map();
  for (const c of rows) {
    const time = istToEpochSeconds(c?.[0]);
    if (time === null) continue;
    byTime.set(time, { time, open: num(c[1]), high: num(c[2]), low: num(c[3]), close: num(c[4]), volume: num(c[5]) });
  }
  return { status: "success", data: [...byTime.values()].sort((a, b) => a.time - b.time) };
}
