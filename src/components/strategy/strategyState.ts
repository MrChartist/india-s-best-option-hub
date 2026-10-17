/**
 * Pure state helpers for the Strategy Builder: leg identity and immutable edits, the ?legs= basket
 * contract shared with the option chain / optimizer / calculators, ?s= share links, saved strategies
 * in localStorage, the target-date timeline and CSV export. No React here, so it is unit-tested.
 */
import { z } from "zod";
import {
  addTradingDays,
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

const upper = (v: unknown) => (typeof v === "string" ? v.trim().toUpperCase() : v);

const sideSchema = z.preprocess((v) => {
  const s = upper(v);
  if (s === "B" || s === "LONG") return "BUY";
  if (s === "S" || s === "SHORT") return "SELL";
  return s;
}, z.enum(["BUY", "SELL"]));

const typeSchema = z.preprocess((v) => {
  const s = upper(v);
  if (s === "CALL" || s === "C") return "CE";
  if (s === "PUT" || s === "P") return "PE";
  if (s === "FUTURE" || s === "FUTURES") return "FUT";
  return s;
}, z.enum(["CE", "PE", "FUT"]));

export const basketLegSchema = z.object({
  symbol: z.preprocess(upper, z.string().min(1).max(30)),
  expiry: z.string().min(1).max(40),
  strike: z.coerce.number().nonnegative().finite(),
  type: typeSchema,
  side: sideSchema,
  lots: z.coerce.number().positive().finite().optional().default(1),
  premium: z.coerce.number().nonnegative().finite().optional().default(0),
  iv: z.coerce.number().nonnegative().finite().optional(),
});

export type BasketLeg = z.infer<typeof basketLegSchema>;

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
    const parsed = basketLegSchema.safeParse(item);
    if (!parsed.success) continue;
    const b = parsed.data;
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

const shareLegSchema = z.tuple([
  typeSchema,
  sideSchema,
  z.number().nonnegative().finite(),
  z.string().min(1),
  z.number().positive().finite(),
  z.number().nonnegative().finite(),
  z.number().nonnegative().finite().nullable(),
  z.union([z.literal(0), z.literal(1)]),
]);

const sharePayloadSchema = z.object({
  v: z.literal(1),
  sym: z.string().min(1).max(30),
  n: z.string().max(80).optional(),
  legs: z.array(shareLegSchema).max(40),
});

export interface ShareState {
  symbol: string;
  name?: string;
  legs: BuilderLeg[];
}

export function encodeShare(state: ShareState): string {
  const payload = {
    v: 1 as const,
    sym: state.symbol,
    n: state.name || undefined,
    legs: state.legs.map((l) => [
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
  return encodeBase64Url(JSON.stringify(payload));
}

export function decodeShare(param: string | null | undefined, lotSizeFor: (symbol: string, expiry: string) => number): ShareState | null {
  if (!param) return null;
  const text = decodeBase64Url(param);
  if (!text) return null;
  try {
    const parsed = sharePayloadSchema.safeParse(JSON.parse(text));
    if (!parsed.success) return null;
    const { sym, n, legs } = parsed.data;
    const symbol = sym.toUpperCase();
    const out: BuilderLeg[] = [];
    for (const [type, side, strike, exp, lots, premium, iv, en] of legs) {
      const expiry = normalizeExpiry(exp);
      if (!expiry) continue;
      out.push({
        id: makeLegId(),
        symbol,
        type,
        side,
        strike: type === "FUT" ? 0 : strike,
        expiry,
        lots: clampLots(lots),
        lotSize: lotSizeFor(symbol, expiry),
        premium,
        iv: iv ?? undefined,
        enabled: en === 1,
        manual: true,
      });
    }
    return { symbol, name: n, legs: out };
  } catch {
    return null;
  }
}

// ───────────────────────────── Saved strategies ─────────────────────────────

export const SAVED_KEY = "mc_strategies_v1";

const savedSchema = z.object({
  id: z.string(),
  name: z.string(),
  symbol: z.string(),
  savedAt: z.number(),
  share: z.string(),
});

export type SavedStrategy = z.infer<typeof savedSchema>;

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
    const parsed = z.array(savedSchema).safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data.sort((a, b) => b.savedAt - a.savedAt) : [];
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
