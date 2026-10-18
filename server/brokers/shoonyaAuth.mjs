/**
 * Shoonya (Finvasia) OAuth code exchange and REST transport.
 *
 * Official sources (https://shoonya.com/api-documentation/...):
 *  - manual-authentication-oauth: browser to https://api.shoonya.com/OAuthlogin/authorize/oauth?client_id=<id>;
 *    the redirect carries a short-lived, single-use `code`. Exchange it with POST
 *    https://api.shoonya.com/NorenWClientAPI/GenAcsTok, Content-Type text/plain, body
 *    jData={"code","checksum"} where checksum = SHA-256(client_id + secret_key + code).
 *    Documented response: { stat: "Ok", susertoken, uid, actid }.
 *  - api-structure: REST base https://api.shoonya.com/NorenWClientAPI/, WebSocket wss://api.shoonya.com/NorenWSAPI/;
 *    every authenticated call sends `Authorization: Bearer <AccessToken>` and a text/plain `jData=<json>`
 *    body, and the token is NOT repeated in the body.
 *  - token-renewal: there is no refresh endpoint; an expired token needs the full login again. The
 *    lifetime is not documented, so the cache is kept until the next 05:00 IST (the Noren daily reset)
 *    and any "Session Expired / Invalid Session Key" reply drops it at once.
 *  - error-handling / rate-limits: HTTP 200 with { stat: "Not_Ok", emsg }; "Rate_Limited" on throttling;
 *    orders ~10/s per user; REST market data ~1 request/second per instrument.
 *
 * Conflicts noted (official docs followed):
 *  - Some clients read `access_token` from GenAcsTok; the official page documents `susertoken`. Kambala's
 *    Noren OAuth SDK returns both and uses access_token as the Bearer. We use access_token when present,
 *    else susertoken.
 *  - Some Shoonya endpoint pages still show the older `jData=...&jKey=` form; the API Structure page uses
 *    the Bearer header. Some clients send jKey for TPSeries/EODChartData;
 *    the official Time/Price Series and Historical Data pages show the Bearer header, which we follow.
 */

import { BrokerError, brokerFetch, SessionRequiredError } from "./contract.mjs";
import { createSessionManager, encodeJData, nextIstFiveAmMs, sha256Hex } from "./shoonyaNorenCore.mjs";

export const REST_BASE = "https://api.shoonya.com/NorenWClientAPI";
export const OAUTH_LOGIN_URL = "https://api.shoonya.com/OAuthlogin/authorize/oauth";
export const WS_URL = "wss://api.shoonya.com/NorenWSAPI/";
// Kept for older imports.
export const OAUTH_LOGIN_BASE = OAUTH_LOGIN_URL;

async function exchangeCode(creds) {
  let res;
  try {
    res = await brokerFetch(`${REST_BASE}/GenAcsTok`, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: `jData=${encodeJData({ code: creds.requestCode, checksum: sha256Hex(`${creds.apiKey}${creds.apiSecret}${creds.requestCode}`) })}`,
    });
  } catch (e) {
    throw new BrokerError(`Shoonya login: network error (${e?.message || e})`);
  }
  const json = await res.json().catch(() => null);
  const token = json?.access_token || json?.susertoken;
  if (String(json?.stat).toLowerCase() === "ok" && token) return { token: String(token), expiresAt: nextIstFiveAmMs() };
  if (res.status >= 500 || !json) throw new BrokerError(`Shoonya login: HTTP ${res.status}`);
  throw new SessionRequiredError(
    `Shoonya did not accept the authorisation code (${json.emsg || `HTTP ${res.status}`}). Codes are single use and expire within minutes. ` +
      `Open ${OAUTH_LOGIN_URL}?client_id=<your API client ID>, log in and save the new code.`,
  );
}

export const session = createSessionManager({
  label: "Shoonya",
  keyFields: ["userId", "apiKey", "apiSecret", "requestCode"],
  exchange: exchangeCode,
});

/** REST transport: Bearer header + text/plain jData body. */
export function send(token, endpoint, data) {
  return brokerFetch(`${REST_BASE}${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "text/plain", Authorization: `Bearer ${token}` },
    body: `jData=${encodeJData(data)}`,
  });
}

/** Test helper: forget every cached session and used code. */
export const resetSessions = () => session.reset();
