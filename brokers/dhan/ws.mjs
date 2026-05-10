/**
 * Dhan Live Market Feed — binary WebSocket client.
 * Parses Dhan's binary packets and emits UnifiedTick objects via callbacks.
 */
import { WebSocket } from "ws";

const EXCHANGE_SEGMENTS = {
  0: "IDX_I", 1: "NSE_EQ", 2: "NSE_FNO", 3: "NSE_CUR",
  4: "BSE_EQ", 5: "MCX_COMM", 7: "BSE_CUR", 8: "BSE_FNO",
};

const SECURITY_ID_TO_SYMBOL = {
  13: "NIFTY", 25: "BANKNIFTY", 27: "FINNIFTY",
  442: "MIDCPNIFTY", 26: "INDIAVIX", 1: "SENSEX",
};

// Default subscription set — indices for the dashboard
const DEFAULT_INSTRUMENTS = [
  { ExchangeSegment: "IDX_I", SecurityId: "13" },   // NIFTY 50
  { ExchangeSegment: "IDX_I", SecurityId: "25" },   // NIFTY BANK
  { ExchangeSegment: "IDX_I", SecurityId: "27" },   // NIFTY FIN SERVICE
  { ExchangeSegment: "IDX_I", SecurityId: "442" },  // MIDCAP NIFTY
  { ExchangeSegment: "IDX_I", SecurityId: "26" },   // INDIA VIX
];

function parseBinaryPacket(buffer) {
  if (buffer.length < 8) return null;
  const view = new DataView(buffer.buffer || buffer, buffer.byteOffset || 0, buffer.length);
  const responseCode = view.getUint8(0);
  const exchangeSegmentNum = view.getUint8(3);
  const securityId = view.getUint32(4, true);

  const exchangeSegment = EXCHANGE_SEGMENTS[exchangeSegmentNum] || `UNKNOWN_${exchangeSegmentNum}`;
  const symbol = SECURITY_ID_TO_SYMBOL[securityId] || `ID_${securityId}`;

  switch (responseCode) {
    case 2: { // Ticker
      if (buffer.length < 16) return null;
      return {
        type: "ltp", brokerId: "dhan",
        instrumentId: securityId, symbol, exchangeSegment,
        ltp: view.getInt32(8, true) / 100,
      };
    }
    case 4: { // Quote
      if (buffer.length < 50) return null;
      return {
        type: "quote", brokerId: "dhan",
        instrumentId: securityId, symbol, exchangeSegment,
        ltp: view.getInt32(8, true) / 100,
        volume: view.getUint32(22, true),
        open: view.getInt32(34, true) / 100,
        close: view.getInt32(38, true) / 100,
        high: view.getInt32(42, true) / 100,
        low: view.getInt32(46, true) / 100,
      };
    }
    case 5: { // OI
      if (buffer.length < 12) return null;
      return {
        type: "oi", brokerId: "dhan",
        instrumentId: securityId, symbol, exchangeSegment,
        oi: view.getUint32(8, true),
      };
    }
    case 6: { // Prev Close
      if (buffer.length < 16) return null;
      return {
        type: "prevClose", brokerId: "dhan",
        instrumentId: securityId, symbol, exchangeSegment,
        prevClose: view.getInt32(8, true) / 100,
      };
    }
    case 8: { // Full
      if (buffer.length < 62) return null;
      return {
        type: "full", brokerId: "dhan",
        instrumentId: securityId, symbol, exchangeSegment,
        ltp: view.getInt32(8, true) / 100,
        volume: view.getUint32(22, true),
        open: view.getInt32(34, true) / 100,
        close: view.getInt32(38, true) / 100,
        high: view.getInt32(42, true) / 100,
        low: view.getInt32(46, true) / 100,
        oi: view.getUint32(50, true),
      };
    }
    case 50: {
      let disconnectCode = 0;
      if (buffer.length >= 10) disconnectCode = view.getUint16(8, true);
      console.warn(`  ⚠️  Dhan WS disconnection packet, code: ${disconnectCode}`);
      return null;
    }
    default:
      return null;
  }
}

/**
 * @param {{clientId: string, accessToken: string}} credentials
 * @param {{onTick: Function, onStatus: Function, onError: Function}} callbacks
 */
export function openWebSocket(credentials, callbacks) {
  if (!credentials?.clientId || !credentials?.accessToken) {
    callbacks.onError(new Error("Dhan WebSocket: clientId/accessToken required"));
    return null;
  }

  let ws = null;
  let reconnectTimer = null;
  let reconnectDelay = 1000;
  let intentionalClose = false;
  let connected = false;
  let subscriptions = [...DEFAULT_INSTRUMENTS];

  const url = `wss://api-feed.dhan.co?version=2&token=${credentials.accessToken}&clientId=${credentials.clientId}&authType=2`;

  function connect() {
    console.log("  🔌 [Dhan] Connecting WebSocket...");
    try {
      ws = new WebSocket(url);
    } catch (err) {
      console.error("  ❌ [Dhan] WS connection error:", err.message);
      scheduleReconnect();
      return;
    }

    ws.on("open", () => {
      console.log("  ✅ [Dhan] WebSocket connected!");
      connected = true;
      reconnectDelay = 1000;
      ws.send(JSON.stringify({
        RequestCode: 21,
        InstrumentCount: subscriptions.length,
        InstrumentList: subscriptions,
      }));
      console.log(`  📡 [Dhan] Subscribed to ${subscriptions.length} instruments`);
      callbacks.onStatus(true, { instrumentCount: subscriptions.length });
    });

    ws.on("message", (data) => {
      try {
        const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
        const tick = parseBinaryPacket(buf);
        if (!tick) return;
        callbacks.onTick(tick);
      } catch { /* ignore parse errors */ }
    });

    ws.on("close", (code, reason) => {
      console.log(`  🔴 [Dhan] WS closed (${code}): ${reason || "no reason"}`);
      connected = false;
      callbacks.onStatus(false);
      if (!intentionalClose) scheduleReconnect();
    });

    ws.on("error", (err) => {
      console.error("  ❌ [Dhan] WS error:", err.message);
      connected = false;
      if (err.message?.includes("429")) {
        reconnectDelay = 120000;
        console.log("  ⏳ [Dhan] Rate-limited. Will retry in 120s...");
      }
      callbacks.onError(err);
    });
  }

  function scheduleReconnect() {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectDelay = Math.max(reconnectDelay, Math.min(reconnectDelay * 2, 30000));
    console.log(`  🔄 [Dhan] Reconnecting in ${reconnectDelay / 1000}s...`);
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
      subscriptions = instruments;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          RequestCode: 21,
          InstrumentCount: instruments.length,
          InstrumentList: instruments,
        }));
      }
    },
    isConnected() { return connected; },
  };
}

export const DEFAULT_WS_INSTRUMENTS = DEFAULT_INSTRUMENTS;
