/**
 * 5paisa session login (TOTP-based two-step handshake) + in-memory session cache.
 *
 * 5paisa access tokens hard-expire at 23:59 IST every day (not a rolling TTL),
 * and TOTP login has a tight per-second rate limit, so we cache the resulting
 * {accessToken, clientCode} in memory keyed by the raw creds object and only
 * re-run the login when the cached session is missing or past that IST cutoff.
 */

import { generateTOTP } from "../lib/totp.mjs";

const BASE = "https://Openapi.5paisa.com/VendorsAPI/Service1.svc";

// key -> { accessToken, clientCode, expiresAt }
const SESSION_CACHE = new Map();

function sessionCacheKey(creds) {
  // In-process cache key only — never persisted, never logged.
  return JSON.stringify(creds || {});
}

/** Today's 23:59 IST as an epoch ms timestamp, regardless of the host server's own timezone. */
function istEndOfDay(now = new Date()) {
  const istDateStr = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now); // "YYYY-MM-DD"
  return new Date(`${istDateStr}T23:59:00+05:30`).getTime();
}

function requireFields(creds, fields) {
  const missing = fields.filter((f) => !creds?.[f]);
  if (missing.length) {
    throw new Error(`5paisa credentials missing required field(s): ${missing.join(", ")}`);
  }
}

async function postJson(path, body, accessToken) {
  const headers = { "Content-Type": "application/json", Accept: "application/json" };
  // Lowercase "bearer" — matches 5paisa's documented header casing exactly (differs
  // from the more common "Bearer"). Login calls (TOTPLogin/GetAccessToken) omit this;
  // every post-login call (e.g. MarketSnapshot) must pass the cached session's token.
  if (accessToken) headers.Authorization = `bearer ${accessToken}`;
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`5paisa API [${path}] returned non-JSON response (HTTP ${res.status})`);
  }
  if (!res.ok) {
    throw new Error(`5paisa API [${path}] error (HTTP ${res.status}): ${json?.body?.Message || json?.head?.statusDescription || text.slice(0, 200)}`);
  }
  return json;
}

/**
 * True when a 5paisa response body indicates the session token itself is dead —
 * distinct from `!res.ok`/HTTP status. Confirmed against 5paisa's own published
 * docs (xstream.5paisa.com/dev-docs/order-tracking-system/order-status: body.Status
 * table — "0: Success, 1: No orders found for this Client, 9: Invalid Session") and
 * a live example on the same body-level convention for the Positions/Margins
 * endpoints (github.com/OpenApi-5p/py5paisa/issues/10 — `"Status": 9, "Message":
 * "Invalid Session"`). This is a BODY-level field (`json.body.Status`), separate
 * from the request-envelope's `json.head.status` (whose own non-zero codes, e.g.
 * "2" for "Invalid head parameters", mean something else entirely) — 5paisa
 * returns HTTP 200 for both cases, which is exactly why `!res.ok` alone (the only
 * check this module used to have) cannot detect it.
 */
function isSessionInvalidBody(json) {
  if (json?.body?.Status === 9) return true;
  const msg = String(json?.body?.Message || "").toLowerCase();
  return msg.includes("invalid session");
}

async function login(creds) {
  requireFields(creds, ["userKey", "clientCode", "pin", "totpSecret", "encryptionKey", "userId"]);

  // Step 1 — TOTP login: exchanges email + fresh TOTP + PIN for a short-lived RequestToken.
  // head.Key is capitalized for this call (verified against 5paisa's own auth flow).
  const totpRes = await postJson("/TOTPLogin", {
    head: { Key: creds.userKey },
    body: {
      Email_ID: creds.clientCode,
      TOTP: generateTOTP(creds.totpSecret),
      PIN: creds.pin,
    },
  });
  const requestToken = totpRes?.body?.RequestToken;
  if (!requestToken) {
    throw new Error(`5paisa TOTP login failed: ${totpRes?.body?.Message || totpRes?.head?.statusDescription || "no RequestToken in response"}`);
  }

  // Step 2 — exchange the RequestToken for an AccessToken + the broker-assigned ClientCode
  // (distinct from creds.clientCode, which is only the login email).
  const tokenRes = await postJson("/GetAccessToken", {
    head: { Key: creds.userKey },
    body: {
      RequestToken: requestToken,
      EncryKey: creds.encryptionKey,
      UserId: creds.userId,
    },
  });
  const accessToken = tokenRes?.body?.AccessToken;
  const clientCode = tokenRes?.body?.ClientCode;
  if (!accessToken) {
    throw new Error(`5paisa access-token exchange failed: ${tokenRes?.body?.Message || tokenRes?.head?.statusDescription || "no AccessToken in response"}`);
  }

  return {
    accessToken,
    clientCode: clientCode || creds.clientCode, // fall back defensively if the API ever omits it
    expiresAt: istEndOfDay(),
  };
}

/** Returns a cached, still-valid session or performs a fresh two-step login. Throws on any auth failure. */
export async function ensureSession(creds) {
  const key = sessionCacheKey(creds);
  const cached = SESSION_CACHE.get(key);
  if (cached && Date.now() < cached.expiresAt) return cached;

  const session = await login(creds);
  SESSION_CACHE.set(key, session);
  return session;
}

/**
 * Authenticated POST with reactive retry-on-session-rejection — the pattern every
 * other broker module in this registry already has (angelone.authFetch,
 * shoonya/flattrade's looksLikeSessionError, indmoney's 401/403 eviction, etc.),
 * which 5paisa was previously missing entirely: it only ever re-logged-in when the
 * cached session's 23:59 IST TTL naturally elapsed, never reactively when the
 * broker rejects the session mid-day (e.g. a forced logout from the mobile/web app,
 * or the token being invalidated server-side before its nominal expiry).
 *
 * `buildBody(session)` is called (not a plain object) so a retry after re-login
 * re-derives the request body against the FRESH session — e.g. MarketSnapshot's
 * body embeds `ClientCode`, which must come from whichever session actually
 * authenticated the call.
 */
export async function authenticatedPost(creds, path, buildBody) {
  let session = await ensureSession(creds);
  let json = await postJson(path, buildBody(session), session.accessToken);

  if (isSessionInvalidBody(json)) {
    console.log(`[fivepaisa] session rejected on ${path} (body.Status=${json?.body?.Status}) — re-logging in`);
    SESSION_CACHE.delete(sessionCacheKey(creds));
    session = await login(creds);
    SESSION_CACHE.set(sessionCacheKey(creds), session);
    json = await postJson(path, buildBody(session), session.accessToken);
  }

  return json;
}

export { BASE, postJson };
