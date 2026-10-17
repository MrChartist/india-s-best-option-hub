/**
 * Alice Blue session login (legacy "Ant API" / pya3 SDK 2-call SHA-256
 * handshake) + persistent authenticated WebSocket tick feed.
 *
 * There is no documented multi-symbol REST quote/option-chain endpoint in
 * this legacy API family (confirmed against openalgo's production adapter
 * and the official pya3 SDK) — all live prices come from the NorenWS tick
 * feed. fetchOptionChain/fetchLTP subscribe to the tokens they need and
 * collect whatever ticks arrive within a short window.
 *
 * NEVER log creds, sessionID, or susertoken values — only field names /
 * presence / broker-side status codes.
 */

import { createHash } from "node:crypto";
import { batchWithDelay, sleep } from "../lib/batch.mjs";

const AB_BASE = "https://ant.aliceblueonline.com/rest/AliceBlueAPIService/api";
const WS_URL = "wss://ws1.aliceblueonline.com/NorenWS/";
const HEARTBEAT_MS = 40_000;
const TICK_WAIT_MS = 2_200;
const TICK_POLL_MS = 150;

const sessionCache = new Map(); // credKey -> { sessionID, userId, expiresAt }
const wsCache = new Map(); // credKey -> connection entry (see openWsConnection)

function credKey(creds) {
  return JSON.stringify(creds || {});
}

function sha256Hex(str) {
  return createHash("sha256").update(str).digest("hex");
}

/** Session is only guaranteed valid "for the trading day" — re-derive at the next IST midnight. */
function nextMidnightIST(fromDate) {
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
  const ist = new Date(fromDate.getTime() + IST_OFFSET_MS);
  const istMidnight = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate() + 1, 0, 0, 0);
  return istMidnight - IST_OFFSET_MS;
}

async function loginHandshake(creds) {
  const userId = String(creds?.userId || "").trim().toUpperCase();
  const apiKey = creds?.apiKey;
  if (!userId || !apiKey) throw new Error("Alice Blue credentials missing: userId and apiKey are required");

  const encRes = await fetch(`${AB_BASE}/customer/getAPIEncpkey`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId }),
  });
  const encJson = await encRes.json().catch(() => ({}));
  if (!encRes.ok || !encJson.encKey) {
    throw new Error(`Alice Blue login step 1 (getAPIEncpkey) failed: ${encJson.emsg || `HTTP ${encRes.status}`}`);
  }

  const userData = sha256Hex(userId + apiKey + encJson.encKey);
  const sidRes = await fetch(`${AB_BASE}/customer/getUserSID`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId, userData }),
  });
  const sidJson = await sidRes.json().catch(() => ({}));
  if (sidJson.stat === "Not_ok" || !sidJson.sessionID) {
    const emsg = sidJson.emsg || `HTTP ${sidRes.status}`;
    throw new Error(
      `Alice Blue login failed: ${emsg}. Note: AliceBlue requires this account to have logged into ` +
      `the web or mobile app at least once today for API sessions to work.`
    );
  }
  return { sessionID: sidJson.sessionID, userId };
}

export async function getSession(creds) {
  const key = credKey(creds);
  const cached = sessionCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached;

  const { sessionID, userId } = await loginHandshake(creds);
  const session = { sessionID, userId, expiresAt: nextMidnightIST(new Date()) };
  sessionCache.set(key, session);
  return session;
}

// Alice Blue's "Ant API" runs on the same Noren/Omnesys OMS backend as Shoonya/
// Flattrade/Tradesmart (see this file's docblock) and shares their {stat,emsg}
// error envelope — confirmed in this very file's loginHandshake() ("Not_ok").
// Unlike Shoonya/Flattrade (whose requestCode is one-time-use, so a dead session
// can only be fixed by the user pasting a fresh code), Alice Blue's userId+apiKey
// are reusable evergreen credentials, so a full silent re-login + retry (matching
// angelone.authFetch) is safe here instead of just evicting and surfacing an error.
function looksLikeSessionError(emsg) {
  const text = String(emsg || "").toLowerCase();
  return (
    text.includes("session") ||
    text.includes("not logged in") ||
    text.includes("invalid input : uid") ||
    text.includes("login")
  );
}

async function abFetch(path, body, creds) {
  let session = await getSession(creds);

  const doCall = async (sess) => {
    const res = await fetch(`${AB_BASE}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-SAS-Version": "2.0",
        Authorization: `Bearer ${sess.userId} ${sess.sessionID}`,
      },
      body: JSON.stringify(body || {}),
    });
    const json = await res.json().catch(() => ({}));
    return { res, json };
  };

  let { res, json } = await doCall(session);

  // Alice Blue can return HTTP 200 with a body-level {stat:"Not_ok"} session
  // rejection (mirrors 5paisa's head/body split) — `!res.ok` alone misses this.
  if (json?.stat === "Not_ok" && looksLikeSessionError(json.emsg)) {
    console.log(`[aliceblue] session rejected on ${path} (${json.emsg}) — re-logging in`);
    sessionCache.delete(credKey(creds));
    session = await getSession(creds);
    ({ res, json } = await doCall(session));
  }

  if (!res.ok) throw new Error(`Alice Blue API error [${res.status}] on ${path}: ${json.emsg || "unknown error"}`);
  return json;
}

/** REST-based WS session lifecycle — costs quota, so only called once per (re)connect, never per poll. */
async function prepareWsSession(creds) {
  await abFetch("/ws/invalidateSocketSess", { loginType: "API" }, creds).catch(() => {});
  const created = await abFetch("/ws/createSocketSess", { loginType: "API" }, creds);
  if (created.stat && created.stat !== "Ok") {
    throw new Error(`Alice Blue WebSocket session creation failed: ${created.emsg || "unknown error"}`);
  }
  return created;
}

function cleanupEntry(entry) {
  entry.authenticated = false;
  if (entry.heartbeatTimer) { clearInterval(entry.heartbeatTimer); entry.heartbeatTimer = null; }
}

// `entry` is created and cached by getWsConnection *before* this function's first
// await, so its `connectingPromise` stays visible to concurrent callers for the
// entire handshake. Mutating that same object in place (instead of building a new
// one here) is what lets a second fetchOptionChain call in flight during connect
// join the in-progress connection rather than opening a duplicate WS + duplicate
// createSocketSess/invalidateSocketSess REST calls against the rate-limit budget.
async function openWsConnection(creds, key, entry) {
  const session = await getSession(creds);
  await prepareWsSession(creds);
  const susertoken = sha256Hex(sha256Hex(session.sessionID)); // double SHA-256, hex each time

  await new Promise((resolve, reject) => {
    let settled = false;
    const ws = new WebSocket(WS_URL);
    entry.ws = ws;

    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        // Actively tear down + evict the stuck entry — otherwise this rejected
        // connectingPromise stays cached forever (getWsConnection keeps returning
        // the same already-rejected promise to every future caller) instead of
        // retrying on the next call, since the socket's own error/close events may
        // never fire if the connection attempt is hanging silently (e.g. a dropped
        // TCP handshake behind a firewall). Mirrors hdfcsecuritiesFeed.mjs's connect
        // timeout handling for the exact same failure mode.
        try { ws.close(); } catch { /* ignore */ }
        cleanupEntry(entry);
        if (wsCache.get(key) === entry) wsCache.delete(key);
        reject(new Error("Alice Blue WebSocket authentication timed out"));
      }
    }, 10_000);

    ws.addEventListener("open", () => {
      ws.send(JSON.stringify({
        susertoken, t: "c",
        actid: `${session.userId}_API`,
        uid: `${session.userId}_API`,
        source: "API",
      }));
    });

    ws.addEventListener("message", (event) => {
      let msg;
      try { msg = JSON.parse(event.data.toString()); } catch { return; }

      if (msg.t === "ck") {
        clearTimeout(timeout);
        if (msg.s === "OK") {
          entry.authenticated = true;
          entry.heartbeatTimer = setInterval(() => {
            try { ws.send(JSON.stringify({ k: "", t: "h" })); } catch { /* next poll will reconnect */ }
          }, HEARTBEAT_MS);
          if (!settled) { settled = true; resolve(); }
        } else if (!settled) {
          settled = true;
          reject(new Error(`Alice Blue WebSocket auth rejected (status: ${msg.s || "unknown"})`));
        }
        return;
      }

      // Tick / depth updates: 'tk'|'tf' (touchline) or 'dk'|'df' (depth) per NorenWS convention.
      if (msg.t === "tk" || msg.t === "tf" || msg.t === "dk" || msg.t === "df") {
        const tickKey = `${msg.e}|${msg.tk}`;
        const prev = entry.latestTicks.get(tickKey) || {};
        entry.latestTicks.set(tickKey, { ...prev, ...msg });
      }
    });

    ws.addEventListener("error", () => {
      clearTimeout(timeout);
      cleanupEntry(entry);
      if (wsCache.get(key) === entry) wsCache.delete(key);
      if (!settled) { settled = true; reject(new Error("Alice Blue WebSocket connection error")); }
    });

    ws.addEventListener("close", () => {
      clearTimeout(timeout);
      cleanupEntry(entry);
      if (wsCache.get(key) === entry) wsCache.delete(key);
      if (!settled) { settled = true; reject(new Error("Alice Blue WebSocket closed before authentication")); }
    });
  });

  return entry;
}

async function getWsConnection(creds) {
  const key = credKey(creds);
  const existing = wsCache.get(key);
  if (existing && existing.ws && existing.ws.readyState === WebSocket.OPEN && existing.authenticated) {
    return existing;
  }
  if (existing?.connectingPromise) return existing.connectingPromise;

  // Build + cache the entry BEFORE the first await inside openWsConnection runs, and
  // pass the same object in so it's mutated (not replaced) throughout the handshake —
  // see the comment on openWsConnection for why identity must be preserved here.
  const entry = {
    ws: null,
    authenticated: false,
    latestTicks: new Map(), // "EXCH|token" -> latest tick fields
    subscribedTokens: new Set(),
    heartbeatTimer: null,
    connectingPromise: null,
  };
  entry.connectingPromise = openWsConnection(creds, key, entry);
  wsCache.set(key, entry);

  const resolved = await entry.connectingPromise;
  resolved.connectingPromise = null;
  return resolved;
}

/**
 * Subscribe to a batch of "EXCH|token" keys and wait up to ~2.2s (or until every
 * key has reported at least once) for the feed to push ticks. Leaves the socket
 * subscribed + open for reuse by the next call.
 */
export async function subscribeAndCollect(creds, tickKeys, windowMs = TICK_WAIT_MS) {
  const entry = await getWsConnection(creds);
  const newKeys = tickKeys.filter((k) => !entry.subscribedTokens.has(k));

  if (newKeys.length) {
    // AliceBlue has no documented per-message token cap for this legacy feed, but we
    // chunk defensively so one option-chain poll never sends one oversized frame.
    await batchWithDelay(newKeys, 50, 150, async (chunk) => {
      entry.ws.send(JSON.stringify({ k: chunk.join("#"), t: "t" }));
      chunk.forEach((k) => entry.subscribedTokens.add(k));
    });
  }

  const start = Date.now();
  while (Date.now() - start < windowMs) {
    if (tickKeys.every((k) => entry.latestTicks.has(k))) break;
    await sleep(TICK_POLL_MS);
  }

  const result = new Map();
  for (const k of tickKeys) result.set(k, entry.latestTicks.get(k));
  return result;
}
