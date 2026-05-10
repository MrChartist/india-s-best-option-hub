/**
 * WebSocket Client — Singleton manager for the live broker market feed.
 *
 * Connects to the local proxy server's WebSocket endpoint (ws://localhost:4002/ws)
 * which relays parsed unified ticks. Provides a pub/sub interface for React
 * components to subscribe to specific instrument updates.
 *
 * Architecture:
 *   <Active Broker>'s upstream WS (binary) → proxy-server.mjs → this client (JSON) → React hooks
 */

import { getActiveBroker, getBrokerInfo } from "./brokerConfig";

// ── Types ──

export interface TickData {
  type: "ticker" | "ltp" | "quote" | "prevClose" | "oi" | "full" | "status";
  brokerId?: string;
  // `securityId` retained for backward-compat — equivalent to `instrumentId` from the unified tick.
  securityId: number;
  instrumentId?: number;
  symbol: string;
  exchangeSegment: string;
  ltp?: number;
  change?: number;
  changePercent?: number;
  open?: number;
  high?: number;
  low?: number;
  close?: number;
  prevClose?: number;
  volume?: number;
  oi?: number;
  bidPrice?: number;
  askPrice?: number;
  timestamp?: number;
  // Status fields
  connected?: boolean;
  instrumentCount?: number;
}

export type TickListener = (data: TickData) => void;
export type StatusListener = (connected: boolean) => void;

// ── App symbol ↔ broker security-id mapping ──
//
// We keep the historical Dhan numeric IDs as the canonical app-level keys
// so existing components (Watchlist, IndexCards, useWebSocketIndices) keep
// working unchanged. Kite ticks come in under their own instrument_token,
// so we translate Kite tokens → these IDs at the relay layer (in the proxy's
// upstream tick handler we set tick.symbol; below we map symbol → id).

const SYMBOL_TO_SECURITY_ID: Record<string, number> = {
  NIFTY: 13,
  BANKNIFTY: 25,
  FINNIFTY: 27,
  MIDCPNIFTY: 442,
  INDIAVIX: 26,
  SENSEX: 1,
};

const SECURITY_ID_TO_SYMBOL: Record<number, string> = {};
for (const [sym, id] of Object.entries(SYMBOL_TO_SECURITY_ID)) {
  SECURITY_ID_TO_SYMBOL[id] = sym;
}

export { SYMBOL_TO_SECURITY_ID, SECURITY_ID_TO_SYMBOL };

// ── WebSocket Client Class ──

class MarketWebSocket {
  private ws: WebSocket | null = null;
  private url: string;
  private tickListeners = new Map<number, Set<TickListener>>(); // securityId → listeners
  private globalListeners = new Set<TickListener>();
  private statusListeners = new Set<StatusListener>();
  private latestData = new Map<number, TickData>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 1000;
  private _connected = false;
  private _upstreamConnected = false;
  private intentionalClose = false;
  private credentialsSent = false;

  constructor(url?: string) {
    this.url = url || `ws://${window.location.hostname}:4002/ws`;
  }

  /** Is the local proxy WebSocket connected? */
  get isConnected(): boolean {
    return this._connected;
  }

  /** Is the broker upstream WebSocket relay active (live ticks flowing)? */
  get isUpstreamConnected(): boolean {
    return this._upstreamConnected;
  }
  /** @deprecated alias kept for backward compatibility */
  get isDhanConnected(): boolean {
    return this._upstreamConnected;
  }

  getLatest(securityId: number): TickData | undefined {
    return this.latestData.get(securityId);
  }

  getLatestBySymbol(symbol: string): TickData | undefined {
    const id = SYMBOL_TO_SECURITY_ID[symbol];
    return id ? this.latestData.get(id) : undefined;
  }

  getAllLatest(): Map<number, TickData> {
    return this.latestData;
  }

  /** Connect to the proxy WebSocket server */
  connect(): void {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    this.intentionalClose = false;

    try {
      this.ws = new WebSocket(this.url);
    } catch (err) {
      console.warn("[MarketWS] Connection error:", err);
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      console.log("[MarketWS] Connected to proxy WebSocket");
      this._connected = true;
      this.reconnectDelay = 1000;
      this.notifyStatus(true);

      if (!this.credentialsSent) {
        this.sendCredentials();
      }
    };

    this.ws.onmessage = (event) => {
      try {
        const data: TickData = JSON.parse(event.data);

        if (data.type === "status") {
          this._upstreamConnected = data.connected || false;
          this.notifyStatus(this._upstreamConnected);
          return;
        }

        // Bridge: if proxy sent `instrumentId` (unified shape) but the app keys
        // off `securityId`, mirror the value across.
        if (data.instrumentId != null && data.securityId == null) {
          // Map by symbol if we know it, otherwise pass through the raw token.
          const idBySymbol = data.symbol ? SYMBOL_TO_SECURITY_ID[data.symbol] : undefined;
          data.securityId = idBySymbol ?? data.instrumentId;
        }

        if (data.securityId == null) return;

        const existing = this.latestData.get(data.securityId) || ({} as TickData);
        const merged = { ...existing, ...data, timestamp: Date.now() };
        this.latestData.set(data.securityId, merged);

        const listeners = this.tickListeners.get(data.securityId);
        if (listeners) listeners.forEach((cb) => cb(merged));
        this.globalListeners.forEach((cb) => cb(merged));
      } catch {
        // Ignore malformed messages
      }
    };

    this.ws.onclose = () => {
      this._connected = false;
      this._upstreamConnected = false;
      this.notifyStatus(false);
      if (!this.intentionalClose) this.scheduleReconnect();
    };

    this.ws.onerror = () => {
      this._connected = false;
    };
  }

  /** Send active broker's credentials to the proxy so it can open the upstream WS. */
  sendCredentials(): void {
    const broker = getActiveBroker();
    if (!broker) return;
    const info = getBrokerInfo(broker.brokerId);
    if (!info) return;

    // Verify all required fields are present
    const requiredKeys = info.fields.filter((f) => f.required).map((f) => f.key);
    const allPresent = requiredKeys.every((k) => !!broker.values[k]);
    if (!allPresent) return;

    this.send({
      type: "configure",
      brokerId: broker.brokerId,
      credentials: broker.values,
    });
    this.credentialsSent = true;
    console.log(`[MarketWS] Sent ${broker.brokerId} credentials to proxy`);
  }

  /** Re-send credentials (e.g. after the user switches brokers). */
  refreshCredentials(): void {
    this.credentialsSent = false;
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.sendCredentials();
    }
  }

  subscribe(securityId: number, callback: TickListener): () => void {
    if (!this.tickListeners.has(securityId)) {
      this.tickListeners.set(securityId, new Set());
    }
    this.tickListeners.get(securityId)!.add(callback);

    const cached = this.latestData.get(securityId);
    if (cached) setTimeout(() => callback(cached), 0);

    return () => {
      this.tickListeners.get(securityId)?.delete(callback);
    };
  }

  subscribeAll(callback: TickListener): () => void {
    this.globalListeners.add(callback);
    return () => {
      this.globalListeners.delete(callback);
    };
  }

  onStatus(callback: StatusListener): () => void {
    this.statusListeners.add(callback);
    setTimeout(() => callback(this._upstreamConnected), 0);
    return () => {
      this.statusListeners.delete(callback);
    };
  }

  private send(data: any): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  disconnect(): void {
    this.intentionalClose = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this._connected = false;
    this._upstreamConnected = false;
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectDelay = Math.min(this.reconnectDelay * 1.5, 15000);
    this.reconnectTimer = setTimeout(() => {
      console.log("[MarketWS] Reconnecting...");
      this.connect();
    }, this.reconnectDelay);
  }

  private notifyStatus(connected: boolean): void {
    this.statusListeners.forEach((cb) => cb(connected));
  }
}

// ── Singleton Export ──

export const marketWS = new MarketWebSocket();

if (typeof window !== "undefined") {
  setTimeout(() => marketWS.connect(), 500);
}
