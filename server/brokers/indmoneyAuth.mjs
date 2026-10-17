/**
 * IndMoney (INDstocks) authentication + paced REST client.
 *
 * Two ways to get a live access token (docs: indstocks-api-docs/04-authentication-users.md
 * for the paste-a-token path; the MPIN+TOTP path is undocumented in that public mirror but
 * confirmed against marketcalls/openalgo's production broker/indmoney adapter, which cites
 * it as documented in its own copy of the same docs):
 *
 *   1. Paste-a-token — user logs in at indstocks.com -> API Trading -> Generate Token and
 *      pastes the resulting 24h token into `accessToken`. Used as-is once validated.
 *   2. MPIN + TOTP — POST /generate/token with the Client ID as the `x-api-key` header plus
 *      the account MPIN and a live 6-digit TOTP code. Scriptable, no browser needed. Limited
 *      to 1 request/60s, and 5 wrong codes within 15 minutes locks the endpoint for 15
 *      minutes — so this is only ever called when the cached session has genuinely expired,
 *      never retried automatically.
 *
 * Sessions from either path are cached in-memory per credential set (never persisted, never
 * logged). A TOTP-issued token is trusted for 23h (1h safety margin under the documented 24h
 * lifetime). A pasted token is re-checked against /user/profile every 30 min at most, since
 * there is no way to know how much of its 24h life was already spent before it was pasted.
 */

import { generateTOTP } from "../lib/totp.mjs";

export const BASE_URL = "https://api.indstocks.com";

const TOKEN_ENDPOINT = "/generate/token";
const PROFILE_ENDPOINT = "/user/profile";

const TOTP_SESSION_TTL_MS = 23 * 60 * 60 * 1000;
const MANUAL_REVALIDATE_MS = 30 * 60 * 1000;

// key -> { accessToken, expiresAt }
const sessionCache = new Map();

// Documented per-second ceilings (indstocks-api-docs/03-conventions.md), paced at 80% —
// the same headroom fraction every other broker module in this app uses — to absorb clock
// jitter against the broker's own rolling window rather than hitting the ceiling exactly.
const RATE_PER_SEC = { quote: 4, data: 4, non_trading: 12 };
const nextFree = new Map();

function credsKey(creds) {
  // In-process cache key only — never persisted, never logged.
  return JSON.stringify({ c: creds?.clientId, m: creds?.mpin, t: creds?.totpSecret, a: creds?.accessToken });
}

function classify(path) {
  if (path.startsWith("/market/quotes")) return "quote";
  if (path.startsWith("/market/instruments") || path.startsWith("/market/historical")) return "data";
  return "non_trading";
}

async function pace(bucket) {
  const rate = RATE_PER_SEC[bucket];
  if (!rate) return;
  const minInterval = 1000 / rate;
  const now = Date.now();
  const earliest = Math.max(now, nextFree.get(bucket) || 0);
  nextFree.set(bucket, earliest + minInterval);
  const wait = earliest - now;
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}

/** Paced GET with a single 429 retry (honouring Retry-After). Never used for /generate/token. */
async function rawGet(path, token, params) {
  const bucket = classify(path);
  const url = new URL(BASE_URL + path);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v != null) url.searchParams.set(k, v);
    }
  }
  const headers = { Authorization: token, Accept: "application/json, text/csv, */*" };

  for (let attempt = 0; attempt <= 1; attempt++) {
    await pace(bucket);
    const res = await fetch(url, { headers });
    if (res.status !== 429) return res;
    if (attempt === 1) return res;
    const retryAfter = Number(res.headers.get("retry-after"));
    await new Promise((r) => setTimeout(r, Number.isFinite(retryAfter) ? retryAfter * 1000 : 1000));
  }
}

export async function validateAccessToken(token) {
  const clean = (token || "").trim();
  if (!clean) return { valid: false, reason: "empty token" };
  try {
    const res = await rawGet(PROFILE_ENDPOINT, clean);
    if (res.status === 200 || res.status === 201) return { valid: true, reason: null };
    const rejected = res.status === 401 || res.status === 403;
    let reason = `HTTP ${res.status}`;
    try {
      const body = JSON.parse(await res.text());
      reason = body?.message || body?.error_code || reason;
    } catch { /* non-JSON error body */ }
    // Only an auth rejection proves the token is bad — a 429/5xx says nothing about it.
    return { valid: rejected ? false : null, reason };
  } catch (e) {
    return { valid: null, reason: `validation request failed: ${e.message}` };
  }
}

async function generateTokenViaTotp(creds) {
  const clientId = (creds.clientId || "").trim();
  const mpin = (creds.mpin || "").trim();
  if (!clientId) throw new Error("IndMoney clientId is required for MPIN + TOTP login.");
  if (!mpin || !creds.totpSecret) throw new Error("IndMoney mpin and totpSecret are both required for TOTP login.");

  const totp = generateTOTP(creds.totpSecret);
  // Deliberately NOT routed through pace()/rawGet — /generate/token has its own strict
  // 1 req/60s rule with a lockout on repeated bad codes, so it must never be coupled to
  // the pacing of quote/data traffic, and it must never be auto-retried on failure.
  const res = await fetch(BASE_URL + TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "x-api-key": clientId, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ mpin, totp }),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-JSON error body handled below */ }

  if (res.status === 200 || res.status === 201) {
    const token = json?.data?.token || json?.data?.access_token || json?.token || json?.access_token;
    if (token) return token;
    throw new Error("IndMoney token generation succeeded but no token was returned.");
  }

  const msg = json?.message || json?.error || `HTTP ${res.status}`;
  if (res.status === 429) {
    throw new Error(`IndMoney token generation is throttled to 1 request/60s: ${msg}. Wait a minute before retrying.`);
  }
  if (res.status === 401 || res.status === 403) {
    throw new Error(
      `IndMoney TOTP login rejected: ${msg}. Check clientId/mpin and use a fresh TOTP code — ` +
      `5 wrong codes within 15 minutes locks token generation for 15 minutes.`
    );
  }
  throw new Error(`IndMoney token generation failed [${res.status}]: ${msg}`);
}

/** Returns a valid access token from cache, or establishes a fresh session. Throws on failure. */
export async function ensureAccessToken(creds = {}) {
  const key = credsKey(creds);
  const cached = sessionCache.get(key);
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.accessToken;

  const pasted = (creds.accessToken || "").trim();
  if (pasted) {
    const { valid, reason } = await validateAccessToken(pasted);
    if (valid === false) {
      throw new Error(
        `IndMoney access token rejected (${reason}). INDstocks tokens expire after 24 hours — ` +
        `paste a fresh one from https://indstocks.com/app/api-trading/access-tokens.`
      );
    }
    // valid === true, or null (unverifiable — a transient outage is not evidence the
    // token is bad, so we proceed with it rather than locking out a working session).
    sessionCache.set(key, { accessToken: pasted, expiresAt: now + MANUAL_REVALIDATE_MS });
    return pasted;
  }

  if (creds.clientId && creds.mpin && creds.totpSecret) {
    const token = await generateTokenViaTotp(creds);
    sessionCache.set(key, { accessToken: token, expiresAt: now + TOTP_SESSION_TTL_MS });
    return token;
  }

  throw new Error(
    "IndMoney credentials incomplete — paste an accessToken, or provide clientId + mpin + totpSecret for MPIN+TOTP login."
  );
}

/** Authenticated JSON GET against the documented {status,data}/{status,message} envelope. */
export async function apiGet(creds, path, params) {
  const token = await ensureAccessToken(creds);
  const res = await rawGet(path, token, params);
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`IndMoney API returned a non-JSON response from ${path} (HTTP ${res.status})`);
  }

  if (res.status === 401 || res.status === 403) {
    sessionCache.delete(credsKey(creds)); // token was rejected mid-session — force a fresh one next call
    throw new Error(`IndMoney auth rejected on ${path}: ${json?.message || `HTTP ${res.status}`}`);
  }
  if (!res.ok) {
    throw new Error(`IndMoney API error [${res.status}] on ${path}: ${json?.message || text.slice(0, 200)}`);
  }
  if (json?.status === "error") {
    throw new Error(`IndMoney API error on ${path}: ${json.message || json.error_code || "unknown"}`);
  }
  return json;
}

/** Authenticated raw-text GET — used for the CSV instrument-master endpoint. */
export async function apiGetRaw(creds, path, params) {
  const token = await ensureAccessToken(creds);
  const res = await rawGet(path, token, params);
  if (res.status === 401 || res.status === 403) {
    sessionCache.delete(credsKey(creds));
    throw new Error(`IndMoney auth rejected on ${path} (HTTP ${res.status})`);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`IndMoney API error [${res.status}] on ${path}: ${body.slice(0, 200)}`);
  }
  return res.text();
}
