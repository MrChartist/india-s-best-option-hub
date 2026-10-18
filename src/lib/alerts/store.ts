/**
 * The alert store: rules, channel settings, the trigger log and the runner's status in one
 * framework-free store (subscribe/getState for useSyncExternalStore).
 *
 * Persistence (localStorage, every access guarded):
 *   mc_alert_rules_v1     AlertRule[]  (all rule types, including the chain's strike alerts)
 *   mc_alert_settings_v1  ChannelSettings
 *   mc_alert_log_v1       TriggerLogEntry[] (newest first, capped)
 * The legacy chain store (mc_strike_alerts_v1) is migrated in on first load and then removed.
 * Other tabs are kept in sync through the storage event.
 */
import {
  ALERT_RULES_STORAGE_KEY,
  DEFAULT_CHANNELS,
  EMPTY_RUNTIME,
  type AlertRule,
  type ChannelSettings,
  type NewAlertRule,
  type RuntimeStatus,
  type TriggerLogEntry,
} from "./types";
import { LEGACY_STRIKE_ALERTS_KEY, migrateAlertRecords } from "./migrate";
import { createRule, exportRulesJSON, mergeRules, parseRulesJSON, safeStorage, type ParsedRules } from "./model";
import { isFiniteNumber, isObject, parseAlertRule } from "./validate";

export const ALERT_SETTINGS_KEY = "mc_alert_settings_v1";
export const ALERT_LOG_KEY = "mc_alert_log_v1";
export const LOG_MAX = 200;

export interface AlertStoreState {
  rules: AlertRule[];
  settings: ChannelSettings;
  log: TriggerLogEntry[];
  runtime: RuntimeStatus;
  /** False while storage is blocked (private mode): changes live for this session only. */
  persisted: boolean;
}

type Listener = () => void;

function readRaw(key: string): string | null {
  const s = safeStorage();
  if (!s) return null;
  try {
    return s.getItem(key);
  } catch {
    return null;
  }
}

function writeRaw(key: string, value: string): boolean {
  const s = safeStorage();
  if (!s) return false;
  try {
    s.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function removeRaw(key: string): void {
  try {
    safeStorage()?.removeItem(key);
  } catch {
    /* blocked */
  }
}

export function parseSettings(raw: unknown): ChannelSettings {
  const out: ChannelSettings = { ...DEFAULT_CHANNELS };
  if (!isObject(raw)) return out;
  for (const k of ["toast", "sound", "desktop", "webhook"] as const)
    if (typeof raw[k] === "boolean") out[k] = raw[k] as boolean;
  if (isFiniteNumber(raw.volume)) out.volume = Math.min(1, Math.max(0, raw.volume));
  if (typeof raw.webhookUrl === "string") out.webhookUrl = raw.webhookUrl.slice(0, 2048);
  return out;
}

function isLogEntry(x: unknown): x is TriggerLogEntry {
  return (
    isObject(x) &&
    typeof x.id === "string" &&
    typeof x.ruleId === "string" &&
    isFiniteNumber(x.ts) &&
    typeof x.title === "string" &&
    typeof x.message === "string" &&
    typeof x.tone === "string"
  );
}

export function parseLog(raw: unknown): TriggerLogEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(isLogEntry)
    .map((e) => ({
      ...e,
      rule: typeof e.rule === "string" ? e.rule : e.title,
      delivery: isObject(e.delivery) ? e.delivery : {},
    }))
    .slice(0, LOG_MAX);
}

function parseJSON(text: string | null): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Rules from storage, with the legacy chain store merged in (ids already present win). */
export function loadAllRules(): { rules: AlertRule[]; migratedLegacy: boolean } {
  // No import cap here: these are the user's own rules, and a capped read would be saved back.
  const rules = parseRulesJSON(readRaw(ALERT_RULES_STORAGE_KEY) ?? "[]", Date.now(), { limit: Infinity }).rules;
  const legacyRaw = parseJSON(readRaw(LEGACY_STRIKE_ALERTS_KEY));
  if (!Array.isArray(legacyRaw) || legacyRaw.length === 0) return { rules, migratedLegacy: legacyRaw !== null };
  const ids = new Set(rules.map((r) => r.id));
  const legacy = migrateAlertRecords(legacyRaw).rules.filter((r) => !ids.has(r.id));
  return { rules: [...rules, ...legacy], migratedLegacy: true };
}

function createAlertStore() {
  let state: AlertStoreState = {
    rules: [],
    settings: { ...DEFAULT_CHANNELS },
    log: [],
    runtime: EMPTY_RUNTIME,
    persisted: false,
  };
  let loaded = false;
  let listening = false;
  const listeners = new Set<Listener>();

  const emit = () => listeners.forEach((l) => l());

  const persistRules = (rules: AlertRule[]) => writeRaw(ALERT_RULES_STORAGE_KEY, JSON.stringify(rules));

  function load(): void {
    const { rules, migratedLegacy } = loadAllRules();
    let persisted = safeStorage() !== null;
    if (migratedLegacy) {
      persisted = persistRules(rules);
      if (persisted) removeRaw(LEGACY_STRIKE_ALERTS_KEY);
    }
    state = {
      ...state,
      rules,
      settings: parseSettings(parseJSON(readRaw(ALERT_SETTINGS_KEY))),
      log: parseLog(parseJSON(readRaw(ALERT_LOG_KEY))),
      persisted,
    };
  }

  function ensureLoaded(): void {
    if (loaded) return;
    loaded = true;
    load();
    if (typeof window !== "undefined" && !listening) {
      listening = true;
      window.addEventListener("storage", (e: StorageEvent) => {
        if (
          e.key === null ||
          e.key === ALERT_RULES_STORAGE_KEY ||
          e.key === ALERT_SETTINGS_KEY ||
          e.key === ALERT_LOG_KEY ||
          e.key === LEGACY_STRIKE_ALERTS_KEY
        ) {
          load();
          emit();
        }
      });
    }
  }

  function set(patch: Partial<AlertStoreState>): void {
    state = { ...state, ...patch };
    emit();
  }

  function setRules(next: AlertRule[]): void {
    const ok = persistRules(next);
    set({ rules: next, persisted: ok });
  }

  return {
    getState(): AlertStoreState {
      ensureLoaded();
      return state;
    },
    subscribe(l: Listener): () => void {
      ensureLoaded();
      listeners.add(l);
      return () => listeners.delete(l);
    },
    /** Re-read everything from storage (no-op when storage is unavailable, so nothing is wiped). */
    reload(): void {
      ensureLoaded();
      if (!safeStorage()) return;
      load();
      emit();
    },

    // ── Rules ──
    addRule(r: NewAlertRule | AlertRule): AlertRule {
      ensureLoaded();
      const rule = "id" in r && typeof r.id === "string" ? (r as AlertRule) : createRule(r as NewAlertRule);
      setRules([...state.rules, rule]);
      return rule;
    },
    /** Replace a rule after validation. Returns an error message, or null when saved. */
    updateRule(id: string, next: AlertRule | ((r: AlertRule) => AlertRule)): string | null {
      ensureLoaded();
      const cur = state.rules.find((r) => r.id === id);
      if (!cur) return "That rule no longer exists.";
      const candidate = typeof next === "function" ? next(cur) : next;
      const parsed = parseAlertRule({ ...candidate, id, createdAt: cur.createdAt });
      if (!parsed.ok) return parsed.error;
      setRules(state.rules.map((r) => (r.id === id ? parsed.rule : r)));
      return null;
    },
    toggleRule(id: string, enabled?: boolean): void {
      ensureLoaded();
      setRules(
        state.rules.map((r) => (r.id === id ? { ...r, enabled: enabled ?? !r.enabled, snoozeUntil: undefined } : r)),
      );
    },
    snoozeRule(id: string, until: number | undefined): void {
      ensureLoaded();
      setRules(state.rules.map((r) => (r.id === id ? { ...r, snoozeUntil: until } : r)));
    },
    removeRule(id: string): void {
      ensureLoaded();
      setRules(state.rules.filter((r) => r.id !== id));
    },
    removeRules(ids: string[]): void {
      ensureLoaded();
      const drop = new Set(ids);
      setRules(state.rules.filter((r) => !drop.has(r.id)));
    },
    clearRules(): void {
      ensureLoaded();
      setRules([]);
    },
    /**
     * Replace the strike-rule subset with `next` (the chain dialog's list). Existing strike rules
     * keep their extra fields (label, channels, cooldown); order of other rules is preserved.
     */
    replaceStrikeRules(next: AlertRule[]): void {
      ensureLoaded();
      const prevById = new Map(state.rules.filter((r) => r.type === "strike_level").map((r) => [r.id, r]));
      const merged = next.map((r) => {
        const prev = prevById.get(r.id);
        return prev
          ? ({
              ...prev,
              ...r,
              createdAt: prev.createdAt,
              cooldownMin: prev.cooldownMin,
              label: prev.label,
              channels: prev.channels,
              snoozeUntil: prev.snoozeUntil,
              origin: prev.origin,
            } as AlertRule)
          : r;
      });
      const others = state.rules.filter((r) => r.type !== "strike_level");
      setRules([...others, ...merged]);
    },
    importJSON(text: string): ParsedRules {
      ensureLoaded();
      const res = parseRulesJSON(text);
      if (res.rules.length > 0) setRules(mergeRules(state.rules, res.rules));
      return res;
    },
    exportJSON(): string {
      ensureLoaded();
      return exportRulesJSON(state.rules);
    },

    // ── Settings ──
    setSettings(patch: Partial<ChannelSettings>): void {
      ensureLoaded();
      const settings = parseSettings({ ...state.settings, ...patch });
      writeRaw(ALERT_SETTINGS_KEY, JSON.stringify(settings));
      set({ settings });
    },

    // ── Log ──
    appendLog(entries: TriggerLogEntry[]): void {
      ensureLoaded();
      if (entries.length === 0) return;
      const log = [...entries, ...state.log].slice(0, LOG_MAX);
      writeRaw(ALERT_LOG_KEY, JSON.stringify(log));
      set({ log });
    },
    /** Update an existing log entry (e.g. when an async webhook finishes). */
    patchLog(id: string, patch: Partial<TriggerLogEntry>): void {
      ensureLoaded();
      if (!state.log.some((e) => e.id === id)) return;
      const log = state.log.map((e) =>
        e.id === id ? { ...e, ...patch, delivery: { ...e.delivery, ...patch.delivery } } : e,
      );
      writeRaw(ALERT_LOG_KEY, JSON.stringify(log));
      set({ log });
    },
    clearLog(): void {
      ensureLoaded();
      writeRaw(ALERT_LOG_KEY, "[]");
      set({ log: [] });
    },

    // ── Runner status ──
    setRuntime(patch: Partial<RuntimeStatus>): void {
      ensureLoaded();
      set({ runtime: { ...state.runtime, ...patch } });
    },

    /** Tests only: forget everything in memory so the next access re-reads storage. */
    resetForTests(): void {
      state = { rules: [], settings: { ...DEFAULT_CHANNELS }, log: [], runtime: EMPTY_RUNTIME, persisted: false };
      loaded = false;
      listeners.clear();
    },
  };
}

export const alertStore = createAlertStore();

/** Most recent fire time per rule (from the log, test fires excluded). */
export function lastFiredByRule(log: TriggerLogEntry[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const e of log) if (!e.test && (out[e.ruleId] === undefined || e.ts > out[e.ruleId])) out[e.ruleId] = e.ts;
  return out;
}

/** Fire count per rule within the log (test fires excluded). */
export function fireCountByRule(log: TriggerLogEntry[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const e of log) if (!e.test) out[e.ruleId] = (out[e.ruleId] ?? 0) + 1;
  return out;
}
