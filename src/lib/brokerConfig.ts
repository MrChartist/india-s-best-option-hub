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

import { BROKERS as BROKER_CATALOG, type BrokerInfo as CatalogBroker } from "./brokerCatalog";

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
  /** The broker's API cannot log in without a password/MPIN/TOTP secret, which this terminal never stores. */
  needsLoginSecrets?: boolean;
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

/** Dhan, as shown in the settings page (the reference integration: data, live feed and 1Cliq orders). */
const DHAN: BrokerInfo = {
  id: "dhan",
  name: "Dhan",
  logo: "DH",
  integrated: true,
  description: "Live option chain, Greeks, OI and the real-time index feed via Dhan API v2. Also the broker 1Cliq Trade places orders with.",
  docsUrl: "https://dhanhq.co/docs/v2/",
  features: ["Option chain", "Live LTP", "Greeks", "OI", "Expiry list", "Live feed", "Orders"],
  fields: [
    { key: "clientId", label: "Client ID", placeholder: "Your Dhan client ID", type: "text", required: true, helpText: "Dhan web → My Profile → Access DhanHQ APIs" },
    { key: "accessToken", label: "Access token", placeholder: "Paste a Dhan access token", type: "password", required: true, helpText: "Generate a token in the same screen. Tokens expire; paste a fresh one when it does." },
  ],
};

function monogram(name: string): string {
  const words = name.replace(/\(.*?\)/g, "").split(/[^A-Za-z0-9]+/).filter(Boolean);
  const letters = words.length >= 2 ? words[0][0] + words[1][0] : (words[0] ?? "?").slice(0, 2);
  return letters.toUpperCase();
}

/**
 * The broker catalogue (brokerCatalog.ts, one server module per broker in server/brokers/) mapped
 * onto this page's key policy: fields that would hold a login password, MPIN, PIN or TOTP secret are
 * never offered, so a broker that cannot log in without one is listed but not `integrated`.
 */
function fromCatalog(b: CatalogBroker): BrokerInfo {
  const allowed = b.fields.filter((f) => !FORBIDDEN_FIELD.test(f.key));
  const needsLoginSecrets = b.fields.some((f) => f.required && FORBIDDEN_FIELD.test(f.key));
  return {
    id: b.id,
    name: b.name,
    logo: monogram(b.name),
    integrated: !needsLoginSecrets,
    needsLoginSecrets,
    description: b.description,
    docsUrl: b.docsUrl,
    features: b.features,
    fields: needsLoginSecrets ? [] : allowed.map((f) => ({ ...f })),
  };
}

export const BROKERS: BrokerInfo[] = [DHAN, ...BROKER_CATALOG.filter((b) => b.id !== "dhan").map(fromCatalog)];

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
  if (state === "encrypted") return unlocked ? unlocked.map((c) => ({ ...c, values: { ...c.values } })) : [];
  if (state === "legacy") return parseList(readStorage("local", LEGACY_KEY));
  return parseList(readStorage("session", SESSION_KEY));
}

async function persist(list: BrokerCredentials[]): Promise<void> {
  const clean = sanitizeCredentials(list);
  const state = getStorageState();
  if (state === "encrypted") {
    if (!vaultKey) throw new Error("Vault is locked. Unlock it with your passphrase first.");
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

export function getBrokerInfo(brokerId: string): BrokerInfo | undefined {
  return BROKERS.find((b) => b.id === brokerId);
}

// ── Live Trading gate ──
// Off by default. Placing a REAL order (real money, needs a static IP whitelisted with Dhan) must be
// an explicit, remembered opt-in, never a side effect of anything else the user does in the app.
// This is the persistent, account-level switch; session-scoped one-click arming is separate and
// deliberately never persisted (see liveArm.ts).
const LIVE_TRADING_KEY = "optionsdesk_live_trading_enabled";

export function isLiveTradingEnabled(): boolean {
  return readStorage("local", LIVE_TRADING_KEY) === "true";
}

export function setLiveTradingEnabled(enabled: boolean): void {
  writeStorage("local", LIVE_TRADING_KEY, enabled ? "true" : "false");
}
