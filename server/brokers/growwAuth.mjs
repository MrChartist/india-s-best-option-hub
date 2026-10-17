/**
 * Groww Trading API — checksum-based authentication.
 *
 * Groww's "API Key & Secret" flow (per https://groww.in/trade-api/docs/curl and
 * marketcalls/openalgo's broker/groww/api/auth_api.py) has no browser OAuth step:
 * the backend itself exchanges (apiKey, apiSecret) for a bearer access token by
 * POSTing a SHA256 checksum of `apiSecret + epoch-seconds-timestamp`.
 *
 * The resulting token is documented to expire at 6:00 AM IST the following day
 * (same lifetime Groww uses for its "Access Token" flow), and the token-exchange
 * endpoint itself is capped at 150 requests/24h — so the session is cached
 * in-memory per credential set and only refreshed when missing/expired or when
 * the broker rejects it (401/403), never on every call.
 */

import { createHash } from "node:crypto";

const AUTH_BASE = "https://api.groww.in";
const TOKEN_PATH = "/v1/token/api/access";

// In-memory only — never persisted to disk. Server restart forces one fresh
// token exchange per active user, well under the 150/24h cap.
const sessionCache = new Map();

/** In-process cache key only. Never logged, never persisted. */
function credsKey(creds) {
  return JSON.stringify({ k: creds?.apiKey, s: creds?.apiSecret });
}

function generateChecksum(apiSecret, timestamp) {
  return createHash("sha256").update(apiSecret + timestamp).digest("hex");
}

/** Epoch ms of the next 6:00 AM IST from `now` — Groww's documented token expiry. */
function nextIst6AmMs(now = Date.now()) {
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
  const istNow = new Date(now + IST_OFFSET_MS);
  const sixAmShifted = Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate(), 6, 0, 0, 0);
  let sixAmIstMs = sixAmShifted - IST_OFFSET_MS;
  if (sixAmIstMs <= now) sixAmIstMs += 24 * 60 * 60 * 1000;
  return sixAmIstMs;
}

async function loginFresh(creds) {
  if (!creds?.apiKey || !creds?.apiSecret) {
    throw new Error("Groww credentials incomplete — need apiKey and apiSecret");
  }
  const timestamp = String(Math.floor(Date.now() / 1000));
  const checksum = generateChecksum(creds.apiSecret, timestamp);

  const res = await fetch(`${AUTH_BASE}${TOKEN_PATH}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${creds.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ key_type: "approval", checksum, timestamp }),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-JSON error body */ }

  if (!res.ok || !json?.token) {
    const msg = json?.error?.message || json?.message || `HTTP ${res.status}`;
    console.log(`[groww] token exchange failed (status ${res.status})`);
    throw new Error(`Groww authentication failed: ${msg}`);
  }

  const session = { token: json.token, expiresAt: nextIst6AmMs() };
  sessionCache.set(credsKey(creds), session);
  return session;
}

/** Returns a valid cached session, exchanging a fresh token if missing/expired. */
export async function getSession(creds) {
  const key = credsKey(creds);
  const cached = sessionCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached;
  return loginFresh(creds);
}

/**
 * Authenticated GET against api.groww.in. On a 401/403 the cached session is
 * dropped and one fresh token exchange + retry is attempted (never looped —
 * the 150/24h cap on the token endpoint means repeated retries could exhaust it).
 */
export async function authGet(creds, path, params) {
  let session = await getSession(creds);

  const doCall = async (token) => {
    const url = new URL(`${AUTH_BASE}${path}`);
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        if (v != null) url.searchParams.set(k, v);
      }
    }
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "X-API-VERSION": "1.0",
      },
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* non-JSON error body */ }
    return { res, text, json };
  };

  let { res, text, json } = await doCall(session.token);

  if (res.status === 401 || res.status === 403) {
    console.log(`[groww] token rejected on ${path} (status ${res.status}) — re-authenticating`);
    sessionCache.delete(credsKey(creds));
    session = await loginFresh(creds);
    ({ res, text, json } = await doCall(session.token));
  }

  if (!res.ok) {
    throw new Error(`Groww API error [${res.status}] on ${path}: ${json?.error?.message || json?.message || text.slice(0, 200)}`);
  }
  if (json && json.status && json.status !== "SUCCESS") {
    throw new Error(`Groww API error on ${path}: ${json.error?.message || json.status}`);
  }
  return json;
}
