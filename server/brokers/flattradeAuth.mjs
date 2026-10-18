/**
 * Flattrade (Pi / PiConnect API) session exchange and REST transport.
 *
 * Official source: https://pi.flattrade.in/docs (v2.0, last updated 31 Mar 2026), sections "Login Flow",
 * "API Rate Limit", "Order API Rate Limit" and every endpoint page.
 *  1. The user opens https://auth.flattrade.in/?app_key=<API key>, signs in (Client ID, password, PAN/DOB)
 *     and is redirected to the registered URL with ?request_code=... (single use, valid a few minutes).
 *  2. POST https://authapi.flattrade.in/trade/apitoken with JSON
 *     { api_key, request_code, api_secret: SHA-256(api_key + request_code + api_secret) }.
 *     Success: { token, client, status: "Ok", emsg: "" }. The token is returned only when the request
 *     comes from the static IP registered for the API key.
 *  3. Every REST call: POST https://piconnect.flattrade.in/PiConnectAPI/<Endpoint> with the body
 *     `jData=<json>&jKey=<token>` (the docs' curl examples send Content-Type: application/json).
 *  Token lifetime: 24 hours, and tokens are cleared between 5 and 6 AM IST every day.
 *  Rate limits: 40 requests/second and 200/minute for data calls; 10/second and 40/minute for orders.
 *
 * Notes (we follow the official docs):
 *  - The docs' token response uses "status": "Ok"; some clients check "stat". Both are accepted here.
 *  - Some clients post most calls as application/x-www-form-urlencoded; the docs use application/json.
 *    The gateway parses the body the same way either way (it is not URL-decoded, see encodeJData()).
 *
 * Nothing secret is logged. Session tokens live only in this process (see createSessionManager).
 */

import { BrokerError, brokerFetch, SessionRequiredError } from "./contract.mjs";
import { createSessionManager, encodeJData, nextIstFiveAmMs, sha256Hex } from "./shoonyaNorenCore.mjs";

export const PI_BASE = "https://piconnect.flattrade.in/PiConnectAPI";
export const AUTH_TOKEN_URL = "https://authapi.flattrade.in/trade/apitoken";
export const LOGIN_URL = "https://auth.flattrade.in/";
export const WS_URL = "wss://piconnect.flattrade.in/PiConnectWSAPI/";

async function exchangeRequestCode(creds) {
  let res;
  try {
    res = await brokerFetch(AUTH_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: creds.apiKey,
        request_code: creds.requestCode,
        api_secret: sha256Hex(`${creds.apiKey}${creds.requestCode}${creds.apiSecret}`),
      }),
    });
  } catch (e) {
    throw new BrokerError(`Flattrade login: network error (${e?.message || e})`);
  }
  const json = await res.json().catch(() => null);
  const ok = String(json?.stat ?? json?.status ?? "").toLowerCase() === "ok";
  if (ok && json?.token) {
    const now = Date.now();
    return { token: String(json.token), expiresAt: Math.min(now + 24 * 60 * 60 * 1000, nextIstFiveAmMs(now)) };
  }
  if (res.status >= 500 || !json) throw new BrokerError(`Flattrade login: HTTP ${res.status}`);
  throw new SessionRequiredError(
    `Flattrade did not accept the request code (${json.emsg || `HTTP ${res.status}`}). Request codes are single use and expire within minutes, ` +
      `and the token is issued only to your registered static IP. Open ${LOGIN_URL}?app_key=<your API key>, log in and save the new code.`,
  );
}

export const session = createSessionManager({
  label: "Flattrade",
  keyFields: ["clientId", "apiKey", "apiSecret", "requestCode"],
  exchange: exchangeRequestCode,
});

/** REST transport: jData + jKey in the body. */
export function send(token, endpoint, data) {
  return brokerFetch(`${PI_BASE}${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: `jData=${encodeJData(data)}&jKey=${encodeURIComponent(token)}`,
  });
}

/** Test helper: forget every cached session and used code. */
export const resetSessions = () => session.reset();
