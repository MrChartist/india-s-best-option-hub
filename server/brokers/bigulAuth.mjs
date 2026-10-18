/**
 * Bigul (Bigul Connect, Bonanza Portfolio) — session login + REST client.
 *
 * Official docs: https://connect.bigul.co/docs (checked 2026-10; "Last updated: July 2026 · API v1"):
 *  - Client (B2C) base URL https://capi.bigul.co/api/v1, request `source` "CLIENT" ("URL & Source Mapping",
 *    "Index List" -> Base URLs & Environments). The partner hosts (papi.bigul.co, servicestest.bigul.co) are not used.
 *  - Onboarding: create an app under Dashboard > My Apps to get x-api-key / x-api-secret, whitelist a static IP and
 *    enable TOTP. Personal use needs no partner approval.
 *  - Login: POST /auth/connect/login, headers x-api-key + x-api-secret, body { source, clientCode, totp }
 *    -> { status: true, data: { token } }. A wrong code answers HTTP 200 with { status: false, message: "Invalid TOTP." }.
 *    "Tokens remain valid until 12:30 AM daily."
 *  - Every other call: headers x-api-key, x-api-secret and Authorization: Bearer <token>; JSON bodies carry source and
 *    clientCode. Errors use { status: false, message }: 401 = invalid or expired token, 403 = API key/secret invalid
 *    or the calling IP is not whitelisted, 429 = rate limit (2,16,000 requests a day, 3,000 per 5 minutes per IP,
 *    10 orders a second).
 *
 * Session login (contract auth.kind "sessionLogin"): the app key, app secret and client code are saved; the user
 * types only the CURRENT 6-digit TOTP code in Broker Settings and login() returns { sessionToken }. The code is never
 * stored, cached or logged. A 401 on a data call throws SessionRequiredError; nothing re-logs in automatically.
 *
 * NEVER log creds, the TOTP code or the token — field names and HTTP status codes only.
 */

import { BrokerError, brokerFetch, SessionRequiredError } from "./contract.mjs";
import { nextIstMidnightMs, readTotpCode, requireFields, sessionFromCreds } from "./sessionLogin.mjs";

export const BASE_URL = "https://capi.bigul.co/api/v1";
export const SOURCE = "CLIENT";
const LABEL = "Bigul";

export const LOGIN_FIELDS = [{ key: "totpCode", label: "6-digit TOTP code", kind: "totp" }];
export const SESSION_FIELDS = ["sessionToken"];
const STORED_FIELDS = ["apiKey", "apiSecret", "clientCode"];

const HALF_HOUR_MS = 30 * 60_000;

/** Epoch ms of the next 00:30 IST after `now` (Bigul tokens die then). */
export function nextBigulExpiryMs(now = Date.now()) {
  const todays = nextIstMidnightMs(now) - 24 * 3600_000 + HALF_HOUR_MS;
  return todays > now ? todays : todays + 24 * 3600_000;
}

const appHeaders = (creds) => ({ "x-api-key": String(creds.apiKey), "x-api-secret": String(creds.apiSecret) });
const shortMessage = (json, status) => String(json?.message || json?.error || `HTTP ${status}`).slice(0, 200);

/** One login with the code the user typed. Returns only the session token. */
export async function login(creds) {
  requireFields(creds, STORED_FIELDS, LABEL);
  const totp = readTotpCode(creds);
  const res = await brokerFetch(`${BASE_URL}/auth/connect/login`, {
    method: "POST",
    headers: { ...appHeaders(creds), "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ source: SOURCE, clientCode: String(creds.clientCode).trim(), totp }),
  }, { kind: "login", label: LABEL });
  const json = await res.json().catch(() => null);
  const token = json?.status === true ? json?.data?.token : null;
  if (!res.ok || typeof token !== "string" || !token) {
    const msg = shortMessage(json, res.status);
    if (res.status === 403) {
      throw new BrokerError(`Bigul login refused [403]: ${msg}. Check the app key and secret, and that this machine's static IP is whitelisted for the app.`, { code: "UPSTREAM_AUTH" });
    }
    if (res.status === 429) throw new BrokerError("Bigul login rate limit [429]: wait a minute and try again.", { code: "UPSTREAM_RATE_LIMIT" });
    if (res.ok) throw new BrokerError(`Bigul login failed: ${msg} Check the client code and that the 6-digit code is the current one.`, { code: "UPSTREAM_AUTH" });
    throw new BrokerError(`Bigul login failed [${res.status}]: ${msg}`);
  }
  // Expire a minute early so an in-flight request never races the real 00:30 IST cut-off.
  return { session: { sessionToken: token }, expiresAt: nextBigulExpiryMs() - 60_000 };
}

/** The stored session. Throws SessionRequiredError when not logged in or expired. */
export function getSession(creds) {
  requireFields(creds, STORED_FIELDS, LABEL);
  const { sessionToken } = sessionFromCreds(creds, SESSION_FIELDS, LABEL);
  return { apiKey: String(creds.apiKey), apiSecret: String(creds.apiSecret), clientCode: String(creds.clientCode).trim(), token: sessionToken };
}

/** "No data" style replies for an empty book. */
const EMPTY_BOOK = /no\s*(data|record|order|trade|position|holding)s?\b|not\s*found/i;

/**
 * Authenticated JSON call. `body` gets source + clientCode added. Returns json.data.
 * 401 -> SessionRequiredError; 403/429/other -> BrokerError 502 "Bigul error [<http>]: <message>".
 * With `emptyOk`, a { status: false } "no data" reply is an empty result (null) instead of an error.
 */
export async function bgRequest(creds, path, { method = "POST", body = {}, query, emptyOk = false, kind } = {}) {
  const s = getSession(creds);
  const url = new URL(`${BASE_URL}${path}`);
  for (const [k, v] of Object.entries(query || {})) url.searchParams.set(k, String(v));
  const init = {
    method,
    headers: { ...appHeaders(s), Authorization: `Bearer ${s.token}`, "Content-Type": "application/json", Accept: "application/json" },
  };
  if (method !== "GET") init.body = JSON.stringify({ source: SOURCE, clientCode: s.clientCode, ...body });
  const res = await brokerFetch(url.toString(), init, { kind, label: LABEL });
  const json = await res.json().catch(() => null);
  if (res.status === 401) throw new SessionRequiredError("Bigul: your session has expired or was rejected. Log in again from Broker Settings.");
  if (res.ok && json?.status === true) return json.data ?? null;
  const msg = shortMessage(json, res.status);
  if (res.ok && emptyOk && EMPTY_BOOK.test(msg)) return null;
  if (res.status === 403) throw new BrokerError(`Bigul error [403]: ${msg}`, { code: "UPSTREAM_AUTH" });
  if (res.status === 429) throw new BrokerError(`Bigul error [429]: ${msg}`, { code: "UPSTREAM_RATE_LIMIT" });
  throw new BrokerError(`Bigul error [${res.status}]: ${msg}`);
}
