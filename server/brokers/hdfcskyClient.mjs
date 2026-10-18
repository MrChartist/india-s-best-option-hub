/**
 * HDFC Sky Open API: REST transport, auth headers, client id and the LTP batch call.
 *
 * Official docs: https://developer.hdfcsky.com/sky-docs/docs/intro (pages cited below).
 *  - Login (fetch_access_token_via_api/*, token_id_fe): GET /oapi/v1/login?api_key -> HDFC Sky login,
 *    OTP and PIN screens -> redirect with a request token -> POST /oapi/v1/access-token?api_key&
 *    request_token with {"apiSecret"} -> {"accessToken": "<JWT>"}. The OTP is sent only after the
 *    password step, so a one-shot session login is not possible; auth.kind is apiKeyToken (the user
 *    pastes today's access token).
 *  - Every call: `Authorization: <access_token>` (no "Bearer"), the docs' sample `User-Agent` and `api_key`
 *    as a query parameter. Account-scoped calls also take `client_id` (profile, funds, positions,
 *    holdings, orders, trades). The client id is the access token's JWT `sub` claim, read here so the
 *    user does not have to type it (the docs' sample token carries "sub":"S0190007").
 *  - Error body: {"status":"error","message","error_code":40000|44000|45010,"data":{}} (profile,
 *    positions, orders pages). HTTP codes per error_structure: 400, 401, 403, 404, 422, 5xx.
 *  - fetchltp: PUT /oapi/v1/fetch-ltp, body {"data":[{"exchange","token"}]}, response {"data":[{"prev_close",
 *    "ltp","exchange","token"}]}. Indices are addressed as NSE_INDEX / BSE_INDEX and derivatives as
 *    NFO / BFO (the security master's own exchange codes). A hard cap of 10 instruments per
 *    call (HTTP 400 above that) has been observed but is not in the official docs (needs live verification), so
 *    batches stay at 10.
 * Never log the token or api key; the URL carries the api key, so it never goes into an error message.
 */

import { BrokerError, brokerFetch, BrokerInputError, SessionRequiredError } from "./contract.mjs";
import { decodeJwtPayload } from "../lib/jwt.mjs";

export const BASE_URL = "https://developer.hdfcsky.com";
export const WS_URL = "wss://developer.hdfcsky.com/wsapi/v1/session";
export const LTP_BATCH_SIZE = 10;
export const LTP_BATCH_DELAY_MS = 200;

// Every request sample on the HDFC Sky docs (e.g. https://developer.hdfcsky.com/sky-docs/docs/fetchltp, "Headers" and
// "Request Curl") carries this browser User-Agent, so the proxy sends the same string on each call.
export const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36";

const LABEL = "HDFC Sky";

export function requireCreds(creds) {
  const apiKey = String(creds?.apiKey ?? "").trim();
  const accessToken = String(creds?.accessToken ?? "").trim();
  if (!apiKey || !accessToken) {
    throw new SessionRequiredError(`${LABEL}: the API key or today's access token is missing. Complete the HDFC Sky login and paste the access token in Broker Settings.`);
  }
  return { apiKey, accessToken };
}

const CLIENT_ID_RE = /^[A-Za-z0-9@._-]{1,64}$/;

/**
 * Account id for the account-scoped endpoints. HDFC Sky does not return it at login, but the access token is a JWT
 * and the docs' sample token names the account in `sub`, so it is read from there. "" when it cannot be read.
 */
export function getClientId(creds) {
  const sub = decodeJwtPayload(creds?.accessToken)?.sub;
  return typeof sub === "string" && CLIENT_ID_RE.test(sub) ? sub : "";
}

export function requireClientId(creds) {
  requireCreds(creds);
  const id = getClientId(creds);
  if (!id) throw new BrokerInputError(`${LABEL}: could not read the client id from the access token. Paste the accessToken exactly as HDFC Sky returned it.`);
  return id;
}

export function wsUrl(creds) {
  const { apiKey, accessToken } = requireCreds(creds);
  const url = new URL(WS_URL);
  url.searchParams.set("token", accessToken);
  url.searchParams.set("api_key", apiKey);
  return url.toString();
}

function messageOf(json, text) {
  const m = json?.message ?? json?.error ?? json?.meta?.displayMessage ?? json?.meta?.statusMsg;
  const code = json?.error_code ? ` (${json.error_code})` : "";
  return `${String(m || text || "").replace(/\s+/g, " ").slice(0, 200)}${code}`;
}

/** Header set the docs' samples use: the raw access token (no "Bearer"), the sample User-Agent, JSON in and out. */
function skyHeaders(accessToken, withBody) {
  return {
    Accept: "application/json",
    "User-Agent": USER_AGENT,
    Authorization: accessToken,
    ...(withBody ? { "Content-Type": "application/json" } : {}),
  };
}

/** One authenticated HDFC Sky call; returns the parsed JSON body. */
export async function skyRequest(creds, method, path, { params = {}, body } = {}) {
  const { apiKey, accessToken } = requireCreds(creds);
  const url = new URL(`${BASE_URL}${path}`);
  url.searchParams.set("api_key", apiKey);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  const hasBody = body !== undefined;

  let res;
  try {
    res = await brokerFetch(url.toString(), { method, headers: skyHeaders(accessToken, hasBody), body: hasBody ? JSON.stringify(body) : undefined });
  } catch (e) {
    throw new BrokerError(`${LABEL}: network error on ${path} (${e?.message || e})`);
  }
  const text = await res.text().catch(() => "");
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON error page */ }

  if (res.status === 401 || res.status === 403) {
    throw new SessionRequiredError(`${LABEL} rejected the access token [${res.status}]. Log in on HDFC Sky again and paste a fresh access token in Broker Settings.`);
  }
  if (res.status === 429) throw new BrokerError(`${LABEL} rate limit hit [429] on ${path}`, { code: "UPSTREAM_RATE_LIMIT" });
  if (!res.ok) throw new BrokerError(`${LABEL} API error [${res.status}] on ${path}: ${messageOf(json, text)}`);
  if (json && json.status === "error") {
    // 40000 "Request forbidden" / "Request Unauthorised" is the docs' token-rejection answer.
    if (Number(json.error_code) === 40000) throw new SessionRequiredError(`${LABEL} refused the request (${messageOf(json, "")}). Paste a fresh access token in Broker Settings.`);
    throw new BrokerError(`${LABEL} API error on ${path}: ${messageOf(json, "")}`);
  }
  return json;
}

/** PUT /oapi/v1/fetch-ltp for up to 10 instruments. Returns Map<"EXCH:token", { ltp, prevClose }>. */
export async function fetchLtpBatch(creds, instruments) {
  const out = new Map();
  if (!instruments.length) return out;
  if (instruments.length > LTP_BATCH_SIZE) throw new Error(`fetchLtpBatch takes at most ${LTP_BATCH_SIZE} instruments`);
  const json = await skyRequest(creds, "PUT", "/oapi/v1/fetch-ltp", { body: { data: instruments.map((i) => ({ exchange: i.exchange, token: String(i.token) })) } });
  for (const row of Array.isArray(json?.data) ? json.data : []) {
    const ltp = Number(row?.ltp);
    out.set(`${String(row?.exchange ?? "").toUpperCase()}:${String(row?.token ?? "")}`, { ltp: Number.isFinite(ltp) ? ltp : 0, prevClose: Number(row?.prev_close) || 0 });
  }
  return out;
}
