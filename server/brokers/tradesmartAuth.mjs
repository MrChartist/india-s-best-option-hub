/**
 * TradeSmart (Noren v2) authentication + authenticated request helper.
 *
 * TradeSmart runs the same Noren OMS family as Flattrade/Shoonya/Finvasia —
 * order-status vocabulary, product codes (C/M/I), and jData request shape all
 * match (confirmed against openalgo's tradesmart adapter, which explicitly
 * calls out the shared lineage). The v2 REST host is different from those
 * siblings though, and so is the auth transport:
 *
 *   1. User opens https://v2api.tradesmartonline.in/OAuthlogin/authorize/oauth?client_id=<apiKey>,
 *      logs in with their TradeSmart Client ID + trading password (+2FA) on
 *      TradeSmart's own hosted page.
 *   2. TradeSmart redirects to the app's registered Redirect URL with a
 *      one-time authorization `code` in the query string, valid for a single
 *      token exchange only.
 *   3. The server exchanges that code for an `access_token` by POSTing
 *      `jData={"code","checksum"}` (checksum = SHA-256(apiKey + apiSecret + code) —
 *      verified against TradeSmart's v2 docs; note the field order differs from
 *      Flattrade's SHA-256(apiKey + code + apiSecret), so do NOT copy that
 *      module's hash order here) to POST /GenAcsTok, no Bearer header needed
 *      for this call specifically.
 *
 * So the user pastes clientId + apiKey + apiSecret + a freshly-generated
 * requestCode into Broker Settings; this module performs step 3 itself and
 * caches the resulting access_token exactly like the other handshake-login
 * brokers (Angel One / 5paisa / Flattrade) cache their session — requestCode
 * is single-use and short-lived, so we must NOT re-run the exchange on every
 * call. TradeSmart's GenAcsTok response documents an `expires_in` field
 * (Unix timestamp); when present we trust it verbatim, otherwise we fall back
 * to the same "next 5 AM IST" daily-reset convention Flattrade documents for
 * this broker family, since TradeSmart's own docs only say the token is
 * "valid for one trading day".
 *
 * Every subsequent v2 call needs BOTH `Authorization: Bearer <access_token>`
 * AND a `jData=<json>` body — unlike the classic Noren brokers which append
 * `&jKey=<token>` to the body instead of using a Bearer header. That's the
 * single biggest transport difference from Flattrade/Shoonya.
 *
 * NEVER log apiSecret, requestCode, or the access_token itself — field names /
 * broker status codes only.
 */

import { createHash } from "node:crypto";

export const REST_ROOT = "https://v2api.tradesmartonline.in/NorenWClientAPIv2";
const GENACSTOK_URL = `${REST_ROOT}/GenAcsTok`;
export const OAUTH_LOGIN_URL = "https://v2api.tradesmartonline.in/OAuthlogin/authorize/oauth";

// key -> { token, expiresAt }
const sessionCache = new Map();

function sha256Hex(str) {
  return createHash("sha256").update(str).digest("hex");
}

/** In-process cache key only — never persisted, never logged. */
function credsKey(creds) {
  return JSON.stringify({
    c: creds?.clientId,
    a: creds?.apiKey,
    s: creds?.apiSecret,
    r: creds?.requestCode,
  });
}

/** Next 5:00 AM IST after `now` — fallback reset window when GenAcsTok carries no expires_in. */
function nextIstResetMs(now = Date.now()) {
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
  const istShifted = new Date(now + IST_OFFSET_MS);
  const cutoffIstShifted = new Date(istShifted);
  cutoffIstShifted.setUTCHours(5, 0, 0, 0);
  if (cutoffIstShifted.getTime() <= istShifted.getTime()) {
    cutoffIstShifted.setUTCDate(cutoffIstShifted.getUTCDate() + 1);
  }
  return cutoffIstShifted.getTime() - IST_OFFSET_MS;
}

/** Interprets GenAcsTok's `expires_in`: epoch seconds if it looks like a timestamp, else a duration in seconds. */
function resolveExpiresAt(expiresIn, now = Date.now()) {
  const n = Number(expiresIn);
  if (!Number.isFinite(n) || n <= 0) return nextIstResetMs(now);
  // > ~2001-09-09 in epoch seconds is unambiguously a timestamp, not a duration.
  return n > 1_000_000_000 ? n * 1000 : now + n * 1000;
}

function requireFields(creds) {
  const missing = ["clientId", "apiKey", "apiSecret", "requestCode"].filter((f) => !creds?.[f]);
  if (missing.length) {
    throw new Error(`TradeSmart credentials missing required field(s): ${missing.join(", ")}`);
  }
}

async function exchangeRequestCode(creds) {
  requireFields(creds);

  const checksum = sha256Hex(`${creds.apiKey}${creds.apiSecret}${creds.requestCode}`);
  const body = "jData=" + JSON.stringify({ code: creds.requestCode, checksum });

  const res = await fetch(GENACSTOK_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body,
  });

  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-JSON error body */ }

  if (!res.ok || json?.stat !== "Ok") {
    const emsg = json?.emsg || `HTTP ${res.status}`;
    console.log(`[tradesmart] requestCode exchange failed: ${emsg}`);
    throw new Error(
      `TradeSmart login failed: ${emsg}. The authorization code is one-time-use and expires within a few ` +
        `minutes of generating it — open ${OAUTH_LOGIN_URL}?client_id=<your apiKey>, log in again, and paste ` +
        `the fresh code into Broker Settings as requestCode.`
    );
  }

  const token = json.access_token || json.accesstoken || json.token || json.susertoken;
  if (!token) {
    throw new Error("TradeSmart authentication succeeded but no access_token was present in the response.");
  }

  const session = { token, expiresAt: resolveExpiresAt(json.expires_in) };
  sessionCache.set(credsKey(creds), session);
  return session;
}

/** Returns a cached, still-valid access_token session or performs the requestCode exchange. */
export async function ensureSession(creds) {
  const key = credsKey(creds);
  const cached = sessionCache.get(key);
  if (cached && Date.now() < cached.expiresAt) return cached;
  return exchangeRequestCode(creds);
}

function looksLikeSessionError(emsg) {
  const lowered = (emsg || "").toLowerCase();
  return (
    lowered.includes("session") ||
    lowered.includes("not authoris") ||
    lowered.includes("not authenticated") ||
    lowered.includes("invalid token") ||
    lowered.includes("login") ||
    lowered.includes("token expired")
  );
}

/**
 * POSTs `jData=<json>` (raw text/plain body) plus an `Authorization: Bearer`
 * header to a TradeSmart v2 endpoint, injecting uid/actid (Client ID) from
 * creds — mirrors openalgo's `payload.setdefault("uid", ...)` pattern.
 * Returns the parsed JSON body as-is (callers check `stat`).
 */
export async function postJData(creds, endpoint, payload = {}) {
  const session = await ensureSession(creds);

  const data = { ...payload, uid: creds.clientId, actid: creds.clientId };
  const body = "jData=" + JSON.stringify(data);

  const res = await fetch(`${REST_ROOT}${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "text/plain",
      Authorization: `Bearer ${session.token}`,
    },
    body,
  });

  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`TradeSmart API [${endpoint}] returned a non-JSON response (HTTP ${res.status})`);
  }

  if (json && json.stat === "Not_Ok" && looksLikeSessionError(json.emsg)) {
    sessionCache.delete(credsKey(creds));
    const err = new Error(
      `TradeSmart session expired or invalid on ${endpoint} (${json.emsg}). Generate a fresh authorization ` +
        `code at ${OAUTH_LOGIN_URL}?client_id=<your apiKey> and paste it into Broker Settings as requestCode.`
    );
    // Flags this as unrecoverable within the current request: requestCode is
    // single-use, so re-deriving a session here would just re-exchange the
    // same already-consumed code and fail again. Batch-quote callers use this
    // to stop hammering the (doomed) re-auth endpoint for every remaining
    // contract instead of retrying it per-contract.
    err.isSessionError = true;
    throw err;
  }

  return json;
}
