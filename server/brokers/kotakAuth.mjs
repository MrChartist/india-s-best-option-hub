/**
 * Kotak Securities (Neo) authentication — TOTP + MPIN two-step handshake.
 *
 * Source: broker-api-docs/kotak-api-docs/02-authentication.md (official Kotak
 * Neo Trade API docs, mirrored) + marketcalls/openalgo's broker/kotak/api/auth_api.py
 * (production reference implementation).
 *
 * Flow:
 *   1. TOTP login  — POST /login/1.0/tradeApiLogin with {mobileNumber, ucc, totp}.
 *      `totp` is generated from a base32 secret captured once during Kotak's own
 *      "TOTP Registration" step in the API dashboard (same shape as Angel One /
 *      5paisa's totpSecret field — never the live 6-digit code itself).
 *      Returns a short-lived "View" token + sid.
 *   2. MPIN validate — POST /login/1.0/tradeApiValidate, authenticated with the
 *      Step 1 view token/sid (`Auth`/`sid` headers), body {mpin}.
 *      Returns a "Trade" token + sid AND `baseUrl` — the host every subsequent
 *      market-data/order call must hit (varies by data-center).
 *
 * Both login calls also require the static per-app `accessToken` issued once
 * from the Neo mobile app (More -> Trade API -> Your Applications) in the
 * `Authorization` header — this is NOT the session token, it identifies the
 * registered API app itself and is also what read-only market-data calls
 * (quotes, instrument master) use directly, without the trade token/sid at all.
 *
 * Kotak's docs don't publish a session TTL. Like 5paisa (another broker whose
 * TOTP session isn't a rolling window either) we treat it as valid through the
 * end of the current IST trading day and force a fresh TOTP+MPIN login after
 * that — conservative, unverified against a live account, but avoids silently
 * trading on a stale session overnight.
 */

import { generateTOTP } from "../lib/totp.mjs";

const LOGIN_BASE = "https://mis.kotaksecurities.com";
const LOGIN_PATH = "/login/1.0/tradeApiLogin";
const VALIDATE_PATH = "/login/1.0/tradeApiValidate";
const NEO_FIN_KEY = "neotradeapi";

const REQUIRED_FIELDS = ["accessToken", "mobileNumber", "ucc", "totpSecret", "mpin"];

// In-memory only — never persisted to disk, never logged. Server restart forces
// one fresh TOTP+MPIN login per active user.
const sessionCache = new Map();

function credsKey(creds) {
  return JSON.stringify({
    a: creds?.accessToken,
    m: creds?.mobileNumber,
    u: creds?.ucc,
    t: creds?.totpSecret,
    p: creds?.mpin,
  });
}

function requireFields(creds) {
  const missing = REQUIRED_FIELDS.filter((f) => !creds?.[f]);
  if (missing.length) {
    throw new Error(`Kotak Neo credentials missing required field(s): ${missing.join(", ")}`);
  }
}

/** Kotak expects "+91XXXXXXXXXX" regardless of how the user typed it. */
function normalizeMobile(raw) {
  let n = String(raw).trim().replace(/\s+/g, "").replace(/^\+?91/, "");
  return `+91${n}`;
}

/** Today's 23:59 IST as an epoch ms timestamp, regardless of the host server's own timezone. */
function istEndOfDay(now = new Date()) {
  const istDateStr = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  return new Date(`${istDateStr}T23:59:00+05:30`).getTime();
}

async function postJson(path, headers, body) {
  const res = await fetch(`${LOGIN_BASE}${path}`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-JSON error body */ }
  return { res, json, text };
}

async function loginFresh(creds) {
  requireFields(creds);
  const mobileNumber = normalizeMobile(creds.mobileNumber);

  // Step 1 — TOTP login (view token/sid).
  const totp = generateTOTP(creds.totpSecret);
  const step1 = await postJson(
    LOGIN_PATH,
    { Authorization: creds.accessToken, "neo-fin-key": NEO_FIN_KEY },
    { mobileNumber, ucc: creds.ucc, totp }
  );
  const viewData = step1.json?.data;
  if (!step1.res.ok || viewData?.status !== "success" || !viewData?.token || !viewData?.sid) {
    const msg = step1.json?.errMsg || step1.json?.message || `HTTP ${step1.res.status}`;
    console.log(`[kotak] TOTP login failed (status ${step1.res.status})`);
    throw new Error(`Kotak Neo TOTP login failed: ${msg}`);
  }

  // Step 2 — MPIN validate (trade token/sid + baseUrl).
  const step2 = await postJson(
    VALIDATE_PATH,
    {
      Authorization: creds.accessToken,
      "neo-fin-key": NEO_FIN_KEY,
      sid: viewData.sid,
      Auth: viewData.token,
    },
    { mpin: creds.mpin }
  );
  const tradeData = step2.json?.data;
  if (!step2.res.ok || tradeData?.status !== "success" || !tradeData?.token || !tradeData?.sid) {
    const msg = step2.json?.errMsg || step2.json?.message || `HTTP ${step2.res.status}`;
    console.log(`[kotak] MPIN validation failed (status ${step2.res.status})`);
    throw new Error(`Kotak Neo MPIN validation failed: ${msg}`);
  }
  if (!tradeData.baseUrl) {
    throw new Error("Kotak Neo login succeeded but returned no baseUrl — cannot make market-data calls.");
  }

  const session = {
    baseUrl: tradeData.baseUrl.replace(/\/$/, ""),
    accessToken: creds.accessToken, // read-only market-data calls authenticate with this, not the trade token
    tradeToken: tradeData.token,
    tradeSid: tradeData.sid,
    expiresAt: istEndOfDay(),
  };
  sessionCache.set(credsKey(creds), session);
  console.log(`[kotak] login successful, baseUrl resolved`);
  return session;
}

/** Returns a cached, still-valid session or performs a fresh TOTP+MPIN login. Throws on any auth failure. */
export async function getSession(creds) {
  requireFields(creds);
  const key = credsKey(creds);
  const cached = sessionCache.get(key);
  if (cached && Date.now() < cached.expiresAt) return cached;
  return loginFresh(creds);
}

export { REQUIRED_FIELDS };
