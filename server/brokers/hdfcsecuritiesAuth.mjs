/**
 * HDFC Securities (InvestRight Open API): REST transport, auth headers and the LTP batch call.
 *
 * Official docs (https://developer.hdfcsec.com/ir-docs/docs/intro and the pages linked below):
 *  - Login (fetch_access_token_via_api/*, token_id_fe): GET /oapi/v1/login?api_key -> HDFC login, 2FA and
 *    consent -> redirect with a request token -> POST /oapi/v1/access-token?api_key&request_token with
 *    body {"apiSecret"} -> {"accessToken"}. The headless variant (login/validate with username+password,
 *    twofa/validate with an OTP sent by SMS/email, authorise) needs the OTP that HDFC sends only after
 *    the password step, so it cannot be done in one call. This adapter therefore keeps the paste-token
 *    model (auth.kind apiKeyToken): the user completes the login once and pastes the access token.
 *  - Every authenticated call: header `Authorization: <access_token>` (no "Bearer"), a non-empty
 *    `User-Agent` header, and `api_key` as a query parameter.
 *  - Errors (error_structure): 400, 401, 403, 404, 422, 5xx. The docs give no rate limit.
 *  - Token lifetime is not documented. A 401/403 is reported as SessionRequiredError so the user is
 *    asked to paste a fresh token (and the proxy serves no stale data meanwhile).
 *
 * fetch-ltp (docs/fetchltp): PUT /oapi/v1/fetch-ltp?api_key, body {"data":[{"exchange","token"}]},
 * response {"data":[{"prev_close","ltp","exchange","token"}], "meta":{...}}. The docs' sample only shows
 * NSE/BSE cash tokens. Derivatives and indices are addressed with the segment codes of the docs'
 * WebSocket prefix table (NFO, BFO, NSE_INDEX, BSE_INDEX); a derivative sent under its parent
 * exchange (NSE) has been observed to be silently dropped from the answer, which is the bug the previous
 * version of this adapter had for every option leg. A 10-instrument cap per call and BFO rows coming back
 * with an empty "exchange" have also been observed (not in the official docs); both are handled here and
 * need live checks.
 *
 * Never log the api key or token. The request URL carries the api key, so it is never put in an error.
 */

import { BrokerError, brokerFetch, SessionRequiredError } from "./contract.mjs";

export const ROOT_URL = "https://developer.hdfcsec.com";
export const WS_URL = "wss://developer.hdfcsec.com/wsapi/v1/session";
export const SECURITY_MASTER_URL = `${ROOT_URL}/oapi/v1/security-master`;
export const LTP_BATCH_SIZE = 10;
export const LTP_BATCH_DELAY_MS = 200;

// The docs' curl samples send a browser User-Agent; requests without one are rejected.
export const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36";

const LABEL = "HDFC Securities";

export function requireCreds(creds) {
  const apiKey = String(creds?.apiKey ?? "").trim();
  const accessToken = String(creds?.accessToken ?? "").trim();
  if (!apiKey || !accessToken) {
    throw new SessionRequiredError(`${LABEL}: the API key or today's access token is missing. Complete the InvestRight login and paste the access token in Broker Settings.`);
  }
  return { apiKey, accessToken };
}

export function wsUrl(creds) {
  const { apiKey, accessToken } = requireCreds(creds);
  const url = new URL(WS_URL);
  url.searchParams.set("token", accessToken);
  url.searchParams.set("api_key", apiKey);
  return url.toString();
}

function messageOf(json, text) {
  const m = json?.message ?? json?.error ?? json?.meta?.statusMsg ?? json?.meta?.displayMessage;
  return String(m || text || "").replace(/\s+/g, " ").slice(0, 200);
}

/**
 * One authenticated InvestRight call. Returns the parsed JSON body.
 * @param {"GET"|"POST"|"PUT"|"DELETE"} method
 */
export async function irRequest(creds, method, path, { params = {}, body } = {}) {
  const { apiKey, accessToken } = requireCreds(creds);
  const url = new URL(`${ROOT_URL}${path}`);
  url.searchParams.set("api_key", apiKey);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  const headers = { Authorization: accessToken, "User-Agent": USER_AGENT, Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";

  let res;
  try {
    res = await brokerFetch(url.toString(), { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch (e) {
    throw new BrokerError(`${LABEL}: network error on ${path} (${e?.message || e})`);
  }
  const text = await res.text().catch(() => "");
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON error page */ }

  if (res.status === 401 || res.status === 403) {
    throw new SessionRequiredError(`${LABEL} rejected the access token [${res.status}]. Log in on InvestRight again and paste a fresh access token in Broker Settings.`);
  }
  if (res.status === 429) throw new BrokerError(`${LABEL} rate limit hit [429] on ${path}`, { code: "UPSTREAM_RATE_LIMIT" });
  if (!res.ok) throw new BrokerError(`${LABEL} API error [${res.status}] on ${path}: ${messageOf(json, text)}`);
  if (json && json.status === "error") throw new BrokerError(`${LABEL} API error on ${path}: ${messageOf(json, "")}`);
  return json;
}

/**
 * PUT /oapi/v1/fetch-ltp for up to LTP_BATCH_SIZE instruments ({ exchange, token } with InvestRight
 * codes). Returns Map<"EXCH|token", { ltp, prevClose }>.
 */
export async function fetchLtpBatch(creds, instruments) {
  const out = new Map();
  if (!instruments.length) return out;
  if (instruments.length > LTP_BATCH_SIZE) throw new Error(`fetchLtpBatch takes at most ${LTP_BATCH_SIZE} instruments`);
  const json = await irRequest(creds, "PUT", "/oapi/v1/fetch-ltp", { body: { data: instruments.map((i) => ({ exchange: i.exchange, token: String(i.token) })) } });
  const requested = new Map();
  for (const i of instruments) {
    const set = requested.get(String(i.token)) ?? new Set();
    set.add(String(i.exchange).toUpperCase());
    requested.set(String(i.token), set);
  }
  for (const row of Array.isArray(json?.data) ? json.data : []) {
    const token = String(row?.token ?? "");
    let exchange = String(row?.exchange ?? "").toUpperCase();
    if (!exchange) {
      const asked = requested.get(token);
      if (!asked || asked.size !== 1) continue;
      [exchange] = asked;
    }
    const ltp = Number(row.ltp);
    out.set(`${exchange}|${token}`, { ltp: Number.isFinite(ltp) ? ltp : 0, prevClose: Number(row.prev_close) || 0 });
  }
  return out;
}

/** One cheap authenticated call: GET /oapi/v1/user/margins (docs/funds_and_margins). */
export async function testConnection(creds = {}) {
  try {
    const json = await irRequest(creds, "GET", "/oapi/v1/user/margins");
    if (json?.status && json.status !== "success") return { status: "error", message: `${LABEL} did not return a success status` };
    return { status: "success", message: "HDFC Securities (InvestRight) connected" };
  } catch (e) {
    return { status: "error", message: e?.message || String(e) };
  }
}
