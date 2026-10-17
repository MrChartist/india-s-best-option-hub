/**
 * Pure state helpers for the Strategy Builder: leg identity and immutable edits, the ?legs= basket
 * contract shared with the option chain / optimizer / calculators, ?s= share links, saved strategies
 * in localStorage, the target-date timeline and CSV export. No React here, so it is unit-tested.
 */
import {
  addTradingDays,
  calendarDaysBetween,
  isTradingDay,
  istDateString,
  normalizeExpiry,
  nowIST,
  toISTDate,
  type Leg,
} from "@/lib/options";

// ───────────────────────────── Legs ─────────────────────────────

export interface BuilderLeg extends Leg {
  id: string;
  enabled: boolean;
  /** Premium typed by the user: "refresh to LTP" leaves it alone. */
  manual?: boolean;
  /** Needs a market price (structure changed, or only a model price was available so far). */
  requote?: boolean;
}

let legCounter = 0;
export function makeLegId(): string {
  legCounter += 1;
  return `leg-${Date.now().toString(36)}-${legCounter.toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export function toBuilderLegs(legs: Leg[]): BuilderLeg[] {
  return legs.map((l) => ({ ...l, id: makeLegId(), enabled: l.enabled !== false }));
}

/** Immutable single-leg update. Returns the same array when the id is unknown. */
export function updateLegById(legs: BuilderLeg[], id: string, patch: Partial<BuilderLeg>): BuilderLeg[] {
  let hit = false;
  const next = legs.map((l) => {
    if (l.id !== id) return l;
    hit = true;
    return { ...l, ...patch, id: l.id };
  });
  return hit ? next : legs;
}

export function flipSide(leg: BuilderLeg): BuilderLeg {
  return { ...leg, side: leg.side === "BUY" ? "SELL" : "BUY" };
}

/** Shift option strikes by `dir` steps (FUT legs untouched). Only the given ids when provided. */
export function shiftStrikes(legs: BuilderLeg[], dir: number, step: number, ids?: string[]): BuilderLeg[] {
  const s = step > 0 ? step : 50;
  return legs.map((l) => {
    if (l.type === "FUT" || (ids && !ids.includes(l.id))) return l;
    const strike = Math.max(s, Math.round((l.strike + dir * s) / s) * s);
    return { ...l, strike, manual: false, requote: true };
  });
}

export function clampLots(v: number): number {
  return Number.isFinite(v) ? Math.max(1, Math.min(5000, Math.round(v))) : 1;
}

// ───────────────────────────── base64url ─────────────────────────────

export function encodeBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeBase64Url(input: string): string | null {
  try {
    const b64 = input.trim().replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const bin = atob(padded);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

// ───────────────────────────── ?legs= basket contract ─────────────────────────────

/** One leg as it arrives in ?legs= (lenient on case, aliases and numeric strings). */
export interface BasketLeg {
  symbol: string;
  expiry: string;
  strike: number;
  type: "CE" | "PE" | "FUT";
  side: "BUY" | "SELL";
  lots: number;
  premium: number;
  iv?: number;
}

const upper = (v: unknown): unknown => (typeof v === "string" ? v.trim().toUpperCase() : v);

export function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

export function isFiniteNumber(x: unknown): x is number {
  return typeof x === "number" && Number.isFinite(x);
}

/** "B", "long", "buy" → BUY; "S", "short", "sell" → SELL. */
export function readSide(v: unknown): "BUY" | "SELL" | null {
  const s = upper(v);
  if (s === "BUY" || s === "B" || s === "LONG") return "BUY";
  if (s === "SELL" || s === "S" || s === "SHORT") return "SELL";
  return null;
}

/** "call", "C", "ce" → CE; "put", "P" → PE; "future(s)", "fut" → FUT. */
export function readType(v: unknown): "CE" | "PE" | "FUT" | null {
  const s = upper(v);
  if (s === "CE" || s === "CALL" || s === "C") return "CE";
  if (s === "PE" || s === "PUT" || s === "P") return "PE";
  if (s === "FUT" || s === "FUTURE" || s === "FUTURES") return "FUT";
  return null;
}

/** Number or numeric string → finite number, else NaN. Booleans, objects and blanks are rejected. */
function toNumber(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "") return Number(v);
  return NaN;
}

/** Optional numeric field: missing → fallback; present but invalid → NaN (the leg is rejected). */
function optionalNumber(v: unknown, fallback: number | undefined): number | undefined {
  if (v === undefined || v === null) return fallback;
  return toNumber(v);
}

/** Validate one unknown ?legs= entry. Returns null for anything malformed (never throws). */
export function readBasketLeg(item: unknown): BasketLeg | null {
  if (!isRecord(item)) return null;
  const symbol = upper(item.symbol);
  if (typeof symbol !== "string" || symbol.length < 1 || symbol.length > 30) return null;
  const expiry = item.expiry;
  if (typeof expiry !== "string" || expiry.length < 1 || expiry.length > 40) return null;
  const strike = toNumber(item.strike ?? 0);
  if (!Number.isFinite(strike) || strike < 0) return null;
  const type = readType(item.type);
  const side = readSide(item.side);
  if (!type || !side) return null;
  const lots = optionalNumber(item.lots, 1) as number;
  if (!Number.isFinite(lots) || lots <= 0) return null;
  const premium = optionalNumber(item.premium, 0) as number;
  if (!Number.isFinite(premium) || premium < 0) return null;
  const iv = optionalNumber(item.iv, undefined);
  if (iv !== undefined && (!Number.isFinite(iv) || iv < 0)) return null;
  return { symbol, expiry, strike, type, side, lots, premium, iv };
}

/**
 * IV in the basket may be percent (NSE convention, 14.2) or decimal (0.142).
 * Anything above 3 is read as percent. Returns a decimal or undefined.
 */
export function normaliseIv(iv: number | undefined): number | undefined {
  if (iv === undefined || !Number.isFinite(iv) || iv <= 0) return undefined;
  return iv > 3 ? iv / 100 : iv;
}

/** Decode ?legs=<base64url(JSON array)>. Invalid entries are dropped, never thrown. */
export function parseLegsParam(param: string | null | undefined, lotSizeFor: (symbol: string, expiry: string) => number): BuilderLeg[] {
  if (!param) return [];
  const text = decodeBase64Url(param);
  if (!text) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return [];
  }
  const list = Array.isArray(raw) ? raw : raw && typeof raw === "object" && Array.isArray((raw as { legs?: unknown }).legs) ? (raw as { legs: unknown[] }).legs : [];
  const out: BuilderLeg[] = [];
  for (const item of list.slice(0, 40)) {
    const b = readBasketLeg(item);
    if (!b) continue;
    const expiry = normalizeExpiry(b.expiry);
    if (!expiry) continue;
    if (b.type !== "FUT" && !(b.strike > 0)) continue;
    out.push({
      id: makeLegId(),
      enabled: true,
      symbol: b.symbol,
      type: b.type,
      side: b.side,
      strike: b.type === "FUT" ? 0 : b.strike,
      expiry,
      lots: clampLots(b.lots),
      lotSize: lotSizeFor(b.symbol, expiry),
      premium: Math.round(b.premium * 100) / 100,
      iv: normaliseIv(b.iv),
      manual: b.premium > 0,
      requote: !(b.premium > 0),
    });
  }
  return out;
}

/** Encode legs in the shared basket shape (iv in percent, as the option chain sends it). */
export function encodeLegsParam(legs: Leg[]): string {
  const basket = legs.map((l) => ({
    symbol: l.symbol,
    expiry: l.expiry,
    strike: l.strike,
    type: l.type,
    side: l.side,
    lots: l.lots,
    premium: l.premium,
    iv: l.iv !== undefined ? Math.round(l.iv * 10000) / 100 : undefined,
  }));
  return encodeBase64Url(JSON.stringify(basket));
}

// ───────────────────────────── ?s= share links ─────────────────────────────

/** Where the prices in a share link came from when it was created. */
export type ShareSource = "live" | "sample" | "delayed";

export interface ShareState {
  symbol: string;
  name?: string;
  legs: BuilderLeg[];
  /** Epoch ms when the entry prices were captured (v2 links). */
  pricedAt?: number;
  /** Data source of those prices (v2 links). */
  source?: ShareSource;
  /** Underlying price at capture (v2 links). */
  spot?: number;
}

/**
 * Share payload. v1: { v, sym, n?, legs }. v2 adds ts (epoch ms), src and spot so a shared link opens
 * as a frozen, labelled snapshot. Each leg is [type, side, strike, expiry, lots, premium, iv|null, enabled].
 */
export function encodeShare(state: ShareState): string {
  const payload: Record<string, unknown> = {
    v: 2,
    sym: state.symbol,
    n: state.name || undefined,
    legs: state.legs.slice(0, 40).map((l) => [
      l.type,
      l.side,
      l.strike,
      l.expiry,
      l.lots,
      Math.round(l.premium * 100) / 100,
      l.iv !== undefined && Number.isFinite(l.iv) ? Math.round(l.iv * 10000) / 10000 : null,
      l.enabled ? 1 : 0,
    ]),
  };
  if (isFiniteNumber(state.pricedAt) && state.pricedAt > 0) payload.ts = Math.round(state.pricedAt);
  if (state.source) payload.src = state.source;
  if (isFiniteNumber(state.spot) && state.spot > 0) payload.spot = Math.round(state.spot * 100) / 100;
  return encodeBase64Url(JSON.stringify(payload));
}

const SHARE_SOURCES: readonly ShareSource[] = ["live", "sample", "delayed"];

function readShareLeg(raw: unknown, symbol: string, lotSizeFor: (symbol: string, expiry: string) => number): BuilderLeg | null {
  if (!Array.isArray(raw) || raw.length !== 8) return null;
  const [t, sd, strike, exp, lots, premium, iv, en] = raw as unknown[];
  const type = readType(t);
  const side = readSide(sd);
  if (!type || !side) return null;
  if (!isFiniteNumber(strike) || strike < 0) return null;
  if (typeof exp !== "string" || exp.length < 1 || exp.length > 40) return null;
  if (!isFiniteNumber(lots) || lots <= 0) return null;
  if (!isFiniteNumber(premium) || premium < 0) return null;
  if (!(iv === null || (isFiniteNumber(iv) && iv >= 0))) return null;
  if (en !== 0 && en !== 1) return null;
  if (type !== "FUT" && !(strike > 0)) return null;
  const expiry = normalizeExpiry(exp);
  if (!expiry) return null;
  const lotSize = lotSizeFor(symbol, expiry);
  return {
    id: makeLegId(),
    symbol,
    type,
    side,
    strike: type === "FUT" ? 0 : strike,
    expiry,
    lots: clampLots(lots),
    lotSize: isFiniteNumber(lotSize) && lotSize > 0 ? lotSize : 1,
    premium,
    iv: iv ?? undefined,
    enabled: en === 1,
    manual: true,
  };
}

/** Decode a ?s= share link (v1 or v2). Malformed input returns null; it never throws. */
export function decodeShare(param: string | null | undefined, lotSizeFor: (symbol: string, expiry: string) => number): ShareState | null {
  if (typeof param !== "string" || !param || param.length > 20000) return null;
  try {
    const text = decodeBase64Url(param);
    if (!text) return null;
    const raw: unknown = JSON.parse(text);
    if (!isRecord(raw) || (raw.v !== 1 && raw.v !== 2)) return null;
    const { sym, n, legs } = raw;
    if (typeof sym !== "string" || sym.trim().length < 1 || sym.length > 30) return null;
    if (n !== undefined && (typeof n !== "string" || n.length > 80)) return null;
    if (!Array.isArray(legs) || legs.length > 40) return null;
    const symbol = sym.trim().toUpperCase();
    const out: BuilderLeg[] = [];
    for (const item of legs) {
      const leg = readShareLeg(item, symbol, lotSizeFor);
      if (leg) out.push(leg);
    }
    const state: ShareState = { symbol, name: n, legs: out };
    if (raw.v === 2) {
      if (isFiniteNumber(raw.ts) && raw.ts > 0) state.pricedAt = raw.ts;
      if (typeof raw.src === "string" && (SHARE_SOURCES as readonly string[]).includes(raw.src)) state.source = raw.src as ShareSource;
      if (isFiniteNumber(raw.spot) && raw.spot > 0) state.spot = raw.spot;
    }
    return state;
  } catch {
    return null;
  }
}

// ───────────────────────────── Saved strategies ─────────────────────────────

export const SAVED_KEY = "mc_strategies_v1";

export interface SavedStrategy {
  id: string;
  name: string;
  symbol: string;
  savedAt: number;
  share: string;
}

export function isSavedStrategy(x: unknown): x is SavedStrategy {
  return (
    isRecord(x) &&
    typeof x.id === "string" &&
    typeof x.name === "string" &&
    typeof x.symbol === "string" &&
    isFiniteNumber(x.savedAt) &&
    typeof x.share === "string"
  );
}

function storage(): Storage | null {
  try {
    return typeof window !== "undefined" && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function loadSavedStrategies(): SavedStrategy[] {
  try {
    const raw = storage()?.getItem(SAVED_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isSavedStrategy).sort((a, b) => b.savedAt - a.savedAt) : [];
  } catch {
    return [];
  }
}

function writeSaved(list: SavedStrategy[]): boolean {
  try {
    const s = storage();
    if (!s) return false;
    s.setItem(SAVED_KEY, JSON.stringify(list.slice(0, 100)));
    return true;
  } catch {
    return false;
  }
}

/** Save (or overwrite by name + symbol). Returns the new list, or null when storage failed. */
export function saveStrategy(name: string, state: ShareState): SavedStrategy[] | null {
  const clean = name.trim().slice(0, 80) || "Untitled strategy";
  const list = loadSavedStrategies().filter((s) => !(s.name === clean && s.symbol === state.symbol));
  const entry: SavedStrategy = { id: makeLegId(), name: clean, symbol: state.symbol, savedAt: Date.now(), share: encodeShare({ ...state, name: clean }) };
  const next = [entry, ...list];
  return writeSaved(next) ? next : null;
}

export function deleteSavedStrategy(id: string): SavedStrategy[] {
  const next = loadSavedStrategies().filter((s) => s.id !== id);
  writeSaved(next);
  return next;
}

// ───────────────────────────── Timeline ─────────────────────────────

export interface TimePoint {
  at: Date;
  label: string;
  /** True on the expiry day (hourly points). */
  final: boolean;
}

const SESSION_HOURS = ["09:15", "10:15", "11:15", "12:15", "13:15", "14:15", "15:15"];

/**
 * Target-date timeline from now to the 15:30 IST expiry: now, each trading day's close until the day
 * before expiry, then hourly points on the expiry day and the expiry itself. Ascending, de-duplicated.
 */
export function targetTimeline(expiry: string, now: Date = new Date()): TimePoint[] {
  const exp = normalizeExpiry(expiry);
  const expiryAt = exp ? toISTDate(exp, "15:30") : null;
  if (!exp || !expiryAt || expiryAt.getTime() <= now.getTime()) return [{ at: now, label: "Now", final: true }];
  const out: TimePoint[] = [{ at: now, label: "Now", final: false }];
  const today = istDateString(now);
  let d = isTradingDay(today) ? today : addTradingDays(today, 1);
  for (let i = 0; i < 400 && d < exp; i++) {
    const close = toISTDate(d, "15:30");
    if (close.getTime() > now.getTime()) out.push({ at: close, label: `${shortDate(d)} close`, final: false });
    d = addTradingDays(d, 1);
  }
  for (const hh of SESSION_HOURS) {
    const at = toISTDate(exp, hh);
    if (at.getTime() > now.getTime()) out.push({ at, label: `Expiry day ${hh}`, final: true });
  }
  out.push({ at: expiryAt, label: "At expiry", final: true });
  return out.filter((p, i, arr) => i === 0 || p.at.getTime() > arr[i - 1].at.getTime());
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function shortDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]}` : iso;
}

/**
 * Heat-table columns: now, trading-day closes, then expiry. When there are few closes left (expiry
 * week) the expiry-day hourly points fill the gap. Sampled evenly to at most maxCols.
 */
export function heatColumns(expiry: string, now: Date = new Date(), maxCols = 10): TimePoint[] {
  const all = targetTimeline(expiry, now);
  const closes = all.filter((p) => p.label === "Now" || p.label.endsWith("close") || p.label === "At expiry");
  const tl = closes.length >= Math.min(maxCols, 6) ? closes : all;
  if (tl.length <= maxCols) return tl;
  const first = tl[0];
  const last = tl[tl.length - 1];
  const middle = tl.slice(1, -1);
  const keep = Math.max(0, maxCols - 2);
  const picked: TimePoint[] = [];
  for (let i = 0; i < keep; i++) picked.push(middle[Math.round(((i + 1) * (middle.length - 1)) / (keep + 1))]);
  return [first, ...picked.filter((p, i, arr) => arr.indexOf(p) === i), last];
}

/** "Mon 20 Oct 14:15 IST" style label for a slider value. */
export function timeLabel(d: Date): string {
  const p = nowIST(d);
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return `${days[p.weekday]} ${shortDate(p.date)}, ${String(p.hh).padStart(2, "0")}:${String(p.mm).padStart(2, "0")} IST`;
}

// ───────────────────────────── CSV ─────────────────────────────

function csvCell(v: string | number): string {
  const s = typeof v === "number" ? (Number.isFinite(v) ? String(Math.round(v * 100) / 100) : "") : v;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: Array<string | number>, rows: Array<Array<string | number>>): string {
  return [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\n");
}

// ───────────────────────────── Hotkeys ─────────────────────────────

/** True when a key event comes from a control that should keep its own keys. */
export function isTypingTarget(el: EventTarget | null): boolean {
  if (!el || typeof (el as HTMLElement).tagName !== "string") return false;
  const node = el as HTMLElement;
  const tag = node.tagName.toUpperCase();
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || tag === "BUTTON" || tag === "A") return true;
  if (node.isContentEditable) return true;
  const role = node.getAttribute?.("role") ?? "";
  return ["combobox", "slider", "switch", "tab", "menuitem", "option", "listbox", "textbox", "spinbutton", "checkbox", "radio"].includes(role);
}

// ───────────────────────────── Initial state (URL + draft) ─────────────────────────────

export type BasketMode = "replace" | "append";

export interface SharedSnapshot {
  pricedAt?: number;
  source?: ShareSource;
  spot?: number;
}

export interface InitialState {
  symbol: string;
  legs: BuilderLeg[];
  name: string;
  /** One-line toast about what came from the URL, or null. */
  message: string | null;
  /** True when the URL decided the symbol or legs (no default template). */
  fromParams: boolean;
  /** Set when the page opened from a ?s= share link: a frozen, read-only snapshot. */
  shared: SharedSnapshot | null;
  /** The draft that ?legs= replaced or extended, for "Undo (restore previous draft)". */
  previous: ShareState | null;
  /** Basket legs on other underlyings that were not loaded. */
  skipped: BuilderLeg[];
  /** Write the draft back to storage on change. False for the default template and shared snapshots. */
  persist: boolean;
}

export interface InitialInput {
  params: URLSearchParams;
  /** Decoded per-browser draft, if any. */
  draft: ShareState | null;
  /** Today's IST date (yyyy-mm-dd); expired draft legs are dropped. */
  today: string;
  lotSizeFor: (symbol: string, expiry: string) => number;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * Decide the builder's first state from the URL and the stored draft.
 *  - ?s=   opens a shared snapshot (read-only, prices frozen) and leaves the stored draft alone.
 *  - ?legs= replaces the draft by default (the old draft is kept in `previous` for undo);
 *           &mode=append adds to it when the underlying matches.
 *  - ?symbol= picks the underlying; a draft on another symbol is not loaded.
 * Basket legs on a second underlying are returned in `skipped`, never silently dropped.
 */
export function resolveInitialState({ params, draft, today, lotSizeFor }: InitialInput): InitialState {
  const symParam = (params.get("symbol") || "").trim().toUpperCase();
  const shared = decodeShare(params.get("s"), lotSizeFor);
  if (shared && shared.legs.length) {
    return {
      symbol: shared.symbol,
      legs: shared.legs,
      name: shared.name || "Shared strategy",
      message: null,
      fromParams: true,
      shared: { pricedAt: shared.pricedAt, source: shared.source, spot: shared.spot },
      previous: null,
      skipped: [],
      persist: false,
    };
  }
  const draftLegs = (draft?.legs ?? []).filter((l) => l.expiry >= today);
  let symbol = symParam || draft?.symbol || "NIFTY";
  let legs = symParam && draft && draft.symbol !== symParam ? [] : draftLegs;
  let name = legs.length ? draft?.name || "" : "";
  let message: string | null = null;
  let previous: ShareState | null = null;
  let skipped: BuilderLeg[] = [];
  const basket = parseLegsParam(params.get("legs"), lotSizeFor);
  if (basket.length) {
    const mode: BasketMode = params.get("mode") === "append" ? "append" : "replace";
    const bSym = basket[0].symbol;
    const same = basket.filter((l) => l.symbol === bSym);
    skipped = basket.filter((l) => l.symbol !== bSym);
    if (legs.length) previous = { symbol, name, legs };
    if (mode === "append" && bSym === symbol && legs.length) {
      legs = [...legs, ...same];
      message = `Added ${plural(same.length, "leg")} from your basket to your ${symbol} draft.`;
    } else {
      const crossSymbol = mode === "append" && legs.length > 0 && bSym !== symbol;
      message = crossSymbol
        ? `Loaded ${plural(same.length, "leg")} on ${bSym}. Your ${symbol} draft was replaced because a strategy uses one underlying.`
        : `Loaded ${plural(same.length, "leg")} from your basket${legs.length ? ", replacing your draft" : ""}.`;
      legs = same;
      name = "";
    }
    symbol = bSym;
  }
  return { symbol, legs, name, message, fromParams: basket.length > 0 || !!symParam, shared: null, previous, skipped, persist: legs.length > 0 };
}

/** Group skipped legs by underlying, in first-seen order. */
export function groupBySymbol(legs: BuilderLeg[]): Array<{ symbol: string; legs: BuilderLeg[] }> {
  const map = new Map<string, BuilderLeg[]>();
  for (const l of legs) map.set(l.symbol, [...(map.get(l.symbol) ?? []), l]);
  return Array.from(map, ([symbol, list]) => ({ symbol, legs: list }));
}

// ───────────────────────────── Heat-table footnote ─────────────────────────────

export type HeatColumnMode = "closes" | "hourly" | "mixed";

/** Largest calendar-day gap (IST dates) between consecutive columns. */
export function maxCalendarGap(columns: TimePoint[]): number {
  let gap = 0;
  for (let i = 1; i < columns.length; i++) {
    const d = calendarDaysBetween(istDateString(columns[i - 1].at), istDateString(columns[i].at));
    if (Number.isFinite(d)) gap = Math.max(gap, d);
  }
  return gap;
}

/** Footnote for the P&L table: what the columns are, plus a theta note across weekends and holidays. */
export function heatFootnote(columns: TimePoint[]): { mode: HeatColumnMode; columns: string; gapNote: string | null } {
  const hourly = columns.filter((c) => c.label.startsWith("Expiry day ")).length;
  const closes = columns.filter((c) => c.label.endsWith(" close")).length;
  const mode: HeatColumnMode = hourly > 0 && closes === 0 ? "hourly" : hourly > 0 ? "mixed" : "closes";
  const text =
    mode === "hourly"
      ? "Expiry day: columns are hourly points through the session (IST), ending at the 15:30 IST expiry."
      : mode === "mixed"
        ? "Columns are trading-day closes at 15:30 IST, then hourly points on expiry day."
        : "Columns are trading-day closes at 15:30 IST, then the expiry.";
  const gapNote =
    maxCalendarGap(columns) > 1
      ? "Some columns are more than one calendar day apart (a weekend or exchange holiday). Option value decays on calendar time, so those steps include the theta of the days the market is shut."
      : null;
  return { mode, columns: text, gapNote };
}
