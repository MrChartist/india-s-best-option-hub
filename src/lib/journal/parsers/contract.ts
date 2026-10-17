/**
 * Instrument parsing for Indian F&O tradebooks.
 *
 * Handles the symbol styles brokers export:
 *  - Zerodha weekly   NIFTY2610625000CE   (YY, month 1-9/O/N/D, DD, strike)
 *  - Zerodha monthly  NIFTY26OCT25000CE / NIFTY26OCTFUT   (YY, MMM; expiry = that month's monthly expiry)
 *  - Angel One        NIFTY27OCT2625000CE / NIFTY27OCT26FUT   (DD, MMM, YY)
 *  - Spaced or dashed "NIFTY 27 OCT 25000 CE", "NIFTY 27OCT2026 25000 CALL", "NIFTY-Oct2026-25000-CE"
 * Spaced labels without a year take it from the trade date (`refDate`).
 * plus separate strike / expiry / option-type columns when a tradebook has them.
 */
import { addCalendarDays, isMonthlyExpiry, isValidIsoDate, normalizeExpiry, toISTDate } from "@/lib/options";
import type { InstrumentType, ParsedContract } from "../types";

const MONTHS: Record<string, number> = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 };
const WEEKLY_MONTH: Record<string, number> = { "1": 1, "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7, "8": 8, "9": 9, O: 10, N: 11, D: 12 };

const pad = (n: number) => String(n).padStart(2, "0");

function iso(y: number, m: number, d: number): string {
  const s = `${y}-${pad(m)}-${pad(d)}`;
  return isValidIsoDate(s) ? s : "";
}

/** The monthly expiry date of a symbol in a month (last matching date), "" when none is found. */
export function monthlyExpiryOf(underlying: string, year: number, month: number): string {
  const first = iso(year, month, 1);
  if (!first) return "";
  const nextMonth = addCalendarDays(first, 31).slice(0, 7);
  for (let d = 31; d >= 1; d--) {
    const day = iso(year, month, d);
    if (day && day.slice(0, 7) !== nextMonth && isMonthlyExpiry(underlying, day)) return day;
  }
  return "";
}

function optType(t: string): InstrumentType | null {
  const u = t.toUpperCase();
  if (u === "CE" || u === "CALL" || u === "C") return "CE";
  if (u === "PE" || u === "PUT" || u === "P") return "PE";
  if (u === "FUT" || u === "FUTURES" || u === "FUTIDX" || u === "FUTSTK") return "FUT";
  return null;
}

const fullYear = (yy: string) => (yy.length === 4 ? +yy : 2000 + +yy);

export type SymbolStyle = "zerodha" | "angel" | "auto";

/**
 * Parse a compact or spaced instrument symbol. `style` breaks the one real ambiguity: Zerodha monthly
 * (YY MMM strike) and Angel (DD MMM YY strike) look alike, so the broker's own style is tried first.
 */
export function parseInstrument(raw: string, style: SymbolStyle = "auto", refDate?: string): ParsedContract | null {
  const s = (raw ?? "").trim().toUpperCase();
  if (!s) return null;
  const compact = s;

  const tryZerodhaWeekly = () => {
    const m = /^([A-Z&][A-Z0-9&-]*?)(\d{2})([1-9OND])(\d{2})(\d+(?:\.\d+)?)(CE|PE)$/.exec(compact);
    if (!m) return null;
    const exp = iso(fullYear(m[2]), WEEKLY_MONTH[m[3]], +m[4]);
    return exp ? { underlying: m[1], expiry: exp, strike: +m[5], type: m[6] as InstrumentType } : null;
  };
  const tryZerodhaMonthly = () => {
    const m = /^([A-Z&][A-Z0-9&-]*?)(\d{2})(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)(\d+(?:\.\d+)?)?(CE|PE|FUT)$/.exec(compact);
    if (!m) return null;
    if ((m[5] === "FUT") !== !m[4]) return null;
    const exp = monthlyExpiryOf(m[1], fullYear(m[2]), MONTHS[m[3]]);
    return exp ? { underlying: m[1], expiry: exp, strike: m[4] ? +m[4] : 0, type: m[5] as InstrumentType } : null;
  };
  const tryAngel = () => {
    const m = /^([A-Z&][A-Z0-9&-]*?)(\d{2})(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)(\d{2})(\d+(?:\.\d+)?)?(CE|PE|FUT)$/.exec(compact);
    if (!m) return null;
    if ((m[6] === "FUT") !== !m[5]) return null;
    const exp = iso(fullYear(m[4]), MONTHS[m[3]], +m[2]);
    return exp ? { underlying: m[1], expiry: exp, strike: m[5] ? +m[5] : 0, type: m[6] as InstrumentType } : null;
  };
  const trySpaced = () => {
    const tokens = s.split(/[\s\-_/]+/).filter(Boolean);
    if (tokens.length < 3) return null;
    const underlying = tokens[0];
    if (!/^[A-Z&][A-Z0-9&]*$/.test(underlying)) return null;
    let type: InstrumentType | null = null;
    let month = 0;
    let day = NaN;
    let year = NaN;
    let monthAt = -1;
    const nums: Array<{ i: number; v: number; raw: string }> = [];
    tokens.slice(1).forEach((t, k) => {
      const i = k + 1;
      const ot = optType(t);
      if (ot && !type) {
        type = ot;
        return;
      }
      // "OCT", "27OCT26", "OCT2026", "27OCT2026", "October"
      const glued = /^(\d{1,2})?(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*?(\d{2}|\d{4})?$/.exec(t);
      if (glued && !month) {
        month = MONTHS[glued[2]];
        monthAt = i;
        if (glued[1]) day = +glued[1];
        if (glued[3]) year = fullYear(glued[3]);
        return;
      }
      if (/^\d+(\.\d+)?$/.test(t)) nums.push({ i, v: +t, raw: t });
    });
    if (!type || !month) return null;
    const rest = nums.filter((n) => {
      if (Number.isNaN(day) && n.i === monthAt - 1 && n.v >= 1 && n.v <= 31 && Number.isInteger(n.v)) {
        day = n.v;
        return false;
      }
      if (Number.isNaN(year) && n.i === monthAt + 1 && ((n.raw.length === 4 && n.v >= 2000 && n.v <= 2100) || (n.raw.length === 2 && nums.length > 1))) {
        year = fullYear(n.raw);
        return false;
      }
      return true;
    });
    if (Number.isNaN(year)) {
      // No year in the label: use the trade date's year (next year if that expiry is already behind it).
      if (!refDate || !isValidIsoDate(refDate)) return null;
      year = +refDate.slice(0, 4);
      if (`${year}-${pad(month)}-${pad(Number.isFinite(day) ? day : 28)}` < refDate.slice(0, 8) + "01") year += 1;
    }
    const strike = rest.length ? Math.max(...rest.map((n) => n.v)) : NaN;
    const expiry = Number.isFinite(day) ? iso(year, month, day) : monthlyExpiryOf(underlying, year, month);
    if (!expiry) return null;
    if (type !== "FUT" && !(strike > 0)) return null;
    return { underlying, expiry, strike: type === "FUT" ? 0 : strike, type: type as InstrumentType };
  };

  // Compact formats only apply to a single token; spaced or dashed labels go to the token parser.
  const spaced = /[\s\-_/]/.test(s.replace(/^[A-Z&]+-[A-Z]+(?=\d)/, ""));
  const order = spaced ? [trySpaced] : style === "angel" ? [tryAngel, tryZerodhaWeekly, tryZerodhaMonthly] : [tryZerodhaWeekly, tryZerodhaMonthly, tryAngel];
  for (const f of order) {
    const r = f();
    if (r) return r;
  }
  return null;
}

/** Build a contract from separate columns (Upstox-style exports). */
export function contractFromColumns(o: { underlying?: string; expiry?: string; strike?: number; optionType?: string; instrument?: string }): ParsedContract | null {
  const underlying = (o.underlying ?? "").trim().toUpperCase().split(/\s+/)[0];
  const expiry = o.expiry ? normalizeExpiry(o.expiry) : "";
  if (!underlying || !expiry) return null;
  const instr = (o.instrument ?? "").toUpperCase();
  const type = optType(o.optionType ?? "") ?? (instr.startsWith("FUT") ? "FUT" : null);
  if (!type) return null;
  if (type !== "FUT" && !(Number(o.strike) > 0)) return null;
  return { underlying, expiry, strike: type === "FUT" ? 0 : Number(o.strike), type };
}

/**
 * IST date and epoch ms from tradebook date and time cells. Accepts ISO ("2026-10-14T10:15:22"),
 * "14-10-2026 10:15:22", "14/10/2026", "14-Oct-2026", and 12-hour times ("02:05:11 PM").
 */
export function parseDateTime(dateCell: string, timeCell?: string): { date: string; ts: number | null } | null {
  const raw = (dateCell ?? "").trim();
  if (!raw) return null;
  let datePart = raw;
  let timePart = (timeCell ?? "").trim();
  const isoMatch = /^(\d{4}-\d{2}-\d{2})[T\s](\d{1,2}:\d{2}(?::\d{2})?(?:\s*[AP]M)?)/i.exec(raw);
  const dmyTime = /^(\S+)\s+(\d{1,2}:\d{2}(?::\d{2})?(?:\s*[AP]M)?)$/i.exec(raw);
  if (isoMatch) {
    datePart = isoMatch[1];
    timePart ||= isoMatch[2];
  } else if (dmyTime) {
    datePart = dmyTime[1];
    timePart ||= dmyTime[2];
  }
  // A time cell may itself carry a date ("2026-10-14 10:15:22").
  const tInner = /(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AP]M)?/i.exec(timePart);
  const date = /^\d{1,2}[/-]\d{1,2}[/-]\d{4}$/.test(datePart) ? dmyToIso(datePart) : normalizeExpiry(datePart);
  if (!date) return null;
  if (!tInner) return { date, ts: null };
  let hh = +tInner[1];
  const mm = +tInner[2];
  const ss = tInner[3] ? +tInner[3] : 0;
  const ap = tInner[4]?.toUpperCase();
  if (ap === "PM" && hh < 12) hh += 12;
  if (ap === "AM" && hh === 12) hh = 0;
  if (hh > 23 || mm > 59 || ss > 59) return { date, ts: null };
  const base = toISTDate(date, `${pad(hh)}:${pad(mm)}`).getTime();
  return { date, ts: Number.isFinite(base) ? base + ss * 1000 : null };
}

function dmyToIso(s: string): string {
  const m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(s);
  return m ? iso(+m[3], +m[2], +m[1]) : "";
}
