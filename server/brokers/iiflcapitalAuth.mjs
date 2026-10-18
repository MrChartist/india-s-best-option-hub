/**
 * IIFL Capital (IIFL Markets Open API) session + paced, authenticated client.
 *
 * Official docs: https://developers.iiflcapital.com/apidocs/user (login flow, getusersession, profile, limits),
 * /apidocs/annexure (rate limits, error codes) and the official Postman collection
 * (github.com/IIFLCapital/IIFL-Markets-Open-API-Postman-Collection-Official-), checked 2026-10:
 *  - Daily login: the user opens https://markets.iiflcapital.com/?v=1&appkey=<appKey>[&redirecturl=...], logs in
 *    with password + OTP/TOTP on IIFL's own page, and is redirected with `authCode` and `clientId`.
 *  - POST https://api.iiflcapital.com/v1/getusersession { checkSum: SHA-256(clientId + authCode + appSecret) }
 *    -> { status: "Ok" | "Not_Ok", userSession: <JWT> }. "The auth code expires immediately after the JWT is
 *    generated"; "The JWT is valid only until midnight on the day it is generated".
 *  - Every other call: `Authorization: Bearer <userSession>`. Envelope { status: "Ok", message, result }.
 *  - Rate limits per API (non-registered < 10 OPS): Market Quotes / Depth / Open Interest / Historical / Limits
 *    10/s; Profile, Get User Session, Order Book, Trade Book, Positions, Holdings 3/s; Order History 10/s;
 *    Place/Modify/Cancel combined 10/s; contract files 2/s.
 *
 * Auth kind: requestTokenExchange. The user pastes the day's authCode (the password and OTP never reach this
 * app); the session is derived once and cached in memory under a SHA-256 tag of the inputs, until the next IST
 * midnight. A `userSession` JWT generated elsewhere can be pasted instead. A rejected token drops the cache and
 * asks for a fresh authCode (it is single-use, so there is no automatic retry).
 */

import { createHash } from "node:crypto";
import { BrokerError, brokerFetch, normaliseError as baseNormalise, redactSecrets } from "./contract.mjs";
import { createSessionCache } from "../lib/boundedCache.mjs";

export const BASE_URL = "https://api.iiflcapital.com/v1";
export const LOGIN_URL = "https://markets.iiflcapital.com/";

const sessionCache = createSessionCache(); // tag -> { token, expiresAt }

export function sha256Hex(s) {
  return createHash("sha256").update(String(s), "utf8").digest("hex");
}

/** Documented checksum: SHA-256 of clientId + authCode + appSecret, concatenated in that order. */
export function checksumFor(clientId, authCode, appSecret) {
  return sha256Hex(`${clientId}${authCode}${appSecret}`);
}

function tagOf(creds) {
  return sha256Hex(`iiflcapital|${creds?.clientId ?? ""}|${creds?.authCode ?? ""}|${creds?.appSecret ?? ""}`);
}

/** Epoch ms of the next IST midnight after `now`. */
export function nextIstMidnightMs(now = Date.now()) {
  const IST = 5.5 * 3600_000;
  const d = new Date(now + IST);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1) - IST;
}

export function secretsOf(creds) {
  return [creds?.appSecret, creds?.authCode, creds?.userSession].filter((s) => typeof s === "string" && s.length >= 4);
}

export function authError(message) {
  return new BrokerError(message, { code: "UPSTREAM_AUTH", statusCode: 502 });
}

const FRESH_CODE_HINT = `Log in again at ${LOGIN_URL}?v=1&appkey=YOUR_APP_KEY and paste the new authCode in Broker Settings (it works once and the session lasts until midnight).`;

async function readJson(res) {
  const text = await res.text();
  try { return { json: JSON.parse(text), text }; } catch { return { json: null, text }; }
}

async function exchange(creds) {
  const clientId = String(creds?.clientId ?? "").trim();
  const authCode = String(creds?.authCode ?? "").trim();
  const appSecret = String(creds?.appSecret ?? "").trim();
  if (!clientId || !authCode || !appSecret) throw authError(`IIFL Capital: Client ID, App Secret and today's authCode are all needed. ${FRESH_CODE_HINT}`);
  await pace("session");
  const res = await brokerFetch(`${BASE_URL}/getusersession`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ checkSum: checksumFor(clientId, authCode, appSecret) }),
  });
  const { json } = await readJson(res);
  if (!res.ok || String(json?.status ?? "").toLowerCase() !== "ok" || typeof json?.userSession !== "string" || !json.userSession) {
    const why = json?.message || json?.status || `HTTP ${res.status}`;
    throw authError(redactSecrets(`IIFL Capital login failed (${why}). ${FRESH_CODE_HINT}`, secretsOf(creds)));
  }
  const session = { token: json.userSession, expiresAt: nextIstMidnightMs() };
  sessionCache.set(tagOf(creds), session);
  return session;
}

/** The Bearer token: a pasted userSession, else the cached or freshly derived one. */
export async function getUserSession(creds = {}) {
  const pasted = String(creds?.userSession ?? "").trim();
  if (pasted) return pasted;
  const cached = sessionCache.get(tagOf(creds));
  if (cached && cached.expiresAt > Date.now()) return cached.token;
  return (await exchange(creds)).token;
}

// ── pacing: one queue per documented limit, a little under each cap ──
const MIN_GAP_MS = { data: 115, slow: 360, orders: 115, session: 360 };
const nextFree = new Map();

async function pace(bucket) {
  const gap = MIN_GAP_MS[bucket] ?? 360;
  const now = Date.now();
  const at = Math.max(now, nextFree.get(bucket) ?? 0);
  nextFree.set(bucket, at + gap);
  if (at > now) await new Promise((r) => setTimeout(r, at - now));
}

function bucketOf(path, method) {
  if (path.startsWith("/marketdata/") || path === "/limits" || path.startsWith("/limits/")) return "data";
  if (path.startsWith("/orders") && method !== "GET") return "orders";
  if (/^\/orders\/[^/]+$/.test(path)) return "data"; // order history: 10/s
  return "slow"; // profile, order book, trades, positions, holdings: 3/s
}

const SUCCESS = new Set(["ok", "success"]);
/** EC916 / EC920 / EC922 / EC926: "No order's / Positions / holdings / Trade's found" mean an empty book. */
const EMPTY_BOOK = /\bEC9(16|20|22|26)\b|no (order'?s|positions|holdings|trade'?s) (are )?found/i;
/** Token problems: HTTP 401/403, EC044 "Token is not valid", EC055 "Unauthorized access". */
const TOKEN_DEAD = /\bEC0(44|55)\b|token is not valid|unauthori[sz]ed access/i;

function messageOf(json, text, status) {
  const first = Array.isArray(json?.result) ? json.result[0] : json?.result;
  const parts = [json?.message, first && typeof first === "object" ? (first.message ?? first.status) : null].filter((p) => p && !SUCCESS.has(String(p).toLowerCase()));
  return parts.join(": ") || (text || "").slice(0, 160) || `HTTP ${status}`;
}

/**
 * Authenticated request. Returns the parsed body (callers read `.result`), `{ empty: true }` for an
 * "empty book" error, and throws BrokerError (502) otherwise.
 */
export async function iiflRequest(creds, path, { method = "GET", body } = {}) {
  const token = await getUserSession(creds);
  await pace(bucketOf(path, method));
  const res = await brokerFetch(`${BASE_URL}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json", ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const { json, text } = await readJson(res);
  const msg = messageOf(json, text, res.status);
  const secrets = [...secretsOf(creds), token];
  if (res.status === 401 || res.status === 403 || TOKEN_DEAD.test(msg)) {
    sessionCache.delete(tagOf(creds));
    throw authError(`IIFL Capital rejected the session (${redactSecrets(msg, secrets)}). ${FRESH_CODE_HINT}`);
  }
  if (res.status === 429) throw new BrokerError(redactSecrets(`IIFL Capital rate limit on ${path}: ${msg}`, secrets), { code: "UPSTREAM_RATE_LIMIT" });
  const status = String(json?.status ?? "").toLowerCase();
  const failed = !res.ok || json === null || (json && typeof json === "object" && !Array.isArray(json) && json.status !== undefined && !SUCCESS.has(status));
  if (failed) {
    if (EMPTY_BOOK.test(msg)) return { empty: true, result: [] };
    throw new BrokerError(redactSecrets(`IIFL Capital API error [${res.status}] on ${path}: ${msg}`, secrets), { code: "UPSTREAM_ERROR" });
  }
  return json;
}

/** Rows of a list response: a bare array (as in the order/trade doc samples) or `result` (array or object). */
export function rowsOf(json) {
  if (Array.isArray(json)) return json;
  const r = json?.result;
  if (Array.isArray(r)) return r;
  if (r && typeof r === "object") return [r];
  return [];
}

export function normaliseError(err, { secrets = [] } = {}) {
  const out = baseNormalise(err, { secrets });
  if (out.code === "UPSTREAM_ERROR" && /\b429\b|too many requests/i.test(out.message)) out.code = "UPSTREAM_RATE_LIMIT";
  return out;
}

export function __resetIiflCapitalAuth() {
  sessionCache.clear();
  nextFree.clear();
}
