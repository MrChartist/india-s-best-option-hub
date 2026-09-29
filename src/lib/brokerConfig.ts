// Broker catalogue + bring-your-own-key credential storage.
//
// Nothing here ships with a key. Users paste their own; they stay in this browser
// (localStorage, or sessionStorage if the user chose "this session only") and are only
// ever sent to the user's own local proxy (see proxy-server.mjs).

import { useSyncExternalStore } from "react";

export type BrokerSupport =
  /** The local proxy relays live market data for this broker. */
  | "live"
  /** Keys can be stored, but no data relay exists yet (contributions welcome). */
  | "saved";

export interface BrokerField {
  key: string;
  label: string;
  placeholder: string;
  secret: boolean;
  required: boolean;
  helpText?: string;
}

export interface BrokerInfo {
  id: string;
  name: string;
  /** One or two letters for the brand tile */
  initial: string;
  /** Brand accent as an HSL triplet, e.g. "142 71% 45%" */
  hue: string;
  description: string;
  docsUrl: string;
  features: string[];
  support: BrokerSupport;
  fields: BrokerField[];
}

export interface BrokerCredentials {
  brokerId: string;
  values: Record<string, string>;
  addedAt: string;
  /** false = kept in sessionStorage and gone when the tab closes */
  persist: boolean;
}

export const BROKERS: BrokerInfo[] = [
  {
    id: "dhan",
    name: "Dhan",
    initial: "D",
    hue: "142 71% 42%",
    description: "Real-time option chain, Greeks, OI and WebSocket ticks via Dhan API v2.",
    docsUrl: "https://dhanhq.co/docs/v2/",
    features: ["Option chain", "Live ticks", "Greeks", "OI", "Historical"],
    support: "live",
    fields: [
      { key: "clientId", label: "Client ID", placeholder: "Your Dhan client ID", secret: false, required: true, helpText: "Dhan web → My Profile → Access DhanHQ APIs" },
      { key: "accessToken", label: "Access token", placeholder: "Your Dhan access token", secret: true, required: true, helpText: "Generate on the same page. Tokens expire — paste a fresh one when it does." },
    ],
  },
  {
    id: "zerodha",
    name: "Zerodha (Kite)",
    initial: "Z",
    hue: "211 90% 52%",
    description: "Kite Connect API with quotes, historical data and WebSocket streaming.",
    docsUrl: "https://kite.trade/docs/connect/v3/",
    features: ["Quotes", "Streaming", "Historical"],
    support: "saved",
    fields: [
      { key: "apiKey", label: "API key", placeholder: "Kite Connect API key", secret: false, required: true, helpText: "Kite developer console → My apps" },
      { key: "apiSecret", label: "API secret", placeholder: "Kite Connect API secret", secret: true, required: true },
      { key: "accessToken", label: "Access token", placeholder: "Session access token", secret: true, required: true, helpText: "Issued after the daily login flow" },
    ],
  },
  {
    id: "angelone",
    name: "Angel One",
    initial: "A",
    hue: "24 95% 53%",
    description: "SmartAPI with quotes, orders and portfolio.",
    docsUrl: "https://smartapi.angelone.in/docs",
    features: ["Quotes", "Orders", "Portfolio"],
    support: "saved",
    fields: [
      { key: "apiKey", label: "API key", placeholder: "SmartAPI key", secret: false, required: true, helpText: "SmartAPI portal → My apps" },
      { key: "clientId", label: "Client ID", placeholder: "Angel One client ID", secret: false, required: true },
      { key: "password", label: "PIN / MPIN", placeholder: "Login PIN", secret: true, required: true },
      { key: "totpSecret", label: "TOTP secret", placeholder: "Optional — for automatic 2FA", secret: true, required: false },
    ],
  },
  {
    id: "upstox",
    name: "Upstox",
    initial: "U",
    hue: "268 75% 58%",
    description: "Upstox API v2 with market data and option chain.",
    docsUrl: "https://upstox.com/developer/api-documentation/",
    features: ["Market data", "Option chain", "Orders"],
    support: "saved",
    fields: [
      { key: "apiKey", label: "API key", placeholder: "Upstox API key", secret: false, required: true },
      { key: "apiSecret", label: "API secret", placeholder: "Upstox API secret", secret: true, required: true },
      { key: "accessToken", label: "Access token", placeholder: "OAuth access token", secret: true, required: true, helpText: "Issued by the OAuth login redirect" },
    ],
  },
  {
    id: "fivepaisa",
    name: "5paisa",
    initial: "5",
    hue: "217 91% 58%",
    description: "5paisa Connect API for market data and trading.",
    docsUrl: "https://www.5paisa.com/developerapi/overview",
    features: ["Market data", "Orders"],
    support: "saved",
    fields: [
      { key: "appName", label: "App name", placeholder: "5paisa app name", secret: false, required: true },
      { key: "appSource", label: "App source", placeholder: "App source ID", secret: false, required: true },
      { key: "userId", label: "User ID", placeholder: "User ID / client code", secret: false, required: true },
      { key: "encryptionKey", label: "Encryption key", placeholder: "Encryption key", secret: true, required: true },
    ],
  },
  {
    id: "fyers",
    name: "Fyers",
    initial: "F",
    hue: "199 89% 46%",
    description: "Fyers API v3 with market data, history and algo support.",
    docsUrl: "https://myapi.fyers.in/docs/",
    features: ["Market data", "Historical", "Orders"],
    support: "saved",
    fields: [
      { key: "appId", label: "App ID", placeholder: "XXXX-100", secret: false, required: true, helpText: "Fyers API dashboard" },
      { key: "secretKey", label: "Secret key", placeholder: "Fyers secret key", secret: true, required: true },
      { key: "accessToken", label: "Access token", placeholder: "Fyers access token", secret: true, required: true },
    ],
  },
  {
    id: "aliceblue",
    name: "Alice Blue",
    initial: "AB",
    hue: "190 80% 42%",
    description: "Alice Blue ANT API for market feeds and orders.",
    docsUrl: "https://v2api.aliceblueonline.com/",
    features: ["Market data", "Orders", "Funds"],
    support: "saved",
    fields: [
      { key: "userId", label: "User ID", placeholder: "Alice Blue user ID", secret: false, required: true },
      { key: "apiKey", label: "API key", placeholder: "ANT API key", secret: true, required: true, helpText: "Alice Blue ANT developer portal" },
    ],
  },
];

export function getBrokerInfo(brokerId: string): BrokerInfo | undefined {
  return BROKERS.find((b) => b.id === brokerId);
}

// ── Storage ──

const STORAGE_KEY = "optionsdesk_broker_keys"; // unchanged, so existing users keep their keys
const ACTIVE_KEY = "optionsdesk_active_broker";
const CHANGE_EVENT = "brokerconfig:change";

type LegacyCreds = Partial<BrokerCredentials> & { brokerId: string; isActive?: boolean };

function readStore(store: Storage | undefined): LegacyCreds[] {
  try {
    const raw = store?.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as LegacyCreds[]) : [];
  } catch {
    return [];
  }
}

function writeStore(store: Storage | undefined, list: LegacyCreds[]) {
  try {
    if (list.length) store?.setItem(STORAGE_KEY, JSON.stringify(list));
    else store?.removeItem(STORAGE_KEY);
  } catch {
    /* storage unavailable (private mode) — nothing we can persist */
  }
}

const local = () => (typeof window === "undefined" ? undefined : window.localStorage);
const session = () => (typeof window === "undefined" ? undefined : window.sessionStorage);

let snapshot: { saved: BrokerCredentials[]; active: BrokerCredentials | null } | null = null;

function notify() {
  snapshot = null;
  if (typeof window !== "undefined") window.dispatchEvent(new Event(CHANGE_EVENT));
}

function compute() {
  const fromLocal = readStore(local());
  const fromSession = readStore(session());
  const byId = new Map<string, BrokerCredentials>();

  for (const c of fromLocal) {
    byId.set(c.brokerId, { brokerId: c.brokerId, values: c.values ?? {}, addedAt: c.addedAt ?? new Date(0).toISOString(), persist: true });
  }
  for (const c of fromSession) {
    byId.set(c.brokerId, { brokerId: c.brokerId, values: c.values ?? {}, addedAt: c.addedAt ?? new Date(0).toISOString(), persist: false });
  }
  const saved = [...byId.values()];

  let activeId: string | null = null;
  try {
    activeId = local()?.getItem(ACTIVE_KEY) ?? null;
  } catch {
    /* ignore */
  }
  // Older versions stored an isActive flag inside each record
  if (!activeId) activeId = [...fromLocal, ...fromSession].find((c) => c.isActive)?.brokerId ?? null;

  const active = saved.find((c) => c.brokerId === activeId) ?? saved[0] ?? null;
  return { saved, active };
}

function getSnapshot() {
  if (!snapshot) snapshot = compute();
  return snapshot;
}

export function getSavedBrokers(): BrokerCredentials[] {
  return getSnapshot().saved;
}

export function getActiveBroker(): BrokerCredentials | null {
  return getSnapshot().active;
}

export function saveBrokerCredentials(creds: BrokerCredentials): void {
  const target = creds.persist ? local() : session();
  const other = creds.persist ? session() : local();
  const record = { brokerId: creds.brokerId, values: creds.values, addedAt: creds.addedAt };

  const targetList = readStore(target).filter((c) => c.brokerId !== creds.brokerId);
  writeStore(target, [...targetList, record]);
  writeStore(other, readStore(other).filter((c) => c.brokerId !== creds.brokerId));

  // First broker added becomes active
  if (getSnapshot().saved.length === 0 || !getSnapshot().active) setActiveBroker(creds.brokerId);
  else notify();
}

export function removeBrokerCredentials(brokerId: string): void {
  writeStore(local(), readStore(local()).filter((c) => c.brokerId !== brokerId));
  writeStore(session(), readStore(session()).filter((c) => c.brokerId !== brokerId));
  try {
    if (local()?.getItem(ACTIVE_KEY) === brokerId) local()?.removeItem(ACTIVE_KEY);
  } catch {
    /* ignore */
  }
  notify();
}

export function clearAllBrokerCredentials(): void {
  writeStore(local(), []);
  writeStore(session(), []);
  try {
    local()?.removeItem(ACTIVE_KEY);
  } catch {
    /* ignore */
  }
  notify();
}

export function setActiveBroker(brokerId: string): void {
  try {
    local()?.setItem(ACTIVE_KEY, brokerId);
  } catch {
    /* ignore */
  }
  notify();
}

// ── React subscription ──

function subscribe(onChange: () => void) {
  const handler = () => {
    snapshot = null;
    onChange();
  };
  window.addEventListener(CHANGE_EVENT, handler);
  window.addEventListener("storage", handler); // other tabs
  return () => {
    window.removeEventListener(CHANGE_EVENT, handler);
    window.removeEventListener("storage", handler);
  };
}

/** Re-renders whenever keys are added, edited, removed or the active broker changes. */
export function useBrokerConfig() {
  return useSyncExternalStore(subscribe, getSnapshot, () => ({ saved: [] as BrokerCredentials[], active: null }));
}

// ── Helpers ──

export function isComplete(broker: BrokerInfo, creds?: BrokerCredentials): boolean {
  if (!creds) return false;
  return broker.fields.filter((f) => f.required).every((f) => creds.values[f.key]?.trim());
}

/** "••••••1a2b" — enough to recognise a key, never enough to leak it. */
export function maskSecret(value: string | undefined): string {
  if (!value) return "—";
  const v = value.trim();
  if (v.length <= 6) return "••••••";
  return `••••••${v.slice(-4)}`;
}

/** Dhan credentials of the active broker, or null when Dhan isn't the active, complete broker. */
export function getDhanCredentials(creds: BrokerCredentials | null = getActiveBroker()): { clientId: string; accessToken: string } | null {
  if (creds?.brokerId !== "dhan") return null;
  const { clientId, accessToken } = creds.values;
  return clientId && accessToken ? { clientId, accessToken } : null;
}

/** Headers the local proxy expects for user-supplied Dhan keys (empty when none, so .env keys apply). */
export function getDhanHeaders(creds?: BrokerCredentials | null): Record<string, string> {
  const dhan = getDhanCredentials(creds === undefined ? getActiveBroker() : creds);
  return dhan ? { "x-dhan-client-id": dhan.clientId, "x-dhan-access-token": dhan.accessToken } : {};
}
