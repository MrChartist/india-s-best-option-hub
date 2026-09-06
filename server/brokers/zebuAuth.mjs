/**
 * Zebu (Mynt) OAuth 2.0-style authentication + authenticated request helper.
 *
 * Zebu runs the same Noren OMS family as Flattrade/Shoonya/Tradesmart (same
 * `jData=<json>` POST body shape, same `stat`/`emsg` response envelope), but
 * unlike Flattrade its Noren layer sits behind a real OAuth authorize/token
 * exchange rather than a bare request_code:
 *
 *   1. User logs in at https://mynt.zebuetrade.com/login, then from
 *      Profile -> (Client Code, top right) -> Settings -> "OAuth Key" screen
 *      registers an app and receives a Client ID + Secret Code (confirmed via
 *      openalgo's zebu.md setup guide — https://docs.openalgo.in/connect-brokers/brokers/zebu).
 *   2. Visiting https://go.mynt.in/OAuthlogin/authorize/oauth?client_id=<clientId>
 *      and logging in redirects to the app's registered callback URL with a
 *      one-time `?code=...` (confirmed via Zebu's own hosted API docs,
 *      https://zebumyntapi.web.app/OAuth/Authentication/).
 *   3. That `code` is exchanged for `access_token` by POSTing
 *      jData={"code","checksum"} (checksum = SHA256(clientId + secretKey + code))
 *      to https://go.mynt.in/NorenWClientAPI/GenAcsTok — confirmed against
 *      openalgo's broker/zebu/api/auth_api.py, byte-for-byte checksum formula.
 *
 * Since this app has no OAuth redirect server, the user completes steps 1-2
 * themselves and pastes clientId + apiSecret (Secret Code) + the resulting
 * one-time authCode into Broker Settings; this module performs step 3 and
 * caches the resulting access_token — never re-exchanging the same authCode
 * (it's single-use, like Flattrade's request_code). Zebu's token response
 * includes `expires_in` (seconds), so the cache TTL is read from the live
 * response rather than a guessed constant.
 *
 * NEVER log apiSecret, authCode, or the access_token itself — field names /
 * broker status codes only.
 */

import { createHash } from "node:crypto";

export const API_BASE = "https://go.mynt.in/NorenWClientAPI";
const TOKEN_EXCHANGE_URL = `${API_BASE}/GenAcsTok`;
const LOGIN_HELP =
  "log in at https://mynt.zebuetrade.com/login, open Profile > Settings > OAuth Key, redo the authorize step at " +
  "https://go.mynt.in/OAuthlogin/authorize/oauth?client_id=<your clientId>, and paste the fresh one-time code " +
  "into Broker Settings";

// key -> { token, expiresAt }
const sessionCache = new Map();

// Fallback only — Zebu's GenAcsTok response documents `expires_in` (seconds)
// on every successful exchange, so this is rarely used in practice.
const FALLBACK_TTL_MS = 24 * 60 * 60 * 1000;
const EXPIRY_SAFETY_MARGIN_MS = 60 * 1000;

function sha256Hex(str) {
  return createHash("sha256").update(str).digest("hex");
}

/** In-process cache key only — never persisted, never logged. */
function credsKey(creds) {
  return JSON.stringify({
    u: creds?.userId,
    c: creds?.clientId,
    s: creds?.apiSecret,
    a: creds?.authCode,
  });
}

function requireFields(creds) {
  const missing = ["userId", "clientId", "apiSecret", "authCode"].filter((f) => !creds?.[f]);
  if (missing.length) {
    throw new Error(`Zebu credentials missing required field(s): ${missing.join(", ")}`);
  }
}

async function exchangeAuthCode(creds) {
  requireFields(creds);

  const checksum = sha256Hex(`${creds.clientId}${creds.apiSecret}${creds.authCode}`);
  const body = "jData=" + JSON.stringify({ code: creds.authCode, checksum });

  const res = await fetch(TOKEN_EXCHANGE_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body,
  });

  const json = await res.json().catch(() => null);
  if (!res.ok || json?.stat !== "Ok" || !json?.access_token) {
    const emsg = json?.emsg || `HTTP ${res.status}`;
    console.log(`[zebu] auth code exchange failed: ${emsg}`);
    throw new Error(
      `Zebu login failed: ${emsg}. The authorization code is one-time-use and expires within minutes of ` +
        `generating it — ${LOGIN_HELP}.`
    );
  }

  const expiresInSec = Number(json.expires_in);
  const ttlMs = Number.isFinite(expiresInSec) && expiresInSec > 0 ? expiresInSec * 1000 : FALLBACK_TTL_MS;
  const session = {
    token: json.access_token,
    expiresAt: Date.now() + Math.max(ttlMs - EXPIRY_SAFETY_MARGIN_MS, 60_000),
  };
  sessionCache.set(credsKey(creds), session);
  return session;
}

/** Returns a cached, still-valid access_token session or performs the authCode exchange. */
export async function ensureSession(creds) {
  const key = credsKey(creds);
  const cached = sessionCache.get(key);
  if (cached && Date.now() < cached.expiresAt) return cached;
  return exchangeAuthCode(creds);
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
 * POSTs `jData=<json>` (text/plain, `Authorization: Bearer <access_token>`) to a
 * NorenWClientAPI endpoint, injecting uid/actid (Zebu trading user ID) from
 * creds — matches openalgo's verified-working adapter (get_api_response /
 * funds.py both send uid+actid this way). Returns the parsed JSON body as-is
 * (callers check `stat`).
 */
export async function postJData(creds, endpoint, payload = {}) {
  const session = await ensureSession(creds);

  const data = { ...payload, uid: creds.userId, actid: creds.userId };
  const body = "jData=" + JSON.stringify(data);

  const res = await fetch(`${API_BASE}${endpoint}`, {
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
    throw new Error(`Zebu API [${endpoint}] returned a non-JSON response (HTTP ${res.status})`);
  }

  if (json && json.stat !== "Ok" && looksLikeSessionError(json.emsg)) {
    sessionCache.delete(credsKey(creds));
    const err = new Error(`Zebu session expired or invalid on ${endpoint} (${json.emsg}). Please ${LOGIN_HELP}.`);
    // Flags this as unrecoverable within the current request: authCode is
    // single-use, so re-deriving a session here would just re-exchange the
    // same already-consumed code and fail again. Batch-quote callers use this
    // to stop hammering the (doomed) re-auth endpoint for every remaining
    // contract instead of retrying it per-contract.
    err.isSessionError = true;
    throw err;
  }

  return json;
}
