/**
 * Zerodha Kite Connect v3 HTTP client shared by the zerodha*.mjs modules.
 *
 * Official docs (October 2026): https://kite.trade/docs/connect/v3/
 *  - Signing (user/): every request carries `X-Kite-Version: 3` and
 *    `Authorization: token <api_key>:<access_token>`.
 *  - Errors (exceptions/): JSON { status: "error", message, error_type } with HTTP 400/403/429/5xx.
 *    TokenException (403) = session expired or invalidated; the user must log in again.
 *  - Rate limits (exceptions/): quote 1 req/s, historical 3 req/s, orders 10 req/s, everything else 10 req/s.
 *
 * Errors become KiteApiError (a 502 BrokerError, "the upstream refused") with a contract code:
 * UPSTREAM_AUTH for TokenException/403, UPSTREAM_RATE_LIMIT for 429, UPSTREAM_INPUT for InputException,
 * UPSTREAM_ERROR otherwise. Kite's error messages never contain the token; we add no credential to them.
 */

import { BrokerError, brokerFetch, BrokerInputError } from "./contract.mjs";

export const KITE_BASE = "https://api.kite.trade";
export const KITE_LOGIN_URL = "https://kite.zerodha.com/connect/login";

export class KiteApiError extends BrokerError {
  constructor(message, { httpStatus = 0, errorType = "", code } = {}) {
    super(message, { code: code ?? codeFor(httpStatus, errorType), statusCode: 502 });
    this.name = "KiteApiError";
    this.httpStatus = httpStatus;
    this.errorType = errorType;
  }
}

function codeFor(httpStatus, errorType) {
  if (httpStatus === 403 || errorType === "TokenException") return "UPSTREAM_AUTH";
  if (httpStatus === 429) return "UPSTREAM_RATE_LIMIT";
  if (errorType === "InputException") return "UPSTREAM_INPUT";
  return "UPSTREAM_ERROR";
}

/** Authorization + version headers. Throws (422) before any call when the key or token is missing. */
export function authHeaders(creds) {
  if (!creds?.apiKey || !creds?.accessToken) {
    throw new BrokerInputError("Zerodha: API key and access token are required. Paste both in Broker Settings.");
  }
  return { Authorization: `token ${creds.apiKey}:${creds.accessToken}`, "X-Kite-Version": "3" };
}

function toForm(obj) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(obj || {})) if (v !== undefined && v !== null) params.append(k, String(v));
  return params;
}

/**
 * Call a Kite endpoint and return `data` from the success envelope.
 * @param {string} path  e.g. "/quote"
 * @param {object} creds { apiKey, accessToken }
 * @param {{ method?: string, query?: Array<[string, string]>, form?: object, raw?: boolean, auth?: boolean }} opts
 *   raw: return the Response text (CSV endpoints). auth=false: no Authorization header (session/token).
 */
export async function kiteFetch(path, creds, { method = "GET", query, form, raw = false, auth = true } = {}) {
  const url = new URL(`${KITE_BASE}${path}`);
  for (const [k, v] of query ?? []) url.searchParams.append(k, v);
  const headers = auth ? authHeaders(creds) : { "X-Kite-Version": "3" };
  if (form) headers["Content-Type"] = "application/x-www-form-urlencoded";
  const res = await brokerFetch(url.toString(), { method, headers, body: form ? toForm(form).toString() : undefined });
  if (raw && res.ok) return res.text();
  const text = await res.text().catch(() => "");
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  if (!res.ok || !json || json.status !== "success") {
    const errorType = String(json?.error_type ?? "");
    const detail = json?.message || text.slice(0, 200) || `HTTP ${res.status}`;
    const hint = res.status === 403 || errorType === "TokenException"
      ? " Generate a fresh access token (Kite tokens expire at 6 AM IST) and paste it in Broker Settings."
      : "";
    throw new KiteApiError(`Zerodha API error [${res.status}${errorType ? ` ${errorType}` : ""}]: ${detail}.${hint}`, { httpStatus: res.status, errorType });
  }
  return json.data;
}
