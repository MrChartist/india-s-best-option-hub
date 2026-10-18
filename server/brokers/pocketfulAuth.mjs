/**
 * Pocketful — REST client and client-id resolution.
 *
 * Official docs (checked 2026-10): https://api.pocketful.in/docs/curl/login and the official JavaScript SDK
 * (github.com/pocketful-tech/pocketfulapi-javascript, PocketfulAPI/pocketful.js):
 *  - Base URL https://algo.pocketful.in (OpenAlgo still uses trade.pocketful.in; the official base is followed).
 *  - Every call sends `x-authorization-token: <access_token>` and `x-device-type: WEB`. The historical-data guide shows
 *    `Authorization: Bearer <token>` instead, so both headers are sent.
 *  - The user generates the access token on the Pocketful API portal (Create App -> "Click here to generate", or the
 *    Refresh button with the default redirect URL). "Access tokens remain valid until 12:00 AM (midnight)".
 *  - Most account calls take `client_id` as a query parameter (the SDK sets it from the user's client code). It is a
 *    saved, non-secret field here; when it is left blank it is looked up once from GET /api/v1/user/trading_info
 *    (not in the docs; OpenAlgo's auth flow uses it) and cached per token.
 *  - Errors: HTTP 401 "Invalid, expired, or missing access token"; bodies { status: "error", error_code, message } or
 *    { error: { code, message }, result }. 429 = rate limited (orders 10/s, data 10/s, others 20/s).
 *
 * NEVER log the access token — only field names / presence / HTTP status codes.
 */

import { createHash } from "node:crypto";
import { BrokerError, brokerFetch, BrokerInputError } from "./contract.mjs";

export const BASE_URL = "https://algo.pocketful.in";
const clientIds = new Map(); // sha256(token) -> client id

/** Test hook. */
export function __resetPocketfulAuth() {
  clientIds.clear();
}

function token(creds) {
  const t = String(creds?.accessToken ?? "").trim();
  if (!t) throw new BrokerInputError("Pocketful: paste today's access token in Broker Settings.");
  return t;
}

export function credHash(creds) {
  return createHash("sha256").update(token(creds)).digest("hex");
}

function headers(creds, json) {
  const t = token(creds);
  const h = { "x-authorization-token": t, Authorization: `Bearer ${t}`, "x-device-type": "WEB", Accept: "application/json" };
  if (json) h["Content-Type"] = "application/json";
  return h;
}

function errorText(json) {
  return String(json?.message || json?.error?.message || json?.msg || "").slice(0, 200);
}

/**
 * Authenticated call. Returns the parsed body. Throws BrokerError (502): "Pocketful error [<http>] <error_code?>: <msg>".
 * Bodies that report failure (status "error" / false, or a non-zero error.code) also throw.
 */
export async function pfRequest(creds, path, { method = "GET", query, body } = {}) {
  const url = new URL(path, BASE_URL);
  for (const [k, v] of Object.entries(query || {})) if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  const res = await brokerFetch(url.toString(), { method, headers: headers(creds, body !== undefined), body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* handled below */ }
  const code = json?.error_code ? ` ${json.error_code}` : json?.error?.code ? ` ${json.error.code}` : "";
  if (res.status === 401 || res.status === 403) {
    throw new BrokerError(`Pocketful error [${res.status}]${code}: access token invalid or expired — generate a new one on the Pocketful API portal`, { code: "UPSTREAM_AUTH" });
  }
  if (!res.ok || !json) throw new BrokerError(`Pocketful error [${res.status}]${code}: ${errorText(json) || "unexpected response"}`);
  const failed = json.status === "error" || json.status === false || (json.error && Number(json.error.code) !== 0);
  if (failed) throw new BrokerError(`Pocketful error [${res.status}]${code}: ${errorText(json) || "request failed"}`);
  return json;
}

/** The trading client id: the saved one, or looked up once per token. */
export async function resolveClientId(creds) {
  const saved = String(creds?.clientId ?? "").trim();
  if (saved) return saved;
  const key = credHash(creds);
  if (clientIds.has(key)) return clientIds.get(key);
  const json = await pfRequest(creds, "/api/v1/user/trading_info");
  const id = String(json?.data?.client_id ?? "").trim();
  if (!id) throw new BrokerError("Pocketful: could not find your client id; enter it in Broker Settings.");
  clientIds.set(key, id);
  return id;
}
