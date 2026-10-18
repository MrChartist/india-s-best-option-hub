/**
 * 5paisa session login (contract auth.kind "sessionLogin") and the authenticated request helpers.
 *
 * Official docs (Xstream, checked 2026-10): https://xstream.5paisa.com/dev-docs/
 *   - TOTP login:     POST https://Openapi.5paisa.com/VendorsAPI/Service1.svc/TOTPLogin
 *                     { head: { Key }, body: { Email_ID, TOTP, PIN } } -> body.RequestToken
 *   - Access token:   POST .../Service1.svc/GetAccessToken (user-authentication-system/access-token)
 *                     { head: { Key }, body: { RequestToken, EncryKey, UserId } } -> body.AccessToken, body.ClientCode
 *                     "Token expires every day at 11:59 PM."
 *   - Every data/order call: header `Authorization: bearer <AccessToken>`, body { head: { key }, body: { ClientCode, ... } }.
 *   - Envelope: head.status "0" success, "2" invalid head parameters (bad user key, body null);
 *     body.Status 0 success, 1 "no records", 2 invalid input, 9 "Invalid Session" / "Authentication Fails".
 *     A missing token is answered with the plain text "Invalid Token".
 *
 * The user types the PIN and the current 6-digit TOTP code in Broker Settings; login() runs once and returns
 * only { sessionToken (AccessToken), sessionClientCode }. After 23:59 IST, or when 5paisa reports the session
 * dead, calls throw SessionRequiredError and the user logs in again. The PIN and code are never stored,
 * cached or logged.
 */

import { BrokerError, brokerFetch, SessionRequiredError } from "./contract.mjs";
import { readTotpCode, requireFields as requireCreds, sessionFromCreds } from "./sessionLogin.mjs";

export const LOGIN_FIELDS = [
  { key: "pin", label: "5paisa PIN", kind: "secret" },
  { key: "totpCode", label: "6-digit TOTP code", kind: "totp" },
];
export const SESSION_FIELDS = ["sessionToken", "sessionClientCode"];

export const BASE = "https://Openapi.5paisa.com/VendorsAPI/Service1.svc";
/** Host of the V2 historical-candles endpoint (documented in lower case, outside Service1.svc). */
export const HISTORY_BASE = "https://openapi.5paisa.com";

/** Today's 23:59 IST as epoch ms, whatever the host's own timezone. */
function istEndOfDay(now = new Date()) {
  const istDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  return new Date(`${istDate}T23:59:00+05:30`).getTime();
}

async function readJson(res, label) {
  const text = await res.text();
  try {
    return { json: JSON.parse(text), text };
  } catch {
    return { json: null, text, label };
  }
}

function upstream(message, code = "UPSTREAM_ERROR") {
  return new BrokerError(message, { code, statusCode: 502 });
}

/** POST JSON to a Service1.svc path. Login calls pass no token. */
export async function postJson(path, body, accessToken) {
  const headers = { "Content-Type": "application/json", Accept: "application/json" };
  // 5paisa documents the lower-case "bearer" scheme.
  if (accessToken) headers.Authorization = `bearer ${accessToken}`;
  const res = await brokerFetch(`${BASE}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
  const { json, text } = await readJson(res);
  if (accessToken && /invalid token/i.test(text) && !json) {
    throw new SessionRequiredError("5paisa rejected the access token. Log in again from Broker Settings.");
  }
  if (res.status === 429) throw upstream(`5paisa API [${path}] rate limit reached (HTTP 429)`, "UPSTREAM_RATE_LIMIT");
  if (!json) throw upstream(`5paisa API [${path}] returned a non-JSON response (HTTP ${res.status})`);
  if (!res.ok) {
    throw upstream(`5paisa API [${path}] error (HTTP ${res.status}): ${json?.body?.Message || json?.head?.statusDescription || "request failed"}`);
  }
  return json;
}

/** One TOTP login with the user-typed PIN + code. Returns only the session fields. */
export async function login(creds) {
  requireCreds(creds, ["userKey", "clientCode", "pin", "encryptionKey", "userId"], "5paisa");
  const totp = readTotpCode(creds);

  // Step 1: Email_ID (login id / client code / mobile) + TOTP + PIN -> RequestToken. head.Key is capitalised here.
  const totpRes = await postJson("/TOTPLogin", {
    head: { Key: creds.userKey },
    body: { Email_ID: creds.clientCode, TOTP: totp, PIN: creds.pin },
  });
  const requestToken = totpRes?.body?.RequestToken;
  if (!requestToken) {
    throw upstream(`5paisa TOTP login failed: ${totpRes?.body?.Message || totpRes?.head?.statusDescription || "no RequestToken in response"}`, "UPSTREAM_AUTH");
  }

  // Step 2: RequestToken -> AccessToken + the broker-assigned ClientCode (creds.clientCode may be the login e-mail).
  const tokenRes = await postJson("/GetAccessToken", {
    head: { Key: creds.userKey },
    body: { RequestToken: requestToken, EncryKey: creds.encryptionKey, UserId: creds.userId },
  });
  const accessToken = tokenRes?.body?.AccessToken;
  if (!accessToken) {
    throw upstream(`5paisa access-token exchange failed: ${tokenRes?.body?.Message || tokenRes?.head?.statusDescription || "no AccessToken in response"}`, "UPSTREAM_AUTH");
  }
  return {
    session: { sessionToken: String(accessToken), sessionClientCode: String(tokenRes?.body?.ClientCode || creds.clientCode) },
    expiresAt: istEndOfDay(),
  };
}

/** The stored session { accessToken, clientCode }. Throws SessionRequiredError when absent or expired. */
export function ensureSession(creds) {
  const s = sessionFromCreds(creds, SESSION_FIELDS, "5paisa");
  return { accessToken: s.sessionToken, clientCode: s.sessionClientCode || creds.clientCode };
}

/** body.Status 9 / "Invalid Session" / "Authentication Fails": the session is dead (sent with HTTP 200). */
export function isSessionInvalidBody(json) {
  if (Number(json?.body?.Status) === 9) return true;
  return /invalid session|authentication fails/i.test(String(json?.body?.Message || json?.head?.statusDescription || ""));
}

/**
 * Authenticated POST. `buildBody(session)` returns the inner `body`; the head ({ key: userKey }) is added here.
 * Session death throws SessionRequiredError (no stored secret to re-login with); a head.status "2" means the
 * stored user key is wrong.
 */
export async function authenticatedPost(creds, path, buildBody) {
  const session = ensureSession(creds);
  const json = await postJson(path, { head: { key: creds.userKey }, body: buildBody(session) }, session.accessToken);
  if (isSessionInvalidBody(json)) {
    throw new SessionRequiredError("5paisa reports the session is no longer valid. Log in again from Broker Settings.");
  }
  if (String(json?.head?.status) === "2") {
    throw upstream(`5paisa API [${path}]: ${json?.head?.statusDescription || "Invalid head parameters"} (check the User Key in Broker Settings)`, "UPSTREAM_AUTH");
  }
  return json;
}

/** Authenticated GET on the historical host (path must start with "/V2/"). */
export async function authenticatedGet(creds, path) {
  const session = ensureSession(creds);
  const res = await brokerFetch(`${HISTORY_BASE}${path}`, {
    method: "GET",
    headers: { Authorization: `bearer ${session.accessToken}`, Accept: "application/json" },
  });
  const { json, text } = await readJson(res);
  if (res.status === 401 || (!json && /invalid token/i.test(text))) {
    throw new SessionRequiredError("5paisa rejected the access token. Log in again from Broker Settings.");
  }
  if (res.status === 429) throw upstream("5paisa historical API rate limit reached (HTTP 429)", "UPSTREAM_RATE_LIMIT");
  if (!json) throw upstream(`5paisa historical API returned a non-JSON response (HTTP ${res.status})`);
  if (!res.ok) throw upstream(`5paisa historical API error (HTTP ${res.status})`);
  return json;
}
