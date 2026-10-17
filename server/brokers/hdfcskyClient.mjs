/**
 * HDFC Sky (HDFC Securities Open API) — HTTP client + auth-header plumbing.
 *
 * Auth model: paste-token, same UX as Dhan/Zerodha. HDFC Sky's real login is a
 * multi-step browser-redirect flow (GET /oapi/v1/login -> HDFC's own login +
 * OTP + PIN + consent screens -> redirect with a one-shot request_token ->
 * POST /oapi/v1/access-token with apiSecret to mint the final accessToken).
 * That flow needs a live human to clear the OTP/PIN screens, so it cannot be
 * driven headlessly from this server — the user completes it once externally
 * (HDFC Sky developer portal / Postman) and pastes the resulting apiKey +
 * accessToken into Broker Settings, exactly like Zerodha's Kite Connect token.
 *
 * Every authenticated call needs:
 *   - `Authorization: <accessToken>` header — NOT "Bearer <token>".
 *   - `User-Agent` header — HDFC Sky rejects requests without one.
 *   - `api_key` as a QUERY param (not a header) on every call.
 *   - `client_id` as a query param on account-scoped calls (not on
 *     /fetch-ltp). It is not a separate secret: HDFC Sky encodes it in the
 *     accessToken's JWT `sub` claim, so it is derived here rather than
 *     collected as its own credential field.
 */

import { batchWithDelay } from "../lib/batch.mjs";

const PROD_BASE = "https://developer.hdfcsky.com";

// PUT /oapi/v1/fetch-ltp is the ONLY REST quote endpoint HDFC Sky exposes —
// there is no full-quote/market-depth/OI REST call; those are WebSocket-only
// (protobuf feed). The server hard-caps this endpoint at 10 instruments per
// request — anything larger is rejected wholesale with HTTP 400 "maximum 10
// items allowed" (openalgo's HDFC Sky plugin verified this live against a
// 94-symbol option-chain request), so batches are kept well under that.
const LTP_BATCH_SIZE = 10;
const LTP_BATCH_DELAY_MS = 200;

// HDFC Sky's own docs sample User-Agent — required on every request.
export const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36";

function base64UrlDecode(segment) {
  const padded = segment.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (segment.length % 4)) % 4);
  return Buffer.from(padded, "base64").toString("utf8");
}

/** Reads the HDFC Sky client (account) id out of the accessToken's JWT `sub` claim, never logging the token itself. */
export function getClientId(creds) {
  const token = creds?.accessToken;
  if (!token) return "";
  try {
    const parts = String(token).split(".");
    if (parts.length < 2) return "";
    const claims = JSON.parse(base64UrlDecode(parts[1]));
    return String(claims.sub || claims.client_id || "");
  } catch {
    return ""; // not a JWT / unparseable — account-scoped calls simply omit client_id
  }
}

function authHeaders(creds, withJson) {
  if (!creds?.accessToken) {
    throw new Error("HDFC Sky credentials missing accessToken — paste it in Broker Settings.");
  }
  const headers = {
    Authorization: creds.accessToken, // no "Bearer " prefix
    "User-Agent": USER_AGENT,
    Accept: "application/json",
  };
  if (withJson) headers["Content-Type"] = "application/json";
  return headers;
}

function buildUrl(path, creds, params) {
  if (!creds?.apiKey) {
    throw new Error("HDFC Sky credentials missing apiKey — paste it in Broker Settings.");
  }
  const url = new URL(`${PROD_BASE}${path}`);
  url.searchParams.set("api_key", creds.apiKey);
  for (const [key, value] of Object.entries(params || {})) {
    if (value != null && value !== "") url.searchParams.set(key, value);
  }
  return url;
}

async function handleResponse(res, path) {
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-JSON error body */ }

  if (res.status === 401 || res.status === 403) {
    throw new Error("HDFC Sky access token expired or invalid — regenerate it and paste a fresh accessToken in Broker Settings.");
  }
  if (!res.ok) {
    throw new Error(`HDFC Sky API error [${res.status}] on ${path}: ${(json?.message || text || "").slice(0, 300)}`);
  }
  if (json?.status === "error") {
    throw new Error(`HDFC Sky API error on ${path}: ${json.message || json.error_code || "unknown"}`);
  }
  return json;
}

export async function hdfcskyGet(creds, path, params) {
  const url = buildUrl(path, creds, params);
  const res = await fetch(url, { method: "GET", headers: authHeaders(creds, false) });
  return handleResponse(res, path);
}

export async function hdfcskyPut(creds, path, body, params) {
  const url = buildUrl(path, creds, params);
  const res = await fetch(url, { method: "PUT", headers: authHeaders(creds, true), body: JSON.stringify(body) });
  return handleResponse(res, path);
}

/**
 * Batched LTP fetch, respecting the 10-instruments-per-call cap.
 * `instruments`: [{ exchange, token }] using HDFC Sky's REST exchange codes
 * (NFO/BFO for derivatives, NSE_INDEX/BSE_INDEX for index spot quotes — see
 * hdfcskyInstruments.mjs). Returns Map<"EXCHANGE:token", { ltp, prevClose }>.
 */
export async function fetchLtpBatch(creds, instruments) {
  const map = new Map();
  if (!instruments.length) return map;

  const chunkResults = await batchWithDelay(instruments, LTP_BATCH_SIZE, LTP_BATCH_DELAY_MS, async (chunk) => {
    // client_id is not accepted/needed on fetch-ltp — only api_key.
    const json = await hdfcskyPut(creds, "/oapi/v1/fetch-ltp", { data: chunk }, {});
    return json?.data || [];
  });

  for (const rows of chunkResults) {
    for (const row of rows) {
      const key = `${String(row.exchange || "").toUpperCase()}:${String(row.token)}`;
      map.set(key, { ltp: Number(row.ltp) || 0, prevClose: Number(row.prev_close) || 0 });
    }
  }
  return map;
}
