/**
 * WebSocket Client — singleton manager for the real-time market feed.
 *
 * Connects to the local proxy's WebSocket (ws://host:4002/ws), which relays
 * parsed Dhan ticks as JSON.
 *
 *   Dhan WS (binary) → proxy-server.mjs → this client (JSON) → React hooks
 *
 * Two things changed here versus the original:
 *
 *  - Ticks are keyed "SEGMENT:securityId", not securityId. See instrumentKeys.ts
 *    for why keying by id alone was a correctness bug, not just untidy.
 *  - Arbitrary instruments (option strikes) can now be subscribed at runtime.
 *    Previously only five hardcoded indices streamed and every option price came
 *    from a REST poll several seconds stale — unusable for execution.
 */

import { getActiveBroker } from "./brokerConfig";
import {
  tickKey, toWireInstrument, SYMBOL_TO_SECURITY_ID, SECURITY_ID_TO_SYMBOL,
  type InstrumentRef, type ExchangeSegment,
} from "./instrumentKeys";

export interface TickData {
  type: "ticker" | "quote" | "prevClose" | "oi" | "full" | "status" | "feedCapacity";
  key?: string;
  securityId: number;
  symbol: string;
  exchangeSegment: string;
  ltp?: number;
  ltt?: number;
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
  connected?: boolean;
  instrumentCount?: number;
}

export type TickListener = (data: TickData) => void;
export type StatusListener = (connected: boolean) => void;

export { SYMBOL_TO_SECURITY_ID, SECURITY_ID_TO_SYMBOL, tickKey };
export type { InstrumentRef, ExchangeSegment };

class MarketWebSocket {
  private ws: WebSocket | null = null;
  private url: string;
  private tickListeners = new Map<string, Set<TickListener>>(); // key → listeners
  private globalListeners = new Set<TickListener>();
  private statusListeners = new Set<StatusListener>();
  private latestData = new Map<string, TickData>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 1000;
  private _connected = false;
  private _dhanConnected = false;
  private intentionalClose = false;
  private credentialsSent = false;
  /** Instruments this client wants, replayed on every reconnect. key → ref */
  private desired = new Map<string, InstrumentRef>();
  /** Refcount per key so two components can watch the same strike. */
  private refs = new Map<string, number>();

  constructor(url?: string) {
    this.url = url || `ws://${window.location.hostname}:4002/ws`;
  }

  get isConnected(): boolean { return this._connected; }
  get isDhanConnected(): boolean { return this._dhanConnected; }

  /** Latest tick for a composite key. */
  getLatestByKey(key: string): TickData | undefined {
    return this.latestData.get(key);
  }

  /** Latest tick for an index, by security id (indices always live in IDX_I). */
  getLatest(securityId: number): TickData | undefined {
    return this.latestData.get(tickKey("IDX_I", securityId));
  }

  getLatestBySymbol(symbol: string): TickData | undefined {
    const id = SYMBOL_TO_SECURITY_ID[symbol];
    return id ? this.getLatest(id) : undefined;
  }

  getAllLatest(): Map<string, TickData> { return this.latestData; }

  connect(): void {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;
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
      this.sendCredentials();
      this.replaySubscriptions();
    };

    this.ws.onmessage = (event) => {
      try {
        const data: TickData = JSON.parse(event.data);

        if (data.type === "status") {
          this._dhanConnected = data.connected || false;
          this.notifyStatus(this._dhanConnected);
          return;
        }
        if (data.type === "feedCapacity") {
          console.warn("[MarketWS] Feed subscription capacity reached:", data);
          return;
        }

        // The server sends `key`; fall back for any message that predates it.
        const key = data.key || tickKey(data.exchangeSegment || "IDX_I", data.securityId);
        const existing = this.latestData.get(key) || ({} as TickData);
        const merged = { ...existing, ...data, key, timestamp: Date.now() };
        this.latestData.set(key, merged);

        this.tickListeners.get(key)?.forEach((cb) => cb(merged));
        this.globalListeners.forEach((cb) => cb(merged));
      } catch {
        // Ignore malformed messages
      }
    };

    this.ws.onclose = () => {
      this._connected = false;
      this._dhanConnected = false;
      // MUST reset: the proxy may have restarted and forgotten our credentials.
      // Leaving this true meant a reconnected browser never re-authenticated and
      // sat silently on a dead feed.
      this.credentialsSent = false;
      this.notifyStatus(false);
      if (!this.intentionalClose) this.scheduleReconnect();
    };

    this.ws.onerror = () => { this._connected = false; };
  }

  sendCredentials(): void {
    if (this.credentialsSent) return;
    const broker = getActiveBroker();
    if (broker?.brokerId === "dhan" && broker.values.clientId && broker.values.accessToken) {
      this.send({ type: "configure", clientId: broker.values.clientId, accessToken: broker.values.accessToken });
      this.credentialsSent = true;
      console.log("[MarketWS] Sent Dhan credentials to proxy");
    }
  }

  /** Re-request everything we are watching. Called on every (re)connect. */
  private replaySubscriptions(): void {
    if (this.desired.size === 0) return;
    this.send({ type: "subscribe", instruments: [...this.desired.values()].map(toWireInstrument) });
  }

  /**
   * Subscribe to any instrument — an option strike, a future, an index.
   * Refcounted: the proxy is only told to unsubscribe when the last local
   * listener goes away.
   */
  subscribeInstrument(ref: InstrumentRef, callback: TickListener): () => void {
    const key = tickKey(ref.exchangeSegment, ref.securityId);

    if (!this.tickListeners.has(key)) this.tickListeners.set(key, new Set());
    this.tickListeners.get(key)!.add(callback);

    const count = (this.refs.get(key) || 0) + 1;
    this.refs.set(key, count);
    if (count === 1) {
      this.desired.set(key, ref);
      this.send({ type: "subscribe", instruments: [toWireInstrument(ref)] });
    }

    const cached = this.latestData.get(key);
    if (cached) setTimeout(() => callback(cached), 0);

    let released = false;
    return () => {
      if (released) return; // double-unsubscribe would corrupt the refcount
      released = true;
      this.tickListeners.get(key)?.delete(callback);
      const remaining = (this.refs.get(key) || 1) - 1;
      if (remaining > 0) { this.refs.set(key, remaining); return; }
      this.refs.delete(key);
      this.desired.delete(key);
      this.send({ type: "unsubscribe", instruments: [toWireInstrument(ref)] });
    };
  }

  /**
   * Subscribe by index security id. Kept for existing callers; indices are
   * pinned server-side so no subscribe message is needed.
   */
  subscribe(securityId: number, callback: TickListener): () => void {
    const key = tickKey("IDX_I", securityId);
    if (!this.tickListeners.has(key)) this.tickListeners.set(key, new Set());
    this.tickListeners.get(key)!.add(callback);

    const cached = this.latestData.get(key);
    if (cached) setTimeout(() => callback(cached), 0);

    return () => { this.tickListeners.get(key)?.delete(callback); };
  }

  subscribeAll(callback: TickListener): () => void {
    this.globalListeners.add(callback);
    return () => { this.globalListeners.delete(callback); };
  }

  onStatus(callback: StatusListener): () => void {
    this.statusListeners.add(callback);
    setTimeout(() => callback(this._dhanConnected), 0);
    return () => { this.statusListeners.delete(callback); };
  }

  private send(data: unknown): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
    // Not open: replaySubscriptions() re-sends from `desired` on reconnect.
  }

  disconnect(): void {
    this.intentionalClose = true;
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    if (this.ws) { this.ws.close(); this.ws = null; }
    this._connected = false;
    this._dhanConnected = false;
    this.credentialsSent = false;
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

export const marketWS = new MarketWebSocket();

if (typeof window !== "undefined") {
  setTimeout(() => marketWS.connect(), 500);
}
