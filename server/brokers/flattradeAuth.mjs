/**
 * Flattrade (Pi / "PiConnect API") authentication + authenticated request helper.
 *
 * Flattrade's login is a real browser OAuth handshake, not a TOTP/PIN flow we
 * can run headlessly end-to-end:
 *   1. User opens https://auth.flattrade.in/?app_key=<apiKey>, logs in with
 *      their Client ID (UCC) + trading password + PAN/DOB.
 *   2. Flattrade redirects to the app's registered Redirect URL with a
 *      one-time `request_code` (valid only a few minutes).
 *   3. The server exchanges that code for a session token ("jKey") by
 *      POSTing {api_key, request_code, api_secret: sha256(api_key+request_code+api_secret)}
 *      to https://authapi.flattrade.in/trade/apitoken.
 *
 * So the user pastes clientId + apiKey + apiSecret + a freshly-generated
 * request_code into Broker Settings; this module performs step 3 itself and
 * then caches the resulting jKey exactly like the TOTP-login brokers (Angel
 * One / 5paisa) cache their session — because request_code is single-use and
 * expires in minutes, we must NOT re-run the exchange on every call.
 *
 * Per Flattrade's docs the token is valid ~24h but is unconditionally wiped
 * during the 5-6 AM IST daily maintenance window, so the cache expiry is
 * pinned to the next 5 AM IST rather than a rolling 24h TTL. Once the cached
 * token is gone, re-deriving a new one requires a *new* request_code from the
 * user (the one they pasted has almost certainly already been consumed) —
 * we surface that as a clear "regenerate your request_code" error rather than
 * silently retrying a doomed exchange.
 *
 * NEVER log apiSecret, requestCode, or the jKey token itself — field names /
 * broker status codes only.
 */

import { createHash } from "node:crypto";

export const PI_BASE = "https://piconnect.flattrade.in/PiConnectAPI";
const AUTH_TOKEN_URL = "https://authapi.flattrade.in/trade/apitoken";

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

/** Next 5:00 AM IST after `now` — the daily window Flattrade documents clearing tokens in. */
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
  const missing = ["clientId", "apiKey", "apiSecret", "requestCode"].filter((f) => !creds?.[f]);
  if (missing.length) {
    throw new Error(`Flattrade credentials missing required field(s): ${missing.join(", ")}`);
  }
}

async function exchangeRequestCode(creds) {
  requireFields(creds);

  const securityHash = sha256Hex(`${creds.apiKey}${creds.requestCode}${creds.apiSecret}`);
  const res = await fetch(AUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: creds.apiKey,
      request_code: creds.requestCode,
      api_secret: securityHash,
    }),
  });

  const json = await res.json().catch(() => null);
  if (!res.ok || json?.stat !== "Ok" || !json?.token) {
    const emsg = json?.emsg || `HTTP ${res.status}`;
    console.log(`[flattrade] request_code exchange failed: ${emsg}`);
    throw new Error(
      `Flattrade login failed: ${emsg}. The request_code is one-time-use and expires within a few ` +
        `minutes of generating it — open https://auth.flattrade.in/?app_key=<your apiKey>, log in again, ` +
        `and paste the fresh request_code into Broker Settings.`
    );
  }

  const session = { token: json.token, expiresAt: nextIstResetMs() };
  sessionCache.set(credsKey(creds), session);
  return session;
}

/** Returns a cached, still-valid jKey session or performs the request_code exchange. */
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
    lowered.includes("login")
  );
}

/**
 * POSTs `jData=<json>&jKey=<token>` (form-encoded — Flattrade's own docs curl
 * examples say `Content-Type: application/json` but ship a form-encoded body;
 * this follows openalgo's verified-working production adapter instead) to a
 * PiConnect endpoint, injecting uid/actid (Client ID / UCC) from creds.
 * Returns the parsed JSON body as-is (callers check `stat`).
 */
export async function postJData(creds, endpoint, payload = {}) {
  const session = await ensureSession(creds);

  const data = { ...payload, uid: creds.clientId, actid: creds.clientId };
  const body = `jData=${JSON.stringify(data)}&jKey=${session.token}`;

  const res = await fetch(`${PI_BASE}${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Flattrade API [${endpoint}] returned a non-JSON response (HTTP ${res.status})`);
  }

  if (json && json.stat === "Not_Ok" && looksLikeSessionError(json.emsg)) {
    sessionCache.delete(credsKey(creds));
    const err = new Error(
      `Flattrade session expired or invalid on ${endpoint} (${json.emsg}). Generate a fresh request_code ` +
        `at https://auth.flattrade.in/?app_key=<your apiKey> and paste it into Broker Settings.`
    );
    // Flags this as unrecoverable within the current request: request_code is
    // single-use, so re-deriving a session here would just re-exchange the
    // same already-consumed code and fail again. Batch-quote callers use this
    // to stop hammering the (doomed) re-auth endpoint for every remaining
    // contract instead of retrying it per-contract.
    err.isSessionError = true;
    throw err;
  }

  return json;
}
