/**
 * Definedge Securities (Integrate API) session login and REST transport.
 *
 * Official sources (checked 2026-10): Definedge's own Python client pyintegrate 3.0.0 (MIT,
 * https://github.com/Definedge-Securities/pyintegrate , integrate/connect.py and tests/mock_responses/*.json)
 * and https://www.definedgesecurities.com/api-documentation/ (behind a bot wall from this environment).
 *  1. GET  https://signin.definedgesecurities.com/auth/realms/debroking/dsbpkc/login/{api_token}
 *     header `api_secret: <api secret>` -> { otp_token, message: "Enter OTP/TOTP" }
 *  2. POST https://signin.definedgesecurities.com/auth/realms/debroking/dsbpkc/token
 *     { otp_token, otp, ac: SHA-256(otp_token + otp + api_secret) }
 *     -> { stat: "Ok", uid, actid, api_session_key, susertoken, ... }   (stat other than "Ok" carries emsg)
 *  3. Every REST call sends `Authorization: <api_session_key>` (no "Bearer"). The WebSocket key is susertoken.
 *  `otp` is either the SMS/e-mail OTP or the "External TOTP" from an authenticator app (enable it at
 *  https://myaccount.definedgesecurities.com/security). A one-shot server login can only use the TOTP: the
 *  user types the CURRENT 6-digit code in the Log in dialog and steps 1 and 2 run back to back.
 *  Errors: { status: "ERROR", message } (a dead session says "Session Expired"); success { status: "SUCCESS" }.
 *  Session lifetime is not published; the session is treated as ending at the next IST midnight.
 *
 * Contract auth kind "sessionLogin": login() returns only { apiSessionKey, wsSessionKey, uid, actid }. The
 * TOTP code is never stored, cached or logged. A key pasted into creds.apiSessionKey (the older manual flow)
 * still works because it is the same session field.
 */

import { BrokerError, brokerFetch, SessionRequiredError } from "./contract.mjs";
import { nextIstMidnightMs, readTotpCode, requireFields, sessionFromCreds } from "./sessionLogin.mjs";
import { createHash } from "node:crypto";

export const SIGNIN_BASE = "https://signin.definedgesecurities.com/auth/realms/debroking/dsbpkc";
export const TRADE_BASE = "https://integrate.definedgesecurities.com/dart/v1";
export const DATA_BASE = "https://data.definedgesecurities.com/sds";

export const LOGIN_FIELDS = [{ key: "totpCode", label: "6-digit External TOTP code", kind: "totp" }];
export const SESSION_FIELDS = ["apiSessionKey", "wsSessionKey", "uid", "actid"];

const MAX_RETRIES = 2;
const sha256Hex = (s) => createHash("sha256").update(String(s)).digest("hex");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function readJson(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

/** Steps 1 + 2 with the user-typed TOTP code. Returns only the session fields. */
export async function login(creds) {
  requireFields(creds, ["apiToken", "apiSecret"], "Definedge");
  const otp = readTotpCode(creds); // refuse a malformed code before any network call
  const apiToken = String(creds.apiToken).trim();
  const apiSecret = String(creds.apiSecret);
  let res;
  try {
    res = await brokerFetch(`${SIGNIN_BASE}/login/${encodeURIComponent(apiToken)}`, { method: "GET", headers: { api_secret: apiSecret } });
  } catch (e) {
    throw new BrokerError(`Definedge login: network error (${e?.message || e})`);
  }
  const step1 = await readJson(res);
  const otpToken = step1?.otp_token ? String(step1.otp_token) : "";
  if (!res.ok || !otpToken) {
    if (res.status >= 500) throw new BrokerError(`Definedge login: HTTP ${res.status}`);
    throw new SessionRequiredError(`Definedge did not accept the API token and secret (${step1?.message || step1?.emsg || `HTTP ${res.status}`}).`);
  }
  try {
    res = await brokerFetch(`${SIGNIN_BASE}/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ otp_token: otpToken, otp, ac: sha256Hex(`${otpToken}${otp}${apiSecret}`) }),
    });
  } catch (e) {
    throw new BrokerError(`Definedge login: network error (${e?.message || e})`);
  }
  const step2 = await readJson(res);
  if (!res.ok || String(step2?.stat || "").toLowerCase() !== "ok" || !step2?.api_session_key) {
    if (res.status >= 500) throw new BrokerError(`Definedge login: HTTP ${res.status}`);
    throw new SessionRequiredError(
      `Definedge login failed (${step2?.emsg || step2?.message || `HTTP ${res.status}`}). Check that External TOTP is enabled on your account and enter a fresh code.`,
    );
  }
  const session = { apiSessionKey: String(step2.api_session_key) };
  if (step2.susertoken) session.wsSessionKey = String(step2.susertoken);
  if (step2.uid) session.uid = String(step2.uid);
  if (step2.actid) session.actid = String(step2.actid);
  return { session, expiresAt: nextIstMidnightMs() };
}

/** The stored session. Throws SessionRequiredError when absent or expired. */
export function getSession(creds) {
  return sessionFromCreds(creds, SESSION_FIELDS, "Definedge");
}

/**
 * Authenticated GET/POST. Returns parsed JSON, or the raw text when `text` is set (historical CSV).
 * 401 or a "Session Expired" message -> SessionRequiredError; 429 retried with backoff (Retry-After honoured);
 * { status: "ERROR" } or non-2xx -> BrokerError with Definedge's message.
 */
export async function definedgeFetch(creds, path, { method = "GET", body, base = TRADE_BASE, text = false, what = path } = {}) {
  const { apiSessionKey } = getSession(creds);
  const headers = { Authorization: apiSessionKey };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await brokerFetch(`${base}${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
    } catch (e) {
      throw new BrokerError(`Definedge ${what}: network error (${e?.message || e})`);
    }
    if (res.status === 429 && attempt < MAX_RETRIES) {
      const retryAfter = Number(res.headers.get("retry-after"));
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 5) * 1000 : 1000 * 2 ** attempt);
      continue;
    }
    const raw = await res.text();
    let json = null;
    try {
      json = raw ? JSON.parse(raw) : null;
    } catch {
      json = null;
    }
    const message = (json && (json.message || json.emsg)) || "";
    if (res.status === 401 || /session\s*expired|invalid\s*session/i.test(message)) {
      throw new SessionRequiredError("Definedge session has expired. Log in again from Broker Settings.");
    }
    if (res.status === 429) throw new BrokerError(`Definedge ${what}: rate limit reached. Try again shortly.`, { code: "UPSTREAM_RATE_LIMIT" });
    if (!res.ok || (json && String(json.status || "").toUpperCase() === "ERROR")) {
      throw new BrokerError(`Definedge ${what} failed (HTTP ${res.status}): ${message || raw.slice(0, 160) || "no details"}`);
    }
    if (text) return raw;
    if (json === null) throw new BrokerError(`Definedge ${what}: unexpected non-JSON response`);
    return json;
  }
}
