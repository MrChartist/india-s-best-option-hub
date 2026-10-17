/**
 * Calendar assembly: exchange holidays and expiries from the @/lib/options time engine, NSE
 * corporate events (results, dividends, board meetings) normalised from the proxy, a labelled
 * sample results season, plus merging, filtering, month grids and page links.
 */
import {
  CONTRACT_SPECS,
  NSE_HOLIDAYS,
  PROVISIONAL_HOLIDAY_YEARS,
  addCalendarDays,
  calendarDaysBetween,
  getContractSpec,
  getExpiries,
  isTradingDay,
  isValidIsoDate,
  isoWeekday,
  mulberry32,
  nextTradingDay,
  sampleSeed,
  toISTDate,
} from "@/lib/options";
import { fiscalQuarterLabel, macroEvents, weekdayOnOrAfter } from "./macro";
import type { EventKind, EventRange, MarketEvent, NseEventCalendarRow } from "./types";

// ── Holidays and special sessions ─────────────────────────────────────────

/** Names for the exchange holiday dates in @/lib/options (NSE and BSE share the list). */
const HOLIDAY_NAMES: Record<string, string> = {
  "2025-02-26": "Mahashivratri",
  "2025-03-14": "Holi",
  "2025-03-31": "Id-ul-Fitr",
  "2025-04-10": "Shri Mahavir Jayanti",
  "2025-04-14": "Dr. Baba Saheb Ambedkar Jayanti",
  "2025-04-18": "Good Friday",
  "2025-05-01": "Maharashtra Day",
  "2025-08-15": "Independence Day",
  "2025-08-27": "Ganesh Chaturthi",
  "2025-10-02": "Mahatma Gandhi Jayanti / Dussehra",
  "2025-10-21": "Diwali Laxmi Pujan",
  "2025-10-22": "Diwali Balipratipada",
  "2025-11-05": "Prakash Gurpurb Sri Guru Nanak Dev",
  "2025-12-25": "Christmas",
  "2026-01-15": "Municipal corporation elections (Maharashtra)",
  "2026-01-26": "Republic Day",
  "2026-03-03": "Holi",
  "2026-03-26": "Shri Ram Navami",
  "2026-03-31": "Shri Mahavir Jayanti",
  "2026-04-03": "Good Friday",
  "2026-04-14": "Dr. Baba Saheb Ambedkar Jayanti",
  "2026-05-01": "Maharashtra Day",
  "2026-05-28": "Bakri Id",
  "2026-06-26": "Muharram",
  "2026-09-14": "Ganesh Chaturthi",
  "2026-10-02": "Mahatma Gandhi Jayanti",
  "2026-10-20": "Dussehra",
  "2026-11-10": "Diwali Balipratipada",
  "2026-11-24": "Prakash Gurpurb Sri Guru Nanak Dev",
  "2026-12-25": "Christmas",
};

/** Special weekend sessions announced (or expected) by the exchanges. verify: true */
const SPECIAL_SESSIONS: Array<{ date: string; time?: string; title: string; detail: string }> = [
  { date: "2026-02-01", time: "09:15", title: "Special session: Budget day", detail: "Full trading session on a Sunday for the Union Budget." },
  { date: "2026-11-08", time: "18:00", title: "Muhurat trading (Diwali)", detail: "One-hour evening session for Diwali Laxmi Pujan. Timing is announced by the exchanges a few weeks before." },
];

/** Exchange holidays (and special sessions) in [from, to], from the @/lib/options holiday table. */
export function holidayEvents(range: EventRange): MarketEvent[] {
  const out: MarketEvent[] = [];
  for (const [yearStr, dates] of Object.entries(NSE_HOLIDAYS)) {
    const provisional = PROVISIONAL_HOLIDAY_YEARS.includes(+yearStr);
    for (const date of dates) {
      if (date < range.from || date > range.to) continue;
      const name = HOLIDAY_NAMES[date];
      out.push({
        id: `holiday:${date}:nse`,
        date,
        kind: "holiday",
        category: "Trading holiday",
        title: name ? `Market holiday: ${name}` : "Market holiday",
        detail: provisional
          ? "NSE and BSE closed (provisional date: the exchanges have not published this year's list yet)."
          : "NSE and BSE closed for equity, F&O and currency derivatives. Expiries falling today move to the previous trading day.",
        impact: "medium",
        region: "IN",
        source: "exchange-calendar",
        provisional: provisional || undefined,
        verify: provisional || undefined,
        marketWide: true,
      });
    }
  }
  for (const s of SPECIAL_SESSIONS) {
    if (s.date < range.from || s.date > range.to) continue;
    out.push({
      id: `holiday:${s.date}:special`,
      date: s.date,
      time: s.time,
      kind: "holiday",
      category: "Special session",
      title: s.title,
      detail: s.detail,
      impact: "low",
      region: "IN",
      source: "schedule",
      verify: true,
      marketWide: true,
    });
  }
  return out;
}

// ── Expiries ──────────────────────────────────────────────────────────────

const NSE_MONTHLY_SYMBOLS = ["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "NIFTYNXT50"];

function expiriesInRange(symbol: string, range: EventRange): Array<{ date: string; type: "weekly" | "monthly" }> {
  const days = calendarDaysBetween(range.from, range.to);
  if (!Number.isFinite(days) || days < 0) return [];
  const count = Math.min(120, Math.ceil(days / 7) + 3);
  return getExpiries(symbol, toISTDate(range.from, "00:00"), count).filter((e) => e.date >= range.from && e.date <= range.to);
}

/** Index and stock expiries in [from, to] under the SEBI rules in @/lib/options (holiday shifts included). */
export function expiryEvents(range: EventRange): MarketEvent[] {
  const out: MarketEvent[] = [];
  const nseMonthly = new Set(expiriesInRange("BANKNIFTY", range).map((e) => e.date));
  for (const date of nseMonthly) {
    out.push({
      id: `expiry:${date}:nse-monthly`,
      date,
      time: "15:30",
      kind: "expiry",
      category: "Monthly expiry",
      title: "NSE monthly F&O expiry",
      detail: "NIFTY, BANKNIFTY, FINNIFTY, MIDCPNIFTY, NIFTYNXT50 and every stock future and option expire at 15:30 IST.",
      symbol: "NIFTY",
      symbols: NSE_MONTHLY_SYMBOLS,
      impact: "high",
      region: "IN",
      source: "exchange-calendar",
      marketWide: true,
    });
  }
  for (const e of expiriesInRange("NIFTY", range)) {
    if (nseMonthly.has(e.date)) continue;
    out.push({
      id: `expiry:${e.date}:nifty-weekly`,
      date: e.date,
      time: "15:30",
      kind: "expiry",
      category: "Weekly expiry",
      title: "NIFTY weekly expiry",
      detail: "NIFTY weekly options expire at 15:30 IST.",
      symbol: "NIFTY",
      impact: "medium",
      region: "IN",
      source: "exchange-calendar",
    });
  }
  const bseMonthly = new Set(expiriesInRange("BANKEX", range).map((e) => e.date));
  for (const e of expiriesInRange("SENSEX", range)) {
    const monthly = e.type === "monthly" || bseMonthly.has(e.date);
    out.push({
      id: `expiry:${e.date}:${monthly ? "bse-monthly" : "sensex-weekly"}`,
      date: e.date,
      time: "15:30",
      kind: "expiry",
      category: monthly ? "Monthly expiry" : "Weekly expiry",
      title: monthly ? "BSE monthly expiry (SENSEX, BANKEX)" : "SENSEX weekly expiry",
      detail: monthly ? "SENSEX and BANKEX monthly contracts expire at 15:30 IST on BSE." : "SENSEX weekly options expire at 15:30 IST on BSE.",
      symbol: "SENSEX",
      symbols: monthly ? ["SENSEX", "BANKEX"] : undefined,
      impact: monthly ? "medium" : "low",
      region: "IN",
      source: "exchange-calendar",
    });
  }
  for (const date of bseMonthly) {
    if (out.some((x) => x.date === date && x.symbol === "SENSEX")) continue;
    out.push({
      id: `expiry:${date}:bankex-monthly`,
      date,
      time: "15:30",
      kind: "expiry",
      category: "Monthly expiry",
      title: "BANKEX monthly expiry",
      detail: "BANKEX monthly contracts expire at 15:30 IST on BSE.",
      symbol: "BANKEX",
      impact: "low",
      region: "IN",
      source: "exchange-calendar",
    });
  }
  return out;
}

// ── Corporate events (results) ────────────────────────────────────────────

/** True when the symbol has stock options in the contract table. */
export function isFnoStock(symbol: string | undefined): boolean {
  return !!symbol && getContractSpec(symbol)?.kind === "STOCK";
}

/** "Q2 FY27": the latest quarter completed before a results date. */
export function resultsQuarterFor(dateIso: string): string {
  const y = +dateIso.slice(0, 4);
  const m = +dateIso.slice(5, 7);
  const qEndMonth = Math.floor((m - 1) / 3) * 3;
  return qEndMonth === 0 ? fiscalQuarterLabel(y - 1, 12) : fiscalQuarterLabel(y, qEndMonth);
}

const RESULTS_RE = /result/i;

function cleanPurpose(p: string): string {
  return p.replace(/\s+/g, " ").trim();
}

/** Normalise the proxy's NSE event-calendar rows into events (results vs other corporate actions), de-duplicated. */
export function normaliseCalendarRows(rows: unknown): MarketEvent[] {
  if (!Array.isArray(rows)) return [];
  const seen = new Map<string, MarketEvent>();
  for (const raw of rows as Partial<NseEventCalendarRow>[]) {
    if (!raw || typeof raw !== "object") continue;
    const symbol = String(raw.symbol ?? "").trim().toUpperCase();
    const date = String(raw.date ?? "").trim();
    if (!symbol || !isValidIsoDate(date)) continue;
    const purpose = cleanPurpose(String(raw.purpose ?? "")) || "Board meeting";
    const company = String(raw.company ?? "").trim() || undefined;
    const description = cleanPurpose(String(raw.description ?? ""));
    const results = RESULTS_RE.test(purpose) || (purpose === "Board meeting" && RESULTS_RE.test(description));
    const fno = isFnoStock(symbol);
    const kind: EventKind = results ? "results" : "corporate";
    const id = `${kind}:${date}:${symbol}`;
    const prev = seen.get(id);
    if (prev) {
      if (!prev.detail?.includes(purpose)) prev.detail = `${prev.detail ?? ""}${prev.detail ? " · " : ""}${purpose}`;
      continue;
    }
    seen.set(id, {
      id,
      date,
      kind,
      category: results ? "Results" : purpose.split("/")[0].trim() || "Board meeting",
      title: results ? `${symbol} ${resultsQuarterFor(date)} results` : `${symbol}: ${purpose}`,
      detail: description ? description.slice(0, 280) : purpose,
      symbol,
      company,
      impact: results ? (fno ? "high" : "medium") : "low",
      region: "IN",
      source: "nse",
      fno,
    });
  }
  return [...seen.values()];
}

// ── Sample results season ─────────────────────────────────────────────────

/** Typical Indian results seasons (month-day windows) by quarter-end month. */
const SEASONS: Array<{ qEnd: number; start: string; end: string; yearOffset: number }> = [
  { qEnd: 3, start: "04-12", end: "05-20", yearOffset: 0 },
  { qEnd: 6, start: "07-10", end: "08-13", yearOffset: 0 },
  { qEnd: 9, start: "10-09", end: "11-13", yearOffset: 0 },
  { qEnd: 12, start: "01-10", end: "02-13", yearOffset: 1 },
];

/** F&O stocks in the contract table, alphabetical. */
export function fnoStocks(): string[] {
  return Object.values(CONTRACT_SPECS)
    .filter((s) => s.kind === "STOCK")
    .map((s) => s.symbol)
    .sort();
}

/**
 * SAMPLE results dates for every F&O stock in the contract table, spread through each typical
 * results season that overlaps the range. Deterministic; always `source: "sample"` and labelled as
 * illustrative, never the company's announced date.
 */
export function sampleResultsEvents(range: EventRange): MarketEvent[] {
  if (!isValidIsoDate(range.from) || !isValidIsoDate(range.to) || range.to < range.from) return [];
  const out: MarketEvent[] = [];
  const stocks = fnoStocks();
  const y0 = +range.from.slice(0, 4) - 1;
  const y1 = +range.to.slice(0, 4);
  for (let qy = y0; qy <= y1; qy++) {
    for (const s of SEASONS) {
      const y = qy + s.yearOffset;
      const start = `${y}-${s.start}`;
      const end = `${y}-${s.end}`;
      if (end < range.from || start > range.to) continue;
      const span = calendarDaysBetween(start, end);
      const quarter = fiscalQuarterLabel(qy, s.qEnd);
      for (const symbol of stocks) {
        const rand = mulberry32(sampleSeed(symbol, `${qy}-${s.qEnd}`, 4_211));
        let date = weekdayOnOrAfter(addCalendarDays(start, Math.floor(rand() * (span + 1))));
        if (date > end) date = addCalendarDays(end, isoWeekday(end) === 0 ? -2 : isoWeekday(end) === 6 ? -1 : 0);
        if (date < range.from || date > range.to) continue;
        const name = getContractSpec(symbol)?.name;
        out.push({
          id: `results:${date}:${symbol}`,
          date,
          kind: "results",
          category: "Results",
          title: `${symbol} ${quarter} results`,
          detail: "Sample date for illustration, not the company's announced board-meeting date.",
          symbol,
          company: name,
          impact: "high",
          region: "IN",
          source: "sample",
          fno: true,
        });
      }
    }
  }
  return out;
}

// ── Merge, filter, group ──────────────────────────────────────────────────

const KIND_ORDER: Record<EventKind, number> = { holiday: 0, "india-macro": 1, "global-macro": 2, expiry: 3, results: 4, corporate: 5 };
const IMPACT_ORDER = { high: 0, medium: 1, low: 2 } as const;

export function compareEvents(a: MarketEvent, b: MarketEvent): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  const ka = KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
  if (a.kind !== b.kind && (a.kind === "holiday" || b.kind === "holiday")) return ka;
  const ta = a.time ?? "99:99";
  const tb = b.time ?? "99:99";
  if (ta !== tb) return ta < tb ? -1 : 1;
  if (ka !== 0) return ka;
  const ia = IMPACT_ORDER[a.impact] - IMPACT_ORDER[b.impact];
  if (ia !== 0) return ia;
  return a.title.localeCompare(b.title);
}

/** Concatenate event lists, drop duplicate ids (first wins) and sort. */
export function mergeEvents(...lists: MarketEvent[][]): MarketEvent[] {
  const seen = new Set<string>();
  const out: MarketEvent[] = [];
  for (const list of lists) {
    for (const e of list) {
      if (!e || seen.has(e.id)) continue;
      seen.add(e.id);
      out.push(e);
    }
  }
  return out.sort(compareEvents);
}

/** Every static (non-network) event in the range: macro schedule, holidays, expiries. */
export function staticEvents(range: EventRange): MarketEvent[] {
  if (!isValidIsoDate(range.from) || !isValidIsoDate(range.to) || range.to < range.from) return [];
  return mergeEvents(macroEvents(range), holidayEvents(range), expiryEvents(range));
}

export interface EventFilter {
  kinds?: ReadonlySet<EventKind> | readonly EventKind[];
  /** Keep events for this underlying, plus market-wide ones. */
  symbol?: string;
  /** Drop results and corporate actions for stocks without options. */
  fnoOnly?: boolean;
  highImpactOnly?: boolean;
}

/** True when the event is about this symbol (directly or as one of several underlyings). */
export function eventMatchesSymbol(e: MarketEvent, symbol: string): boolean {
  const s = symbol.trim().toUpperCase();
  if (!s) return true;
  return e.symbol === s || (e.symbols?.includes(s) ?? false);
}

export function filterEvents(events: MarketEvent[], f: EventFilter): MarketEvent[] {
  const kinds = f.kinds ? new Set(f.kinds) : null;
  const sym = (f.symbol ?? "").trim().toUpperCase();
  return events.filter((e) => {
    if (kinds && !kinds.has(e.kind)) return false;
    if (f.highImpactOnly && e.impact !== "high") return false;
    if (f.fnoOnly && (e.kind === "results" || e.kind === "corporate") && !e.fno) return false;
    if (sym && !eventMatchesSymbol(e, sym) && !e.marketWide) return false;
    return true;
  });
}

/** Events grouped by date, in date order. */
export function groupByDate(events: MarketEvent[]): Array<{ date: string; events: MarketEvent[] }> {
  const map = new Map<string, MarketEvent[]>();
  for (const e of [...events].sort(compareEvents)) {
    const list = map.get(e.date);
    if (list) list.push(e);
    else map.set(e.date, [e]);
  }
  return [...map.entries()].map(([date, evs]) => ({ date, events: evs }));
}

// ── Calendar ranges ───────────────────────────────────────────────────────

const pad = (n: number) => String(n).padStart(2, "0");

/** "2026-10" for an ISO date. */
export function monthKey(dateIso: string): string {
  return dateIso.slice(0, 7);
}

export function isValidMonthKey(ym: string | null | undefined): ym is string {
  return !!ym && /^\d{4}-(0[1-9]|1[0-2])$/.test(ym);
}

/** First and last day of a month ("2026-10"). */
export function monthRange(ym: string): EventRange {
  const y = +ym.slice(0, 4);
  const m = +ym.slice(5, 7);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${ym}-01`, to: `${ym}-${pad(last)}` };
}

/** Shift a month key by n months. */
export function shiftMonth(ym: string, n: number): string {
  const total = +ym.slice(0, 4) * 12 + (+ym.slice(5, 7) - 1) + n;
  return `${Math.floor(total / 12)}-${pad((total % 12) + 1)}`;
}

/** Monday–Sunday of the week containing a date. */
export function weekRange(dateIso: string): EventRange {
  const wd = isoWeekday(dateIso);
  const back = wd === 0 ? 6 : wd - 1;
  const from = addCalendarDays(dateIso, -back);
  return { from, to: addCalendarDays(from, 6) };
}

export interface MonthCell {
  date: string;
  inMonth: boolean;
  weekend: boolean;
  trading: boolean;
}

/** Monday-first weeks covering a month (4–6 rows of 7 cells). */
export function monthGrid(ym: string): MonthCell[][] {
  const { from, to } = monthRange(ym);
  let d = weekRange(from).from;
  const end = weekRange(to).to;
  const weeks: MonthCell[][] = [];
  for (let guard = 0; d <= end && guard < 6; guard++) {
    const row: MonthCell[] = [];
    for (let i = 0; i < 7; i++) {
      const wd = isoWeekday(d);
      row.push({ date: d, inMonth: d.slice(0, 7) === ym, weekend: wd === 0 || wd === 6, trading: isTradingDay(d) });
      d = addCalendarDays(d, 1);
    }
    weeks.push(row);
  }
  return weeks;
}

// ── Links to the rest of the terminal ─────────────────────────────────────

/** The first session whose price can react to the event: the same day for an intraday event on a trading day, otherwise the next session. */
export function reactionDate(e: Pick<MarketEvent, "date" | "time" | "kind">): string {
  if (e.kind === "expiry") return e.date;
  const intraday = !!e.time && e.time < "15:30";
  return isTradingDay(e.date) && intraday ? e.date : nextTradingDay(e.date);
}

/** The underlying whose options trade the event best. */
export function linkSymbol(e: MarketEvent): string | null {
  if (e.kind === "holiday") return null;
  if (e.kind === "results" || e.kind === "corporate") return e.fno ? e.symbol ?? null : null;
  return e.symbol ?? null;
}

/** The expiry that spans the event's reaction session (the event's own date for an expiry). */
export function eventExpiry(e: MarketEvent): string | null {
  const sym = linkSymbol(e);
  if (!sym) return null;
  if (e.kind === "expiry") return e.date;
  const react = reactionDate(e);
  if (!react) return null;
  return getExpiries(sym, toISTDate(react, "09:15"), 1)[0]?.date ?? null;
}

export interface EventLink {
  label: string;
  href: string;
  /** Accessible description, e.g. "Open the RELIANCE option chain for the 27 Oct expiry". */
  title: string;
}

/** Deep links (chain, straddles, expiry day) for an event. Empty for past expiries and non-F&O names. */
export function eventLinks(e: MarketEvent, today: string): EventLink[] {
  const sym = linkSymbol(e);
  const expiry = eventExpiry(e);
  if (!sym || !expiry || expiry < today) return [];
  const q = (extra: Record<string, string> = {}) => new URLSearchParams({ symbol: sym, expiry, ...extra }).toString();
  const links: EventLink[] = [
    { label: "Chain", href: `/option-chain?${q()}`, title: `Open the ${sym} option chain for the ${expiry} expiry` },
    { label: "Straddles", href: `/straddles?${q({ view: "daily" })}`, title: `Open ${sym} straddles for the ${expiry} expiry` },
  ];
  if (e.kind === "expiry" && sym !== "BANKEX") links.push({ label: "Expiry day", href: `/expiry-day?${q()}`, title: `Open the ${sym} expiry-day view` });
  return links;
}
