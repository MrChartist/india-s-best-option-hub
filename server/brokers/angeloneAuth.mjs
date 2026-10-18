/**
 * Angel One (SmartAPI) authentication — session login (contract auth.kind "sessionLogin").
 *
 * Official docs: https://smartapi.angelone.in/docs (User / Exceptions / RateLimit pages, checked 2026-10).
 * SmartAPI has no paste-a-token model: POST /rest/auth/angelbroking/user/v1/loginByPassword with
 * { clientcode, password (the account PIN/MPIN), totp } returns { jwtToken, refreshToken, feedToken }.
 * The user types the PIN and the current 6-digit TOTP code in Broker Settings; login() runs once and
 * only the returned tokens are kept (by the browser's credential store, sent back as sessionToken /
 * feedToken / refreshToken). The JWT dies at IST midnight, after which calls throw
 * SessionRequiredError and the user logs in again. Nothing here stores, caches or logs the PIN or code.
 *
 * Every call sends the documented header set: Authorization: Bearer <jwt>, X-PrivateKey: <api key>,
 * X-UserType USER, X-SourceID WEB, X-ClientLocalIP, X-ClientPublicIP, X-MACAddress.
 * Rate limits (RateLimit page): loginByPassword 1/s, getProfile 3/s, getRMS 2/s, order book / trade book /
 * positions / holdings 1/s, quote 10/s (the Market Data page says 1/s for 50-token calls, so callers here
 * pace quotes at 1/s), getCandleData 3/s, optionGreek 1/s, place/modify/cancel 9/s combined.
 */

import { BrokerError, brokerFetch, SessionRequiredError } from "./contract.mjs";
import { nextIstMidnightMs, readTotpCode, requireFields, sessionFromCreds } from "./sessionLogin.mjs";

const AUTH_BASE = "https://apiconnect.angelone.in";
const LOGIN_PATH = "/rest/auth/angelbroking/user/v1/loginByPassword";
export const PROFILE_PATH = "/rest/secure/angelbroking/user/v1/getProfile";

export const LOGIN_FIELDS = [
  { key: "password", label: "PIN / MPIN", kind: "secret" },
  { key: "totpCode", label: "6-digit TOTP code", kind: "totp" },
];
export const SESSION_FIELDS = ["sessionToken", "feedToken", "refreshToken"];

function commonHeaders(apiKey) {
  return {
    "Content-Type": "application/json",
    "Accept": "application/json",
    "X-UserType": "USER",
    "X-SourceID": "WEB",
    "X-ClientLocalIP": "127.0.0.1",
    "X-ClientPublicIP": "127.0.0.1",
    "X-MACAddress": "AA:BB:CC:DD:EE:FF",
    "X-PrivateKey": apiKey,
  };
}

/** One login with the user-typed PIN + current TOTP code. Returns only the session tokens. */
export async function login(creds) {
  requireFields(creds, ["apiKey", "clientId", "password"], "Angel One");
  const totp = readTotpCode(creds);
  const res = await brokerFetch(`${AUTH_BASE}${LOGIN_PATH}`, {
    method: "POST",
    headers: commonHeaders(creds.apiKey),
    body: JSON.stringify({ clientcode: creds.clientId, password: creds.password, totp }),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.status || !json?.data?.jwtToken) {
    const code = json?.errorcode ? ` (${json.errorcode})` : "";
    throw new BrokerError(`Angel One login failed${code}: ${json?.message || `HTTP ${res.status}`}`, { code: "UPSTREAM_AUTH" });
  }
  const session = { sessionToken: String(json.data.jwtToken) };
  if (json.data.feedToken) session.feedToken = String(json.data.feedToken);
  if (json.data.refreshToken) session.refreshToken = String(json.data.refreshToken);
  return { session, expiresAt: nextIstMidnightMs() };
}

/** The stored session ({ jwtToken }). Throws SessionRequiredError when absent or expired. */
export function getSession(creds) {
  requireFields(creds, ["apiKey", "clientId"], "Angel One");
  return { jwtToken: sessionFromCreds(creds, SESSION_FIELDS, "Angel One").sessionToken };
}

function isRateLimitBody(text) {
  const lowered = (text || "").toLowerCase();
  return lowered.includes("exceeding") || lowered.includes("access rate") || lowered.includes("rate limit");
}

/**
 * Authenticated call against apiconnect.angelone.in (`body === undefined` means GET). A genuine auth
 * 401/403 (body does NOT mention rate limiting) means the session is dead: SessionRequiredError, so the
 * user logs in again (there is no stored secret to re-login with). A rate-limit answer becomes
 * UPSTREAM_RATE_LIMIT and is never retried here.
 */
export async function authFetch(creds, path, body) {
  const session = getSession(creds);
  const res = await brokerFetch(`${AUTH_BASE}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { ...commonHeaders(creds.apiKey), Authorization: `Bearer ${session.jwtToken}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-JSON error body */ }

  if ((res.status === 401 || res.status === 403) && !isRateLimitBody(text)) {
    throw new SessionRequiredError("Angel One rejected the session. Log in again from Broker Settings.");
  }
  if (res.status === 429 || (res.status === 403 && isRateLimitBody(text))) {
    throw new BrokerError(`Angel One API rate limit exceeded on ${path}`, { code: "UPSTREAM_RATE_LIMIT" });
  }
  if (!res.ok) {
    throw new BrokerError(`Angel One API error [${res.status}] on ${path}: ${String(json?.message || text).slice(0, 200)}`);
  }
  // Documented SmartAPI token errors arrive as HTTP 200 + status:false: AG8001 invalid, AG8002 expired, AG8003 missing.
  // Seen with both casings in the wild (errorcode / errorCode, status / success).
  const failed = json && (json.status === false || json.success === false);
  const errCode = String(json?.errorcode ?? json?.errorCode ?? "");
  if (failed && /^AG800[123]$/.test(errCode)) {
    throw new SessionRequiredError("Angel One session expired. Log in again from Broker Settings.");
  }
  if (failed) {
    throw new BrokerError(`Angel One API error on ${path}${errCode ? ` (${errCode})` : ""}: ${json.message || "unknown"}`);
  }
  return json;
}
