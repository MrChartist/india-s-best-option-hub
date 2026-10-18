/**
 * Groww Trading API: authentication, pacing and the authenticated HTTP client.
 *
 * Official docs (https://groww.in/trade-api/docs/curl, checked 2026-10):
 *  - Every call: `Authorization: Bearer <access token>`, `Accept: application/json`, `X-API-VERSION: 1.0`.
 *  - Two documented ways to get the access token:
 *      1. "Access Token" generated in Groww (Settings > Trading APIs). Expires daily at 6:00 AM IST.
 *         The user pastes it into `accessToken`.
 *      2. "API Key and Secret": POST https://api.groww.in/v1/token/api/access with
 *         `Authorization: Bearer <apiKey>` and body { key_type: "approval", checksum, timestamp }, where
 *         checksum = SHA-256(apiSecret + epoch-seconds timestamp). Needs a daily approval on the Groww Cloud
 *         API Keys page. Response: { token, tokenRefId, sessionName, expiry, isActive }.
 *    (A third, TOTP flow exists: key_type "totp" + the current code. It is not used here; the two paths
 *    above need no password, PIN or TOTP value, so nothing secret is typed or stored beyond the key pair.)
 *  - Envelope: { status: "SUCCESS", payload } or { status: "FAILURE", error: { code, message, metadata } }.
 *    Error codes GA000-GA007 (GA005 = "User not authorised to perform this operation").
 *  - Rate limits are per type: Orders 10/s 250/min; Live Data 10/s 300/min; Non Trading 20/s 500/min;
 *    token endpoint 5/s 30/min and 150 per 24 h. Calls are paced below those per-minute caps.
 *
 * The access token from path 2 is cached in memory only, under a SHA-256 tag of the credentials (never the
 * raw values), until the next 6:00 AM IST. A 401/403 drops it and re-exchanges once (path 2 only).
 * Nothing here logs a key, secret or token.
 */

import { createHash } from "node:crypto";
import { BrokerError, brokerFetch, normaliseError as baseNormalise, redactSecrets } from "./contract.mjs";
import { createSessionCache } from "../lib/boundedCache.mjs";

export const API_BASE = "https://api.groww.in";
const TOKEN_PATH = "/v1/token/api/access";

const sessionCache = createSessionCache(); // credsTag -> { token, expiresAt }

/** SHA-256 tag of the credential values: a cache key that never contains the values themselves. */
function credsTag(creds) {
  return createHash("sha256").update(`groww|${creds?.apiKey ?? ""}|${creds?.apiSecret ?? ""}`).digest("hex");
}

export function checksumFor(apiSecret, timestamp) {
  return createHash("sha256").update(String(apiSecret) + String(timestamp)).digest("hex");
}

/** Epoch ms of the next 6:00 AM IST after `now` (Groww's documented token expiry). */
export function nextIst6AmMs(now = Date.now()) {
  const IST = 5.5 * 60 * 60 * 1000;
  const d = new Date(now + IST);
  let at = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 6, 0, 0, 0) - IST;
  if (at <= now) at += 24 * 60 * 60 * 1000;
  return at;
}

function secretsOf(creds) {
  return [creds?.accessToken, creds?.apiKey, creds?.apiSecret].filter((s) => typeof s === "string" && s.length >= 4);
}

function authError(message) {
  return new BrokerError(message, { code: "UPSTREAM_AUTH", statusCode: 502 });
}

async function readJson(res) {
  const text = await res.text();
  try {
    return { json: JSON.parse(text), text };
  } catch {
    return { json: null, text };
  }
}

async function exchangeKeyPair(creds) {
  const apiKey = String(creds?.apiKey ?? "").trim();
  const apiSecret = String(creds?.apiSecret ?? "").trim();
  if (!apiKey || !apiSecret) {
    throw authError("Groww: paste today's Access Token, or save your API Key and API Secret, in Broker Settings.");
  }
  const timestamp = String(Math.floor(Date.now() / 1000));
  await pace("auth");
  const res = await brokerFetch(`${API_BASE}${TOKEN_PATH}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ key_type: "approval", checksum: checksumFor(apiSecret, timestamp), timestamp }),
  });
  const { json } = await readJson(res);
  if (!res.ok || typeof json?.token !== "string" || !json.token) {
    const why = json?.error?.message || json?.message || `HTTP ${res.status}`;
    throw authError(redactSecrets(`Groww token exchange failed (${why}). Approve the API key for today on the Groww Cloud API Keys page and try again.`, secretsOf(creds)));
  }
  const session = { token: json.token, expiresAt: nextIst6AmMs() };
  sessionCache.set(credsTag(creds), session);
  return session;
}

/** The bearer token to use: the pasted access token, else a cached or freshly exchanged one. */
export async function getAccessToken(creds = {}, { fresh = false } = {}) {
  const pasted = String(creds?.accessToken ?? "").trim();
  if (pasted) return pasted;
  const tag = credsTag(creds);
  const cached = sessionCache.get(tag);
  if (!fresh && cached && cached.expiresAt > Date.now()) return cached.token;
  sessionCache.delete(tag);
  return (await exchangeKeyPair(creds)).token;
}

// ── pacing: one queue per documented rate-limit type, kept under the per-minute caps ──
const MIN_GAP_MS = { live: 220, nonTrading: 130, orders: 260, auth: 2100 };
const nextFree = new Map();

export async function pace(bucket) {
  const gap = MIN_GAP_MS[bucket] ?? 250;
  const now = Date.now();
  const at = Math.max(now, nextFree.get(bucket) ?? 0);
  nextFree.set(bucket, at + gap);
  if (at > now) await new Promise((r) => setTimeout(r, at - now));
}

function bucketOf(path, method) {
  if (path.startsWith("/v1/order/create") || path.startsWith("/v1/order/modify") || path.startsWith("/v1/order/cancel")) return "orders";
  if (path.startsWith("/v1/live-data") || path.startsWith("/v1/option-chain") || path.startsWith("/v1/historical")) return "live";
  return method === "POST" ? "orders" : "nonTrading";
}

function upstreamError(status, json, text, path, creds) {
  const code = json?.error?.code;
  const why = json?.error?.message || json?.message || (text || "").slice(0, 160) || `HTTP ${status}`;
  const message = redactSecrets(`Groww API error${code ? ` ${code}` : ""} [${status}] on ${path}: ${why}`, secretsOf(creds));
  if (status === 429) return new BrokerError(message, { code: "UPSTREAM_RATE_LIMIT", statusCode: 502 });
  if (status === 401 || status === 403 || code === "GA005") return authError(message);
  return new BrokerError(message, { code: "UPSTREAM_ERROR", statusCode: 502 });
}

/**
 * Authenticated request. GET params go in the query string (arrays joined by commas); POST bodies are JSON.
 * Returns the `payload` of a SUCCESS envelope. Throws BrokerError (502) otherwise.
 */
export async function growwRequest(creds, path, { method = "GET", params, body } = {}) {
  const send = async (token) => {
    const url = new URL(`${API_BASE}${path}`);
    for (const [k, v] of Object.entries(params || {})) {
      if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, Array.isArray(v) ? v.join(",") : String(v));
    }
    await pace(bucketOf(path, method));
    const headers = { Authorization: `Bearer ${token}`, Accept: "application/json", "X-API-VERSION": "1.0" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const res = await brokerFetch(url.toString(), { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
    return { res, ...(await readJson(res)) };
  };

  let r = await send(await getAccessToken(creds));
  const canRefresh = !String(creds?.accessToken ?? "").trim();
  if ((r.res.status === 401 || r.res.status === 403) && canRefresh) {
    r = await send(await getAccessToken(creds, { fresh: true }));
  }
  if (!r.res.ok) {
    if ((r.res.status === 401 || r.res.status === 403) && !canRefresh) {
      throw authError("Groww rejected the access token. Tokens expire daily at 6:00 AM IST; paste a fresh one in Broker Settings.");
    }
    throw upstreamError(r.res.status, r.json, r.text, path, creds);
  }
  if (!r.json || typeof r.json !== "object") throw upstreamError(r.res.status, null, r.text, path, creds);
  if (r.json.status && r.json.status !== "SUCCESS") throw upstreamError(r.res.status, r.json, r.text, path, creds);
  return r.json.payload ?? null;
}

/** Contract error normaliser: rate limits and auth failures keep their codes; secrets are redacted. */
export function normaliseError(err, { secrets = [] } = {}) {
  const out = baseNormalise(err, { secrets });
  if (out.code === "UPSTREAM_ERROR" && /\b429\b|too many requests/i.test(out.message)) out.code = "UPSTREAM_RATE_LIMIT";
  return out;
}

/** Test hook: forget cached sessions and pacing state. */
export function __resetGrowwAuth() {
  sessionCache.clear();
  nextFree.clear();
}
