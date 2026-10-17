/**
 * Nubra (Nuvama Nubra) REST API V3 authentication.
 *
 * Nubra has no paste-a-token model — the session_token used on every
 * authenticated call only comes from an active login, and it is short-lived
 * (a JWT with its own `exp` claim). Two login paths exist per the V3 docs:
 *   - phone-OTP (SMS code) — inherently interactive, cannot run headless.
 *   - TOTP (authenticator-app code) — non-interactive once TOTP has been
 *     enabled on the account, which is a one-time step the user does
 *     themselves (Nubra's app/site walks them through
 *     /totp/generate-secret + /totp/enable and hands them a base32 secret to
 *     add to an authenticator app — that same secret is what this module's
 *     `totpSecret` credential field expects).
 *
 * This mirrors marketcalls/openalgo's `authenticate_broker_totp()`:
 *   1. POST /totp/login   {phone, totp, otp:""}  -> auth_token
 *   2. POST /verifypin    {pin: mpin}             -> session_token
 * headers/base URL match openalgo's broker/nubra/api/baseurl.py, which is the
 * verified-working header set (Authorization + x-device-id [+ Content-Type]).
 *
 * The session is cached in-memory keyed by the raw creds; the session_token's
 * own JWT `exp` claim (unix seconds) sizes the cache instead of a guessed
 * fixed lifetime, with a small safety margin so we re-login slightly before
 * the token actually dies rather than racing an in-flight request against it.
 */

import { generateTOTP } from "../lib/totp.mjs";

export const NUBRA_BASE = "https://api.nubra.io";

// Stable per-deployment device id. The login flow binds the session to
// whatever device id issued it, so every later authenticated call from this
// server MUST reuse the same value.
const DEVICE_ID = "OPTIONSDESK";

export const SESSION_EXPIRED_STATUS = 440; // Nubra's documented "re-auth needed" status

const SAFETY_MARGIN_MS = 60_000; // re-login 60s before the JWT's own exp
const FALLBACK_SESSION_MS = 6 * 60 * 60 * 1000; // only used if the JWT can't be decoded

// In-memory only — never persisted. A server restart forces one fresh TOTP
// login per active user, which is fine (TOTP login is not a hot path).
const sessionCache = new Map();

function credsKey(creds) {
  return JSON.stringify({ p: creds?.phone, m: creds?.mpin, t: creds?.totpSecret });
}

function buildHeaders({ withJson = true, authToken } = {}) {
  const h = { "x-device-id": DEVICE_ID };
  if (withJson) h["Content-Type"] = "application/json";
  if (authToken) h["Authorization"] = `Bearer ${authToken}`;
  return h;
}

/** Decode a JWT's `exp` claim (unix seconds) without verifying the signature — we only need the expiry hint. */
function decodeJwtExpMs(token) {
  try {
    const payload = token.split(".")[1];
    const json = Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf-8");
    const { exp } = JSON.parse(json);
    return typeof exp === "number" ? exp * 1000 : null;
  } catch {
    return null;
  }
}

/** TOTP codes are 6 digits where a leading zero is significant; pad, and reject anything else. */
function normalizeTotp(code) {
  const s = String(code ?? "").trim();
  return /^\d{1,6}$/.test(s) ? s.padStart(6, "0") : null;
}

async function readJson(res) {
  try {
    return await res.json();
  } catch {
    return {};
  }
}

async function totpLogin(creds) {
  const totpStr = normalizeTotp(generateTOTP(creds.totpSecret));
  if (!totpStr) throw new Error("Nubra: could not derive a valid TOTP code from totpSecret");

  // Docs show `totp` as a JSON integer; int() on a leading-zero code drops the
  // zero, which some servers then reject as a string mismatch — hedge with
  // the zero-padded string as a fallback (same trick openalgo's client uses).
  const candidates = [Number(totpStr)];
  if (String(Number(totpStr)) !== totpStr) candidates.push(totpStr);

  let lastError = "TOTP login failed";
  for (const totpVal of candidates) {
    const res = await fetch(`${NUBRA_BASE}/totp/login`, {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify({ phone: creds.phone, totp: totpVal, otp: "" }),
    });
    const json = await readJson(res);
    if (json?.auth_token) return json.auth_token;
    lastError = json?.error || json?.message || `HTTP ${res.status}`;
  }
  throw new Error(`Nubra TOTP login failed: ${lastError}`);
}

async function verifyPin(creds, authToken) {
  const res = await fetch(`${NUBRA_BASE}/verifypin`, {
    method: "POST",
    headers: buildHeaders({ authToken }),
    body: JSON.stringify({ pin: String(creds.mpin) }),
  });
  const json = await readJson(res);
  if (!json?.session_token) {
    throw new Error(`Nubra PIN verification failed: ${json?.error || json?.message || `HTTP ${res.status}`}`);
  }
  return json.session_token;
}

async function loginFresh(creds) {
  const authToken = await totpLogin(creds);
  const sessionToken = await verifyPin(creds, authToken);
  const expMs = decodeJwtExpMs(sessionToken);
  const session = {
    sessionToken,
    expiresAt: (expMs || Date.now() + FALLBACK_SESSION_MS) - SAFETY_MARGIN_MS,
  };
  sessionCache.set(credsKey(creds), session);
  console.log(`[nubra] logged in fresh, session valid until ${new Date(session.expiresAt).toISOString()}`);
  return session;
}

/** Returns a valid cached session, logging in fresh (new TOTP) only if missing/expired. */
export async function getSession(creds) {
  if (!creds?.phone || !creds?.mpin || !creds?.totpSecret) {
    throw new Error("Nubra credentials incomplete — need phone, mpin, totpSecret");
  }
  const key = credsKey(creds);
  const cached = sessionCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached;
  return loginFresh(creds);
}

/**
 * Authenticated Nubra V3 REST call. Retries 429 with exponential backoff (the
 * broker's own documented behaviour under load) and re-logs in once on HTTP
 * 440 (session expired/invalid per the V3 "Errors & Exceptions" docs).
 */
export async function nubraFetch(creds, path, { method = "GET", body } = {}) {
  let session = await getSession(creds);

  const attempt = async (sess) => {
    let delayMs = 1000;
    for (let i = 0; i < 3; i++) {
      const res = await fetch(`${NUBRA_BASE}${path}`, {
        method,
        headers: buildHeaders({ authToken: sess.sessionToken }),
        body: body != null ? JSON.stringify(body) : undefined,
      });
      if (res.status === 429 && i < 2) {
        console.log(`[nubra] rate limited on ${path}, retrying in ${delayMs}ms`);
        await new Promise((r) => setTimeout(r, delayMs));
        delayMs *= 2;
        continue;
      }
      return res;
    }
    throw new Error(`Nubra API rate limit exceeded on ${path}`);
  };

  let res = await attempt(session);
  if (res.status === SESSION_EXPIRED_STATUS) {
    console.log(`[nubra] session expired (HTTP 440) on ${path}, re-authenticating`);
    sessionCache.delete(credsKey(creds));
    session = await loginFresh(creds);
    res = await attempt(session);
  }

  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* non-JSON error body */
  }

  if (!res.ok) {
    const detail = json?.error || json?.message || text.slice(0, 200) || `HTTP ${res.status}`;
    throw new Error(`Nubra API error [${res.status}] on ${path}: ${detail}`);
  }
  return json;
}
