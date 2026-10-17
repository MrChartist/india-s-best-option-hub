/**
 * Edge analytics on round trips, always net of charges: win rate, expectancy, profit factor, drawdown,
 * charges as a share of gross P&L, and expectancy split by strategy, DTE at entry, weekday and time of
 * day (IST).
 */
import { isoWeekday, nowIST } from "@/lib/options";
import type { Annotation, RoundTrip } from "./types";

export interface Summary {
  trades: number;
  wins: number;
  losses: number;
  /** Percent 0-100 (NaN with no trades). */
  winRate: number;
  gross: number;
  charges: number;
  net: number;
  /** Charges as a percent of |gross P&L| (NaN when gross is zero). */
  chargesPctOfGross: number;
  /** Average net P&L per trade (₹). */
  expectancy: number;
  avgWin: number;
  avgLoss: number;
  /** Sum of winning nets ÷ |sum of losing nets| (Infinity with no losers). */
  profitFactor: number;
  /** Largest peak-to-trough fall of cumulative net P&L, as a positive ₹ figure. */
  maxDrawdown: number;
  best: number;
  worst: number;
  /** Trades whose gross was positive but net was not: charges turned a win into a loss. */
  eatenByCharges: number;
}

const round2 = (v: number) => Math.round(v * 100) / 100;

function exitSort(t: RoundTrip): number {
  return t.exitTs ?? Date.parse(`${t.exitDate}T10:00:00Z`);
}

export function summarise(trips: RoundTrip[]): Summary {
  const n = trips.length;
  const wins = trips.filter((t) => t.net > 0);
  const losses = trips.filter((t) => t.net <= 0);
  const gross = trips.reduce((a, t) => a + t.gross, 0);
  const charges = trips.reduce((a, t) => a + t.charges, 0);
  const net = trips.reduce((a, t) => a + t.net, 0);
  const winSum = wins.reduce((a, t) => a + t.net, 0);
  const lossSum = losses.reduce((a, t) => a + t.net, 0);
  let peak = 0;
  let cum = 0;
  let dd = 0;
  for (const t of [...trips].sort((a, b) => exitSort(a) - exitSort(b))) {
    cum += t.net;
    peak = Math.max(peak, cum);
    dd = Math.max(dd, peak - cum);
  }
  return {
    trades: n,
    wins: wins.length,
    losses: losses.length,
    winRate: n ? (wins.length / n) * 100 : NaN,
    gross: round2(gross),
    charges: round2(charges),
    net: round2(net),
    chargesPctOfGross: Math.abs(gross) > 1e-9 ? (charges / Math.abs(gross)) * 100 : NaN,
    expectancy: n ? round2(net / n) : NaN,
    avgWin: wins.length ? round2(winSum / wins.length) : NaN,
    avgLoss: losses.length ? round2(lossSum / losses.length) : NaN,
    profitFactor: lossSum < 0 ? winSum / Math.abs(lossSum) : winSum > 0 ? Infinity : NaN,
    maxDrawdown: round2(dd),
    best: n ? Math.max(...trips.map((t) => t.net)) : NaN,
    worst: n ? Math.min(...trips.map((t) => t.net)) : NaN,
    eatenByCharges: trips.filter((t) => t.gross > 0 && t.net <= 0).length,
  };
}

export type Dimension = "strategy" | "dte" | "weekday" | "timeOfDay" | "underlying" | "tag";

export const DIMENSION_LABEL: Record<Dimension, string> = {
  strategy: "Strategy",
  dte: "DTE at entry",
  weekday: "Entry weekday",
  timeOfDay: "Entry time (IST)",
  underlying: "Underlying",
  tag: "Tag",
};

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export const DTE_BUCKETS = ["0 DTE (expiry day)", "1–2 days", "3–7 days", "8–30 days", "Over 30 days"] as const;
export function dteBucket(dte: number): string {
  if (dte <= 0) return DTE_BUCKETS[0];
  if (dte <= 2) return DTE_BUCKETS[1];
  if (dte <= 7) return DTE_BUCKETS[2];
  if (dte <= 30) return DTE_BUCKETS[3];
  return DTE_BUCKETS[4];
}

export const TIME_BUCKETS = ["09:15–10:00 opening", "10:00–12:00 morning", "12:00–14:00 midday", "14:00–15:30 closing", "Time not in file"] as const;
export function timeBucket(ts: number | null): string {
  if (ts === null || !Number.isFinite(ts)) return TIME_BUCKETS[4];
  const { hh, mm } = nowIST(new Date(ts));
  const mins = hh * 60 + mm;
  if (mins < 10 * 60) return TIME_BUCKETS[0];
  if (mins < 12 * 60) return TIME_BUCKETS[1];
  if (mins < 14 * 60) return TIME_BUCKETS[2];
  return TIME_BUCKETS[3];
}

export function weekdayOf(iso: string): string {
  const w = isoWeekday(iso);
  return Number.isFinite(w) ? WEEKDAYS[w] : "—";
}

function keysFor(t: RoundTrip, dim: Dimension, notes?: Record<string, Annotation>): string[] {
  switch (dim) {
    case "strategy":
      return [t.strategy || "Unclassified"];
    case "dte":
      return [dteBucket(t.dte)];
    case "weekday":
      return [weekdayOf(t.entryDate)];
    case "timeOfDay":
      return [timeBucket(t.entryTs)];
    case "underlying":
      return [t.underlying];
    case "tag": {
      const tags = notes?.[t.id]?.tags ?? [];
      return tags.length ? tags : ["Untagged"];
    }
  }
}

export interface GroupRow extends Summary {
  key: string;
}

const ORDER: Partial<Record<Dimension, readonly string[]>> = {
  dte: DTE_BUCKETS,
  timeOfDay: TIME_BUCKETS,
  weekday: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
};

/** Summary per bucket of a dimension. Natural order for DTE, weekday and time; by net otherwise. */
export function groupStats(trips: RoundTrip[], dim: Dimension, notes?: Record<string, Annotation>): GroupRow[] {
  const m = new Map<string, RoundTrip[]>();
  for (const t of trips)
    for (const k of keysFor(t, dim, notes)) {
      const arr = m.get(k);
      if (arr) arr.push(t);
      else m.set(k, [t]);
    }
  const rows = [...m.entries()].map(([key, list]) => ({ key, ...summarise(list) }));
  const order = ORDER[dim];
  if (order) return rows.sort((a, b) => (order.indexOf(a.key) + 1 || 99) - (order.indexOf(b.key) + 1 || 99));
  return rows.sort((a, b) => b.net - a.net);
}

/** Net P&L per IST exit date, for the P&L calendar. */
export function dailyNet(trips: RoundTrip[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const t of trips) out[t.exitDate] = round2((out[t.exitDate] ?? 0) + t.net);
  return out;
}

/** Cumulative gross and net P&L by exit, for an equity curve (the gap between them is charges). */
export function equityCurve(trips: RoundTrip[]): Array<{ i: number; date: string; cum: number; grossCum: number; net: number }> {
  let cum = 0;
  let grossCum = 0;
  return [...trips]
    .sort((a, b) => exitSort(a) - exitSort(b))
    .map((t, i) => {
      cum += t.net;
      grossCum += t.gross;
      return { i: i + 1, date: t.exitDate, cum: round2(cum), grossCum: round2(grossCum), net: t.net };
    });
}

/**
 * Combine the legs of each multi-leg structure (same groupId) into one position-level trade, so a
 * four-leg iron condor counts as one trade in win rate and expectancy. Entry is the earliest leg,
 * exit the latest; P&L and charges are summed.
 */
export function combineGroups(trips: RoundTrip[]): RoundTrip[] {
  const m = new Map<string, RoundTrip[]>();
  for (const t of trips) {
    const k = t.groupId || t.id;
    const arr = m.get(k);
    if (arr) arr.push(t);
    else m.set(k, [t]);
  }
  const out: RoundTrip[] = [];
  for (const [k, list] of m) {
    if (list.length === 1) {
      out.push(list[0]);
      continue;
    }
    const entryKey = (t: RoundTrip) => t.entryTs ?? Date.parse(`${t.entryDate}T03:45:00Z`);
    const first = list.reduce((a, t) => (entryKey(t) < entryKey(a) ? t : a));
    const last = list.reduce((a, t) => (exitSort(t) > exitSort(a) ? t : a));
    out.push({
      ...first,
      id: `group:${k}`,
      exitDate: last.exitDate,
      exitTs: last.exitTs,
      gross: round2(list.reduce((a, t) => a + t.gross, 0)),
      charges: round2(list.reduce((a, t) => a + t.charges, 0)),
      net: round2(list.reduce((a, t) => a + t.net, 0)),
      assumedExpiry: list.some((t) => t.assumedExpiry),
      settled: list.some((t) => t.settled),
    });
  }
  return out;
}

/** Tags and notes for combined trades: the union of their legs' tags, notes joined. */
export function mergeGroupNotes(legs: RoundTrip[], notes: Record<string, Annotation>): Record<string, Annotation> {
  const out: Record<string, Annotation> = { ...notes };
  const byGroup = new Map<string, RoundTrip[]>();
  for (const t of legs) {
    const arr = byGroup.get(t.groupId);
    if (arr) arr.push(t);
    else byGroup.set(t.groupId, [t]);
  }
  for (const [gid, list] of byGroup) {
    if (list.length < 2) continue;
    const tags = [...new Set(list.flatMap((t) => notes[t.id]?.tags ?? []))];
    const note = list.map((t) => notes[t.id]?.note).filter(Boolean).join(" · ");
    if (tags.length || note) out[`group:${gid}`] = { tags, note };
  }
  return out;
}
