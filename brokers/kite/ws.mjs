/**
 * Kite Connect v3 — Live binary WebSocket parser.
 *
 * URL: wss://ws.kite.trade?api_key=<>&access_token=<>
 *
 * Packet format (big-endian):
 *   First frame: 2-byte uint16 — number of packets in this frame
 *   For each packet:
 *     2-byte uint16 — packet length
 *     N bytes      — payload
 *
 * Payload layout depends on subscription mode (ltp | quote | full).
 * Prices and OHLC are quoted in paise for NSE_EQ/NSE_FNO (divide by 100);
 * for currencies it's 1e7. We use /100 since this terminal trades NSE.
 */
import { WebSocket } from "ws";
import { resolveIndex } from "./instruments.mjs";

// Build reverse map: instrument_token → app symbol (for the indices we care about)
const TOKEN_TO_SYMBOL = {};
for (const sym of ["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "INDIAVIX", "SENSEX"]) {
  const idx = resolveIndex(sym);
  if (idx) TOKEN_TO_SYMBOL[idx.instrumentToken] = sym;
}

// Default index subscriptions for the dashboard (matches Dhan defaults)
const DEFAULT_TOKENS = Object.keys(TOKEN_TO_SYMBOL).map(Number);

function parsePacket(buf) {
  const len = buf.length;
  if (len < 8) return null;
  const view = new DataView(buf.buffer, buf.byteOffset, buf.length);
  const token = view.getInt32(0, false); // big-endian
  const symbol = TOKEN_TO_SYMBOL[token] || `TOKEN_${token}`;

  // Indices send 8 or 32-byte packets; equities send 8/44/184.
  // We branch on length only; semantics of fields differ slightly for indices but the offsets we use are common.
  const PRICE_DIVISOR = 100; // NSE/NFO

  if (len === 8) {
    return {
      type: "ltp", brokerId: "kite",
      instrumentId: token, symbol, exchangeSegment: "NSE_FNO",
      ltp: view.getInt32(4, false) / PRICE_DIVISOR,
    };
  }

  if (len === 28 || len === 32) {
    // Index quote packet (28 = without timestamp; 32 = with)
    return {
      type: "quote", brokerId: "kite",
      instrumentId: token, symbol, exchangeSegment: "IDX_I",
      ltp: view.getInt32(4, false) / PRICE_DIVISOR,
      high: view.getInt32(8, false) / PRICE_DIVISOR,
      low: view.getInt32(12, false) / PRICE_DIVISOR,
      open: view.getInt32(16, false) / PRICE_DIVISOR,
      close: view.getInt32(20, false) / PRICE_DIVISOR,
      change: view.getInt32(24, false) / PRICE_DIVISOR,
    };
  }

  if (len === 44) {
    return {
      type: "quote", brokerId: "kite",
      instrumentId: token, symbol, exchangeSegment: "NSE_FNO",
      ltp: view.getInt32(4, false) / PRICE_DIVISOR,
      volume: view.getInt32(16, false),
      open: view.getInt32(28, false) / PRICE_DIVISOR,
      high: view.getInt32(32, false) / PRICE_DIVISOR,
      low: view.getInt32(36, false) / PRICE_DIVISOR,
      close: view.getInt32(40, false) / PRICE_DIVISOR,
    };
  }

  if (len === 184) {
    // Full mode (equity/F&O)
    return {
      type: "full", brokerId: "kite",
      instrumentId: token, symbol, exchangeSegment: "NSE_FNO",
      ltp: view.getInt32(4, false) / PRICE_DIVISOR,
      volume: view.getInt32(16, false),
      open: view.getInt32(28, false) / PRICE_DIVISOR,
      high: view.getInt32(32, false) / PRICE_DIVISOR,
      low: view.getInt32(36, false) / PRICE_DIVISOR,
      close: view.getInt32(40, false) / PRICE_DIVISOR,
      oi: view.getInt32(48, false),
    };
  }

  return null;
}

function parseBinaryFrame(buf) {
  if (buf.length < 2) return [];
  const view = new DataView(buf.buffer, buf.byteOffset, buf.length);
  const numPackets = view.getInt16(0, false);
  const ticks = [];
  let offset = 2;
  for (let i = 0; i < numPackets; i++) {
    if (offset + 2 > buf.length) break;
    const pktLen = view.getInt16(offset, false);
    offset += 2;
    if (offset + pktLen > buf.length) break;
    const slice = buf.slice(offset, offset + pktLen);
    const tick = parsePacket(slice);
    if (tick) ticks.push(tick);
    offset += pktLen;
  }
  return ticks;
}

/**
 * @param {{apiKey: string, accessToken: string}} credentials
 * @param {{onTick: Function, onStatus: Function, onError: Function}} callbacks
 */
export function openWebSocket(credentials, callbacks) {
  const apiKey = credentials?.apiKey || process.env.KITE_API_KEY;
  const accessToken = credentials?.accessToken || process.env.KITE_ACCESS_TOKEN;
  if (!apiKey || !accessToken) {
    callbacks.onError(new Error("Kite WebSocket: apiKey/accessToken required"));
    return null;
  }

  let ws = null;
  let reconnectTimer = null;
  let reconnectDelay = 1000;
  let intentionalClose = false;
  let connected = false;
  let subscribedTokens = [...DEFAULT_TOKENS];

  const url = `wss://ws.kite.trade?api_key=${apiKey}&access_token=${accessToken}`;

  function connect() {
    console.log("  🔌 [Kite] Connecting WebSocket...");
    try {
      ws = new WebSocket(url);
    } catch (err) {
      console.error("  ❌ [Kite] WS connection error:", err.message);
      scheduleReconnect();
      return;
    }

    ws.on("open", () => {
      console.log("  ✅ [Kite] WebSocket connected!");
      connected = true;
      reconnectDelay = 1000;
      ws.send(JSON.stringify({ a: "subscribe", v: subscribedTokens }));
      // Use "quote" mode by default (broadcasts OHLC + volume); "full" includes OI/depth.
      ws.send(JSON.stringify({ a: "mode", v: ["quote", subscribedTokens] }));
      console.log(`  📡 [Kite] Subscribed to ${subscribedTokens.length} tokens`);
      callbacks.onStatus(true, { instrumentCount: subscribedTokens.length });
    });

    ws.on("message", (data, isBinary) => {
      try {
        if (isBinary) {
          const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
          if (buf.length === 1) return; // heartbeat
          const ticks = parseBinaryFrame(buf);
          ticks.forEach(callbacks.onTick);
        } else {
          // Text frame — usually order updates / errors
          const msg = JSON.parse(data.toString());
          if (msg.type === "error") callbacks.onError(new Error(msg.data || "Kite WS error"));
        }
      } catch { /* ignore */ }
    });

    ws.on("close", (code, reason) => {
      console.log(`  🔴 [Kite] WS closed (${code}): ${reason || "no reason"}`);
      connected = false;
      callbacks.onStatus(false);
      if (!intentionalClose) scheduleReconnect();
    });

    ws.on("error", (err) => {
      console.error("  ❌ [Kite] WS error:", err.message);
      connected = false;
      callbacks.onError(err);
    });
  }

  function scheduleReconnect() {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectDelay = Math.max(reconnectDelay, Math.min(reconnectDelay * 2, 30000));
    console.log(`  🔄 [Kite] Reconnecting in ${reconnectDelay / 1000}s...`);
    reconnectTimer = setTimeout(connect, reconnectDelay);
  }

  connect();

  return {
    close() {
      intentionalClose = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (ws) ws.close();
    },
    subscribe(instruments) {
      // Accept either token-list ([number,...]) or unified instrument list ({securityId,...})
      const tokens = instruments
        .map((i) => typeof i === "number" ? i : Number(i.securityId))
        .filter((n) => Number.isFinite(n));
      subscribedTokens = tokens;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ a: "subscribe", v: tokens }));
        ws.send(JSON.stringify({ a: "mode", v: ["quote", tokens] }));
      }
    },
    isConnected() { return connected; },
  };
}

export const DEFAULT_WS_TOKENS = DEFAULT_TOKENS;
