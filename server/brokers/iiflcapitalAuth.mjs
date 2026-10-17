/**
 * IIFL Capital session login + authenticated fetch.
 *
 * IIFL has no paste-a-token model and no TOTP handshake either — it's a
 * one-time browser OAuth-style dance the user does OUTSIDE this app:
 *   1. Visit https://markets.iiflcapital.com/?v=1&appkey=<appKey>&redirecturl=<url>
 *   2. Log in with trading credentials + OTP/TOTP on IIFL's own login page.
 *   3. IIFL redirects back with `authCode` + `clientId` query params.
 * That authCode is single-use and short-lived, so instead of asking the user
 * to also hand-compute the SHA-256 checksum documented at
 * broker-api-docs/iiflcapital-api-docs/03-user.md, this module does the
 * exchange server-side: SHA-256(clientId + authCode + appSecret) -> POST
 * /getusersession -> userSession (a JWT). That JWT is a per-trading-day
 * session, so it's cached in-memory keyed by the raw creds and only
 * re-derived after IST midnight or on an explicit auth failure — never
 * re-logged-in on every call (the authCode itself is consumed by the first
 * successful exchange and can't be reused for a second login anyway).
 *
 * NEVER log clientId/appSecret/authCode/userSession values — field
 * names/presence and HTTP status codes only.
 */

import { createHash } from "node:crypto";

export const BASE_URL = "https://api.iiflcapital.com/v1";
export const LOGIN_URL = "https://markets.iiflcapital.com/";

// credsKey -> { token, expiresAt }. In-memory only — a server restart just
// forces the next call to re-exchange (fails fast with a clear "regenerate
// authCode" error if that authCode has already been consumed).
const sessionCache = new Map();

function credKey(creds) {
  return JSON.stringify({ c: creds?.clientId, s: creds?.appSecret, a: creds?.authCode });
}

function sha256Hex(str) {
  return createHash("sha256").update(str, "utf8").digest("hex");
}

/** IIFL sessions are valid "for the trading day" (docs: fresh login required daily) — re-derive at the next IST midnight. */
function nextMidnightIST(fromDate = new Date()) {
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
  const ist = new Date(fromDate.getTime() + IST_OFFSET_MS);
  const istMidnightUtcMs = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate() + 1, 0, 0, 0);
  return istMidnightUtcMs - IST_OFFSET_MS;
}

async function loginFresh(creds) {
  const clientId = String(creds?.clientId || "").trim();
  const appSecret = String(creds?.appSecret || "").trim();
  const authCode = String(creds?.authCode || "").trim();
  if (!clientId || !appSecret || !authCode) {
    throw new Error("IIFL Capital credentials incomplete — clientId, appSecret and authCode are all required.");
  }

  const checkSum = sha256Hex(`${clientId}${authCode}${appSecret}`);
  const res = await fetch(`${BASE_URL}/getusersession`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ checkSum }),
  });
  const json = await res.json().catch(() => null);

  const status = String(json?.status || "").toLowerCase();
  const token = json?.userSession;
  if (!res.ok || status !== "ok" || !token) {
    const msg = json?.message || `HTTP ${res.status}`;
    throw new Error(
      `IIFL Capital login failed (${msg}). authCode is single-use and short-lived — log in again at ` +
      `${LOGIN_URL}?v=1&appkey=YOUR_APP_KEY&redirecturl=YOUR_URL and paste the fresh authCode in Broker Settings.`
    );
  }

  const session = { token, expiresAt: nextMidnightIST() };
  sessionCache.set(credKey(creds), session);
  return session;
}

/** Returns a cached session or performs the checksum exchange once. */
export async function getSession(creds) {
  const key = credKey(creds);
  const cached = sessionCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached;
  return loginFresh(creds);
}

function invalidate(creds) {
  sessionCache.delete(credKey(creds));
}

// ---- Rate limiting ---------------------------------------------------------
// Tightest documented per-category cap (15-rate-limits.md) is 10 req/sec for
// non-registered sessions (Market Quotes / Market Depth / Historical Data /
// Open Interest). Pace every call — across data/order/funds alike — against
// one shared, conservative floor (~7.5 req/sec) rather than track a user's
// registration tier we have no way to know.
const MIN_INTERVAL_MS = 135;
let lastCallAt = 0;

async function paceRequest() {
  const now = Date.now();
  const wait = MIN_INTERVAL_MS - (now - lastCallAt);
  lastCallAt = now + Math.max(wait, 0);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}

const MAX_RETRIES = 3;
const ERROR_STATUSES = new Set(["error", "failed", "failure", "false", "ko", "not_ok"]);

function isAuthFailure(res, json) {
  if (res.status === 401 || res.status === 403) return true;
  return /session|token|unauthor|not.?logged.?in/i.test(json?.message || "");
}

/**
 * Authenticated request against an IIFL Capital endpoint. Handles pacing,
 * 429 backoff (Retry-After if present, else exponential), and treats an
 * auth-shaped failure as "session is dead" — invalidates the cache so the
 * *next* call re-attempts the checksum exchange, but does not itself retry
 * with the same (already-consumed) authCode since that would just repeat
 * the same failure.
 */
export async function iiflFetch(path, creds, body, { method = "POST", _retry = 0 } = {}) {
  const session = await getSession(creds);
  await paceRequest();

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${session.token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  let json = null;
  try { json = await res.json(); } catch { /* non-JSON body */ }

  if (res.status === 429 && _retry < MAX_RETRIES) {
    const retryAfter = Number(res.headers.get("retry-after"));
    const delay = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1000 * 2 ** _retry;
    await new Promise((r) => setTimeout(r, delay));
    return iiflFetch(path, creds, body, { method, _retry: _retry + 1 });
  }

  const statusField = String(json?.status ?? "").toLowerCase();
  const failed = !res.ok || ERROR_STATUSES.has(statusField);

  if (failed) {
    if (isAuthFailure(res, json)) invalidate(creds);
    const msg = json?.message || json?.error || `HTTP ${res.status}`;
    throw new Error(`IIFL Capital API error [${res.status}] on ${path}: ${msg}`);
  }

  return json;
}
