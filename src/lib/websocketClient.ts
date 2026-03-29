/**
 * WebSocket Client — Singleton manager for real-time Dhan market feed
 * 
 * Connects to the local proxy server's WebSocket endpoint (ws://localhost:4002/ws)
 * which relays parsed Dhan tick data as JSON. Provides a pub/sub interface for
 * React components to subscribe to specific instrument updates.
 * 
 * Architecture:
 *   Dhan WS (binary) → proxy-server.mjs → this client (JSON) → React hooks
 */

import { getActiveBroker } from "./brokerConfig";

// ── Types ──

export interface TickData {
  type: "ticker" | "quote" | "prevClose" | "oi" | "full" | "status";
  securityId: number;
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
  timestamp?: number;
  // Status fields
  connected?: boolean;
  instrumentCount?: number;
}

export type TickListener = (data: TickData) => void;
export type StatusListener = (connected: boolean) => void;

// ── Security ID ↔ Symbol mapping ──

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
  private globalListeners = new Set<TickListener>(); // all ticks
  private statusListeners = new Set<StatusListener>();
  private latestData = new Map<number, TickData>(); // securityId → latest merged data
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 1000;
  private _connected = false;
  private _dhanConnected = false;
  private intentionalClose = false;
  private credentialsSent = false;

  constructor(url?: string) {
    this.url = url || `ws://${window.location.hostname}:4002/ws`;
  }

  /** Is the local proxy WebSocket connected? */
  get isConnected(): boolean {
    return this._connected;
  }

  /** Is the Dhan WebSocket relay active (live ticks flowing)? */
  get isDhanConnected(): boolean {
    return this._dhanConnected;
  }

  /** Get latest cached tick for a security */
  getLatest(securityId: number): TickData | undefined {
    return this.latestData.get(securityId);
  }

  /** Get latest by symbol name */
  getLatestBySymbol(symbol: string): TickData | undefined {
    const id = SYMBOL_TO_SECURITY_ID[symbol];
    return id ? this.latestData.get(id) : undefined;
  }

  /** Get all latest ticks */
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

      // Send Dhan credentials from browser localStorage if available
      if (!this.credentialsSent) {
        this.sendCredentials();
      }
    };

    this.ws.onmessage = (event) => {
      try {
        const data: TickData = JSON.parse(event.data);

        if (data.type === "status") {
          this._dhanConnected = data.connected || false;
          this.notifyStatus(this._dhanConnected);
          return;
        }

        // Merge into latest cache
        const existing = this.latestData.get(data.securityId) || ({} as TickData);
        const merged = { ...existing, ...data, timestamp: Date.now() };
        this.latestData.set(data.securityId, merged);

        // Notify specific listeners
        const listeners = this.tickListeners.get(data.securityId);
        if (listeners) {
          listeners.forEach((cb) => cb(merged));
        }

        // Notify global listeners
        this.globalListeners.forEach((cb) => cb(merged));
      } catch {
        // Ignore malformed messages
      }
    };

    this.ws.onclose = () => {
      this._connected = false;
      this._dhanConnected = false;
      this.notifyStatus(false);

      if (!this.intentionalClose) {
        this.scheduleReconnect();
      }
    };

    this.ws.onerror = () => {
      // Error handler — close event will fire after this
      this._connected = false;
    };
  }

  /** Send Dhan credentials to proxy for WebSocket connection */
  sendCredentials(): void {
    const broker = getActiveBroker();
    if (broker?.brokerId === "dhan" && broker.values.clientId && broker.values.accessToken) {
      this.send({
        type: "configure",
        clientId: broker.values.clientId,
        accessToken: broker.values.accessToken,
      });
      this.credentialsSent = true;
      console.log("[MarketWS] Sent Dhan credentials to proxy");
    }
  }

  /** Subscribe to ticks for a specific security ID */
  subscribe(securityId: number, callback: TickListener): () => void {
    if (!this.tickListeners.has(securityId)) {
      this.tickListeners.set(securityId, new Set());
    }
    this.tickListeners.get(securityId)!.add(callback);

    // Immediately deliver cached data
    const cached = this.latestData.get(securityId);
    if (cached) {
      setTimeout(() => callback(cached), 0);
    }

    return () => {
      this.tickListeners.get(securityId)?.delete(callback);
    };
  }

  /** Subscribe to ALL ticks */
  subscribeAll(callback: TickListener): () => void {
    this.globalListeners.add(callback);
    return () => {
      this.globalListeners.delete(callback);
    };
  }

  /** Subscribe to connection status changes */
  onStatus(callback: StatusListener): () => void {
    this.statusListeners.add(callback);
    // Immediately report current status
    setTimeout(() => callback(this._dhanConnected), 0);
    return () => {
      this.statusListeners.delete(callback);
    };
  }

  /** Send a message to the proxy */
  private send(data: any): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  /** Disconnect */
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
    this._dhanConnected = false;
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

// Auto-connect on import (safe for SSR since WebSocket check is in connect())
if (typeof window !== "undefined") {
  // Small delay to let the app initialize first
  setTimeout(() => marketWS.connect(), 500);
}
