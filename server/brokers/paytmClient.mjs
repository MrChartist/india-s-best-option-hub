/**
 * Paytm Money Open API: REST transport and date helpers.
 *
 * Official docs: https://developer.paytmmoney.com/docs/api/ (pages cited by slug below).
 *  - login: https://login.paytmmoney.com/merchant-login?apiKey={api_key}&state={state_key} redirects to
 *    the app's registered return URL with ?request_token=...
 *  - generate-access-token: POST /accounts/v2/gettoken {api_key, api_secret_key, request_token} ->
 *    {access_token, public_access_token, read_access_token}. "Generated Access token will be valid till
 *    midnight 12 for the day." The redirect needs a return URL registered on the user's own app, so the
 *    user runs it and pastes the access_token (auth.kind apiKeyToken).
 *  - Every call sends `x-jwt-token: <access_token>`. Most read APIs also accept the read_access_token;
 *    orders need the access_token. The WebSocket needs the public_access_token, which this app does not
 *    store, so no feed is declared.
 *  - Error body (live-market-data-api): {"status":401,"message":"Invalid Access Token","error_code":
 *    "PM_OPEN_API_0001"}; 400 PM_OPEN_API_400, 403 PM_OPEN_API_403, 500 PM_OPEN_API_500. Order APIs answer
 *    {"status":"success"|..., "message", "error_code"}. No rate limit is documented.
 * The token is never logged or put into an error message.
 */

import { BrokerError, brokerFetch, SessionRequiredError } from "./contract.mjs";

export const PAYTM_BASE = "https://developer.paytmmoney.com";
const LABEL = "Paytm Money";

export function requireToken(creds) {
  const token = String(creds?.accessToken ?? "").trim();
  if (!token) throw new SessionRequiredError(`${LABEL}: today's access token is missing. Complete the Paytm Money login and paste the access_token in Broker Settings.`);
  return token;
}

function messageOf(json, text) {
  const m = json?.message ?? json?.meta?.displayMessage ?? json?.meta?.message ?? (Array.isArray(json?.errors) ? json.errors.map((e) => e?.message).join("; ") : "");
  const code = json?.error_code ?? json?.meta?.code;
  return `${String(m || text || "").replace(/\s+/g, " ").slice(0, 200)}${code ? ` (${code})` : ""}`;
}

/** One authenticated Paytm Money call. `path` includes its query string. Returns the parsed JSON. */
export async function paytmRequest(creds, method, path, body) {
  const token = requireToken(creds);
  const headers = { "x-jwt-token": token, Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const route = path.split("?")[0];
  let res;
  try {
    res = await brokerFetch(`${PAYTM_BASE}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch (e) {
    throw new BrokerError(`${LABEL}: network error on ${route} (${e?.message || e})`);
  }
  const text = await res.text().catch(() => "");
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON error page */ }

  if (res.status === 401 || res.status === 403) {
    throw new SessionRequiredError(`${LABEL} refused the access token [${res.status}]${json ? `: ${messageOf(json, "")}` : ""}. Paste today's access_token (not the read or public token) in Broker Settings.`);
  }
  if (res.status === 429) throw new BrokerError(`${LABEL} rate limit hit [429] on ${route}`, { code: "UPSTREAM_RATE_LIMIT" });
  if (!res.ok) throw new BrokerError(`${LABEL} API error [${res.status}] on ${route}: ${messageOf(json, text)}`);
  const st = typeof json?.status === "string" ? json.status.toLowerCase() : "";
  if (st && st !== "success") throw new BrokerError(`${LABEL} API error on ${route}: ${messageOf(json, "")}`);
  if (Array.isArray(json?.errors) && json.errors.length) throw new BrokerError(`${LABEL} API error on ${route}: ${messageOf(json, "")}`);
  return json;
}

export const paytmGet = (path, creds) => paytmRequest(creds, "GET", path);

/** "YYYY-MM-DD" -> "DD-MM-YYYY" (option-chain `expiry` parameter). */
export function isoToPaytmDate(iso) {
  const [y, m, d] = String(iso).split("-");
  return `${d}-${m}-${y}`;
}

/**
 * Expiry shapes -> "YYYY-MM-DD" (IST):
 *  epoch ms (option-chain/config `expires`), "DD-MM-YYYY", "YYYY-MM-DD HH:MM:SS" (security master),
 *  "2023-02-23T00:00:00" (option-chain rows).
 */
export function toIsoDate(value) {
  if (typeof value === "number" || /^\d{12,13}$/.test(String(value))) {
    return new Date(Number(value) + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
  }
  const s = String(value ?? "").trim();
  const ddmmyyyy = s.match(/^(\d{2})-(\d{2})-(\d{4})/);
  if (ddmmyyyy) return `${ddmmyyyy[3]}-${ddmmyyyy[2]}-${ddmmyyyy[1]}`;
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : "";
}

/** "2023-01-31 18:17:25" | "31-07-2019 14:55:00" (IST) -> ISO with +05:30; other strings pass through. */
export function istTimestamp(value) {
  const s = String(value ?? "").trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/);
  if (m) return m[1] === "0001" ? null : `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}+05:30`;
  m = s.match(/^(\d{2})-(\d{2})-(\d{4})[ T](\d{2}):(\d{2}):(\d{2})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}:${m[6]}+05:30`;
  return s || null;
}
