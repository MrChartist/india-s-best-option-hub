/**
 * In-memory flow store: a ring buffer of recent chain snapshots per underlying plus the prints
 * derived from them, so the tape works within a session even without IndexedDB.
 *
 * Framework-free (subscribe/getState) so it can back React's useSyncExternalStore and be tested
 * in node. Feeds are keyed by underlying; changing expiry resets that feed.
 */
import type { OptionData } from "@/lib/mockData";
import { buildSnapshot, type ChainSnapshot } from "@/lib/snapshotStore";
import { derivePrints, derivePrintsFromSeries } from "./derivePrints";
import { simulateSession } from "./sampleSession";
import type { FlowPrint } from "./types";

export type FeedMode = "live" | "recorded" | "sample";

export interface FeedEntry {
  symbol: string;
  expiry: string;
  lotSize: number;
  mode: FeedMode;
  source: string;
  asOf: number;
  stale: boolean;
  reason?: string;
  spot: number;
  chain: OptionData[];
  snaps: ChainSnapshot[];
  prints: FlowPrint[];
  updatedAt: number;
  /** True once recorded snapshots from IndexedDB have been merged in. */
  hydrated: boolean;
}

export const RING_CAPACITY = 600;
/** Polls closer together than this are not stored (the chain barely moves in a few seconds). */
export const MIN_RING_GAP_MS = 10_000;
export const MAX_PRINTS = 20_000;
/**
 * A feed nobody has retained or ingested into for this long is dropped (with its snapshot ring)
 * on the next ingest, so the alert engine stops evaluating a frozen "live" snapshot.
 */
export const IDLE_FEED_MS = 10 * 60_000;

/** Fixed-capacity, time-ordered buffer of snapshots with de-duplication. */
export class SnapshotRing {
  private items: ChainSnapshot[] = [];
  constructor(readonly capacity: number = RING_CAPACITY, readonly minGapMs: number = MIN_RING_GAP_MS) {}

  /** Add a snapshot. Returns false when it is older than, too close to or identical to the last one. */
  push(s: ChainSnapshot): boolean {
    const last = this.items[this.items.length - 1];
    if (last) {
      if (s.ts <= last.ts) return false;
      if (s.ts - last.ts < this.minGapMs) return false;
      if (sameContent(last, s)) return false;
    }
    this.items.push(s);
    if (this.items.length > this.capacity) this.items.splice(0, this.items.length - this.capacity);
    return true;
  }

  /** Merge older/other snapshots (e.g. from IndexedDB), keeping time order and the capacity. */
  merge(list: ChainSnapshot[]): void {
    const byTs = new Map<number, ChainSnapshot>();
    for (const s of [...list, ...this.items]) if (s && Array.isArray(s.rows)) byTs.set(Math.round(s.ts / 1000), s);
    this.items = [...byTs.values()].sort((a, b) => a.ts - b.ts).slice(-this.capacity);
  }

  last(): ChainSnapshot | undefined {
    return this.items[this.items.length - 1];
  }

  toArray(): ChainSnapshot[] {
    return [...this.items];
  }

  get size(): number {
    return this.items.length;
  }
}

/** Cheap content check: same total volume and OI on both sides means nothing traded. */
export function sameContent(a: ChainSnapshot, b: ChainSnapshot): boolean {
  if (a.rows.length !== b.rows.length) return false;
  let va = 0;
  let vb = 0;
  let oa = 0;
  let ob = 0;
  let la = 0;
  let lb = 0;
  for (const r of a.rows) {
    va += r.vol;
    oa += r.oi;
    la += r.ltp;
  }
  for (const r of b.rows) {
    vb += r.vol;
    ob += r.oi;
    lb += r.ltp;
  }
  return va === vb && oa === ob && Math.abs(la - lb) < 1e-9;
}

export interface IngestInput {
  symbol: string;
  expiry: string;
  lotSize: number;
  spot: number;
  chain: OptionData[];
  source: string;
  asOf: number;
  stale: boolean;
  isLive: boolean;
  reason?: string;
  now?: Date;
}

export interface FlowState {
  version: number;
  feeds: Record<string, FeedEntry>;
}

export function createFlowStore() {
  let state: FlowState = { version: 0, feeds: {} };
  const rings = new Map<string, SnapshotRing>();
  const refs = new Map<string, number>();
  const listeners = new Set<() => void>();

  const emit = (feeds: Record<string, FeedEntry>) => {
    state = { version: state.version + 1, feeds };
    for (const l of listeners) l();
  };

  const ringFor = (symbol: string) => {
    let r = rings.get(symbol);
    if (!r) {
      r = new SnapshotRing();
      rings.set(symbol, r);
    }
    return r;
  };

  /** Feeds other than `keep` that are unretained and idle past IDLE_FEED_MS, removed. */
  const pruneIdle = (feeds: Record<string, FeedEntry>, keep: string, nowMs: number): Record<string, FeedEntry> => {
    let out = feeds;
    for (const [sym, f] of Object.entries(feeds)) {
      if (sym === keep || (refs.get(sym) ?? 0) > 0 || nowMs - f.updatedAt < IDLE_FEED_MS) continue;
      if (out === feeds) out = { ...feeds };
      delete out[sym];
      rings.delete(sym);
    }
    return out;
  };

  function ingest(i: IngestInput): void {
    const symbol = String(i.symbol || "").toUpperCase();
    if (!symbol || !i.expiry || !Array.isArray(i.chain) || i.chain.length === 0) return;
    const pruned = pruneIdle(state.feeds, symbol, Date.now());
    if (pruned !== state.feeds) state = { ...state, feeds: pruned };
    const prev = state.feeds[symbol];
    const sameSeries = prev && prev.expiry === i.expiry;
    const isSample = i.source === "sample";
    const mode: FeedMode = isSample ? "sample" : i.isLive && !i.stale ? "live" : "recorded";
    const base = { symbol, expiry: i.expiry, lotSize: i.lotSize, mode, source: i.source, asOf: i.asOf, stale: i.stale, reason: i.reason, spot: i.spot, chain: i.chain, updatedAt: Date.now() };

    if (isSample) {
      if (sameSeries && prev.mode === "sample" && prev.snaps.length > 0) {
        emit({ ...state.feeds, [symbol]: { ...prev, ...base, snaps: prev.snaps, prints: prev.prints } });
        return;
      }
      rings.delete(symbol);
      const snaps = simulateSession({ symbol, expiry: i.expiry, spot: i.spot, chain: i.chain, now: i.now });
      emit({ ...state.feeds, [symbol]: { ...base, snaps, prints: derivePrintsFromSeries(snaps, i.lotSize), hydrated: true } });
      return;
    }

    if (!sameSeries || prev.mode === "sample") rings.delete(symbol);
    const ring = ringFor(symbol);
    const snap = buildSnapshot(symbol, i.expiry, i.spot, i.chain, Number.isFinite(i.asOf) && i.asOf > 0 ? i.asOf : Date.now());
    const before = ring.last();
    const added = snap.rows.length > 0 && ring.push(snap);
    let prints = sameSeries && prev.mode !== "sample" ? prev.prints : [];
    if (added && before) {
      const fresh = derivePrints(before, snap, i.lotSize);
      if (fresh.length) prints = [...fresh, ...prints].slice(0, MAX_PRINTS);
    }
    emit({ ...state.feeds, [symbol]: { ...base, snaps: ring.toArray(), prints, hydrated: sameSeries && prev.mode !== "sample" ? prev.hydrated : false } });
  }

  /** Merge recorded snapshots (same symbol and expiry) and rebuild that feed's prints. */
  function hydrate(symbol: string, expiry: string, snaps: ChainSnapshot[]): void {
    const sym = String(symbol || "").toUpperCase();
    const feed = state.feeds[sym];
    if (!feed || feed.mode === "sample" || feed.expiry !== expiry) return;
    const usable = (snaps ?? []).filter((s) => s && s.symbol === sym && s.expiry === expiry);
    const ring = ringFor(sym);
    if (usable.length) ring.merge(usable);
    const all = ring.toArray();
    emit({ ...state.feeds, [sym]: { ...feed, snaps: all, prints: derivePrintsFromSeries(all, feed.lotSize).slice(0, MAX_PRINTS), hydrated: true } });
  }

  /**
   * Mark a symbol as in use (e.g. by a mounted FlowFeeder). Returns the matching release.
   * When the last holder releases, the feed and its snapshot ring are dropped, so stale "live"
   * entries do not linger for the whole session.
   */
  function retain(symbol: string): () => void {
    const sym = String(symbol || "").toUpperCase();
    if (!sym) return () => {};
    refs.set(sym, (refs.get(sym) ?? 0) + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      release(sym);
    };
  }

  /** Drop one hold on a symbol; removes the feed once nobody holds it. */
  function release(symbol: string): void {
    const sym = String(symbol || "").toUpperCase();
    const n = (refs.get(sym) ?? 0) - 1;
    if (n > 0) {
      refs.set(sym, n);
      return;
    }
    refs.delete(sym);
    rings.delete(sym);
    if (state.feeds[sym]) {
      const feeds = { ...state.feeds };
      delete feeds[sym];
      emit(feeds);
    }
  }

  function reset(): void {
    rings.clear();
    refs.clear();
    emit({});
  }

  return {
    getState: () => state,
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    ingest,
    hydrate,
    retain,
    release,
    reset,
  };
}

export type FlowStore = ReturnType<typeof createFlowStore>;

/** App-wide store shared by the Flow page, the Premium Tide card and the alert engine. */
export const flowStore: FlowStore = createFlowStore();

/** All prints across feeds, newest first. */
export function allPrints(feeds: Record<string, FeedEntry>): FlowPrint[] {
  const out: FlowPrint[] = [];
  for (const f of Object.values(feeds)) out.push(...f.prints);
  return out.sort((a, b) => b.ts - a.ts || b.premium - a.premium);
}
