/**
 * Profitmart Securities (ProfitMax API) OAuth code exchange and REST transport.
 *
 * Profitmart runs Kambala's Noren OMS. Official docs: https://profitmax.profitmart.in/ApiDocs/docs/intro
 *  - "OAuth Flow": the user opens the OAuth URL, logs in and is redirected with `?code=<uuid>`; the code is
 *    exchanged with a SHA-256 checksum of Client ID + Client Secret + code, and the access token returned
 *    goes in the Authorization header of every later call.
 *  - "GenAcsTok": POST <root>/NorenWClientAPI/GenAcsTok, Content-Type text/plain, body
 *    jData={"code","checksum"}. Response: access_token, refresh_token, expires_in, susertoken, actid, uid,
 *    prarr, stat ("Ok" / "Not_Ok" with emsg).
 *  - Every endpoint page (Place Order, Holdings, TPSeries ...) shows `Authorization: Bearer <token>` and a
 *    text/plain `jData=<json>` body, with no jKey.
 *
 * Host. The doc examples use the vendor placeholder host api.kambala.co.in, and the official SDKs
 * (github.com/ProfitmartAPI) point at Kambala test hosts. The production host below was confirmed on
 * 18 Oct 2026 by plain unauthenticated GET requests only: /NorenWClientAPI/GenAcsTok and /UserDetails
 * answer 405 (POST-only endpoints exist), /OAuthlogin/authorize/oauth serves the login page and the
 * NFO/BFO/NSE symbol ZIPs download. It still needs one live login on a Profitmart account.
 *
 * Token lifetime: `expires_in` is honoured (seconds, or an epoch timestamp); without it the token is kept
 * until 05:00 IST, the Noren daily reset. No refresh call is made: the docs do not show the refresh
 * request, so an expired token needs a fresh login code.
 */

import { BrokerError, brokerFetch, SessionRequiredError } from "./contract.mjs";
import { createSessionManager, encodeJData, nextIstFiveAmMs, sha256Hex } from "./shoonyaNorenCore.mjs";

export const HOST = "https://profitmax.profitmart.in";
export const REST_ROOT = `${HOST}/NorenWClientAPI`;
export const OAUTH_LOGIN_URL = `${HOST}/OAuthlogin/authorize/oauth`;

/** expires_in: epoch seconds when it looks like a timestamp, else a duration in seconds; fallback 05:00 IST. */
export function resolveExpiresAt(expiresIn, now = Date.now()) {
  const n = Number(expiresIn);
  if (!Number.isFinite(n) || n <= 0) return nextIstFiveAmMs(now);
  const at = n > 1_000_000_000 ? n * 1000 : now + n * 1000;
  return Math.min(at, nextIstFiveAmMs(now));
}

async function exchangeCode(creds) {
  let res;
  try {
    res = await brokerFetch(`${REST_ROOT}/GenAcsTok`, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: `jData=${encodeJData({ code: creds.requestCode, checksum: sha256Hex(`${creds.apiKey}${creds.apiSecret}${creds.requestCode}`) })}`,
    }, { kind: "login", label: "Profitmart" });
  } catch (e) {
    if (e instanceof BrokerError) throw e;
    throw new BrokerError(`Profitmart login: network error (${e?.message || e})`);
  }
  const json = await res.json().catch(() => null);
  const token = json?.access_token || json?.susertoken;
  if (String(json?.stat ?? "Ok").toLowerCase() === "ok" && token) {
    return { token: String(token), expiresAt: resolveExpiresAt(json.expires_in) };
  }
  if (res.status >= 500 || !json) throw new BrokerError(`Profitmart login: HTTP ${res.status}`);
  throw new SessionRequiredError(
    `Profitmart did not accept the login code (${json.emsg || `HTTP ${res.status}`}). Codes are single use and expire within minutes. ` +
      `Open ${OAUTH_LOGIN_URL}?client_id=<your client ID>, log in and save the new code.`,
  );
}

export const session = createSessionManager({
  label: "Profitmart",
  keyFields: ["clientId", "apiKey", "apiSecret", "requestCode"],
  exchange: exchangeCode,
});

/** REST transport: Bearer header + text/plain jData body (official endpoint pages). */
export function send(token, endpoint, data) {
  return brokerFetch(`${REST_ROOT}${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "text/plain", Authorization: `Bearer ${token}` },
    body: `jData=${encodeJData(data)}`,
  }, { label: "Profitmart" });
}

/** Test helper: forget every cached session and used code. */
export const resetSessions = () => session.reset();
