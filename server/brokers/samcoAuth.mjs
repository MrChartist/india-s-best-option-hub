/**
 * Samco Trade API v3.2 — session + HTTP client.
 *
 * Official docs (checked 2026-10): https://docs-tradeapi.samco.in/session/generate-token.html and
 * https://docs-tradeapi.samco.in/overview.html.
 *  - POST https://tradeapi.samco.in/session/token { apiKey, apiSecret } (JSON) ->
 *    { status: "Success", sessionToken, accountID, ... }. Failures carry status "Failure", a statusMessage
 *    and sometimes errorCode EOAUTH001 (bad key) / EOAUTH008 (bad secret).
 *  - Every later call sends the token as the `x-session-token` header.
 *  - "The sessionToken is valid until 08:00 IST the next day" (all tokens expire at the next 08:00 IST).
 *  - Order-related calls from a host that is not a registered static IP fail with HTTP 403 and
 *    "The IP is not the registered static IP" (EOAUTH009).
 *
 * The apiKey/apiSecret pair is saved in Broker Settings (contract auth.kind "apiKeyToken": the adapter swaps
 * the pair for a session server-side). Sessions live only in this process's memory, keyed by a SHA-256 of the
 * pair, so the secret itself is never a map key, a log line or part of an error message.
 *
 * Retry policy: a read (GET, or POST to a read endpoint flagged `read: true`) that comes back 401/403 drops the
 * cached session and tries exactly once more with a fresh one. State-changing calls (orders) are NEVER retried:
 * a retried order could be placed twice.
 */

import { createHash } from "node:crypto";
import { BrokerError, brokerFetch, BrokerInputError } from "./contract.mjs";
import { createSessionCache } from "../lib/boundedCache.mjs";

export const BASE_URL = "https://tradeapi.samco.in";
const SESSIONS = createSessionCache(); // sha256(apiKey|apiSecret) -> { sessionToken, expiresAt }

/** Test hook: forget every cached session. */
export function __resetSamcoSessions() {
  SESSIONS.clear();
}

function sessionKey(creds) {
  return createHash("sha256").update(`${creds.apiKey}\u0000${creds.apiSecret}`).digest("hex");
}

/** Epoch ms of the next 08:00 IST strictly after `now` (Samco's documented session cut-off). */
export function nextIst8AmMs(now = Date.now()) {
  const IST = 5.5 * 3600_000;
  const d = new Date(now + IST);
  d.setUTCHours(8, 0, 0, 0);
  let t = d.getTime() - IST;
  if (t <= now) t += 24 * 3600_000;
  return t;
}

function requireCreds(creds) {
  if (!String(creds?.apiKey ?? "").trim() || !String(creds?.apiSecret ?? "").trim()) {
    throw new BrokerInputError("Samco: enter both the API key and the API secret in Broker Settings.");
  }
}

function upstreamError(status, json, fallback) {
  const msg = String(json?.statusMessage || json?.message || fallback || `HTTP ${status}`).slice(0, 200);
  const code = json?.errorCode ? ` ${json.errorCode}` : "";
  return new BrokerError(`Samco error [${status}]${code}: ${msg}`);
}

async function readJson(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function login(creds) {
  const res = await brokerFetch(`${BASE_URL}/session/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ apiKey: creds.apiKey, apiSecret: creds.apiSecret }),
  });
  const json = await readJson(res);
  if (!res.ok || json?.status !== "Success" || !json?.sessionToken) {
    throw upstreamError(res.status, json, "session/token was refused");
  }
  const session = { sessionToken: String(json.sessionToken), expiresAt: nextIst8AmMs() - 60_000 };
  SESSIONS.set(sessionKey(creds), session);
  return session;
}

/** A cached, unexpired session or a fresh login. */
export async function getSession(creds) {
  requireCreds(creds);
  const cached = SESSIONS.get(sessionKey(creds));
  if (cached && cached.expiresAt > Date.now()) return cached;
  return login(creds);
}

function buildUrl(path, query) {
  const url = new URL(path, BASE_URL);
  for (const [k, v] of Object.entries(query || {})) if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  return url.toString();
}

/**
 * Authenticated call. Returns the parsed JSON body (status "Success"). Throws BrokerError (502) otherwise.
 * `read: true` allows one re-login on 401/403; it is implied for GET.
 */
export async function samcoRequest(creds, path, { method = "GET", body, query, read, emptyOk = false } = {}) {
  const canRetry = read ?? method === "GET";
  let session = await getSession(creds);
  const call = async (s) => {
    const res = await brokerFetch(buildUrl(path, query), {
      method,
      headers: { Accept: "application/json", "Content-Type": "application/json", "x-session-token": s.sessionToken },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { res, json: await readJson(res) };
  };
  let { res, json } = await call(session);
  if ((res.status === 401 || res.status === 403) && canRetry && !/registered static IP/i.test(String(json?.statusMessage))) {
    SESSIONS.delete(sessionKey(creds));
    session = await login(creds);
    ({ res, json } = await call(session));
  }
  if (!res.ok) throw upstreamError(res.status, json);
  if (!json) throw new BrokerError(`Samco error [${res.status}]: response was not JSON`);
  if (json.status && json.status !== "Success") {
    // List endpoints answer an empty book with a Failure + "No ... found" message; callers that pass
    // emptyOk get null for that instead of an error.
    if (emptyOk && /\bno\b.*\b(found|available|exists?)\b|no data/i.test(String(json.statusMessage))) return null;
    throw upstreamError(res.status, json);
  }
  return json;
}
