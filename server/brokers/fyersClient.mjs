/**
 * Fyers API v3 — shared HTTP client, error mapping and small value helpers.
 *
 * Facts below are from Fyers' official v3 docs (https://fyers.in/api-docs/v3/, "API Standards",
 * "Authentication", "Appendix", "Plans & Rate Limits", checked 2026-10):
 *  - Every authenticated request carries `Authorization: <app_id>:<access_token>` (colon-joined, no
 *    "Bearer"). Tokens expire daily at 6:30 AM IST.
 *  - Envelope: { s: "ok"|"error", code, message, ...payload }. Expired/invalid token -> code -8, -15,
 *    -16 or -17 (HTTP 401). Rate limit -> HTTP 429 / code -429 (or -360 on the Standard plan).
 *  - Standard plan Data APIs: 5 req/s, 50 req/min, 5,000 req/day; Transaction + User Info APIs:
 *    10 req/s, 200 req/min. Exceeding the per-minute limit more than 3 times a day blocks the user for
 *    the rest of the day, so callers here never retry on a rate-limit error.
 *
 * Never log or echo the access token or app secret; messages carry only paths and broker codes.
 */

import { BrokerError, brokerFetch, normaliseError as baseNormalise, SessionRequiredError } from "./contract.mjs";

export const FYERS_HOST = "https://api-t1.fyers.in";

const SESSION_CODES = new Set([-8, -15, -16, -17]);
const RATE_CODES = new Set([-429, -360]);
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

/** `<appId>:<accessToken>`. A missing token means the user has not logged in today. */
export function authHeader(creds) {
  const appId = String(creds?.appId ?? "").trim();
  const accessToken = String(creds?.accessToken ?? "").trim();
  if (!appId || !accessToken) {
    throw new SessionRequiredError("Fyers: App ID or today's access token is missing. Log in on Fyers and paste a fresh access token in Broker Settings.");
  }
  return `${appId}:${accessToken}`;
}

/** Turn a Fyers failure (HTTP status + {s, code, message}) into the contract error classes. */
export function fyersError(status, json, path) {
  const code = Number(json?.code);
  const msg = String(json?.message || "").slice(0, 200);
  if (status === 401 || SESSION_CODES.has(code)) {
    return new SessionRequiredError("Fyers rejected the access token (it expires daily at 6:30 AM). Log in on Fyers and paste a fresh token in Broker Settings.");
  }
  if (status === 429 || RATE_CODES.has(code)) {
    return new BrokerError(`Fyers rate limit reached on ${path}. Wait a minute before retrying.`, { code: "UPSTREAM_RATE_LIMIT" });
  }
  return new BrokerError(`Fyers API error on ${path}${Number.isFinite(code) ? ` (code ${code})` : ""}${msg ? `: ${msg}` : ` [HTTP ${status}]`}`);
}

/**
 * One authenticated call. `query` is appended as a URL query string, `body` is sent as JSON.
 * Resolves to the parsed body when `s === "ok"`, otherwise throws (never retries).
 */
export async function fyersRequest(creds, path, { method = "GET", query, body } = {}) {
  const auth = authHeader(creds);
  const qs = query ? `?${new URLSearchParams(query).toString()}` : "";
  const res = await brokerFetch(`${FYERS_HOST}${path}${qs}`, {
    method,
    headers: { Authorization: auth, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { /* non-JSON error page */ }
  if (!res.ok || !json || json.s !== "ok") throw fyersError(res.status, json, path);
  return json;
}

/** Contract normaliser: the shared one already keeps our 422/502 codes and redacts secrets. */
export function normaliseError(err, opts = {}) {
  return baseNormalise(err, opts);
}

// ── value helpers ──

export const num = (v) => {
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};
export const numOrNull = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
};

/** Epoch seconds -> IST calendar date "YYYY-MM-DD" (Fyers expiry epochs are 15:30/15:40 IST). */
export function epochToIstDate(epochSec) {
  const n = Number(epochSec);
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Date(n * 1000 + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** "24-03-2026" -> "2026-03-24" (expiryData.date is documented as DD-MM-YYYY). */
export function ddmmyyyyToIso(s) {
  const m = /^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec(String(s ?? "").trim());
  return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : null;
}

/**
 * Fyers order/trade timestamps: "02-Aug-2023 13:01:42" (sample) or "02-08-2023 13:01:42" (as the trade
 * book table describes it), both IST. Returns an ISO string with +05:30, or the raw value if unparseable.
 */
export function fyersTimeToIso(s) {
  const raw = String(s ?? "").trim();
  if (!raw) return null;
  const m = /^(\d{1,2})-([A-Za-z]{3}|\d{1,2})-(\d{4})\s+(\d{2}):(\d{2}):(\d{2})$/.exec(raw);
  if (!m) return raw;
  const month = /^\d+$/.test(m[2]) ? Number(m[2]) : MONTHS.indexOf(m[2].toUpperCase()) + 1;
  if (month < 1 || month > 12) return raw;
  return `${m[3]}-${String(month).padStart(2, "0")}-${m[1].padStart(2, "0")}T${m[4]}:${m[5]}:${m[6]}+05:30`;
}

/**
 * Contract exchange for a Fyers row. Ticker prefix (NSE:/BSE:/MCX:) plus the documented segment code
 * (10 capital market, 11 equity derivatives, 12 currency derivatives, 20 commodity).
 */
export function contractExchange(ticker, segment) {
  const prefix = String(ticker ?? "").split(":")[0].toUpperCase();
  const seg = Number(segment);
  if (prefix === "MCX" || seg === 20) return "MCX";
  if (seg === 12) return "CDS";
  const derivative = seg === 11 || (!Number.isFinite(seg) && /(CE|PE|FUT)$/.test(String(ticker)));
  if (prefix === "BSE") return derivative ? "BFO" : "BSE";
  return derivative ? "NFO" : "NSE";
}

/** Fyers productType -> app vocabulary (CNC, INTRADAY, MARGIN, MTF, CO, BO). */
export function contractProduct(p) {
  const v = String(p ?? "").toUpperCase();
  return ["CNC", "INTRADAY", "MARGIN", "MTF", "CO", "BO"].includes(v) ? v : "INTRADAY";
}

export function tradingSymbolOf(ticker) {
  const s = String(ticker ?? "");
  const i = s.indexOf(":");
  return i >= 0 ? s.slice(i + 1) : s;
}
