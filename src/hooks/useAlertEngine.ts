/**
 * Rule-based alert engine hook.
 *
 * Rules live in localStorage ("mc_alert_rules_v1") and are evaluated against real chain data from
 * the shared flow store (PCR from OI, ATM IV, IV percentile from recorded history, max pain, gamma
 * flip, OI walls, derived flow prints) and the NSE ban list. Sample data never triggers alerts.
 * Delivery: sonner toast, the browser Notification API (opt-in) and an optional chime.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useQueries } from "@tanstack/react-query";
import { toast } from "sonner";
import { getDailyStats } from "@/lib/snapshotStore";
import { FLOW_UNIVERSE, useBanList } from "@/components/flow/useFlow";
import {
  alertFeedSymbols,
  allPrints,
  buildSymbolMarket,
  evaluateRules,
  exportRulesJSON,
  flowStore,
  loadRules,
  mergeRules,
  parseRulesJSON,
  saveRules,
  safeStorage,
  createRule,
  type AlertEvent,
  type AlertRule,
  type AlertTone,
  type FeedMode,
  type NewAlertRule,
  type RuleState,
  type SymbolMarket,
} from "@/lib/flow";

export type { AlertTone } from "@/lib/flow";

// ── Sound ──

let audioContext: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  try {
    if (!audioContext) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      audioContext = new Ctor();
    }
    return audioContext;
  } catch {
    return null;
  }
}

const toneFrequencies: Record<AlertTone, number[]> = {
  bullish: [523.25, 659.25, 783.99],
  bearish: [783.99, 659.25, 523.25],
  warning: [880, 698.46, 880],
  info: [659.25, 783.99],
};

export function playAlertSound(tone: AlertTone = "info", volume = 0.25): void {
  const ctx = getAudioContext();
  if (!ctx) return;
  try {
    if (ctx.state === "suspended") void ctx.resume();
    const noteLength = 0.12;
    toneFrequencies[tone].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = "sine";
      osc.frequency.value = freq;
      const t0 = ctx.currentTime + i * noteLength;
      gain.gain.setValueAtTime(Math.max(0.0001, Math.min(1, volume)), t0);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + noteLength + 0.05);
      osc.start(t0);
      osc.stop(t0 + noteLength + 0.06);
    });
  } catch {
    /* audio blocked */
  }
}

// ── Desktop notifications ──

export type DesktopPermission = NotificationPermission | "unsupported";

export function desktopPermission(): DesktopPermission {
  try {
    return typeof Notification === "undefined" ? "unsupported" : Notification.permission;
  } catch {
    return "unsupported";
  }
}

export async function requestDesktopPermission(): Promise<DesktopPermission> {
  if (desktopPermission() === "unsupported") return "unsupported";
  try {
    return await Notification.requestPermission();
  } catch {
    return desktopPermission();
  }
}

function showDesktop(e: AlertEvent): void {
  if (desktopPermission() !== "granted") return;
  try {
    new Notification(e.title, { body: `${e.message}\nEducational alert, not advice.`, tag: e.ruleId });
  } catch {
    /* some browsers only allow notifications from a service worker */
  }
}

// ── Settings and log persistence ──

export interface AlertSettings {
  sound: boolean;
  volume: number;
  desktop: boolean;
}

const SETTINGS_KEY = "mc_alert_settings_v1";
const LOG_KEY = "mc_alert_log_v1";
const LOG_MAX = 50;
const DEFAULT_SETTINGS: AlertSettings = { sound: true, volume: 0.25, desktop: false };

function readJSON<T>(key: string, fallback: T): T {
  const s = safeStorage();
  if (!s) return fallback;
  try {
    const raw = s.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJSON(key: string, value: unknown): void {
  const s = safeStorage();
  if (!s) return;
  try {
    s.setItem(key, JSON.stringify(value));
  } catch {
    /* quota or private mode */
  }
}

function deliver(e: AlertEvent, settings: AlertSettings): void {
  const opts = { description: e.message, duration: 10_000 };
  if (e.tone === "bullish") toast.success(e.title, opts);
  else if (e.tone === "bearish") toast.error(e.title, opts);
  else if (e.tone === "warning") toast.warning(e.title, opts);
  else toast.info(e.title, opts);
  if (settings.desktop) showDesktop(e);
  if (settings.sound) playAlertSound(e.tone, settings.volume);
}

export interface FeedStatus {
  symbol: string;
  mode: FeedMode | "waiting";
  asOf?: number;
}

const EVAL_INTERVAL_MS = 15_000;

export function useAlertEngine() {
  const [rules, setRules] = useState<AlertRule[]>(() => loadRules());
  const [settings, setSettingsState] = useState<AlertSettings>(() => ({ ...DEFAULT_SETTINGS, ...readJSON<Partial<AlertSettings>>(SETTINGS_KEY, {}) }));
  const [log, setLog] = useState<AlertEvent[]>(() => {
    const l = readJSON<AlertEvent[]>(LOG_KEY, []);
    return Array.isArray(l) ? l.slice(0, LOG_MAX) : [];
  });
  const [permission, setPermission] = useState<DesktopPermission>(() => desktopPermission());

  useEffect(() => {
    saveRules(rules);
  }, [rules]);
  useEffect(() => writeJSON(SETTINGS_KEY, settings), [settings]);
  useEffect(() => writeJSON(LOG_KEY, log.slice(0, LOG_MAX)), [log]);

  // Keep rules in sync across tabs.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === "mc_alert_rules_v1") setRules(loadRules());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const feedSymbols = useMemo(() => alertFeedSymbols(rules, FLOW_UNIVERSE), [rules]);
  const enabledRules = useMemo(() => rules.filter((r) => r.enabled), [rules]);
  const needsBan = enabledRules.some((r) => r.type === "ban_entry");
  const ivpSymbols = useMemo(() => [...new Set(enabledRules.filter((r) => r.type === "ivp_level").map((r) => r.symbol))].sort(), [enabledRules]);
  const flipSymbols = useMemo(() => new Set(enabledRules.filter((r) => r.type === "spot_cross_ref" && r.ref === "gamma_flip").map((r) => r.symbol)), [enabledRules]);

  const ban = useBanList(needsBan);
  const banList = ban.data?.symbols ?? null;

  const ivQueries = useQueries({
    queries: ivpSymbols.map((symbol) => ({
      queryKey: ["alert-iv-history", symbol],
      queryFn: async () => {
        const stats = await getDailyStats(symbol, 260).catch(() => []);
        return stats.map((s) => s.atmIv).filter((v) => Number.isFinite(v) && v > 0);
      },
      staleTime: 30 * 60_000,
      refetchInterval: 30 * 60_000,
      retry: 0,
    })),
  });
  const ivKey = ivQueries.map((q) => q.data?.length ?? -1).join(",");
  const ivHistory = useMemo(() => {
    const m: Record<string, number[]> = {};
    ivpSymbols.forEach((s, i) => {
      const d = ivQueries[i]?.data;
      if (d) m[s] = d;
    });
    return m;
    // ivQueries is a new array every render; ivKey tracks the data that matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ivpSymbols, ivKey]);

  const flowState = useSyncExternalStore(flowStore.subscribe, flowStore.getState, flowStore.getState);

  const stateRef = useRef<RuleState>({});
  const marketCache = useRef(new Map<string, { asOf: number; flip: boolean; ivLen: number; m: SymbolMarket | null }>());
  const live = useRef({ rules, settings, banList, ivHistory, flipSymbols });
  live.current = { rules, settings, banList, ivHistory, flipSymbols };

  const evaluate = useCallback(() => {
    const { rules: rs, settings: st, banList: bl, ivHistory: ivh, flipSymbols: flips } = live.current;
    if (!rs.some((r) => r.enabled)) return;
    const feeds = flowStore.getState().feeds;
    const markets: Record<string, SymbolMarket> = {};
    const realFeeds = Object.fromEntries(Object.entries(feeds).filter(([, f]) => f.mode !== "sample"));
    for (const f of Object.values(realFeeds)) {
      const withFlip = flips.has(f.symbol);
      const ivLen = ivh[f.symbol]?.length ?? 0;
      const cached = marketCache.current.get(f.symbol);
      let m: SymbolMarket | null;
      if (cached && cached.asOf === f.asOf && cached.flip === withFlip && cached.ivLen === ivLen) m = cached.m;
      else {
        m = buildSymbolMarket(f, { ivHistory: ivh[f.symbol], withFlip });
        marketCache.current.set(f.symbol, { asOf: f.asOf, flip: withFlip, ivLen, m });
      }
      if (m) markets[f.symbol] = m;
    }
    const now = Date.now();
    const { events, state } = evaluateRules(rs, { now, markets, prints: allPrints(realFeeds), banList: bl }, stateRef.current);
    stateRef.current = state;
    if (events.length === 0) return;
    for (const e of events.slice(0, 5)) deliver(e, st);
    setLog((l) => [...events, ...l].slice(0, LOG_MAX));
  }, []);

  // Evaluate on new data and on a timer (for time-window rules and the ban list).
  useEffect(() => {
    evaluate();
  }, [flowState, banList, ivHistory, evaluate]);
  useEffect(() => {
    const id = setInterval(evaluate, EVAL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [evaluate]);

  const status: FeedStatus[] = useMemo(
    () => feedSymbols.map((symbol) => {
      const f = flowState.feeds[symbol];
      return f ? { symbol, mode: f.mode, asOf: f.asOf } : { symbol, mode: "waiting" as const };
    }),
    [feedSymbols, flowState],
  );

  const lastFired = useCallback((id: string) => stateRef.current[id]?.lastFiredAt, []);

  const addRule = useCallback((r: NewAlertRule) => {
    const rule = createRule(r);
    setRules((rs) => [...rs, rule]);
    return rule;
  }, []);
  const updateRule = useCallback((id: string, patch: Partial<AlertRule>) => {
    setRules((rs) => rs.map((r) => (r.id === id ? ({ ...r, ...patch, id: r.id, type: r.type } as AlertRule) : r)));
  }, []);
  const toggleRule = useCallback((id: string) => {
    setRules((rs) => rs.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r)));
    // Re-arm crossing memory so a re-enabled rule starts from a fresh baseline.
    const next = { ...stateRef.current };
    delete next[id];
    stateRef.current = next;
  }, []);
  const removeRule = useCallback((id: string) => setRules((rs) => rs.filter((r) => r.id !== id)), []);
  const clearRules = useCallback(() => setRules([]), []);

  const exportJSON = useCallback(() => exportRulesJSON(rules), [rules]);
  const importJSON = useCallback((text: string) => {
    const res = parseRulesJSON(text);
    if (res.rules.length > 0) setRules((rs) => mergeRules(rs, res.rules));
    return res;
  }, []);

  const setSettings = useCallback((patch: Partial<AlertSettings>) => setSettingsState((s) => ({ ...s, ...patch })), []);
  const enableDesktop = useCallback(async (on: boolean) => {
    if (!on) {
      setSettingsState((s) => ({ ...s, desktop: false }));
      return desktopPermission();
    }
    const p = await requestDesktopPermission();
    setPermission(p);
    setSettingsState((s) => ({ ...s, desktop: p === "granted" }));
    return p;
  }, []);

  const clearLog = useCallback(() => setLog([]), []);

  return {
    rules,
    addRule,
    updateRule,
    toggleRule,
    removeRule,
    clearRules,
    exportJSON,
    importJSON,
    settings,
    setSettings,
    enableDesktop,
    permission,
    log,
    clearLog,
    feedSymbols,
    status,
    lastFired,
    banListDate: ban.data?.date ?? "",
    banListAvailable: Array.isArray(banList),
  };
}

export type AlertEngine = ReturnType<typeof useAlertEngine>;
