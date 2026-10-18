/**
 * IndMoney (INDstocks) session and paced REST client.
 *
 * Official docs: https://api-docs.indstocks.com/getting-started/ and the official Postman collection it
 * links (https://documenter.getpostman.com/view/56363899/2sBY4LShyj), checked 2026-10:
 *  - Every protected call: `Authorization: <access token>` (the raw token, NO "Bearer" prefix).
 *  - Tokens expire after 24 hours. Two ways to get one:
 *      1. Generate it on indstocks.com (API Trading > Access Tokens, static IP set up) and paste it.
 *      2. POST https://api.indstocks.com/generate/token with header `x-api-key: <Client ID>` (shown after
 *         TOTP setup) and body { mpin, totp } -> { token, expires_in } (expires_in is an epoch-seconds
 *         timestamp in the sample). Wrong/expired codes return 400 { message }.
 *  - Envelope: { status: "success", data } / { status: "error", message, error_type }. TokenException (403;
 *    401 in the profile sample) = token invalid/expired/revoked. The quote endpoints' 403 body is
 *    { message, success: false }.
 *  - Rate limits: Order APIs 10/s; Data/Quote APIs 5/s (100,000/day); Non-Trading 15/s (100,000/day).
 *
 * Path 2 is a session login (capabilities.auth.kind "sessionLogin"): the user types the MPIN and the
 * CURRENT 6-digit code in the Broker Settings "Log in" dialog; login() returns only { accessToken }. The
 * MPIN and code are never stored, cached, logged or retried. A pasted token (path 1) is used the same way.
 * Token rejection throws SessionRequiredError: the user logs in (or pastes) again; there is no auto re-login.
 */

import { BrokerError, brokerFetch, normaliseError as baseNormalise, redactSecrets, SessionRequiredError } from "./contract.mjs";
import { readTotpCode, requireFields, sessionFromCreds } from "./sessionLogin.mjs";

export const BASE_URL = "https://api.indstocks.com";
export const SESSION_FIELDS = ["accessToken"];
export const LOGIN_FIELDS = [
  { key: "mpin", label: "INDstocks MPIN", kind: "secret" },
  { key: "totpCode", label: "Current 6-digit code from your authenticator app", kind: "totp" },
];
const NAME = "IndMoney";
const DAY_MS = 24 * 60 * 60 * 1000;

/** The stored access token, or SessionRequiredError before any network call. */
export function sessionToken(creds) {
  return sessionFromCreds(creds, SESSION_FIELDS, NAME).accessToken;
}

/** `expires_in` from /generate/token: an epoch timestamp (s or ms) in the sample, else seconds to live. */
export function expiryFrom(expiresIn, now = Date.now()) {
  const v = Number(expiresIn);
  if (!Number.isFinite(v) || v <= 0) return now + DAY_MS - 60_000;
  if (v > 1e12) return v;
  if (v > 1e9) return v * 1000;
  return now + v * 1000;
}

/** Session login: Client ID (stored) + MPIN + current TOTP code (typed) -> { session: { accessToken }, expiresAt }. */
export async function login(creds = {}) {
  requireFields(creds, ["clientId", "mpin"], NAME);
  const totp = readTotpCode(creds);
  const res = await brokerFetch(`${BASE_URL}/generate/token`, {
    method: "POST",
    headers: { "x-api-key": String(creds.clientId).trim(), "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ mpin: String(creds.mpin), totp }),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-JSON body */ }
  const secrets = [String(creds.mpin), totp];
  if (!res.ok || typeof json?.token !== "string" || !json.token) {
    const why = redactSecrets(json?.message || `HTTP ${res.status}`, secrets);
    if (res.status === 429) throw new BrokerError(`${NAME} login is limited to one attempt a minute (${why}). Wait a minute and try again.`, { code: "UPSTREAM_RATE_LIMIT" });
    throw new BrokerError(`${NAME} login failed: ${why}. Check the Client ID and MPIN and use a fresh code (5 wrong codes lock token generation for 15 minutes).`, { code: "UPSTREAM_AUTH" });
  }
  // Trust expires_in only when it lands inside the documented 24-hour life; otherwise assume 24 hours.
  const now = Date.now();
  const stated = expiryFrom(json.expires_in, now);
  const expiresAt = stated > now && stated <= now + DAY_MS ? stated : now + DAY_MS - 60_000;
  return { session: { accessToken: json.token }, expiresAt };
}

// ── pacing per documented bucket, at ~80% of the per-second caps ──
const MIN_GAP_MS = { quote: 250, nonTrading: 80, orders: 125 };
const nextFree = new Map();

async function pace(bucket) {
  const gap = MIN_GAP_MS[bucket] ?? 250;
  const now = Date.now();
  const at = Math.max(now, nextFree.get(bucket) ?? 0);
  nextFree.set(bucket, at + gap);
  if (at > now) await new Promise((r) => setTimeout(r, at - now));
}

function bucketOf(path, method) {
  if (path.startsWith("/market/")) return "quote";
  if (method === "POST" && path.startsWith("/order")) return "orders";
  return "nonTrading";
}

function isTokenRejection(status, json) {
  if (status === 401) return true;
  if (status !== 403) return false;
  if (json?.error_type === "UserException") return false; // segment not activated, not a dead token
  return true;
}

function upstreamError(status, json, text, path, token) {
  const why = json?.message || json?.debug_info || (text || "").slice(0, 160) || `HTTP ${status}`;
  const kind = json?.error_type ? ` ${json.error_type}` : "";
  const message = redactSecrets(`${NAME} API error${kind} [${status}] on ${path}: ${why}`, [token]);
  if (status === 429) return new BrokerError(message, { code: "UPSTREAM_RATE_LIMIT" });
  if (status === 403) return new BrokerError(message, { code: "UPSTREAM_FORBIDDEN" });
  return new BrokerError(message, { code: "UPSTREAM_ERROR" });
}

/**
 * Authenticated request. GET params go in the query string; POST bodies are JSON. Returns parsed JSON, or the
 * raw text when `raw` is set (the instrument CSV). Token rejection -> SessionRequiredError.
 */
export async function indRequest(creds, path, { method = "GET", params, body, raw = false } = {}) {
  const token = sessionToken(creds);
  const url = new URL(`${BASE_URL}${path}`);
  for (const [k, v] of Object.entries(params || {})) if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  const headers = { Authorization: token, Accept: raw ? "text/csv, */*" : "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  await pace(bucketOf(path, method));
  const res = await brokerFetch(url.toString(), { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* CSV or non-JSON error */ }
  if (isTokenRejection(res.status, json)) {
    throw new SessionRequiredError(`${NAME}: the access token was rejected or has expired (tokens last 24 hours). Log in again from Broker Settings.`);
  }
  if (!res.ok) throw upstreamError(res.status, json, text, path, token);
  if (raw) {
    if (json && json.status === "error") throw upstreamError(res.status, json, text, path, token);
    return text;
  }
  if (!json || typeof json !== "object") throw upstreamError(res.status, null, text, path, token);
  if (json.status === "error" || json.success === false) throw upstreamError(res.status, json, text, path, token);
  return json;
}

export function normaliseError(err, { secrets = [] } = {}) {
  const out = baseNormalise(err, { secrets });
  if (out.code === "UPSTREAM_ERROR" && /\b429\b|too many requests/i.test(out.message)) out.code = "UPSTREAM_RATE_LIMIT";
  return out;
}

export function __resetIndmoneyPacing() {
  nextFree.clear();
}
