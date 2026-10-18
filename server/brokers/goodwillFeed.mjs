/**
 * Goodwill live touchline feed (contract capability `feed`). Official docs:
 * https://developer.gwcindia.in/api/webSocket (checked 2026-10):
 *  - wss://giga.gwcindia.in/NorenWSTP/ ; all messages are JSON.
 *  - Connect: { t: "c", uid, actid, source: "API", susertoken: <usersessionid from login-response> }
 *    -> { t: "ck", uid, s: "Ok" | "Not_Ok" }.
 *  - Subscribe touchline: { t: "t", k: "NSE|22#NFO|35008" } -> one "tk" snapshot per scrip, then "tf" updates that
 *    carry only the fields that changed (lp, pc, v, o, h, l, c, ap, oi, poi, toi, bq1, bp1, sq1, sp1, ft).
 *    Unsubscribe: { t: "u", k: ... }.
 * The field names are the standard Noren touchline ones, so snapshots are merged per scrip and mapped with the
 * shared Noren quote mapper. This module only streams prices; it never sends orders.
 */

import WebSocket from "ws";
import { SessionRequiredError, normaliseError } from "./contract.mjs";
import { mapQuote } from "./shoonyaNorenCore.mjs";
import { feedIdsFor, session } from "./goodwillAuth.mjs";

export const FEED_URL = "wss://giga.gwcindia.in/NorenWSTP/";
const EXCHANGES = new Set(["NSE", "NFO", "BSE", "BFO", "MCX", "CDS"]);
const keyOf = (r) => `${r.exchange}|${String(r.token)}`;

/**
 * createFeed(creds, { onTick, onStatus }, { WebSocketImpl }) -> { subscribe, unsubscribe, close }.
 * Reconnects with backoff (1 s doubling to 30 s) and re-subscribes; stops for good when the connect ack is
 * Not_Ok or there is no session (retrying cannot fix either).
 */
export function createFeed(creds, { onTick = () => {}, onStatus = () => {} } = {}, { WebSocketImpl = WebSocket } = {}) {
  if (!String(creds?.accessToken ?? "").trim() && !String(creds?.requestToken ?? "").trim()) {
    throw new SessionRequiredError("Goodwill: no session for the live feed. Paste today's request_token (or an access token) in Broker Settings.");
  }
  const wanted = new Map();
  const state = new Map();
  let ws = null;
  let ready = false;
  let closed = false;
  let delay = 1000;
  let retry = null;

  const send = (msg) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg)); };
  const subscribeKeys = (keys) => { if (ready && keys.length) send({ t: "t", k: keys.join("#") }); };

  async function connect() {
    if (closed) return;
    let ids;
    try {
      const { token } = await session.ensure(creds);
      ids = feedIdsFor(token, creds);
    } catch (e) {
      closed = true;
      onStatus({ connected: false, reason: normaliseError(e).message });
      return;
    }
    if (!ids.userSessionId || !ids.clientId) {
      closed = true;
      onStatus({ connected: false, reason: "Goodwill: the feed needs your client ID and user session ID. Log in again with a fresh request_token, or add both in Broker Settings." });
      return;
    }
    if (closed) return;
    ws = new WebSocketImpl(FEED_URL);
    ws.on("open", () => send({ t: "c", uid: ids.clientId, actid: ids.clientId, source: "API", susertoken: ids.userSessionId }));
    ws.on("message", (data) => {
      let msg;
      try { msg = JSON.parse(String(data)); } catch { return; }
      if (msg.t === "ck") {
        if (String(msg.s ?? "").toLowerCase() !== "ok") {
          closed = true;
          onStatus({ connected: false, reason: "Goodwill refused the feed session. Log in again with a fresh request_token." });
          ws.close();
          return;
        }
        ready = true;
        delay = 1000;
        onStatus({ connected: true });
        subscribeKeys([...wanted.keys()]);
      } else if (msg.t === "tk" || msg.t === "tf") {
        const key = `${msg.e}|${msg.tk}`;
        const merged = { ...(state.get(key) || {}), ...msg };
        state.set(key, merged);
        const ref = wanted.get(key);
        if (ref && Number(merged.lp) > 0) onTick(mapQuote(ref, merged));
      }
    });
    ws.on("close", () => {
      ready = false;
      if (closed) return;
      onStatus({ connected: false, reason: "disconnected" });
      retry = setTimeout(connect, delay);
      delay = Math.min(delay * 2, 30_000);
    });
    ws.on("error", () => { /* "close" follows and drives the reconnect */ });
  }

  connect();
  return {
    subscribe(refs = []) {
      const fresh = refs.filter((r) => /^\d+$/.test(String(r?.token ?? "")) && EXCHANGES.has(r?.exchange) && !wanted.has(keyOf(r)));
      for (const r of fresh) wanted.set(keyOf(r), r);
      subscribeKeys(fresh.map(keyOf));
    },
    unsubscribe(refs = []) {
      const gone = refs.filter((r) => wanted.has(keyOf(r))).map(keyOf);
      for (const k of gone) { wanted.delete(k); state.delete(k); }
      if (ready && gone.length) send({ t: "u", k: gone.join("#") });
    },
    close() {
      closed = true;
      clearTimeout(retry);
      try { ws?.close(); } catch { /* already closed */ }
    },
  };
}
