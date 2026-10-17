/**
 * Alert runtime.
 *
 * - `useAlertRunner()` is the lightweight, always-mounted part: it decides which chains to poll,
 *   builds the evaluation context from real data (flow store feeds, recorded IV history, the NSE
 *   ban list, open positions marked from live chains) and evaluates every rule. Sample data never
 *   triggers an alert.
 * - `useAlertEngine()` is the store-backed facade the alert sheet and the Alerts page use: rules,
 *   settings, log, runner status and actions. It does not evaluate anything itself.
 * - `deliverAlert()` / `testFireAlert()` push an event through the channels (toast, browser
 *   notification, chime, webhook) and write the trigger log.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useQueries } from "@tanstack/react-query";
import { toast } from "sonner";
import { getDailyStats } from "@/lib/snapshotStore";
import { getPositions, type TrackedPosition } from "@/lib/positionStore";
import { FLOW_UNIVERSE, useBanList } from "@/components/flow/useFlow";
import { allPrints, buildSymbolMarket, flowStore, type FeedEntry, type FlowPrint } from "@/lib/flow";
import {
  ANY_SYMBOL,
  alertFeedSymbols,
  alertStore,
  buildPortfolio,
  deliveredBy,
  describeRule,
  desktopPermission,
  effectiveChannels,
  evaluateRules,
  lastFiredByRule,
  markDelivered,
  playAlertSound,
  requestDesktopPermission,
  sendWebhook,
  showDesktopNotification,
  webhookPayload,
  type AlertEvent,
  type AlertRule,
  type ChannelSettings,
  type DesktopPermission,
  type FeedStatus,
  type NewAlertRule,
  type RuleState,
  type SymbolMarket,
  type TriggerLogEntry,
} from "@/lib/alerts";

export type { AlertTone, DesktopPermission, FeedStatus } from "@/lib/alerts";
export { playAlertSound, desktopPermission, requestDesktopPermission } from "@/lib/alerts";

/** Kept for older imports: the channel settings. */
export type AlertSettings = ChannelSettings;

/** Name the background runner records when it shows an alert. */
export const RUNNER_SURFACE = "Alerts";
const EVAL_INTERVAL_MS = 15_000;
/** At most this many alerts are shown per evaluation; the rest are logged only. */
const MAX_SHOWN_PER_EVAL = 5;

// ── Delivery ──

function showToast(e: Pick<AlertEvent, "title" | "message" | "tone">, test: boolean): void {
  const opts = { description: e.message, duration: 10_000 };
  const title = test ? `Test: ${e.title}` : e.title;
  if (e.tone === "bullish") toast.success(title, opts);
  else if (e.tone === "bearish") toast.error(title, opts);
  else if (e.tone === "warning") toast.warning(title, opts);
  else toast.info(title, opts);
}

export interface DeliverOptions {
  test?: boolean;
  /** Log only (rate limit, or another surface already showed it). */
  silent?: boolean;
  shownElsewhere?: string;
  /** Play the chime for this event (the runner plays one chime per batch). */
  sound?: boolean;
}

/** Push one event through the channels and append it to the trigger log. Returns the log entry. */
export function deliverAlert(e: AlertEvent, rule: AlertRule | undefined, o: DeliverOptions = {}): TriggerLogEntry {
  const { settings } = alertStore.getState();
  const ch = effectiveChannels(settings, rule?.channels);
  const delivery: TriggerLogEntry["delivery"] = {};
  const test = !!o.test;
  if (o.silent) {
    delivery.toast = "skipped";
  } else {
    if (ch.toast) {
      showToast(e, test);
      delivery.toast = "sent";
    } else delivery.toast = "skipped";
    delivery.desktop = ch.desktop ? showDesktopNotification(test ? { ...e, title: `Test: ${e.title}` } : e) : "skipped";
    if (ch.sound && o.sound !== false) delivery.sound = playAlertSound(e.tone, settings.volume) ? "sent" : "blocked";
    else delivery.sound = "skipped";
    delivery.webhook = ch.webhook ? "sent" : "skipped";
  }
  const entry: TriggerLogEntry = {
    ...e,
    rule: rule ? describeRule(rule) : e.title,
    delivery,
    test: test || undefined,
    shownElsewhere: o.shownElsewhere,
  };
  alertStore.appendLog([entry]);
  if (!o.silent && ch.webhook) {
    void sendWebhook(settings.webhookUrl, webhookPayload(e, test)).then((outcome) =>
      alertStore.patchLog(entry.id, { delivery: { webhook: outcome } }),
    );
  }
  return entry;
}

/** The last real market context for a symbol, so a test entry shows what the rule would see. */
function testSnapshot(symbol: string): AlertEvent["snapshot"] {
  const m = alertStore.getState().runtime.markets[symbol];
  if (!m) return undefined;
  return {
    symbol,
    spot: m.spot,
    pcr: m.pcr,
    atmIv: m.atmIv,
    ivp: m.ivp,
    maxPain: m.maxPain,
    tideNet: m.tideNet,
    expiry: m.expiry,
    dataTs: m.ts,
  };
}

/** Fire a clearly-labelled test alert for a rule (or a generic one) through every enabled channel. */
export function testFireAlert(rule?: AlertRule, now: number = Date.now()): TriggerLogEntry {
  const e: AlertEvent = {
    id: `test:${rule?.id ?? "channels"}:${now}`,
    ruleId: rule?.id ?? "test",
    type: rule?.type ?? "price_level",
    symbol: rule?.symbol ?? "NIFTY",
    ts: now,
    title: rule ? describeRule(rule) : "Channel check",
    message: "This is a test alert. No market condition was met.",
    tone: "info",
    snapshot: testSnapshot(rule?.symbol ?? "NIFTY"),
  };
  return deliverAlert(e, rule, { test: true });
}

// ── Runner ──

let activeRunner: symbol | null = null;

/**
 * Cross-tab leader election, so only one tab in the browser evaluates rules and delivers alerts
 * (toast, desktop notification, webhook, log entry). Uses the Web Locks API where available: the
 * lock is held for as long as the runner is mounted and passes to a waiting tab when this one
 * closes. Without Web Locks, a localStorage lease renewed by heartbeat does the same job.
 */
const LEADER_LOCK = "mc-alert-runner";
const LEASE_KEY = "mc-alert-runner-lease";
const LEASE_MS = 8_000;
const HEARTBEAT_MS = 2_500;

interface Lease {
  id: string;
  until: number;
}

function readLease(): Lease | null {
  try {
    const raw = localStorage.getItem(LEASE_KEY);
    const v = raw ? (JSON.parse(raw) as Partial<Lease>) : null;
    return v && typeof v.id === "string" && typeof v.until === "number" ? { id: v.id, until: v.until } : null;
  } catch {
    return null;
  }
}

/** One step of the lease protocol: claim or renew when free, expired or ours. Returns leadership. */
export function tryLease(id: string, now: number = Date.now()): boolean {
  try {
    const cur = readLease();
    if (cur && cur.id !== id && cur.until > now) return false;
    localStorage.setItem(LEASE_KEY, JSON.stringify({ id, until: now + LEASE_MS }));
    return readLease()?.id === id;
  } catch {
    // No storage at all (private mode with storage blocked): every tab is on its own.
    return true;
  }
}

export function releaseLease(id: string): void {
  try {
    if (readLease()?.id === id) localStorage.removeItem(LEASE_KEY);
  } catch {
    /* storage unavailable */
  }
}

function useTabLeader(): boolean {
  const [leader, setLeader] = useState(false);
  useEffect(() => {
    let disposed = false;
    const locks = typeof navigator !== "undefined" ? (navigator as Navigator & { locks?: LockManager }).locks : undefined;
    if (locks && typeof locks.request === "function") {
      const ac = new AbortController();
      let release: (() => void) | null = null;
      locks
        .request(LEADER_LOCK, { signal: ac.signal }, () =>
          new Promise<void>((resolve) => {
            if (disposed) return resolve();
            release = resolve;
            setLeader(true);
          }),
        )
        .catch(() => {
          /* aborted on unmount */
        });
      return () => {
        disposed = true;
        ac.abort();
        release?.();
        setLeader(false);
      };
    }
    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    const beat = () => {
      if (!disposed) setLeader(tryLease(id));
    };
    beat();
    const t = setInterval(beat, HEARTBEAT_MS);
    const onStorage = (e: StorageEvent) => {
      if (e.key === LEASE_KEY) beat();
    };
    const onHide = () => releaseLease(id);
    window.addEventListener("storage", onStorage);
    window.addEventListener("pagehide", onHide);
    return () => {
      disposed = true;
      clearInterval(t);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("pagehide", onHide);
      releaseLease(id);
      setLeader(false);
    };
  }, []);
  return leader;
}

/**
 * Prints newer than `since` across feeds, newest first. Each feed's prints are already newest
 * first, so only each feed's head is scanned and the merged slice is small.
 */
function recentPrints(feeds: Record<string, FeedEntry>, since: number): FlowPrint[] {
  if (since === -Infinity) return allPrints(feeds);
  const out: FlowPrint[] = [];
  for (const f of Object.values(feeds)) {
    for (const p of f.prints) {
      if (!(p.ts > since)) break;
      out.push(p);
    }
  }
  return out.sort((a, b) => b.ts - a.ts || b.premium - a.premium);
}

function feedStatus(symbols: string[], feeds: Record<string, FeedEntry>): FeedStatus[] {
  return symbols.map((symbol) => {
    const f = feeds[symbol];
    return f ? { symbol, mode: f.mode, asOf: f.asOf, expiry: f.expiry } : { symbol, mode: "waiting" as const };
  });
}

function readPositions(): TrackedPosition[] {
  try {
    return getPositions();
  } catch {
    return [];
  }
}

const positionsKey = (ps: TrackedPosition[]) => ps.map((p) => `${p.id}:${p.symbol}:${p.lots}`).join("|");

/**
 * The always-mounted runner. Returns the underlyings whose chains must be polled (render a
 * FlowFeeder for each). Only the first mounted runner in a tab, and only in the tab elected leader
 * across the browser, evaluates and delivers, so extra mounts and extra tabs never duplicate alerts.
 */
export function useAlertRunner(): { feedSymbols: string[] } {
  const { rules } = useSyncExternalStore(alertStore.subscribe, alertStore.getState, alertStore.getState);
  const flowState = useSyncExternalStore(flowStore.subscribe, flowStore.getState, flowStore.getState);
  const [positions, setPositions] = useState<TrackedPosition[]>(readPositions);
  const token = useRef(Symbol("alert-runner"));
  const isLeader = useTabLeader();
  const leaderRef = useRef(isLeader);
  leaderRef.current = isLeader;

  useEffect(() => {
    const me = token.current;
    if (activeRunner === null) activeRunner = me;
    alertStore.reload();
    return () => {
      if (activeRunner === me) {
        activeRunner = null;
        alertStore.setRuntime({ running: false });
      }
    };
  }, []);

  const enabledRules = useMemo(() => rules.filter((r) => r.enabled), [rules]);
  const needsPositions = enabledRules.some((r) => r.type === "position_pnl" || r.type === "position_greek");

  // Positions change on another page or tab; re-read on storage events and every evaluation tick.
  useEffect(() => {
    if (!needsPositions) return;
    const refresh = () =>
      setPositions((prev) => {
        const next = readPositions();
        return positionsKey(next) === positionsKey(prev) ? prev : next;
      });
    refresh();
    const id = setInterval(refresh, EVAL_INTERVAL_MS);
    window.addEventListener("storage", refresh);
    return () => {
      clearInterval(id);
      window.removeEventListener("storage", refresh);
    };
  }, [needsPositions]);

  const positionSymbols = useMemo(
    () => (needsPositions ? [...new Set(positions.map((p) => p.symbol.toUpperCase()))].sort() : []),
    [positions, needsPositions],
  );
  const feedSymbols = useMemo(() => alertFeedSymbols(rules, FLOW_UNIVERSE, positionSymbols), [rules, positionSymbols]);
  const needsBan = enabledRules.some((r) => r.type === "ban_entry");
  const ivpSymbols = useMemo(
    () => [...new Set(enabledRules.filter((r) => r.type === "ivp_level").map((r) => r.symbol))].sort(),
    [enabledRules],
  );
  const flipSymbols = useMemo(
    () =>
      new Set(enabledRules.filter((r) => r.type === "spot_cross_ref" && r.ref === "gamma_flip").map((r) => r.symbol)),
    [enabledRules],
  );
  const tideSymbols = useMemo(
    () => new Set(enabledRules.filter((r) => r.type === "premium_tide").map((r) => r.symbol)),
    [enabledRules],
  );

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

  const stateRef = useRef<RuleState>({});
  const marketCache = useRef(new Map<string, { key: string; m: SymbolMarket | null }>());
  const live = useRef({
    rules,
    banList,
    ivHistory,
    flipSymbols,
    tideSymbols,
    positions,
    needsPositions,
    feedSymbols,
    banDate: "",
    banAvailable: false,
  });
  live.current = {
    rules,
    banList,
    ivHistory,
    flipSymbols,
    tideSymbols,
    positions,
    needsPositions,
    feedSymbols,
    banDate: ban.data?.date ?? "",
    banAvailable: Array.isArray(banList),
  };

  const evaluate = useCallback(() => {
    // A second runner in this tab claims the slot if the first one unmounted.
    if (activeRunner === null) activeRunner = token.current;
    if (activeRunner !== token.current) return;
    const cur = live.current;
    const feeds = flowStore.getState().feeds;
    const realFeeds: Record<string, FeedEntry> = Object.fromEntries(
      Object.entries(feeds).filter(([, f]) => f.mode !== "sample"),
    );
    const markets: Record<string, SymbolMarket> = {};
    for (const f of Object.values(realFeeds)) {
      const withFlip = cur.flipSymbols.has(f.symbol);
      const withTide = cur.tideSymbols.has(f.symbol);
      const ivLen = cur.ivHistory[f.symbol]?.length ?? 0;
      const key = `${f.asOf}|${withFlip}|${withTide}|${ivLen}|${f.prints.length}`;
      const cached = marketCache.current.get(f.symbol);
      let m: SymbolMarket | null;
      if (cached && cached.key === key) m = cached.m;
      else {
        m = buildSymbolMarket(f, {
          ivHistory: cur.ivHistory[f.symbol],
          withFlip,
          prints: withTide ? f.prints : undefined,
        });
        marketCache.current.set(f.symbol, { key, m });
      }
      if (m) markets[f.symbol] = m;
    }
    const portfolio = cur.needsPositions
      ? buildPortfolio(
          cur.positions,
          Object.values(realFeeds).map((f) => ({ symbol: f.symbol, expiry: f.expiry, asOf: f.asOf, chain: f.chain })),
        )
      : undefined;

    const now = Date.now();
    alertStore.setRuntime({
      running: true,
      feeds: feedStatus(cur.feedSymbols, feeds),
      banListAvailable: cur.banAvailable,
      banListDate: cur.banDate,
      lastEvalAt: now,
      positions: cur.needsPositions ? cur.positions.length : 0,
      portfolio,
      markets,
    });
    // Only the elected tab evaluates and delivers; the others show status and the shared log.
    if (!leaderRef.current) return;
    const enabled = cur.rules.filter((r) => r.enabled);
    if (enabled.length === 0) return;

    // Flow prints are only read by the print rules; merging and sorting up to MAX_PRINTS per feed
    // on every poll is wasted main-thread work otherwise. Only prints newer than the oldest
    // baseline any print rule has seen are passed in.
    let prints: FlowPrint[] = [];
    const printRules = enabled.filter((r) => r.type === "big_opening_print" || r.type === "repeated_hits");
    if (printRules.length > 0) {
      let since = Infinity;
      for (const r of printRules) since = Math.min(since, stateRef.current[r.id]?.printTs ?? -Infinity);
      prints = recentPrints(realFeeds, since);
    }

    const { events, state } = evaluateRules(
      cur.rules,
      { now, markets, prints, banList: cur.banList, portfolio },
      stateRef.current,
    );
    stateRef.current = state;
    if (events.length === 0) return;
    const byId = new Map(cur.rules.map((r) => [r.id, r]));
    let shown = 0;
    let chimed = false;
    for (const e of events) {
      const rule = byId.get(e.ruleId);
      const elsewhere = rule?.type === "strike_level" ? deliveredBy(e.ruleId, now) : null;
      if (elsewhere && elsewhere !== RUNNER_SURFACE) {
        deliverAlert(e, rule, { silent: true, shownElsewhere: elsewhere });
        continue;
      }
      const silent = shown >= MAX_SHOWN_PER_EVAL;
      deliverAlert(e, rule, { silent, sound: !chimed });
      if (!silent) {
        shown++;
        chimed = true;
        markDelivered(e.ruleId, RUNNER_SURFACE, now);
      }
    }
  }, []);

  // Re-arm crossing memory when a rule is paused or edited so it starts from a fresh baseline.
  const signature = useRef(new Map<string, string>());
  useEffect(() => {
    const next = new Map(
      rules.map((r) => [
        r.id,
        JSON.stringify({ ...r, label: undefined, note: undefined, channels: undefined, snoozeUntil: undefined }),
      ]),
    );
    const state = { ...stateRef.current };
    let changed = false;
    for (const [id, sig] of signature.current) {
      if (next.get(id) !== sig && state[id]) {
        delete state[id];
        changed = true;
      }
    }
    if (changed) stateRef.current = state;
    signature.current = next;
  }, [rules]);

  // Evaluate on new data and on a timer (for time-window rules, the ban list and positions).
  useEffect(() => {
    evaluate();
  }, [flowState, banList, ivHistory, positions, rules, evaluate, isLeader]);
  useEffect(() => {
    const id = setInterval(evaluate, EVAL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [evaluate]);

  return { feedSymbols };
}

// ── Facade for the sheet and the page ──

export function useAlertEngine() {
  const s = useSyncExternalStore(alertStore.subscribe, alertStore.getState, alertStore.getState);
  const [permission, setPermission] = useState<DesktopPermission>(() => desktopPermission());

  // The permission can change in browser settings while the app is open.
  useEffect(() => {
    const onFocus = () => setPermission(desktopPermission());
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  const lastFiredMap = useMemo(() => lastFiredByRule(s.log), [s.log]);
  const lastFired = useCallback((id: string): number | undefined => lastFiredMap[id], [lastFiredMap]);

  const enableDesktop = useCallback(async (on: boolean): Promise<DesktopPermission> => {
    if (!on) {
      alertStore.setSettings({ desktop: false });
      return desktopPermission();
    }
    const p = await requestDesktopPermission();
    setPermission(p);
    alertStore.setSettings({ desktop: p === "granted" });
    return p;
  }, []);

  const hasBanRule = s.rules.some((r) => r.enabled && r.type === "ban_entry");

  return {
    rules: s.rules,
    addRule: useCallback((r: NewAlertRule) => alertStore.addRule(r), []),
    updateRule: alertStore.updateRule,
    toggleRule: alertStore.toggleRule,
    snoozeRule: alertStore.snoozeRule,
    removeRule: alertStore.removeRule,
    removeRules: alertStore.removeRules,
    clearRules: alertStore.clearRules,
    exportJSON: alertStore.exportJSON,
    importJSON: alertStore.importJSON,
    settings: s.settings,
    setSettings: alertStore.setSettings,
    enableDesktop,
    permission,
    log: s.log,
    clearLog: alertStore.clearLog,
    runtime: s.runtime,
    persisted: s.persisted,
    feedSymbols: s.runtime.feeds.map((f) => f.symbol),
    status: s.runtime.feeds,
    lastFired,
    banListDate: s.runtime.banListDate,
    banListAvailable: s.runtime.banListAvailable,
    hasBanRule,
    testFire: testFireAlert,
    anySymbol: ANY_SYMBOL,
  };
}

export type AlertEngine = ReturnType<typeof useAlertEngine>;
