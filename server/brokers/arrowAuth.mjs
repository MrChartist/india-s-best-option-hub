/**
 * Arrow (https://arrow.trade) authentication.
 *
 * Arrow's login is a Zerodha-style external redirect + checksum handshake, NOT
 * a paste-a-JWT model and NOT a server-side TOTP login:
 *   1. The user visits https://app.arrow.trade/app/login?appID=<appId> in their
 *      own browser, signs in (password + TOTP is handled entirely by Arrow's
 *      hosted login page), and is redirected to their registered redirect URL
 *      with a one-time `request-token` query param.
 *   2. The user copies that `request-token` value and pastes it into Broker
 *      Settings alongside their `appId` / `appSecret`.
 *   3. WE do the token exchange server-side: SHA256("appId:appSecret:requestToken")
 *      (colon-separated, in that order) as `checkSum`, POSTed with `token`
 *      (the request-token) and `appID` to /auth/app/authenticate-token.
 *   4. Arrow returns a JWT (`data.token`) good for 24 hours (docs: "Access
 *      tokens have a limited lifespan (24hrs) due to regulatory compliance").
 *
 * The request-token is single-use, so we cache the resulting JWT in-memory
 * keyed by the full creds triple and reuse it for the documented 24h window
 * instead of re-exchanging (which would fail the second time — Arrow's token
 * exchange is one-shot per request-token). Once the JWT expires the user must
 * repeat the browser login and paste a fresh request-token.
 *
 * NEVER log appSecret, requestToken, or the JWT itself — field names / status
 * codes only.
 */

import { createHash } from "node:crypto";

export const ROOT_URL = "https://edge.arrow.trade";
const AUTH_TOKEN_URL = `${ROOT_URL}/auth/app/authenticate-token`;

// Documented session lifetime — used as our in-memory cache TTL.
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

const sessionCache = new Map(); // credsKey -> { token, expiresAt }

function credsKey(creds) {
  return JSON.stringify({
    a: creds?.appId,
    s: creds?.appSecret,
    r: creds?.requestToken,
  });
}

function sha256Hex(str) {
  return createHash("sha256").update(str).digest("hex");
}

async function exchangeRequestToken(creds) {
  const { appId, appSecret, requestToken } = creds || {};
  if (!appId || !appSecret || !requestToken) {
    throw new Error(
      "Arrow credentials incomplete — need appId, appSecret, and requestToken. " +
      "Get requestToken by visiting https://app.arrow.trade/app/login?appID=<appId>, " +
      "logging in, and copying the request-token from the redirect URL."
    );
  }

  const checkSum = sha256Hex(`${appId}:${appSecret}:${requestToken}`);
  const res = await fetch(AUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ appID: appId, token: requestToken, checkSum }),
  });
  const json = await res.json().catch(() => ({}));

  if (!res.ok || json?.status !== "success") {
    const msg = json?.message || `HTTP ${res.status}`;
    console.log(`[arrow] token exchange failed: ${msg}`);
    throw new Error(
      `Arrow authentication failed: ${msg}. The requestToken is single-use — ` +
      "generate a fresh one by logging in again at https://app.arrow.trade/app/login?appID=<appId>."
    );
  }

  const token = json.data?.token;
  if (!token) {
    throw new Error("Arrow authentication succeeded but returned no access token.");
  }
  return token;
}

/** Returns a valid cached JWT, exchanging the requestToken once if missing/expired. */
export async function getAuthToken(creds) {
  const key = credsKey(creds);
  const cached = sessionCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.token;

  const token = await exchangeRequestToken(creds);
  sessionCache.set(key, { token, expiresAt: Date.now() + SESSION_TTL_MS });
  return token;
}

/**
 * Evicts the cached JWT after a live 401/403 proves the broker rejected it before
 * its own 24h TTL (e.g. a forced logout, or server-side revocation). Unlike
 * angelone/5paisa's evergreen TOTP secrets, Arrow's requestToken is single-use —
 * it was already consumed by the original exchangeRequestToken call — so this
 * cannot silently re-derive a fresh JWT the way a full reactive retry would.
 * Callers must still surface a clear "get a fresh requestToken" error; this only
 * stops the stale, already-dead JWT from being reused on every subsequent call
 * until the 24h cache TTL happens to elapse on its own.
 */
export function invalidateSession(creds) {
  sessionCache.delete(credsKey(creds));
}

/** Builds Arrow's custom auth headers. Arrow does NOT use `Authorization: Bearer`. */
export function authHeaders(appId, token, withJson = false) {
  const headers = { appID: appId, token };
  if (withJson) headers["Content-Type"] = "application/json";
  return headers;
}
