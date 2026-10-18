/**
 * Broker configuration and credential storage.
 *
 * Two storage modes, both browser-only:
 *   - "session": credentials live in sessionStorage and vanish when the tab closes.
 *   - "encrypted": credentials are encrypted with AES-GCM (256-bit key derived from a passphrase
 *     via PBKDF2-SHA256, 310k iterations) and stored in localStorage. They are decrypted into memory
 *     only after the user unlocks the vault in this tab. The passphrase is never stored.
 *
 * Passwords, MPINs and TOTP secrets are never collected or stored. Older plaintext entries in
 * localStorage ("legacy") are still read so existing users keep working, and the settings page asks
 * them to move to one of the two modes above.
 */

export interface BrokerInfo {
  id: string;
  name: string;
  /** Short monogram shown in the broker tile. */
  logo: string;
  fields: BrokerField[];
  docsUrl: string;
  description: string;
  features: string[];
  /** True when the terminal can actually use this broker's API today. */
  integrated: boolean;
}

export interface BrokerField {
  key: string;
  label: string;
  placeholder: string;
  type: "text" | "password";
  required: boolean;
  helpText?: string;
}

export interface BrokerCredentials {
  brokerId: string;
  values: Record<string, string>;
  addedAt: string;
  isActive: boolean;
}

export type StorageMode = "session" | "encrypted";
export type StorageState = StorageMode | "legacy" | "none";

const LEGACY_KEY = "optionsdesk_broker_keys";
const SESSION_KEY = "mc_broker_session_v1";
const VAULT_KEY = "mc_broker_vault_v1";
const MODE_KEY = "mc_broker_storage_mode";

export const BROKER_CHANGE_EVENT = "mc:broker-credentials-changed";

/** Field names that must never be stored (passwords, MPIN, TOTP seeds). */
const FORBIDDEN_FIELD = /(pass(word)?|mpin|\bpin\b|totp|otp)/i;

export const BROKERS: BrokerInfo[] = [
  {
    id: "dhan",
    name: "Dhan",
    logo: "DH",
    integrated: true,
    description: "Live option chain, Greeks, OI and the real-time index feed via Dhan API v2.",
    docsUrl: "https://dhanhq.co/docs/v2/",
    features: ["Option chain", "Live LTP", "Greeks", "OI", "Expiry list", "Live feed"],
    fields: [
      { key: "clientId", label: "Client ID", placeholder: "Your Dhan client ID", type: "text", required: true, helpText: "Dhan web → My Profile → Access DhanHQ APIs" },
      { key: "accessToken", label: "Access token", placeholder: "Paste a Dhan access token", type: "password", required: true, helpText: "Generate a token in the same screen. Tokens expire; paste a fresh one when it does." },
    ],
  },
  {
    id: "zerodha",
    name: "Zerodha (Kite)",
    logo: "ZK",
    integrated: false,
    description: "Kite Connect market data and WebSocket streaming.",
    docsUrl: "https://kite.trade/docs/connect/v3/",
    features: ["Option chain", "Live quotes", "Streaming", "Historical data"],
    fields: [],
  },
  {
    id: "angelone",
    name: "Angel One (SmartAPI)",
    logo: "AO",
    integrated: false,
    description: "SmartAPI market data, option chain and portfolio.",
    docsUrl: "https://smartapi.angelone.in/docs",
    features: ["Option chain", "Live quotes", "Portfolio"],
    fields: [],
  },
  {
    id: "upstox",
    name: "Upstox",
    logo: "UP",
    integrated: false,
    description: "Upstox API v2 market data and option chain.",
    docsUrl: "https://upstox.com/developer/api-documentation/",
    features: ["Option chain", "Market data", "Portfolio"],
    fields: [],
  },
  {
    id: "fivepaisa",
    name: "5paisa",
    logo: "5P",
    integrated: false,
    description: "5paisa Connect market data and option chain.",
    docsUrl: "https://www.5paisa.com/developerapi/overview",
    features: ["Option chain", "Market data"],
    fields: [],
  },
  {
    id: "fyers",
    name: "Fyers",
    logo: "FY",
    integrated: false,
    description: "Fyers API v3 market data and historical candles.",
    docsUrl: "https://myapi.fyers.in/docs/",
    features: ["Option chain", "Historical data"],
    fields: [],
  },
  {
    id: "aliceblue",
    name: "Alice Blue",
    logo: "AB",
    integrated: false,
    description: "Alice Blue ANT API market feed.",
    docsUrl: "https://v2api.aliceblueonline.com/",
    features: ["Market data", "Portfolio"],
    fields: [],
  },
];

// ── Safe storage access (private windows can throw) ──

function readStorage(store: "local" | "session", key: string): string | null {
  try {
    const s = store === "local" ? window.localStorage : window.sessionStorage;
    return s.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(store: "local" | "session", key: string, value: string | null): void {
  try {
    const s = store === "local" ? window.localStorage : window.sessionStorage;
    if (value === null) s.removeItem(key);
    else s.setItem(key, value);
  } catch {
    /* storage unavailable: credentials stay in memory only */
  }
}

/** Remove forbidden fields and non-string values. */
export function sanitizeCredentials(list: unknown): BrokerCredentials[] {
  if (!Array.isArray(list)) return [];
  const out: BrokerCredentials[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Partial<BrokerCredentials>;
    if (typeof rec.brokerId !== "string" || !rec.brokerId) continue;
    const values: Record<string, string> = {};
    for (const [k, v] of Object.entries(rec.values ?? {})) {
      if (typeof v !== "string" || FORBIDDEN_FIELD.test(k)) continue;
      values[k] = v.trim();
    }
    out.push({
      brokerId: rec.brokerId,
      values,
      addedAt: typeof rec.addedAt === "string" ? rec.addedAt : new Date().toISOString(),
      isActive: !!rec.isActive,
    });
  }
  return out;
}

function parseList(raw: string | null): BrokerCredentials[] {
  if (!raw) return [];
  try {
    return sanitizeCredentials(JSON.parse(raw));
  } catch {
    return [];
  }
}

// ── WebCrypto vault ──

export interface VaultBlob {
  v: 1;
  kdf: "PBKDF2-SHA256";
  iterations: number;
  salt: string;
  iv: string;
  ct: string;
}

const PBKDF2_ITERATIONS = 310_000;

type Bytes = Uint8Array<ArrayBuffer>;

function toB64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function fromB64(b64: string): Bytes {
  const s = atob(b64);
  const out: Bytes = new Uint8Array(new ArrayBuffer(s.length));
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

function subtle(): SubtleCrypto {
  const c = globalThis.crypto;
  if (!c?.subtle) throw new Error("WebCrypto is not available in this browser (needs https or localhost).");
  return c.subtle;
}

async function deriveKey(passphrase: string, salt: Bytes, iterations: number): Promise<CryptoKey> {
  const base = await subtle().importKey("raw", new TextEncoder().encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  return subtle().deriveKey(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

async function encryptWithKey(key: CryptoKey, salt: Bytes, iterations: number, data: unknown): Promise<VaultBlob> {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ct = await subtle().encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(JSON.stringify(data)));
  return { v: 1, kdf: "PBKDF2-SHA256", iterations, salt: toB64(salt), iv: toB64(iv), ct: toB64(new Uint8Array(ct)) };
}

/** Encrypt any JSON value with a passphrase. Exported for tests and for export/import tools. */
export async function encryptJSON(data: unknown, passphrase: string): Promise<VaultBlob> {
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKey(passphrase, salt, PBKDF2_ITERATIONS);
  return encryptWithKey(key, salt, PBKDF2_ITERATIONS, data);
}

/** Decrypt a VaultBlob. Throws on a wrong passphrase or tampered data. */
export async function decryptJSON<T>(blob: VaultBlob, passphrase: string): Promise<T> {
  const key = await deriveKey(passphrase, fromB64(blob.salt), blob.iterations);
  const pt = await subtle().decrypt({ name: "AES-GCM", iv: fromB64(blob.iv) }, key, fromB64(blob.ct));
  return JSON.parse(new TextDecoder().decode(pt)) as T;
}

// In-memory state for the encrypted mode (never persisted in plaintext).
let unlocked: BrokerCredentials[] | null = null;
let vaultKey: { key: CryptoKey; salt: Bytes; iterations: number } | null = null;

function readVault(): VaultBlob | null {
  const raw = readStorage("local", VAULT_KEY);
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as VaultBlob;
    return v && v.v === 1 && v.salt && v.iv && v.ct ? v : null;
  } catch {
    return null;
  }
}

function notifyChange(): void {
  try {
    window.dispatchEvent(new CustomEvent(BROKER_CHANGE_EVENT));
  } catch {
    /* non-browser environment */
  }
}

/**
 * Whether the vault on disk was written with this tab's key. Another tab can re-key it (session
 * mode, then encrypt with a new passphrase); this tab must then stop using its old in-memory key
 * and credentials, or its next save would overwrite the new vault with the old key.
 */
function vaultMatchesKey(): boolean {
  if (!vaultKey) return false;
  const blob = readVault();
  return !!blob && blob.salt === toB64(vaultKey.salt);
}

function forgetUnlocked(): void {
  unlocked = null;
  vaultKey = null;
}

// Another tab changed the vault or the storage mode. If the vault still uses this tab's key, read
// the new contents; otherwise lock this tab so it asks for the passphrase again.
try {
  window.addEventListener("storage", (e: StorageEvent) => {
    if (e.key !== null && e.key !== VAULT_KEY && e.key !== MODE_KEY) return;
    if (unlocked === null && vaultKey === null) return;
    const blob = readVault();
    const key = vaultKey;
    if (!blob || !key || readStorage("local", MODE_KEY) !== "encrypted" || blob.salt !== toB64(key.salt)) {
      forgetUnlocked();
      notifyChange();
      return;
    }
    subtle()
      .decrypt({ name: "AES-GCM", iv: fromB64(blob.iv) }, key.key, fromB64(blob.ct))
      .then((pt) => {
        if (vaultKey !== key) return;
        unlocked = sanitizeCredentials(JSON.parse(new TextDecoder().decode(pt)));
      })
      .catch(() => forgetUnlocked())
      .finally(notifyChange);
  });
} catch {
  /* non-browser environment */
}

/** Subscribe to credential changes (save, remove, unlock, lock, mode switch). */
export function onBrokerCredentialsChange(cb: () => void): () => void {
  try {
    window.addEventListener(BROKER_CHANGE_EVENT, cb);
    return () => window.removeEventListener(BROKER_CHANGE_EVENT, cb);
  } catch {
    return () => undefined;
  }
}

// ── Public API ──

export function getStorageState(): StorageState {
  const mode = readStorage("local", MODE_KEY);
  if (mode === "encrypted" && readVault()) return "encrypted";
  if (mode === "session") return "session";
  if (parseList(readStorage("local", LEGACY_KEY)).length > 0) return "legacy";
  if (readVault()) return "encrypted";
  return parseList(readStorage("session", SESSION_KEY)).length > 0 ? "session" : "none";
}

/** True when an encrypted vault exists but has not been unlocked in this tab. */
export function isVaultLocked(): boolean {
  return getStorageState() === "encrypted" && unlocked === null;
}

export function getSavedBrokers(): BrokerCredentials[] {
  const state = getStorageState();
  if (state === "encrypted") {
    if (unlocked && !vaultMatchesKey()) {
      // Re-keyed in another tab: never show or send the old credentials.
      forgetUnlocked();
      queueMicrotask(notifyChange);
    }
    return unlocked ? unlocked.map((c) => ({ ...c, values: { ...c.values } })) : [];
  }
  if (state === "legacy") return parseList(readStorage("local", LEGACY_KEY));
  return parseList(readStorage("session", SESSION_KEY));
}

async function persist(list: BrokerCredentials[]): Promise<void> {
  const clean = sanitizeCredentials(list);
  const state = getStorageState();
  if (state === "encrypted") {
    if (!vaultKey) throw new Error("Vault is locked. Unlock it with your passphrase first.");
    if (!vaultMatchesKey()) {
      forgetUnlocked();
      notifyChange();
      throw new Error("The vault was changed in another tab. Unlock it again.");
    }
    const blob = await encryptWithKey(vaultKey.key, vaultKey.salt, vaultKey.iterations, clean);
    writeStorage("local", VAULT_KEY, JSON.stringify(blob));
    unlocked = clean;
  } else if (state === "legacy") {
    // Keep legacy users working until they pick a mode; but never write forbidden fields.
    writeStorage("local", LEGACY_KEY, JSON.stringify(clean));
  } else {
    writeStorage("local", MODE_KEY, "session");
    writeStorage("session", SESSION_KEY, JSON.stringify(clean));
  }
  notifyChange();
}

/** Add or update a broker. Keeps the existing isActive flag on edit; the first broker becomes active. */
export async function saveBrokerCredentials(creds: Omit<BrokerCredentials, "isActive"> & { isActive?: boolean }): Promise<void> {
  const existing = getSavedBrokers();
  const idx = existing.findIndex((b) => b.brokerId === creds.brokerId);
  const isActive = idx >= 0 ? existing[idx].isActive : creds.isActive ?? !existing.some((b) => b.isActive);
  const next: BrokerCredentials = {
    brokerId: creds.brokerId,
    values: creds.values,
    addedAt: idx >= 0 ? existing[idx].addedAt : creds.addedAt,
    isActive,
  };
  if (idx >= 0) existing[idx] = next;
  else existing.push(next);
  await persist(existing);
}

export async function removeBrokerCredentials(brokerId: string): Promise<void> {
  const remaining = getSavedBrokers().filter((b) => b.brokerId !== brokerId);
  if (remaining.length > 0 && !remaining.some((b) => b.isActive)) remaining[0].isActive = true;
  await persist(remaining);
}

export async function setActiveBroker(brokerId: string): Promise<void> {
  await persist(getSavedBrokers().map((b) => ({ ...b, isActive: b.brokerId === brokerId })));
}

export function getActiveBroker(): BrokerCredentials | null {
  const all = getSavedBrokers();
  return all.find((b) => b.isActive) || all[0] || null;
}

/** Dhan credentials for the proxy headers / WebSocket, or null. */
export function getDhanCredentials(): { clientId: string; accessToken: string } | null {
  const dhan = getSavedBrokers().find((b) => b.brokerId === "dhan");
  const clientId = dhan?.values.clientId;
  const accessToken = dhan?.values.accessToken;
  return clientId && accessToken ? { clientId, accessToken } : null;
}

/** Switch to session-only storage. Moves current credentials (if readable) and wipes the vault and legacy copy. */
export async function switchToSessionMode(): Promise<void> {
  const current = getSavedBrokers();
  writeStorage("local", VAULT_KEY, null);
  writeStorage("local", LEGACY_KEY, null);
  writeStorage("local", MODE_KEY, "session");
  writeStorage("session", SESSION_KEY, JSON.stringify(sanitizeCredentials(current)));
  unlocked = null;
  vaultKey = null;
  notifyChange();
}

/** Switch to encrypted storage with a new passphrase, moving current credentials into the vault. */
export async function enableEncryptedMode(passphrase: string): Promise<void> {
  if (passphrase.length < 8) throw new Error("Use a passphrase of at least 8 characters.");
  const current = sanitizeCredentials(getSavedBrokers());
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKey(passphrase, salt, PBKDF2_ITERATIONS);
  const blob = await encryptWithKey(key, salt, PBKDF2_ITERATIONS, current);
  writeStorage("local", VAULT_KEY, JSON.stringify(blob));
  writeStorage("local", MODE_KEY, "encrypted");
  writeStorage("local", LEGACY_KEY, null);
  writeStorage("session", SESSION_KEY, null);
  unlocked = current;
  vaultKey = { key, salt, iterations: PBKDF2_ITERATIONS };
  notifyChange();
}

/** Unlock the encrypted vault for this tab. Returns false on a wrong passphrase. */
export async function unlockVault(passphrase: string): Promise<boolean> {
  const blob = readVault();
  if (!blob) return false;
  try {
    const salt = fromB64(blob.salt);
    const key = await deriveKey(passphrase, salt, blob.iterations);
    const pt = await subtle().decrypt({ name: "AES-GCM", iv: fromB64(blob.iv) }, key, fromB64(blob.ct));
    unlocked = sanitizeCredentials(JSON.parse(new TextDecoder().decode(pt)));
    vaultKey = { key, salt, iterations: blob.iterations };
    notifyChange();
    return true;
  } catch {
    return false;
  }
}

/** Forget the decrypted credentials in this tab (the vault stays on disk). */
export function lockVault(): void {
  unlocked = null;
  vaultKey = null;
  notifyChange();
}

/** Delete every stored credential in every mode. */
export function wipeAllCredentials(): void {
  writeStorage("local", VAULT_KEY, null);
  writeStorage("local", LEGACY_KEY, null);
  writeStorage("local", MODE_KEY, null);
  writeStorage("session", SESSION_KEY, null);
  unlocked = null;
  vaultKey = null;
  notifyChange();
}
