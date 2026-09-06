/**
 * Tradejini (CubePlus) authentication.
 *
 * Login is `POST /api-gw/oauth/individual-token-v2` with the app's API key as a
 * bare Bearer token, and `password` (the CubePlus login PIN — NOT the account
 * password) + a fresh 2FA code as form fields. Verified against
 * marketcalls/openalgo's production broker/tradejini/api/auth_api.py, the only
 * available reference for this broker (no public API docs mirror exists).
 *
 * We always send `twoFaTyp: "totp"` and derive the code from a user-supplied
 * base32 TOTP secret, so credentials work unattended (no per-login OTP prompt).
 * The response carries `expires_in` (seconds) — we cache the session for that
 * window (minus a safety buffer) instead of re-logging in on every call, since
 * Tradejini's login endpoint is gated by a static-IP allowlist and repeated
 * logins would burn through whatever attempt budget that gate allows.
 *
 * Every authenticated call downstream (WebSocket included) uses the paired
 * token `Authorization: Bearer <apiKey>:<accessToken>` — see docs comment in
 * auth_api.py ("every authenticated call sends Bearer <api_key>:<access_token>").
 *
 * NEVER log creds, the TOTP secret, or the access token — field names / HTTP
 * status codes only.
 */

import { generateTOTP } from "../lib/totp.mjs";

const AUTH_BASE = "https://api.tradejini.com/v2";
const LOGIN_PATH = "/api-gw/oauth/individual-token-v2";

// In-memory only — a server restart forces one fresh login per active user.
const sessionCache = new Map();

function credKey(creds) {
  return JSON.stringify({ a: creds?.apiKey, p: creds?.password, t: creds?.totpSecret });
}

async function loginFresh(creds) {
  if (!creds?.apiKey || !creds?.password || !creds?.totpSecret) {
    throw new Error("Tradejini credentials incomplete — apiKey, password, and totpSecret are all required");
  }

  let totp;
  try {
    totp = generateTOTP(creds.totpSecret);
  } catch {
    throw new Error("Tradejini: totpSecret is not a valid base32 TOTP secret");
  }

  const body = new URLSearchParams({ password: creds.password, twoFa: totp, twoFaTyp: "totp" });

  const res = await fetch(`${AUTH_BASE}${LOGIN_PATH}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${creds.apiKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const json = await res.json().catch(() => ({}));

  if (!res.ok || !json.access_token) {
    const msg = json.msg || json.message || `HTTP ${res.status}`;
    if (res.status === 401) {
      throw new Error(
        `Tradejini login unauthorized: ${msg}. Check, in order: password must be your CubePlus login ` +
        `PIN (not your account password); this app's static IP must be whitelisted in the Tradejini ` +
        `developer portal; apiKey must be the app API key; and the TOTP secret must be current.`
      );
    }
    throw new Error(`Tradejini login failed: ${msg}`);
  }

  const tokenType = String(json.token_type || "").toLowerCase();
  if (tokenType && tokenType !== "bearer") {
    throw new Error(`Tradejini login returned an unexpected token type: ${json.token_type}`);
  }

  const expiresInSec = Number(json.expires_in) || 24 * 60 * 60;
  const session = {
    apiKey: creds.apiKey,
    accessToken: json.access_token,
    // Renew 60s early so an in-flight request never races the real expiry.
    expiresAt: Date.now() + Math.max(expiresInSec - 60, 60) * 1000,
  };
  sessionCache.set(credKey(creds), session);
  return session;
}

/** Returns a valid cached session, logging in fresh (new TOTP code) if missing/expired. */
export async function getSession(creds) {
  const key = credKey(creds);
  const cached = sessionCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached;
  return loginFresh(creds);
}

export function invalidateSession(creds) {
  sessionCache.delete(credKey(creds));
}

/** The paired token every authenticated Tradejini call (REST + WebSocket) expects. */
export function pairedToken(session) {
  return `${session.apiKey}:${session.accessToken}`;
}
