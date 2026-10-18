/**
 * HDFC Sky historical candles.
 *
 * Official docs: https://developer.hdfcsky.com/sky-docs/docs/fetchCandles
 *   GET /oapi/charts-api/charts/v1/fetch-candle?api_key&symbol&exchange&chartType&seriesType&start&end
 *   response {"data":{"results":[[open, high, low, close, volume, oi, "DD-MM-YYYY"], ...]},
 *             "meta":{"displayMessage":"Success","err_code":"Success"}}
 * The parameter table says chartType "MINUTES/DAY" but the docs' curl sends chartType=MINUTE; we follow
 * the curl (the plural has been observed to be rejected). The sample rows are NOT in time order, so we
 * sort. Intraday rows carry "DD-MM-YYYY HH:MM" (IST); an 8th cumulative-volume column has
 * been observed on live data (not in the official docs), which is ignored.
 * Only 1-minute and daily resolutions exist; 3/5/15/30/60-minute candles are aggregated here from
 * 1-minute data, in buckets anchored at the 09:15 IST open. Per-request range caps are not documented;
 * observed limits are 31 days for MINUTE and 2000 for DAY (needs live verification), so requests are split at
 * 30 / 1999 days.
 * symbol / seriesType (not documented beyond the sample "RELIANCE" + "EQ"): cash uses the series-free
 * symbol and the series as seriesType; derivatives use the master trading_symbol and instrument_name
 * (OPTIDX, OPTSTK, IO, SO, ...); indices use the index name and the master segment (INDICES, IDX).
 */

import { BrokerError, BrokerInputError } from "./contract.mjs";
import { skyRequest } from "./hdfcskyClient.mjs";
import { getInstrumentMaster, findRow, isIndexRow, indexNameOf } from "./hdfcskyInstruments.mjs";

const IST_OFFSET_S = 19_800;
const INTERVAL_MINUTES = { "1m": 1, "3m": 3, "5m": 5, "15m": 15, "30m": 30, "60m": 60 };

/** Pure: chart request fields for a master row and the contract exchange it was asked for. */
export function chartParams(row) {
  const exchange = String(row.exchange).toUpperCase();
  if (isIndexRow(row)) return { symbol: indexNameOf(row), exchange, seriesType: String(row.segment).toUpperCase() };
  if (exchange === "NSE" || exchange === "BSE") {
    const sym = String(row.trading_symbol);
    const dash = sym.lastIndexOf("-");
    return dash > 0 ? { symbol: sym.slice(0, dash), exchange, seriesType: sym.slice(dash + 1) } : { symbol: sym, exchange, seriesType: "EQ" };
  }
  return { symbol: String(row.trading_symbol), exchange, seriesType: String(row.instrument_name).toUpperCase() };
}

/** "22-10-2024" | "22-10-2024 09:15" (IST) -> epoch seconds. */
export function istToEpoch(s) {
  const m = String(s ?? "").trim().match(/^(\d{2})-(\d{2})-(\d{4})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!m) return null;
  const utc = Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1]), Number(m[4] ?? 0), Number(m[5] ?? 0), Number(m[6] ?? 0)) / 1000;
  return utc - IST_OFFSET_S;
}

/** Pure: raw results -> Candle[] sorted ascending, duplicates dropped. */
export function parseCandles(results) {
  const byTime = new Map();
  for (const r of Array.isArray(results) ? results : []) {
    if (!Array.isArray(r) || r.length < 7) continue;
    const time = istToEpoch(r[6]);
    const [open, high, low, close, volume, oi] = r.slice(0, 6).map(Number);
    if (time === null || ![open, high, low, close].every(Number.isFinite)) continue;
    byTime.set(time, { time, open, high, low, close, volume: Number.isFinite(volume) ? volume : 0, oi: Number.isFinite(oi) ? oi : 0 });
  }
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}

/** Pure: aggregate 1-minute candles into `minutes` buckets anchored at 09:15 IST each day. */
export function resample(candles, minutes) {
  if (minutes <= 1) return candles;
  const size = minutes * 60;
  const out = new Map();
  for (const c of candles) {
    const istDayStart = Math.floor((c.time + IST_OFFSET_S) / 86_400) * 86_400 - IST_OFFSET_S;
    const open915 = istDayStart + (9 * 60 + 15) * 60;
    const bucket = c.time >= open915 ? open915 + Math.floor((c.time - open915) / size) * size : c.time;
    const b = out.get(bucket);
    if (!b) out.set(bucket, { ...c, time: bucket });
    else {
      b.high = Math.max(b.high, c.high);
      b.low = Math.min(b.low, c.low);
      b.close = c.close;
      b.volume += c.volume;
      b.oi = c.oi;
    }
  }
  return [...out.values()].sort((a, b) => a.time - b.time);
}

function dayChunks(from, to, maxDays) {
  const chunks = [];
  let start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) throw new BrokerInputError("HDFC Sky historical: from/to must be YYYY-MM-DD with from <= to.");
  while (start <= end) {
    const stop = new Date(Math.min(end.getTime(), start.getTime() + (maxDays - 1) * 86_400_000));
    chunks.push([start.toISOString().slice(0, 10), stop.toISOString().slice(0, 10)]);
    start = new Date(stop.getTime() + 86_400_000);
  }
  return chunks;
}

export async function fetchHistorical(creds, { instrument, interval, from, to } = {}) {
  const isDay = interval === "1d";
  const minutes = INTERVAL_MINUTES[interval];
  if (!isDay && !minutes) throw new BrokerInputError(`HDFC Sky historical: interval ${interval} is not supported.`);
  const master = await getInstrumentMaster();
  const row = findRow(master, instrument?.exchange, instrument?.token);
  if (!row) throw new BrokerInputError(`HDFC Sky historical: ${instrument?.exchange}:${instrument?.token} is not in the security master.`);
  const params = chartParams(row);
  const chartType = isDay ? "DAY" : "MINUTE";
  const raw = [];
  for (const [start, end] of dayChunks(String(from).slice(0, 10), String(to).slice(0, 10), isDay ? 1999 : 30)) {
    const json = await skyRequest(creds, "GET", "/oapi/charts-api/charts/v1/fetch-candle", { params: { ...params, chartType, start, end } });
    // The documented sample's only success value is err_code "Success" (compared case-insensitively). A
    // missing or empty err_code is treated as success because the candle payload itself is then the only signal.
    const err = String(json?.meta?.err_code ?? "success").trim().toLowerCase();
    if (err && err !== "success") throw new BrokerError(`HDFC Sky historical: ${json?.meta?.displayMessage || err}`);
    raw.push(...(json?.data?.results ?? []));
  }
  const candles = parseCandles(raw);
  return { status: "success", data: isDay ? candles : resample(candles, minutes) };
}
