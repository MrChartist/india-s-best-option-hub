/**
 * WebSocket client: singleton for the proxy's live-feed relay.
 *
 *   Dhan feed (binary) → proxy-server.mjs (parses, JSON) → this client → React hooks
 *
 * Ticks are keyed by "segment:securityId" (for example "IDX_I:13"), because security ids are only
 * unique within an exchange segment. Two statuses are tracked separately: whether the browser can
 * reach the proxy, and whether the proxy has a live Dhan feed.
 *
 * Importing this module opens nothing. DashboardLayout calls startMarketWS() once the proxy
 * reachability gate (src/lib/api/proxyClient.ts) reports the proxy online. Reconnects back off
 * (1 s growing to 30 s), pause while the tab is hidden or the device is offline, and stop after
 * MAX_RECONNECT_FAILURES consecutive failures until the gate sees the proxy come back.
 */
import { getDhanCredentials, onBrokerCredentialsChange } from "./brokerConfig";
import { markProxyOnline, proxyWsUrl, subscribeProxyStatus, type ProxyGateSnapshot } from "./api/proxyClient";

/** Consecutive failed connects before the client gives up until the proxy gate flips back online. */
export const MAX_RECONNECT_FAILURES = 5;

/** Why the client is not currently trying to reconnect (null while connected or retrying). */
export type ReconnectHold = "hidden" | "offline" | "gave-up" | null;

/** Pure reconnect decision: hold reasons win over retrying; returns the hold or null to retry. */
export function reconnectHold(state: { failures: number; hidden: boolean; online: boolean }): ReconnectHold {
  if (state.failures >= MAX_RECONNECT_FAILURES) return "gave-up";
  if (!state.online) return "offline";
  if (state.hidden) return "hidden";
  return null;
}

/** Reconnect delay after `failures` consecutive failures: 1.5 s, 2.25 s … capped at 30 s. */
export function reconnectDelayMs(failures: number): number {
  const n = Math.max(1, Math.floor(failures));
  return Math.min(Math.round(1000 * 1.5 ** n), 30_000);
}

function docHidden(): boolean {
  return typeof document !== "undefined" && document.visibilityState === "hidden";
}

function deviceOnline(): boolean {
  return typeof navigator === "undefined" || navigator.onLine !== false;
}

// ── Types ──

export interface DepthLevel {
  bidQty: number;
  askQty: number;
  bidOrders: number;
  askOrders: number;
  bid: number;
  ask: number;
}

export interface TickData {
  type: "ticker" | "quote" | "prevClose" | "oi" | "full" | "status";
  /** "segment:securityId" */
  key: string;
  securityId: number;
  symbol: string;
  exchangeSegment: string;
  ltp?: number;
  ltq?: number;
  /** Last trade time, epoch seconds as sent by the exchange. */
  ltt?: number;
  avgPrice?: number;
  change?: number;
  changePercent?: number;
  open?: number;
  high?: number;
  low?: number;
  close?: number;
  prevClose?: number;
  prevOI?: number;
  volume?: number;
  oi?: number;
  oiDayHigh?: number;
  oiDayLow?: number;
  totalBuyQty?: number;
  totalSellQty?: number;
  depth?: DepthLevel[];
  timestamp?: number;
}

export interface FeedStatus {
  /** Browser ↔ proxy socket is open. */
  proxyConnected: boolean;
  /** Proxy ↔ Dhan feed is live. */
  dhanConnected: boolean;
  /** Last Dhan disconnect code (805–810) or null. */
  disconnectCode: number | null;
  message: string | null;
}

export type TickListener = (data: TickData) => void;
export type StatusListener = (dhanConnected: boolean) => void;
export type FeedStatusListener = (status: FeedStatus) => void;

// ── Instrument ids (Dhan IDX_I segment; verify against the Dhan scrip master) ──

const SYMBOL_TO_SECURITY_ID: Record<string, number> = {
  NIFTY: 13,
  BANKNIFTY: 25,
  FINNIFTY: 27,
  MIDCPNIFTY: 442,
  INDIAVIX: 21,
  SENSEX: 51,
  BANKEX: 69,
};

const SECURITY_ID_TO_SYMBOL: Record<number, string> = {};
for (const [sym, id] of Object.entries(SYMBOL_TO_SECURITY_ID)) SECURITY_ID_TO_SYMBOL[id] = sym;

export { SYMBOL_TO_SECURITY_ID, SECURITY_ID_TO_SYMBOL };

export function tickKey(exchangeSegment: string, securityId: number | string): string {
  return `${exchangeSegment}:${securityId}`;
}

/** Tick key for an index symbol (all indices are in IDX_I), or undefined. */
export function indexTickKey(symbol: string): string | undefined {
  const id = SYMBOL_TO_SECURITY_ID[symbol.toUpperCase()];
  return id ? tickKey("IDX_I", id) : undefined;
}

export const DHAN_DISCONNECT_MESSAGES: Record<number, string> = {
  805: "Too many Dhan feed connections for this account. Close other apps using the same token.",
  806: "Dhan Data APIs are not enabled on this account.",
  807: "Your Dhan access token has expired. Paste a fresh token in Broker settings.",
  808: "Dhan rejected the client ID or access token.",
  809: "Dhan says the access token is invalid.",
  810: "Dhan says the client ID is invalid.",
};

/** Merge an incoming tick into the previous one and recompute change from prevClose. */
export function mergeTick(prev: TickData | undefined, next: Partial<TickData> & { key: string }): TickData {
  const merged = { ...(prev ?? {}), ...next } as TickData;
  if (merged.prevClose && merged.ltp) {
    merged.change = merged.ltp - merged.prevClose;
    merged.changePercent = (merged.change / merged.prevClose) * 100;
  }
  return merged;
}

interface StatusMessage {
  type: "status";
  connected?: boolean;
  dhanConnected?: boolean;
  disconnectCode?: number | null;
  message?: string | null;
}

function isStatus(m: unknown): m is StatusMessage {
  return !!m && typeof m === "object" && (m as { type?: unknown }).type === "status";
}

// ── Client ──

class MarketWebSocket {
  private ws: WebSocket | null = null;
  private readonly url: string;
  private tickListeners = new Map<string, Set<TickListener>>();
  private globalListeners = new Set<TickListener>();
  private statusListeners = new Set<StatusListener>();
  private feedListeners = new Set<FeedStatusListener>();
  private latestData = new Map<string, TickData>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private failures = 0;
  private hold: ReconnectHold = null;
  private intentionalClose = false;
  private lastCredentialFingerprint: string | null = null;
  private status: FeedStatus = { proxyConnected: false, dhanConnected: false, disconnectCode: null, message: null };

  constructor(url?: string) {
    this.url = url || proxyWsUrl();
  }

  get isConnected(): boolean {
    return this.status.proxyConnected;
  }

  get isDhanConnected(): boolean {
    return this.status.dhanConnected;
  }

  getStatus(): FeedStatus {
    return { ...this.status };
  }

  getLatest(key: string): TickData | undefined {
    return this.latestData.get(key);
  }

  getLatestBySymbol(symbol: string): TickData | undefined {
    const key = indexTickKey(symbol);
    return key ? this.latestData.get(key) : undefined;
  }

  getAllLatest(): Map<string, TickData> {
    return this.latestData;
  }

  connect(): void {
    if (typeof WebSocket === "undefined") return;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;
    this.intentionalClose = false;
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;
    // Every handler ignores events from a socket that has since been replaced (disconnect() then
    // connect()), so a late close from the old socket cannot mark the new one as down.
    const current = () => this.ws === ws;

    ws.onopen = () => {
      if (!current()) return;
      this.failures = 0;
      this.hold = null;
      markProxyOnline();
      this.lastCredentialFingerprint = null;
      this.setStatus({ proxyConnected: true });
      this.sendCredentials();
    };

    ws.onmessage = (event: MessageEvent) => {
      if (!current()) return;
      let msg: unknown;
      try {
        msg = JSON.parse(typeof event.data === "string" ? event.data : "");
      } catch {
        return;
      }
      if (isStatus(msg)) {
        const dhan = msg.dhanConnected ?? msg.connected ?? false;
        this.setStatus({
          dhanConnected: !!dhan,
          disconnectCode: msg.disconnectCode ?? (dhan ? null : this.status.disconnectCode),
          message: msg.message ?? (msg.disconnectCode ? DHAN_DISCONNECT_MESSAGES[msg.disconnectCode] ?? null : dhan ? null : this.status.message),
        });
        return;
      }
      const t = msg as Partial<TickData>;
      if (!t || typeof t !== "object" || t.securityId === undefined || !t.exchangeSegment) return;
      const key = t.key || tickKey(t.exchangeSegment, t.securityId);
      const merged = mergeTick(this.latestData.get(key), { ...t, key, timestamp: Date.now() });
      const indexSymbol = merged.exchangeSegment === "IDX_I" ? SECURITY_ID_TO_SYMBOL[merged.securityId] : undefined;
      if (indexSymbol) merged.symbol = indexSymbol;
      this.latestData.set(key, merged);
      this.tickListeners.get(key)?.forEach((cb) => cb(merged));
      this.globalListeners.forEach((cb) => cb(merged));
    };

    ws.onclose = () => {
      if (!current()) return;
      this.ws = null;
      this.setStatus({ proxyConnected: false, dhanConnected: false });
      if (!this.intentionalClose) this.scheduleReconnect();
    };

    ws.onerror = () => {
      /* close fires next */
    };
  }

  /** Send Dhan credentials to the proxy when they exist and differ from what was last sent. */
  sendCredentials(force = false): void {
    const creds = getDhanCredentials();
    if (!creds) {
      this.lastCredentialFingerprint = null;
      return;
    }
    const fp = `${creds.clientId}:${creds.accessToken.length}:${creds.accessToken.slice(-8)}`;
    if (!force && fp === this.lastCredentialFingerprint) return;
    if (this.send({ type: "configure", clientId: creds.clientId, accessToken: creds.accessToken })) {
      this.lastCredentialFingerprint = fp;
    }
  }

  /** Ask the proxy to subscribe extra instruments (max 100 per call). */
  subscribeInstruments(instruments: Array<{ exchangeSegment: string; securityId: number | string }>): boolean {
    const list = instruments.slice(0, 100).map((i) => ({ ExchangeSegment: i.exchangeSegment, SecurityId: String(i.securityId) }));
    return list.length > 0 && this.send({ type: "subscribe", instruments: list });
  }

  subscribe(key: string, callback: TickListener): () => void {
    let set = this.tickListeners.get(key);
    if (!set) {
      set = new Set();
      this.tickListeners.set(key, set);
    }
    set.add(callback);
    // Replay the cached tick asynchronously, but only while this listener is still registered:
    // a component that switched keys must not receive the previous key's tick.
    const timer = this.latestData.has(key)
      ? setTimeout(() => {
          const cached = this.latestData.get(key);
          if (cached && this.tickListeners.get(key)?.has(callback)) callback(cached);
        }, 0)
      : null;
    return () => {
      if (timer !== null) clearTimeout(timer);
      const listeners = this.tickListeners.get(key);
      if (!listeners) return;
      listeners.delete(callback);
      if (listeners.size === 0) this.tickListeners.delete(key);
    };
  }

  subscribeAll(callback: TickListener): () => void {
    this.globalListeners.add(callback);
    return () => {
      this.globalListeners.delete(callback);
    };
  }

  /** Dhan feed status (true = live ticks flowing). */
  onStatus(callback: StatusListener): () => void {
    this.statusListeners.add(callback);
    const timer = setTimeout(() => {
      if (this.statusListeners.has(callback)) callback(this.status.dhanConnected);
    }, 0);
    return () => {
      clearTimeout(timer);
      this.statusListeners.delete(callback);
    };
  }

  /** Full feed status (proxy and Dhan separately). */
  onFeedStatus(callback: FeedStatusListener): () => void {
    this.feedListeners.add(callback);
    const timer = setTimeout(() => {
      if (this.feedListeners.has(callback)) callback(this.getStatus());
    }, 0);
    return () => {
      clearTimeout(timer);
      this.feedListeners.delete(callback);
    };
  }

  private send(data: unknown): boolean {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
      return true;
    }
    return false;
  }

  disconnect(): void {
    this.intentionalClose = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      const old = this.ws;
      // Detach first: the old socket's close event can arrive after a reconnect has opened a new one.
      old.onopen = null;
      old.onmessage = null;
      old.onclose = null;
      old.onerror = null;
      this.ws = null;
      old.close();
    }
    this.setStatus({ proxyConnected: false, dhanConnected: false });
  }

  /** Why reconnects are paused right now (null while connected or retrying). */
  get reconnectHold(): ReconnectHold {
    return this.hold;
  }

  /** Consecutive failed connects since the last successful open. */
  get failureCount(): number {
    return this.failures;
  }

  /**
   * Try again now if a reconnect is held or the client gave up (tab visible again, device back
   * online, proxy gate back online). `resetFailures` clears the give-up counter.
   */
  resume(resetFailures = false): void {
    if (this.intentionalClose) return;
    if (resetFailures) this.failures = 0;
    if (this.ws) return;
    if (reconnectHold({ failures: this.failures, hidden: docHidden(), online: deviceOnline() }) !== null) return;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.hold = null;
    this.connect();
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.failures += 1;
    this.hold = reconnectHold({ failures: this.failures, hidden: docHidden(), online: deviceOnline() });
    if (this.hold !== null) return; // resume() picks it up later
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, reconnectDelayMs(this.failures));
  }

  private setStatus(patch: Partial<FeedStatus>): void {
    const prev = this.status;
    this.status = { ...prev, ...patch };
    if (prev.dhanConnected !== this.status.dhanConnected) this.statusListeners.forEach((cb) => cb(this.status.dhanConnected));
    this.feedListeners.forEach((cb) => cb(this.getStatus()));
  }
}

export const marketWS = new MarketWebSocket();

let started = false;

/**
 * Open the live feed. Idempotent: the first call wires the visibility, network, proxy-gate and
 * credential listeners and connects; later calls just nudge a held reconnect. Call it only once
 * the proxy gate reports online (DashboardLayout does).
 */
export function startMarketWS(): void {
  if (typeof window === "undefined") return;
  if (started) {
    marketWS.resume(true);
    return;
  }
  started = true;
  // Resend credentials whenever they change (save, unlock, remove).
  onBrokerCredentialsChange(() => marketWS.sendCredentials());
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", () => {
      if (!docHidden()) marketWS.resume();
    });
  }
  window.addEventListener("online", () => marketWS.resume());
  // The gate flipping back to online (a good /health or any proxied response) lifts a give-up.
  let lastGate: ProxyGateSnapshot["status"] | null = null;
  subscribeProxyStatus((s) => {
    if (s.status === "online" && lastGate !== "online") marketWS.resume(true);
    lastGate = s.status;
  });
  marketWS.connect();
}
