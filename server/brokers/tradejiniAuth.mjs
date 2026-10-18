/**
 * Tradejini (CubePlus) — session login + REST client.
 *
 * Official docs (checked 2026-10): https://developer.tradejini.com/docs/api-basics,
 * /docs/authorization/updatedIndividualToken and /docs/authorization-flow/individual-apps.
 *  - POST https://api.tradejini.com/v2/api-gw/oauth/individual-token-v2, `Authorization: Bearer <api_key>`,
 *    form body { password, twoFa, twoFaTyp: "totp" } -> { access_token, token_type: "bearer", expires_in (s) }.
 *    The docs describe `password` as "your login password" (it is sometimes called the CubePlus PIN; the
 *    official wording is followed in the prompt label). 401 = wrong password / 2FA, or a non-whitelisted IP. 3 req/s per IP.
 *  - Every other call: `Authorization: Bearer <api_key>:<access_token>`. GET/DELETE take query parameters,
 *    POST/PUT take application/x-www-form-urlencoded bodies. Responses are { s: "ok"|"error"|"no-data", d, msg }.
 *  - Access tokens last 24 hours; an expired token answers 401 Unauthorized.
 *
 * Session login (contract auth.kind "sessionLogin"): the user types the password and the CURRENT 6-digit TOTP
 * code in Broker Settings; login() returns only { sessionToken }. Nothing re-logs in automatically: a 401 on a
 * data call throws SessionRequiredError and the user logs in again.
 *
 * NEVER log creds, the password, the TOTP code or the access token — field names / HTTP status codes only.
 */

import { BrokerError, brokerFetch, SessionRequiredError } from "./contract.mjs";
import { readTotpCode, requireFields, sessionFromCreds } from "./sessionLogin.mjs";

export const BASE_URL = "https://api.tradejini.com/v2";
const LOGIN_PATH = "/api-gw/oauth/individual-token-v2";

export const LOGIN_FIELDS = [
  { key: "password", label: "Tradejini login password", kind: "secret" },
  { key: "totpCode", label: "6-digit TOTP code", kind: "totp" },
];
export const SESSION_FIELDS = ["sessionToken"];

/** One login with the user-typed password + code. Returns only the session token. */
export async function login(creds) {
  requireFields(creds, ["apiKey", "password"], "Tradejini");
  const totp = readTotpCode(creds);

  const res = await brokerFetch(`${BASE_URL}${LOGIN_PATH}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${creds.apiKey}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ password: creds.password, twoFa: totp, twoFaTyp: "totp" }),
  });
  const json = await res.json().catch(() => ({}));

  if (!res.ok || !json.access_token) {
    const msg = String(json.msg || json.message || `HTTP ${res.status}`).slice(0, 160);
    if (res.status === 401) {
      throw new BrokerError(
        `Tradejini login unauthorised [401]: ${msg}. Check the login password, that the 6-digit code is the current one, ` +
          "that the API key is the app's key and that this machine's static IP is whitelisted for the app.",
        { code: "UPSTREAM_AUTH" },
      );
    }
    if (res.status === 429) throw new BrokerError("Tradejini login rate limit [429]: wait a few seconds and try again.", { code: "UPSTREAM_RATE_LIMIT" });
    throw new BrokerError(`Tradejini login failed [${res.status}]: ${msg}`);
  }
  const tokenType = String(json.token_type || "").toLowerCase();
  if (tokenType && tokenType !== "bearer") throw new BrokerError(`Tradejini login returned an unexpected token type: ${json.token_type}`);

  const expiresInSec = Number(json.expires_in) || 24 * 60 * 60;
  return {
    session: { sessionToken: String(json.access_token) },
    // Expire 60 s early so an in-flight request never races the real expiry.
    expiresAt: Date.now() + Math.max(expiresInSec - 60, 60) * 1000,
  };
}

/** The stored session { apiKey, accessToken }. Throws SessionRequiredError when absent or expired. */
export function getSession(creds) {
  requireFields(creds, ["apiKey"], "Tradejini");
  return { apiKey: String(creds.apiKey), accessToken: sessionFromCreds(creds, SESSION_FIELDS, "Tradejini").sessionToken };
}

/** The paired token every authenticated Tradejini call (REST + WebSocket) expects. */
export function pairedToken(session) {
  return `${session.apiKey}:${session.accessToken}`;
}

/**
 * Authenticated REST call. Returns `d` (or null for s: "no-data"). 401 -> SessionRequiredError (no re-login),
 * anything else that is not s: "ok" -> BrokerError 502 "Tradejini error [<http>]: <msg>".
 */
export async function tjRequest(creds, path, { method = "GET", query, form } = {}) {
  const session = getSession(creds);
  const url = new URL(`${BASE_URL}${path}`);
  for (const [k, v] of Object.entries(query || {})) if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  const headers = { Authorization: `Bearer ${pairedToken(session)}`, Accept: "application/json" };
  let body;
  if (form) {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(form)) if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
    body = p;
  }
  const res = await brokerFetch(url.toString(), { method, headers, body });
  const json = await res.json().catch(() => null);
  if (res.status === 401) throw new SessionRequiredError("Tradejini: your session has expired or was rejected. Log in again from Broker Settings.");
  if (json?.s === "no-data") return null;
  if (!res.ok || !json || json.s !== "ok") {
    const msg = String(json?.msg || json?.d?.msg || `HTTP ${res.status}`).slice(0, 200);
    throw new BrokerError(`Tradejini error [${res.status}]: ${msg}`);
  }
  return json.d ?? null;
}
