/**
 * Upstox API HTTP client shared by the upstox*.mjs modules.
 *
 * Official docs (October 2026): https://upstox.com/developer/api-documentation/
 *  - Hosts: https://api.upstox.com (v2 and v3 REST) and https://api-hft.upstox.com (v3 order
 *    place/modify/cancel). Every call sends `Authorization: Bearer <access_token>` and
 *    `Accept: application/json`.
 *  - Errors (error-codes): { status: "error", errors: [{ errorCode, message, ... }] } with HTTP
 *    400/401/403/404/429/5xx. UDAPI100050 = invalid token, UDAPI100016 = invalid credentials,
 *    UDAPI10005 = too many requests, UDAPI100036/100038 = invalid input.
 *  - Rate limits (rate-limiting): standard APIs 50/s, 500/min, 2000/30 min; order APIs 10/s
 *    (regular algos), 500/min, 2000/30 min.
 *  - Access tokens expire at 3:30 AM IST the next day regardless of when they were issued.
 */

import { BrokerError, brokerFetch, BrokerInputError } from "./contract.mjs";

export const UPSTOX_API = "https://api.upstox.com";
export const UPSTOX_HFT = "https://api-hft.upstox.com";

const AUTH_CODES = new Set(["UDAPI100050", "UDAPI100016", "UDAPI100067", "UDAPI100073"]);
const INPUT_CODES = new Set(["UDAPI100036", "UDAPI100038", "UDAPI100011", "UDAPI1087", "UDAPI1088"]);

export class UpstoxApiError extends BrokerError {
  constructor(message, { httpStatus = 0, errorCode = "" } = {}) {
    let code = "UPSTREAM_ERROR";
    if (httpStatus === 401 || AUTH_CODES.has(errorCode)) code = "UPSTREAM_AUTH";
    else if (httpStatus === 429 || errorCode === "UDAPI10005") code = "UPSTREAM_RATE_LIMIT";
    else if (INPUT_CODES.has(errorCode)) code = "UPSTREAM_INPUT";
    super(message, { code, statusCode: 502 });
    this.name = "UpstoxApiError";
    this.httpStatus = httpStatus;
    this.errorCode = errorCode;
  }
}

export function bearer(creds) {
  if (!creds?.accessToken) throw new BrokerInputError("Upstox: access token is required. Paste it in Broker Settings.");
  return { Authorization: `Bearer ${creds.accessToken}`, Accept: "application/json" };
}

/**
 * Call an Upstox endpoint and return the parsed JSON envelope (status === "success").
 * @param {string} path "/v2/option/chain"
 * @param {{ method?: string, query?: Record<string,string>, json?: object, base?: string, auth?: boolean, form?: object }} opts
 */
export async function upstoxFetch(path, creds, { method = "GET", query, json, form, base = UPSTOX_API, auth = true } = {}) {
  const url = new URL(`${base}${path}`);
  for (const [k, v] of Object.entries(query ?? {})) url.searchParams.set(k, v);
  const headers = auth ? bearer(creds) : { Accept: "application/json" };
  let body;
  if (json) { headers["Content-Type"] = "application/json"; body = JSON.stringify(json); }
  else if (form) { headers["Content-Type"] = "application/x-www-form-urlencoded"; body = new URLSearchParams(form).toString(); }
  const res = await brokerFetch(url.toString(), { method, headers, body });
  const text = await res.text().catch(() => "");
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = null; }
  const ok = res.ok && parsed && (parsed.status === "success" || Array.isArray(parsed) || (auth === false && parsed.access_token));
  if (!ok) {
    const e = Array.isArray(parsed?.errors) ? parsed.errors[0] : null;
    const errorCode = String(e?.errorCode ?? e?.error_code ?? "");
    const detail = e?.message || parsed?.message || text.slice(0, 200) || `HTTP ${res.status}`;
    const hint = res.status === 401 || AUTH_CODES.has(errorCode)
      ? " Generate a fresh access token (Upstox tokens expire at 3:30 AM IST) and paste it in Broker Settings."
      : "";
    throw new UpstoxApiError(`Upstox API error [${res.status}${errorCode ? ` ${errorCode}` : ""}]: ${detail}.${hint}`, { httpStatus: res.status, errorCode });
  }
  return parsed;
}
