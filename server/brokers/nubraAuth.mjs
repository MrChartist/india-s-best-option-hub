/**
 * Nubra (Zanskar Securities) REST API V3 authentication and transport.
 *
 * Official sources (checked 2026-10): https://nubra.io/products/api/docs/rest-api-v3/authentication.html ,
 * errors_and_exceptions.html, RateLimits.html, and Nubra's own Python SDK (nubra-sdk 0.5.4 on PyPI,
 * nubra_python_sdk/start_sdk.py `_totp_login`). The REST page documents only the SMS-OTP path
 * (/sendphoneotp -> /verifyphoneotp -> /verifypin); the TOTP path below (POST /totp/login with
 * { phone, totp: <int>, otp: "" }, HTTP 201 -> auth_token) is the one the official SDK uses.
 *
 * Nubra has no paste-a-token model — the session_token used on every
 * authenticated call only comes from an active login, and it is short-lived
 * (a JWT with its own `exp` claim). Two login paths exist (REST docs + official SDK):
 *   - phone-OTP (SMS code) — inherently interactive, cannot run headless.
 *   - TOTP (authenticator-app code), once TOTP is enabled on the account.
 *
 * Session login (contract auth.kind "sessionLogin") uses the TOTP path with the CURRENT 6-digit code
 * the user types in Broker Settings, plus their MPIN:
 *   1. POST /totp/login   {phone, totp, otp:""}  -> auth_token
 *   2. POST /verifypin    {pin: mpin}             -> session_token
 * (headers: Authorization + x-device-id [+ Content-Type]). login() returns only { sessionToken };
 * its expiresAt comes from the JWT's own `exp` claim minus a safety margin. HTTP 440 (Nubra's
 * documented "re-auth needed") throws SessionRequiredError. The MPIN and code are never stored,
 * cached or logged.
 */

import { BrokerError, brokerFetch, SessionRequiredError } from "./contract.mjs";
import { readTotpCode, requireFields, sessionFromCreds } from "./sessionLogin.mjs";

export const NUBRA_BASE = "https://api.nubra.io";

// Stable per-deployment device id. The login flow binds the session to
// whatever device id issued it, so every later authenticated call from this
// server MUST reuse the same value.
const DEVICE_ID = "OPTIONSDESK";

export const SESSION_EXPIRED_STATUS = 440; // Nubra's documented "re-auth needed" status

const SAFETY_MARGIN_MS = 60_000; // re-login 60s before the JWT's own exp
const FALLBACK_SESSION_MS = 6 * 60 * 60 * 1000; // only used if the JWT can't be decoded

export const LOGIN_FIELDS = [
  { key: "mpin", label: "Nubra MPIN", kind: "secret" },
  { key: "totpCode", label: "6-digit TOTP code", kind: "totp" },
];
export const SESSION_FIELDS = ["sessionToken"];

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

async function readJson(res) {
  try {
    return await res.json();
  } catch {
    return {};
  }
}

async function totpLogin(creds) {
  const totpStr = readTotpCode(creds);
  let res;
  try {
    // The official SDK sends `totp` as a JSON integer (int(totp)); the docs never show a string form.
    res = await brokerFetch(`${NUBRA_BASE}/totp/login`, {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify({ phone: String(creds.phone).trim(), totp: Number(totpStr), otp: "" }),
    });
  } catch (e) {
    throw new BrokerError(`Nubra login: network error (${e?.message || e})`);
  }
  const json = await readJson(res);
  if (json?.auth_token) return String(json.auth_token);
  if (res.status >= 500) throw new BrokerError(`Nubra login: HTTP ${res.status}`);
  throw new SessionRequiredError(`Nubra TOTP login failed (${json?.error || json?.message || `HTTP ${res.status}`}). Check that TOTP is enabled on your Nubra account and enter a fresh code.`);
}

async function verifyPin(creds, authToken) {
  let res;
  try {
    res = await brokerFetch(`${NUBRA_BASE}/verifypin`, {
      method: "POST",
      headers: buildHeaders({ authToken }),
      body: JSON.stringify({ pin: String(creds.mpin) }),
    });
  } catch (e) {
    throw new BrokerError(`Nubra login: network error (${e?.message || e})`);
  }
  const json = await readJson(res);
  if (json?.session_token) return String(json.session_token);
  if (res.status >= 500) throw new BrokerError(`Nubra login: HTTP ${res.status}`);
  throw new SessionRequiredError(`Nubra MPIN verification failed (${json?.error || json?.message || `HTTP ${res.status}`}).`);
}

/** One TOTP + PIN login with the user-typed values. Returns only the session token. */
export async function login(creds) {
  requireFields(creds, ["phone", "mpin"], "Nubra");
  readTotpCode(creds); // refuse a malformed code before any network call
  const authToken = await totpLogin(creds);
  const sessionToken = await verifyPin(creds, authToken);
  const expMs = decodeJwtExpMs(sessionToken);
  return {
    session: { sessionToken: String(sessionToken) },
    expiresAt: (expMs || Date.now() + FALLBACK_SESSION_MS) - SAFETY_MARGIN_MS,
  };
}

/** The stored session { sessionToken }. Throws SessionRequiredError when absent or expired. */
export function getSession(creds) {
  return sessionFromCreds(creds, SESSION_FIELDS, "Nubra");
}

/**
 * Authenticated Nubra V3 REST call. 429 is retried twice with backoff; HTTP 440 (documented "session expired,
 * invalid or no longer usable") and 401 throw SessionRequiredError; other failures throw BrokerError with
 * Nubra's `error` text ({ error, nubra_error_code } is the documented V3 error shape).
 */
export async function nubraFetch(creds, path, { method = "GET", body, what = path } = {}) {
  const { sessionToken } = getSession(creds);
  let res;
  let delayMs = 1000;
  for (let i = 0; ; i++) {
    try {
      res = await brokerFetch(`${NUBRA_BASE}${path}`, {
        method,
        headers: buildHeaders({ withJson: body !== undefined, authToken: sessionToken }),
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      throw new BrokerError(`Nubra ${what}: network error (${e?.message || e})`);
    }
    if (res.status !== 429 || i >= 2) break;
    await new Promise((r) => setTimeout(r, delayMs));
    delayMs *= 2;
  }
  if (res.status === SESSION_EXPIRED_STATUS || res.status === 401) {
    throw new SessionRequiredError("Nubra session expired. Log in again from Broker Settings.");
  }
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (res.status === 429) throw new BrokerError(`Nubra ${what}: rate limit reached. Try again shortly.`, { code: "UPSTREAM_RATE_LIMIT" });
  if (!res.ok) {
    const detail = json?.error || json?.message || text.slice(0, 160) || `HTTP ${res.status}`;
    throw new BrokerError(`Nubra ${what} failed (HTTP ${res.status}): ${detail}`);
  }
  if (json === null) throw new BrokerError(`Nubra ${what}: unexpected non-JSON response`);
  return json;
}
