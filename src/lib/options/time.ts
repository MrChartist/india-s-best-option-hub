/**
 * IST clock and NSE/BSE trading calendar.
 *
 * IST is UTC+05:30 with no daylight saving. Calendar dates are handled as ISO
 * strings (yyyy-mm-dd) to avoid browser time-zone leaks.
 */
import type { Exchange } from "./types";

export type MarketSession = "pre-open" | "open" | "closing" | "closed" | "holiday" | "weekend";

const IST_OFFSET_MIN = 330;
const MS_PER_MIN = 60_000;
const MS_PER_DAY = 86_400_000;
export const MINUTES_PER_YEAR = 365 * 24 * 60;
export const TRADING_MINUTES_PER_DAY = 375; // 09:15 – 15:30
export const TRADING_DAYS_PER_YEAR = 252;

/** Session boundaries in minutes after midnight IST. */
export const SESSION_TIMES = {
  preOpen: 9 * 60,
  preOpenEnd: 9 * 60 + 8,
  open: 9 * 60 + 15,
  close: 15 * 60 + 30,
  closingStart: 15 * 60 + 40,
  closingEnd: 16 * 60,
} as const;

/**
 * NSE equity / F&O trading holidays (weekdays only). BSE follows the same list.
 * 2025 and 2026 follow the exchange circulars; 2027 is PROVISIONAL (estimated
 * festival dates) and must be replaced once the exchange publishes its list.
 * verify: true
 */
export const NSE_HOLIDAYS: Record<number, string[]> = {
  2025: [
    "2025-02-26", // Mahashivratri
    "2025-03-14", // Holi
    "2025-03-31", // Id-ul-Fitr
    "2025-04-10", // Shri Mahavir Jayanti
    "2025-04-14", // Dr. Baba Saheb Ambedkar Jayanti
    "2025-04-18", // Good Friday
    "2025-05-01", // Maharashtra Day
    "2025-08-15", // Independence Day
    "2025-08-27", // Ganesh Chaturthi
    "2025-10-02", // Gandhi Jayanti / Dussehra
    "2025-10-21", // Diwali Laxmi Pujan (muhurat session only)
    "2025-10-22", // Diwali Balipratipada
    "2025-11-05", // Prakash Gurpurb Sri Guru Nanak Dev
    "2025-12-25", // Christmas
  ],
  2026: [
    "2026-01-15", // Municipal corporation elections (Maharashtra)
    "2026-01-26", // Republic Day
    "2026-03-03", // Holi
    "2026-03-26", // Shri Ram Navami
    "2026-03-31", // Shri Mahavir Jayanti
    "2026-04-03", // Good Friday
    "2026-04-14", // Dr. Baba Saheb Ambedkar Jayanti
    "2026-05-01", // Maharashtra Day
    "2026-05-28", // Bakri Id
    "2026-06-26", // Muharram
    "2026-09-14", // Ganesh Chaturthi
    "2026-10-02", // Mahatma Gandhi Jayanti
    "2026-10-20", // Dussehra
    "2026-11-10", // Diwali Balipratipada
    "2026-11-24", // Prakash Gurpurb Sri Guru Nanak Dev
    "2026-12-25", // Christmas
  ],
  2027: [
    // PROVISIONAL — estimated, not from an exchange circular
    "2027-01-26",
    "2027-03-10",
    "2027-03-22",
    "2027-03-26",
    "2027-04-14",
    "2027-04-15",
    "2027-05-17",
    "2027-06-15",
    "2027-10-29",
  ],
};

/** Years whose holiday list is provisional. */
export const PROVISIONAL_HOLIDAY_YEARS: readonly number[] = [2027];

const holidaySet = new Set<string>(Object.values(NSE_HOLIDAYS).flat());

// ---------- low-level ISO date arithmetic (UTC-based, no local TZ) ----------

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseIso(iso: string): { y: number; m: number; d: number } | null {
  const m = ISO_RE.exec(iso ?? "");
  if (!m) return null;
  const y = +m[1];
  const mo = +m[2];
  const d = +m[3];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return { y, m: mo, d };
}

function isoToDayNum(iso: string): number {
  const p = parseIso(iso);
  return p ? Date.UTC(p.y, p.m - 1, p.d) / MS_PER_DAY : NaN;
}

function dayNumToIso(n: number): string {
  const dt = new Date(n * MS_PER_DAY);
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(dt.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Add calendar days to an ISO date. */
export function addCalendarDays(iso: string, n: number): string {
  const dn = isoToDayNum(iso);
  return Number.isNaN(dn) ? "" : dayNumToIso(dn + Math.trunc(n));
}

/** Weekday of an ISO date, 0 = Sunday. NaN for invalid input. */
export function isoWeekday(iso: string): number {
  const dn = isoToDayNum(iso);
  if (Number.isNaN(dn)) return NaN;
  return (((dn + 4) % 7) + 7) % 7; // 1970-01-01 was a Thursday
}

/** Calendar days from a to b (b - a). */
export function calendarDaysBetween(fromIso: string, toIso: string): number {
  return isoToDayNum(toIso) - isoToDayNum(fromIso);
}

export function isValidIsoDate(iso: string): boolean {
  return parseIso(iso) !== null;
}

// ---------- IST clock ----------

let istFormatter: Intl.DateTimeFormat | null = null;
function getIstFormatter(): Intl.DateTimeFormat {
  if (!istFormatter) {
    istFormatter = new Intl.DateTimeFormat("en-IN", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
  }
  return istFormatter;
}

const WEEKDAY_FROM_ISO = (iso: string) => isoWeekday(iso);

/** Current wall-clock parts in IST. */
export function nowIST(now: Date = new Date()): { date: string; hh: number; mm: number; ss: number; weekday: number } {
  const t = now instanceof Date ? now.getTime() : NaN;
  if (!Number.isFinite(t)) return { date: "", hh: NaN, mm: NaN, ss: NaN, weekday: NaN };
  let y = 0;
  let mo = 0;
  let d = 0;
  let hh = 0;
  let mm = 0;
  let ss = 0;
  try {
    for (const part of getIstFormatter().formatToParts(now)) {
      const v = Number(part.value);
      switch (part.type) {
        case "year": y = v; break;
        case "month": mo = v; break;
        case "day": d = v; break;
        case "hour": hh = v % 24; break;
        case "minute": mm = v; break;
        case "second": ss = v; break;
        default: break;
      }
    }
  } catch {
    y = 0;
  }
  if (!y) {
    // Fallback: fixed +05:30 offset (IST has no DST)
    const shifted = new Date(t + IST_OFFSET_MIN * MS_PER_MIN);
    y = shifted.getUTCFullYear();
    mo = shifted.getUTCMonth() + 1;
    d = shifted.getUTCDate();
    hh = shifted.getUTCHours();
    mm = shifted.getUTCMinutes();
    ss = shifted.getUTCSeconds();
  }
  const date = `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return { date, hh, mm, ss, weekday: WEEKDAY_FROM_ISO(date) };
}

/** Today's date in IST as yyyy-mm-dd. */
export function istDateString(d: Date = new Date()): string {
  return nowIST(d).date;
}

/** The absolute instant for an IST calendar date and time (default 15:30). Invalid Date on bad input. */
export function toISTDate(isoDate: string, hhmm = "15:30"): Date {
  const p = parseIso(isoDate);
  const tm = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(hhmm ?? "");
  if (!p || !tm) return new Date(NaN);
  const utc = Date.UTC(p.y, p.m - 1, p.d, +tm[1], +tm[2], tm[3] ? +tm[3] : 0) - IST_OFFSET_MIN * MS_PER_MIN;
  return new Date(utc);
}

// ---------- trading calendar ----------

export function isHoliday(isoDate: string, _exchange: Exchange = "NSE"): boolean {
  return holidaySet.has(isoDate);
}

export function isTradingDay(isoDate: string, exchange: Exchange = "NSE"): boolean {
  const wd = isoWeekday(isoDate);
  if (Number.isNaN(wd) || wd === 0 || wd === 6) return false;
  return !isHoliday(isoDate, exchange);
}

/** The trading day on or before isoDate. */
export function tradingDayOnOrBefore(isoDate: string, exchange: Exchange = "NSE"): string {
  if (!isValidIsoDate(isoDate)) return "";
  let d = isoDate;
  for (let i = 0; i < 30 && !isTradingDay(d, exchange); i++) d = addCalendarDays(d, -1);
  return d;
}

/** The trading day strictly before isoDate. */
export function previousTradingDay(isoDate: string, exchange: Exchange = "NSE"): string {
  if (!isValidIsoDate(isoDate)) return "";
  return tradingDayOnOrBefore(addCalendarDays(isoDate, -1), exchange);
}

/** The trading day strictly after isoDate. */
export function nextTradingDay(isoDate: string, exchange: Exchange = "NSE"): string {
  if (!isValidIsoDate(isoDate)) return "";
  let d = addCalendarDays(isoDate, 1);
  for (let i = 0; i < 30 && !isTradingDay(d, exchange); i++) d = addCalendarDays(d, 1);
  return d;
}

/** Move n trading days forward (n > 0) or backward (n < 0). n = 0 returns the date itself. */
export function addTradingDays(isoDate: string, n: number, exchange: Exchange = "NSE"): string {
  if (!isValidIsoDate(isoDate) || !Number.isFinite(n)) return "";
  let d = isoDate;
  const steps = Math.abs(Math.trunc(n));
  for (let i = 0; i < steps; i++) d = n > 0 ? nextTradingDay(d, exchange) : previousTradingDay(d, exchange);
  return d;
}

/**
 * Trading days in (from, to] — i.e. sessions left after `from` up to and including `to`.
 * Negative when to < from. NaN for invalid input.
 */
export function tradingDaysBetween(fromIso: string, toIso: string, exchange: Exchange = "NSE"): number {
  const a = isoToDayNum(fromIso);
  const b = isoToDayNum(toIso);
  if (Number.isNaN(a) || Number.isNaN(b)) return NaN;
  if (a === b) return 0;
  const sign = b > a ? 1 : -1;
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  let count = 0;
  for (let dn = lo + 1; dn <= hi; dn++) if (isTradingDay(dayNumToIso(dn), exchange)) count++;
  return sign * count;
}

export function getMarketSession(now: Date = new Date(), exchange: Exchange = "NSE"): MarketSession {
  const { date, hh, mm, weekday } = nowIST(now);
  if (!date) return "closed";
  if (weekday === 0 || weekday === 6) return "weekend";
  if (isHoliday(date, exchange)) return "holiday";
  const t = hh * 60 + mm;
  if (t >= SESSION_TIMES.preOpen && t < SESSION_TIMES.open) return "pre-open";
  if (t >= SESSION_TIMES.open && t < SESSION_TIMES.close) return "open";
  if (t >= SESSION_TIMES.closingStart && t < SESSION_TIMES.closingEnd) return "closing";
  return "closed";
}

/** "2h 10m", "45m", "3d 4h". */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms)) return "—";
  const totalMin = Math.max(0, Math.ceil(ms / MS_PER_MIN));
  const d = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  const m = totalMin % 60;
  if (d > 0) return h > 0 ? `${d}d ${h}h` : `${d}d`;
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  return `${m}m`;
}

/** Next market open or close from now. */
export function nextSessionChange(now: Date = new Date()): { session: MarketSession; at: Date; label: string } {
  const t0 = now instanceof Date ? now.getTime() : NaN;
  if (!Number.isFinite(t0)) return { session: "closed", at: new Date(NaN), label: "—" };
  const session = getMarketSession(now);
  const { date } = nowIST(now);
  if (session === "open") {
    const at = toISTDate(date, "15:30");
    return { session: "closed", at, label: `Closes in ${formatDuration(at.getTime() - t0)}` };
  }
  let openDate: string;
  const todayOpen = toISTDate(date, "09:15");
  if (isTradingDay(date) && t0 < todayOpen.getTime()) openDate = date;
  else openDate = nextTradingDay(date);
  const at = toISTDate(openDate, "09:15");
  return { session: "open", at, label: `Opens in ${formatDuration(at.getTime() - t0)}` };
}

/**
 * Years to expiry, measured to 15:30 IST on the expiry date with minute precision.
 * Returns 0 once the contract has expired; while live it never falls below one minute.
 * mode "trading" counts only trading-session minutes (375 per day, 252 days a year).
 */
export function timeToExpiryYears(expiryIso: string, now: Date = new Date(), opts?: { mode?: "calendar" | "trading" }): number {
  const iso = isValidIsoDate(expiryIso) ? expiryIso : normalizeExpiry(expiryIso);
  if (!iso) return NaN;
  const t0 = now instanceof Date ? now.getTime() : NaN;
  if (!Number.isFinite(t0)) return NaN;
  const expiryAt = toISTDate(iso, "15:30").getTime();
  if (t0 >= expiryAt) return 0;
  if (opts?.mode === "trading") {
    const { date, hh, mm } = nowIST(now);
    let minutes = 0;
    if (isTradingDay(date)) {
      const t = hh * 60 + mm;
      minutes += Math.max(0, SESSION_TIMES.close - Math.max(t, SESSION_TIMES.open));
    }
    minutes += Math.max(0, tradingDaysBetween(date, iso)) * TRADING_MINUTES_PER_DAY;
    return Math.max(minutes, 1) / (TRADING_DAYS_PER_YEAR * TRADING_MINUTES_PER_DAY);
  }
  const minutes = Math.floor((expiryAt - t0) / MS_PER_MIN);
  return Math.max(minutes, 1) / MINUTES_PER_YEAR;
}

/** "Expiry today · 3h 12m" | "2d 4h" | "12 days" | "Expired". */
export function dteLabel(expiryIso: string, now: Date = new Date()): string {
  const iso = isValidIsoDate(expiryIso) ? expiryIso : normalizeExpiry(expiryIso);
  if (!iso) return "—";
  const t0 = now instanceof Date ? now.getTime() : NaN;
  const expiryAt = toISTDate(iso, "15:30").getTime();
  if (!Number.isFinite(t0)) return "—";
  if (t0 >= expiryAt) return "Expired";
  const today = nowIST(now).date;
  const left = expiryAt - t0;
  if (today === iso) return `Expiry today · ${formatDuration(left)}`;
  const days = calendarDaysBetween(today, iso);
  if (days < 7) return formatDuration(left);
  return `${days} days`;
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
  january: 1, february: 2, march: 3, april: 4, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

function mkIso(y: number, m: number, d: number): string {
  const iso = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return isValidIsoDate(iso) ? iso : "";
}

function fullYear(y: string): number {
  const n = Number(y);
  return y.length === 2 ? 2000 + n : n;
}

/**
 * Normalise common expiry formats to ISO yyyy-mm-dd.
 * Accepts "2026-10-20", "2026-10-20T…", "20-Oct-2026", "20 Oct 2026", "20OCT26", "Oct 20, 2026",
 * "20/10/2026", "20-10-2026" and "20 Oct" (year inferred: this year, or next year if that date is
 * more than 60 days in the past). Returns "" when unparseable.
 */
export function normalizeExpiry(input: string, now: Date = new Date()): string {
  if (typeof input !== "string") return "";
  const s = input.trim();
  if (!s) return "";
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/.exec(s);
  if (m) return mkIso(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[\s\-/.]?([A-Za-z]{3,9})[\s\-/.,]*(\d{2}|\d{4})?$/.exec(s);
  if (m) {
    const mo = MONTHS[m[2].toLowerCase()];
    if (!mo) return "";
    const day = +m[1];
    if (m[3]) return mkIso(fullYear(m[3]), mo, day);
    const today = nowIST(now).date || "2026-01-01";
    const y = +today.slice(0, 4);
    const candidate = mkIso(y, mo, day);
    if (!candidate) return "";
    return calendarDaysBetween(candidate, today) > 60 ? mkIso(y + 1, mo, day) : candidate;
  }
  m = /^([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})$/.exec(s);
  if (m) {
    const mo = MONTHS[m[1].toLowerCase()];
    return mo ? mkIso(+m[3], mo, +m[2]) : "";
  }
  m = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/.exec(s);
  if (m) return mkIso(+m[3], +m[2], +m[1]);
  return "";
}
