/**
 * Shoonya (Finvasia) OAuth login + authenticated request helper.
 *
 * Shoonya's retail API runs on the same Noren OMS backend as Flattrade,
 * Tradesmart and Zebu (confirmed against openalgo's adapters for all four —
 * identical jData request shape, identical {stat,emsg} error envelope,
 * identical GetQuotes/Limits field names). It has migrated to an OAuth
 * "GenAcsTok" flow; the classic username+password+TOTP QuickLogin endpoint
 * openalgo's own comments call out as decommissioned post-OAuth (the legacy
 * chart path now 502s). The live flow:
 *   1. User visits
 *      https://api.shoonya.com/OAuthlogin/authorize/oauth?client_id=<apiKey>
 *      and logs in with their trading credentials on Shoonya's own hosted
 *      page (apiKey here is the OAuth app's client_id, issued when the app is
 *      registered on Shoonya's developer console — see
 *      https://shoonya.com/api-documentation).
 *   2. Shoonya redirects back to the app's registered redirect URL with a
 *      one-time `code` query param.
 *   3. The app exchanges {code, checksum: sha256(client_id+secret+code)} for
 *      an access_token via POST /NorenWClientAPI/GenAcsTok.
 *
 * So the user pastes userId (trading UID — the "uid" every subsequent data
 * call needs) + apiKey (the OAuth app's client_id) + apiSecret (the app's
 * secret key) + requestCode (the one-time `code` from the redirect) into
 * Broker Settings; this module performs step 3 itself and caches the
 * resulting access_token — requestCode is single-use and expires within
 * minutes of being issued, so it must never be re-exchanged once consumed.
 *
 * Session lifetime is not documented on Shoonya's own developer page. The
 * Noren OMS family it shares a backend with (Flattrade confirmed via its own
 * docs) enforces a hard token wipe during the 5-6 AM IST daily maintenance
 * window, so the in-memory cache expiry mirrors that convention here too —
 * unverified against Shoonya's own docs specifically, flagged for whoever
 * can confirm it against a live account. Any session-shaped error from the
 * API (see looksLikeSessionError below) evicts the cache immediately either
 * way, so a wrong guess here only costs one extra login round-trip rather
 * than silently reusing a dead token.
 *
 * NEVER log apiSecret, requestCode, or the access_token itself — field names
 * / broker status codes only.
 */

import { createHash } from "node:crypto";

const AUTH_BASE = "https://api.shoonya.com/NorenWClientAPI";
export const OAUTH_LOGIN_BASE = "https://api.shoonya.com/OAuthlogin/authorize/oauth";

// key -> { token, expiresAt }
const sessionCache = new Map();

function sha256Hex(str) {
  return createHash("sha256").update(str).digest("hex");
}

/** In-process cache key only — never persisted, never logged. */
function credsKey(creds) {
  return JSON.stringify({
    u: creds?.userId,
    k: creds?.apiKey,
    s: creds?.apiSecret,
    c: creds?.requestCode,
  });
}

/** Next 5:00 AM IST after `now` — the daily reset window this broker family documents. */
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

function requireFields(creds) {
  const missing = ["userId", "apiKey", "apiSecret", "requestCode"].filter((f) => !creds?.[f]);
  if (missing.length) {
    throw new Error(`Shoonya credentials missing required field(s): ${missing.join(", ")}`);
  }
}

async function exchangeCode(creds) {
  requireFields(creds);

  const checksum = sha256Hex(`${creds.apiKey}${creds.apiSecret}${creds.requestCode}`);
  const body = "jData=" + JSON.stringify({ code: creds.requestCode, checksum });

  const res = await fetch(`${AUTH_BASE}/GenAcsTok`, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body,
  });

  const json = await res.json().catch(() => null);
  if (!res.ok || json?.stat !== "Ok" || !json?.access_token) {
    const emsg = json?.emsg || `HTTP ${res.status}`;
    console.log(`[shoonya] code exchange failed: ${emsg}`);
    throw new Error(
      `Shoonya login failed: ${emsg}. The authorization code is one-time-use and expires within a few ` +
        `minutes of being issued — open ${OAUTH_LOGIN_BASE}?client_id=<your apiKey>, log in again, and ` +
        `paste the fresh code into Broker Settings.`
    );
  }

  const session = { token: json.access_token, expiresAt: nextIstResetMs() };
  sessionCache.set(credsKey(creds), session);
  return session;
}

/** Returns a cached, still-valid access_token session or performs the code exchange. */
export async function ensureSession(creds) {
  const key = credsKey(creds);
  const cached = sessionCache.get(key);
  if (cached && Date.now() < cached.expiresAt) return cached;
  return exchangeCode(creds);
}

function looksLikeSessionError(emsg) {
  const text = String(emsg || "").toLowerCase();
  return (
    text.includes("session expired") ||
    text.includes("invalid session") ||
    text.includes("session key") ||
    text.includes("not logged in") ||
    text.includes("invalid input : uid")
  );
}

/**
 * POSTs jData=<json> with an `Authorization: Bearer <access_token>` header to
 * a Shoonya /NorenWClientAPI/* endpoint, injecting uid + actid (trading user
 * ID) from creds. Returns the parsed JSON body as-is (callers check `stat`).
 */
export async function postJData(creds, endpoint, payload = {}) {
  const session = await ensureSession(creds);

  const data = { ...payload, uid: creds.userId, actid: creds.userId };
  const body = "jData=" + JSON.stringify(data);

  const res = await fetch(`${AUTH_BASE}${endpoint}`, {
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
    throw new Error(`Shoonya API [${endpoint}] returned a non-JSON response (HTTP ${res.status})`);
  }

  if (json && json.stat === "Not_Ok" && looksLikeSessionError(json.emsg)) {
    sessionCache.delete(credsKey(creds));
    const err = new Error(
      `Shoonya session expired or invalid on ${endpoint} (${json.emsg}). Generate a fresh authorization ` +
        `code at ${OAUTH_LOGIN_BASE}?client_id=<your apiKey> and paste it into Broker Settings.`
    );
    // Flags this as unrecoverable within the current request: the OAuth code
    // is single-use, so re-deriving a session here would just re-exchange the
    // same already-consumed code and fail again. Batch-quote callers use this
    // to stop hammering the (doomed) re-auth endpoint for every remaining
    // contract instead of retrying it per-contract.
    err.isSessionError = true;
    throw err;
  }

  return json;
}
