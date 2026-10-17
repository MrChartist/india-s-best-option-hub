/**
 * Angel One (SmartAPI) authentication.
 *
 * SmartAPI has no paste-a-token model — the backend must actively log in
 * with a fresh TOTP code every session. The resulting JWT dies at IST
 * midnight regardless of activity, so we cache it in memory keyed by the
 * creds and only re-login (fresh TOTP) when missing/expired or when the
 * broker tells us the token itself is bad. Re-running TOTP login on every
 * poll would blow through Angel's 1 req/sec login limit within seconds.
 */

import { generateTOTP } from "../lib/totp.mjs";

const AUTH_BASE = "https://apiconnect.angelone.in";
const LOGIN_PATH = "/rest/auth/angelbroking/user/v1/loginByPassword";

// In-memory only — never persisted to disk. Server restart forces one fresh
// TOTP login per active user, which is fine (well under the 1 req/sec cap).
const sessionCache = new Map();

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

/** Epoch ms of the next IST midnight from `now` — Angel JWT sessions expire exactly there. */
function nextIstMidnightMs(now = Date.now()) {
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
  const istShifted = new Date(now + IST_OFFSET_MS);
  istShifted.setUTCHours(0, 0, 0, 0);
  const istMidnightTodayShifted = istShifted.getTime();
  return istMidnightTodayShifted + 24 * 60 * 60 * 1000 - IST_OFFSET_MS;
}

/** In-process cache key only. Never logged, never persisted. */
function credsKey(creds) {
  return JSON.stringify({
    a: creds?.apiKey,
    c: creds?.clientId,
    p: creds?.password,
    t: creds?.totpSecret,
  });
}

async function loginFresh(creds) {
  const totp = generateTOTP(creds.totpSecret);
  const res = await fetch(`${AUTH_BASE}${LOGIN_PATH}`, {
    method: "POST",
    headers: commonHeaders(creds.apiKey),
    body: JSON.stringify({ clientcode: creds.clientId, password: creds.password, totp }),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.status || !json?.data?.jwtToken) {
    const msg = json?.message || `HTTP ${res.status}`;
    console.log(`[angelone] login failed: ${msg}`);
    throw new Error(`Angel One login failed: ${msg}`);
  }
  const session = {
    jwtToken: json.data.jwtToken,
    refreshToken: json.data.refreshToken || null,
    expiresAt: nextIstMidnightMs(),
  };
  sessionCache.set(credsKey(creds), session);
  return session;
}

/** Returns a valid cached session, logging in fresh (new TOTP) if missing/expired. */
export async function getSession(creds) {
  if (!creds?.apiKey || !creds?.clientId || !creds?.password || !creds?.totpSecret) {
    throw new Error("Angel One credentials incomplete — need apiKey, clientId, password, totpSecret");
  }
  const key = credsKey(creds);
  const cached = sessionCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached;
  return loginFresh(creds);
}

function isRateLimitBody(text) {
  const lowered = (text || "").toLowerCase();
  return lowered.includes("exceeding") || lowered.includes("access rate") || lowered.includes("rate limit");
}

/**
 * Authenticated POST against apiconnect.angelone.in. On a genuine auth-403
 * (body does NOT mention rate limiting) forces a fresh TOTP login and retries
 * once. A rate-limit 403 is never retried here — it's surfaced as an error so
 * the caller's own batching/backoff handles pacing instead of compounding it.
 */
export async function authFetch(creds, path, body) {
  let session = await getSession(creds);

  const doCall = async (sess) => {
    const res = await fetch(`${AUTH_BASE}${path}`, {
      method: "POST",
      headers: {
        ...commonHeaders(creds.apiKey),
        Authorization: `Bearer ${sess.jwtToken}`,
      },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* non-JSON error body */ }
    return { res, text, json };
  };

  let { res, text, json } = await doCall(session);

  if (res.status === 403 && !isRateLimitBody(text)) {
    console.log(`[angelone] token rejected on ${path} (status 403) — re-logging in`);
    sessionCache.delete(credsKey(creds));
    session = await loginFresh(creds);
    ({ res, text, json } = await doCall(session));
  }

  if (res.status === 403 && isRateLimitBody(text)) {
    throw new Error(`Angel One API rate limit exceeded on ${path}`);
  }
  if (!res.ok) {
    throw new Error(`Angel One API error [${res.status}] on ${path}: ${json?.message || text.slice(0, 200)}`);
  }
  if (json && json.status === false) {
    throw new Error(`Angel One API error on ${path}: ${json.message || json.errorcode || "unknown"}`);
  }
  return json;
}
