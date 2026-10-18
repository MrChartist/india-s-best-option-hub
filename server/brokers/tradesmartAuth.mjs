/**
 * TradeSmart (Noren v2) OAuth code exchange and REST transport.
 *
 * Official docs: https://apidocs.tradesmartonline.in/v2/ — behind a Cloudflare challenge that blocked
 * every automated fetch while this was written (HTTP 403), so the facts below could NOT be re-read from
 * the official page. They come from (a) the previous version of this module, whose author cited the v2
 * docs' Quick Start; (b) Kambala's Noren OAuth SDK (NorenRestApiOAuth on PyPI — Kambala builds the OMS
 * TradeSmart runs), which documents the same GenAcsTok/Bearer contract; and (c) OpenAlgo's TradeSmart
 * adapter, as a factual cross-check only. Every point is flagged for live verification.
 *  - Login page: https://v2api.tradesmartonline.in/OAuthlogin/authorize/oauth?client_id=<app key>,
 *    redirecting with a single-use `code`.
 *  - POST https://v2api.tradesmartonline.in/NorenWClientAPIv2/GenAcsTok, text/plain body
 *    jData={"code","checksum"}, checksum = SHA-256(app key + secret key + code), no Bearer header.
 *    Response: { stat: "Ok", access_token, ..., expires_in? }. The token lasts one trading day.
 *  - Every other call: POST <root>/<Endpoint>, `Authorization: Bearer <access_token>`, text/plain
 *    `jData=<json>` body (no jKey).
 *  - WebSocket: wss://v2api.tradesmartonline.in/NorenWSAPI/.
 */

import { BrokerError, brokerFetch, SessionRequiredError } from "./contract.mjs";
import { createSessionManager, encodeJData, nextIstFiveAmMs, sha256Hex } from "./shoonyaNorenCore.mjs";

export const REST_ROOT = "https://v2api.tradesmartonline.in/NorenWClientAPIv2";
export const OAUTH_LOGIN_URL = "https://v2api.tradesmartonline.in/OAuthlogin/authorize/oauth";
export const WS_URL = "wss://v2api.tradesmartonline.in/NorenWSAPI/";

/** expires_in: epoch seconds when it looks like a timestamp, else a duration in seconds; fallback 05:00 IST. */
export function resolveExpiresAt(expiresIn, now = Date.now()) {
  const n = Number(expiresIn);
  if (!Number.isFinite(n) || n <= 0) return nextIstFiveAmMs(now);
  return n > 1_000_000_000 ? n * 1000 : now + n * 1000;
}

async function exchangeCode(creds) {
  let res;
  try {
    res = await brokerFetch(`${REST_ROOT}/GenAcsTok`, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: `jData=${encodeJData({ code: creds.requestCode, checksum: sha256Hex(`${creds.apiKey}${creds.apiSecret}${creds.requestCode}`) })}`,
    });
  } catch (e) {
    throw new BrokerError(`TradeSmart login: network error (${e?.message || e})`);
  }
  const json = await res.json().catch(() => null);
  const token = json?.access_token || json?.susertoken;
  if (String(json?.stat).toLowerCase() === "ok" && token) return { token: String(token), expiresAt: resolveExpiresAt(json.expires_in) };
  if (res.status >= 500 || !json) throw new BrokerError(`TradeSmart login: HTTP ${res.status}`);
  throw new SessionRequiredError(
    `TradeSmart did not accept the authorisation code (${json.emsg || `HTTP ${res.status}`}). Codes are single use and expire within minutes. ` +
      `Open ${OAUTH_LOGIN_URL}?client_id=<your app key>, log in and save the new code.`,
  );
}

export const session = createSessionManager({
  label: "TradeSmart",
  keyFields: ["clientId", "apiKey", "apiSecret", "requestCode"],
  exchange: exchangeCode,
});

/** REST transport: Bearer header + text/plain jData body. */
export function send(token, endpoint, data) {
  return brokerFetch(`${REST_ROOT}${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "text/plain", Authorization: `Bearer ${token}` },
    body: `jData=${encodeJData(data)}`,
  });
}

/** Test helper: forget every cached session and used code. */
export const resetSessions = () => session.reset();
