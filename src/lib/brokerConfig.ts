/**
 * Broker account storage and the live-trading gate.
 *
 * Accounts are keyed by a generated `accountId`, NOT by `brokerId`. Keying by
 * brokerId meant saving a second Dhan account silently overwrote the first, so
 * two accounts at the same broker were impossible — which blocks a consolidated
 * order book and any multi-account feature.
 *
 * Records written by the old scheme are migrated on read (see migrate()), so an
 * existing install keeps its credentials without the user re-entering anything.
 *
 * The static broker catalogue lives in brokerCatalog.ts.
 */

import { BROKERS, type BrokerInfo } from "./brokerCatalog";

export { BROKERS };
export type { BrokerInfo, BrokerField } from "./brokerCatalog";

export interface BrokerCredentials {
  /** Stable unique id for this ACCOUNT. Generated once, never reused. */
  accountId: string;
  brokerId: string;
  /** User-facing name, so two accounts at one broker are tellable apart. */
  label?: string;
  values: Record<string, string>;
  addedAt: string;
  isActive: boolean;
}

const STORAGE_KEY = "optionsdesk_broker_keys";

function newAccountId(): string {
  return `acc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Default label: broker name plus a masked client id, matching 1Cliq's chip. */
function defaultLabel(brokerId: string, values: Record<string, string>): string {
  const name = BROKERS.find((b) => b.id === brokerId)?.name || brokerId;
  const id = values?.clientId || values?.userId || "";
  if (!id) return name;
  const masked = id.length > 4 ? `${id.slice(0, 2)}****${id.slice(-2)}` : id;
  return `${name} (${masked})`;
}

/** Bring pre-accountId records forward. Idempotent. */
function migrate(list: unknown): { records: BrokerCredentials[]; changed: boolean } {
  if (!Array.isArray(list)) return { records: [], changed: false };
  let changed = false;
  const records = list.map((raw) => {
    const rec = raw as Partial<BrokerCredentials>;
    if (rec.accountId && rec.label) return rec as BrokerCredentials;
    changed = true;
    return {
      accountId: rec.accountId || newAccountId(),
      brokerId: rec.brokerId || "",
      label: rec.label || defaultLabel(rec.brokerId || "", rec.values || {}),
      values: rec.values || {},
      addedAt: rec.addedAt || new Date().toISOString(),
      isActive: rec.isActive === true,
    } as BrokerCredentials;
  }).filter((r) => r.brokerId);
  return { records, changed };
}

export function getSavedBrokers(): BrokerCredentials[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const { records, changed } = migrate(JSON.parse(raw));
    // Write the migration back once so it isn't redone on every read.
    if (changed) localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
    return records;
  } catch {
    return [];
  }
}

/**
 * Create or update ONE account. An update must carry the existing accountId;
 * without one this always adds a new account rather than overwriting a
 * same-broker record, which is the whole point of the change.
 */
export function saveBrokerCredentials(creds: Omit<BrokerCredentials, "accountId"> & { accountId?: string }): BrokerCredentials {
  const existing = getSavedBrokers();
  const record: BrokerCredentials = {
    accountId: creds.accountId || newAccountId(),
    brokerId: creds.brokerId,
    label: creds.label || defaultLabel(creds.brokerId, creds.values),
    values: creds.values,
    addedAt: creds.addedAt || new Date().toISOString(),
    isActive: creds.isActive === true,
  };

  const idx = existing.findIndex((b) => b.accountId === record.accountId);
  if (idx >= 0) existing[idx] = record;
  else existing.push(record);

  // Exactly one account is active at a time — it drives the market-data feed.
  if (record.isActive) {
    for (const b of existing) if (b.accountId !== record.accountId) b.isActive = false;
  }

  localStorage.setItem(STORAGE_KEY, JSON.stringify(existing));
  return record;
}

export function removeBrokerAccount(accountId: string): void {
  const existing = getSavedBrokers().filter((b) => b.accountId !== accountId);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(existing));
}

/** Remove EVERY account for a broker. Kept for the settings page's per-broker delete. */
export function removeBrokerCredentials(brokerId: string): void {
  const existing = getSavedBrokers().filter((b) => b.brokerId !== brokerId);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(existing));
}

export function getActiveBroker(): BrokerCredentials | null {
  const all = getSavedBrokers();
  return all.find((b) => b.isActive) || all[0] || null;
}

export function getAccount(accountId: string): BrokerCredentials | null {
  return getSavedBrokers().find((b) => b.accountId === accountId) || null;
}

/** All accounts for one broker — the basis of a consolidated multi-account book. */
export function getAccountsForBroker(brokerId: string): BrokerCredentials[] {
  return getSavedBrokers().filter((b) => b.brokerId === brokerId);
}

export function setActiveAccount(accountId: string): void {
  const all = getSavedBrokers().map((b) => ({ ...b, isActive: b.accountId === accountId }));
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
}

/** Activate a broker by id. Picks its first account when several exist. */
export function setActiveBroker(brokerId: string): void {
  const all = getSavedBrokers();
  const target = all.find((b) => b.brokerId === brokerId);
  if (!target) return;
  setActiveAccount(target.accountId);
}

export function getBrokerInfo(brokerId: string): BrokerInfo | undefined {
  return BROKERS.find((b) => b.id === brokerId);
}

// ── Live Trading gate ──
// Off by default. Placing a REAL order (real money, requires a static IP
// whitelisted with Dhan) must be an explicit, remembered opt-in — never a
// side effect of anything else the user does in the app.
//
// This is the persistent, account-level switch. Session-scoped one-click arming
// is separate and deliberately never persisted — see liveArm.ts.
const LIVE_TRADING_KEY = "optionsdesk_live_trading_enabled";

export function isLiveTradingEnabled(): boolean {
  try {
    return localStorage.getItem(LIVE_TRADING_KEY) === "true";
  } catch {
    return false;
  }
}

export function setLiveTradingEnabled(enabled: boolean): void {
  localStorage.setItem(LIVE_TRADING_KEY, enabled ? "true" : "false");
}
