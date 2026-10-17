/**
 * IndiaBulls (XTS) instrument-master + index-token resolution.
 *
 * XTS has no native option-chain endpoint, so strikes/expiries/tokens are
 * resolved from two public (no-auth-required, confirmed against openalgo's
 * production adapter) endpoints:
 *   - POST {MARKET_DATA_URL}/instruments/master {exchangeSegmentList:[seg]}
 *     -> pipe-delimited F&O contract dump for one exchange segment (NSEFO/BSEFO)
 *   - GET  {MARKET_DATA_URL}/instruments/indexlist?exchangeSegment=<1|11>
 *     -> live index name -> token map for NSE (1) / BSE (11) indices
 * Both are daily-stable, so they're cached once/day via instrumentCache,
 * shared across every user's credentials rather than keyed per-user.
 */

import { getCachedOrFetch, ONE_DAY_MS } from "../lib/instrumentCache.mjs";
import { MARKET_DATA_URL } from "./ibullsAuth.mjs";

// XTS numeric exchange-segment IDs (confirmed from openalgo's exchange_segment_map,
// reused identically across every call site in that adapter).
export const SEGMENT_NUM = { NSECM: 1, NSEFO: 2, CDS: 3, BSECM: 11, BSEFO: 12, MCXFO: 51 };

// Which F&O master file (segment label used in the /instruments/master call)
// and which numeric segment (for quote calls) each app symbol's options live in.
export const UNDERLYING_FO = {
  NIFTY: { segmentLabel: "NSEFO", segmentNum: SEGMENT_NUM.NSEFO, name: "NIFTY" },
  BANKNIFTY: { segmentLabel: "NSEFO", segmentNum: SEGMENT_NUM.NSEFO, name: "BANKNIFTY" },
  FINNIFTY: { segmentLabel: "NSEFO", segmentNum: SEGMENT_NUM.NSEFO, name: "FINNIFTY" },
  MIDCPNIFTY: { segmentLabel: "NSEFO", segmentNum: SEGMENT_NUM.NSEFO, name: "MIDCPNIFTY" },
  SENSEX: { segmentLabel: "BSEFO", segmentNum: SEGMENT_NUM.BSEFO, name: "SENSEX" },
};

// Index-spot lookup: which indexlist segment to query (1=NSE, 11=BSE) and the
// raw broker index name to match against — both taken verbatim from
// openalgo's process_index_data() nse_index_map (the one broker-side mapping
// table that happens to already use this app's exact 5 symbol names).
export const INDEX_SPOT = {
  NIFTY: { segmentNum: SEGMENT_NUM.NSECM, rawName: "NIFTY 50" },
  BANKNIFTY: { segmentNum: SEGMENT_NUM.NSECM, rawName: "NIFTY BANK" },
  FINNIFTY: { segmentNum: SEGMENT_NUM.NSECM, rawName: "NIFTY FIN SERVICE" },
  MIDCPNIFTY: { segmentNum: SEGMENT_NUM.NSECM, rawName: "NIFTY MID SELECT" },
  SENSEX: { segmentNum: SEGMENT_NUM.BSECM, rawName: "SENSEX" },
};

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

// IST-safe calendar-date formatter — used only for the epoch/generic-Date
// fallback branches below. Contract expiries are exchange (NSE/BSE, i.e.
// IST) calendar dates; reading a Date object's *UTC* fields instead (as this
// used to) silently shifts the date back a day for any epoch/timestamp that
// encodes IST midnight (18:30 UTC the day before) — matches the IST-safe
// fallback already used by this registry's jainamxtsInstruments.mjs /
// wisdomInstruments.mjs siblings.
const IST_DATE_FORMATTER = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" });
function isoInIST(d) {
  return IST_DATE_FORMATTER.format(d);
}

/**
 * Parses XTS's ContractExpiration field to "YYYY-MM-DD". The exact wire
 * format isn't documented publicly (openalgo just hands it to pandas'
 * auto-inferring to_datetime), so this handles the formats XTS-family
 * brokers are known to emit: epoch ms/sec, "DD-MMM-YYYY", or an ISO-ish
 * string — unverified against a live response, best-effort.
 */
export function parseExpiryToISO(raw) {
  if (raw == null || raw === "") return null;
  const s = String(raw).trim();

  if (/^\d{10,13}$/.test(s)) {
    const ms = s.length === 13 ? Number(s) : Number(s) * 1000;
    const d = new Date(ms);
    if (!isNaN(d.getTime())) return isoInIST(d);
  }

  const m = s.match(/^(\d{1,2})[-\/ ]([A-Za-z]{3})[-\/ ](\d{2,4})/);
  if (m) {
    const day = m[1].padStart(2, "0");
    const monIdx = MONTHS.indexOf(m[2].toUpperCase());
    if (monIdx !== -1) {
      let year = m[3];
      if (year.length === 2) year = (Number(year) < 70 ? "20" : "19") + year;
      return `${year}-${String(monIdx + 1).padStart(2, "0")}-${day}`;
    }
  }

  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);

  const d = new Date(s);
  if (!isNaN(d.getTime())) return isoInIST(d);
  return null;
}

async function downloadFOMaster(segmentLabel) {
  console.log(`[ibulls] downloading instrument master for ${segmentLabel}`);
  const res = await fetch(`${MARKET_DATA_URL}/instruments/master`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ exchangeSegmentList: [segmentLabel] }),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.result) {
    throw new Error(`IndiaBulls instrument master download failed for ${segmentLabel} [${res.status}]`);
  }

  // Raw response: newline-separated rows, pipe-separated fields, no header row.
  // F&O column order (confirmed from openalgo's headers_fo used to label this
  // exact response before writing it to CSV):
  //   0 ExchangeSegment, 1 ExchangeInstrumentID, 2 InstrumentType, 3 Name,
  //   4 Description, ..., 12 LotSize, ..., 16 ContractExpiration,
  //   17 StrikePrice, 18 OptionType (1=FUT, 3=CE, 4=PE), ...
  const rows = [];
  for (const line of json.result.split("\n")) {
    if (!line.trim()) continue;
    const f = line.split("|");
    if (f.length < 19) continue;
    const optionType = f[18];
    if (optionType !== "3" && optionType !== "4") continue; // options only, skip futures
    const expiryISO = parseExpiryToISO(f[16]);
    const strike = Number(f[17]);
    if (!expiryISO || !Number.isFinite(strike)) continue;
    rows.push({
      token: Number(f[1]) || f[1],
      name: f[3],
      expiry: expiryISO,
      strike,
      type: optionType === "3" ? "ce" : "pe",
      lotSize: Number(f[12]) || 0,
    });
  }
  return rows;
}

/** All option rows (CE+PE, every expiry) for one XTS F&O segment. Cached once/day, shared across users. */
async function getFOMaster(segmentLabel) {
  return getCachedOrFetch(`ibulls:master:${segmentLabel}`, () => downloadFOMaster(segmentLabel), ONE_DAY_MS);
}

/** All CE/PE rows for a given app symbol, across all expiries. */
export async function getOptionRows(symbol) {
  const cfg = UNDERLYING_FO[symbol];
  if (!cfg) throw new Error(`Unknown symbol for IndiaBulls: ${symbol}`);
  const rows = await getFOMaster(cfg.segmentLabel);
  return rows.filter((r) => r.name === cfg.name).map((r) => ({ ...r, segmentNum: cfg.segmentNum }));
}

/** Distinct ascending ISO expiry dates. */
export function listExpiries(rows) {
  return Array.from(new Set(rows.map((r) => r.expiry))).sort();
}

async function downloadIndexList(segmentNum) {
  console.log(`[ibulls] downloading index list for segment ${segmentNum}`);
  const res = await fetch(`${MARKET_DATA_URL}/instruments/indexlist?exchangeSegment=${segmentNum}`, {
    headers: { "Content-Type": "application/json" },
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.result?.indexList) {
    throw new Error(`IndiaBulls index list download failed for segment ${segmentNum} [${res.status}]`);
  }
  // Each entry is "NAME_TOKEN" (name may contain spaces, never underscores).
  return json.result.indexList.map((entry) => {
    const idx = entry.lastIndexOf("_");
    return { name: entry.slice(0, idx).trim().toUpperCase(), token: entry.slice(idx + 1) };
  });
}

async function getIndexList(segmentNum) {
  return getCachedOrFetch(`ibulls:indexlist:${segmentNum}`, () => downloadIndexList(segmentNum), ONE_DAY_MS);
}

/** Resolves {segmentNum, token} for an underlying's live index-spot quote, or null if not found. */
export async function getIndexSpotToken(symbol) {
  const cfg = INDEX_SPOT[symbol];
  if (!cfg) return null;
  const list = await getIndexList(cfg.segmentNum);
  const match = list.find((e) => e.name === cfg.rawName.toUpperCase());
  return match ? { segmentNum: cfg.segmentNum, token: Number(match.token) || match.token } : null;
}
