/**
 * Static 2026–27 macro calendar: RBI MPC decisions, the Union Budget, MoSPI CPI / GDP / IIP
 * releases, FOMC decisions and US CPI, all in IST.
 *
 * verify: true — every date here is compiled from published schedules where they existed when this
 * file was written and estimated from the usual pattern otherwise (MoSPI release rules, the
 * Fed's and BLS's typical cadence). Each event carries `verify: true`; check the official source
 * (rbi.org.in, mospi.gov.in, federalreserve.gov, bls.gov) before trading around it.
 */
import { addCalendarDays, isValidIsoDate, isoWeekday } from "@/lib/options";
import type { EventRange, MarketEvent } from "./types";

/** The span the static macro list covers. */
export const MACRO_COVERAGE: EventRange = { from: "2026-01-01", to: "2027-12-31" };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

/** RBI MPC policy announcements (last day of each meeting, 10:00 IST). verify: true */
export const RBI_MPC_DATES: readonly string[] = [
  "2026-02-06",
  "2026-04-08",
  "2026-06-05",
  "2026-08-06",
  "2026-10-01",
  "2026-12-04",
  "2027-02-05",
  "2027-04-07",
  "2027-06-04",
  "2027-08-06",
  "2027-10-01",
  "2027-12-03",
];

/** Union Budget speeches (11:00 IST). 1 Feb 2026 fell on a Sunday with a special NSE session. verify: true */
export const UNION_BUDGET_DATES: readonly string[] = ["2026-02-01", "2027-02-01"];

/** FOMC decision days in US Eastern time (statement at 14:00 ET). 2027 is estimated. verify: true */
export const FOMC_DATES_ET: readonly string[] = [
  "2026-01-28",
  "2026-03-18",
  "2026-04-29",
  "2026-06-17",
  "2026-07-29",
  "2026-09-16",
  "2026-10-28",
  "2026-12-09",
  "2027-01-27",
  "2027-03-17",
  "2027-04-28",
  "2027-06-16",
  "2027-07-28",
  "2027-09-22",
  "2027-11-03",
  "2027-12-15",
];

/** FOMC meetings with a Summary of Economic Projections ("dot plot"). */
const FOMC_SEP = new Set(["2026-03-18", "2026-06-17", "2026-09-16", "2026-12-09", "2027-03-17", "2027-06-16", "2027-09-22", "2027-12-15"]);

/** US CPI releases in US Eastern time (08:30 ET). 2027 is estimated. verify: true */
export const US_CPI_DATES_ET: readonly string[] = [
  "2026-01-13",
  "2026-02-11",
  "2026-03-11",
  "2026-04-10",
  "2026-05-12",
  "2026-06-10",
  "2026-07-14",
  "2026-08-12",
  "2026-09-11",
  "2026-10-14",
  "2026-11-10",
  "2026-12-10",
  "2027-01-13",
  "2027-02-10",
  "2027-03-10",
  "2027-04-13",
  "2027-05-12",
  "2027-06-10",
  "2027-07-14",
  "2027-08-11",
  "2027-09-14",
  "2027-10-13",
  "2027-11-10",
  "2027-12-10",
];

/** n-th weekday (0 = Sunday) of a month, 1-based n. */
function nthWeekday(y: number, m: number, weekday: number, n: number): string {
  const first = ymd(y, m, 1);
  const offset = (weekday - isoWeekday(first) + 7) % 7;
  return addCalendarDays(first, offset + (n - 1) * 7);
}

/** True when US daylight saving time is in force on that date (second Sunday of March to first Sunday of November). */
export function isUsDst(dateIso: string): boolean {
  if (!isValidIsoDate(dateIso)) return false;
  const y = +dateIso.slice(0, 4);
  return dateIso >= nthWeekday(y, 3, 0, 2) && dateIso < nthWeekday(y, 11, 0, 1);
}

/** Convert a US Eastern wall-clock time to the IST date and time ("14:00" ET in July → same date "23:30" IST). */
export function usEasternToIst(dateIso: string, hhmm: string): { date: string; time: string } | null {
  const tm = /^(\d{1,2}):(\d{2})$/.exec(hhmm ?? "");
  if (!isValidIsoDate(dateIso) || !tm) return null;
  const offsetH = isUsDst(dateIso) ? 4 : 5;
  const utc = Date.UTC(+dateIso.slice(0, 4), +dateIso.slice(5, 7) - 1, +dateIso.slice(8, 10), +tm[1] + offsetH, +tm[2]);
  const ist = new Date(utc + 330 * 60_000);
  return {
    date: ymd(ist.getUTCFullYear(), ist.getUTCMonth() + 1, ist.getUTCDate()),
    time: `${pad(ist.getUTCHours())}:${pad(ist.getUTCMinutes())}`,
  };
}

/** The date itself when it is Monday–Friday, otherwise the following Monday. */
export function weekdayOnOrAfter(dateIso: string): string {
  let d = dateIso;
  for (let i = 0; i < 3; i++) {
    const wd = isoWeekday(d);
    if (wd !== 0 && wd !== 6) return d;
    d = addCalendarDays(d, 1);
  }
  return d;
}

/** The last Monday–Friday of a month. */
export function lastWeekdayOfMonth(y: number, m: number): string {
  const nextFirst = m === 12 ? ymd(y + 1, 1, 1) : ymd(y, m + 1, 1);
  let d = addCalendarDays(nextFirst, -1);
  for (let i = 0; i < 3; i++) {
    const wd = isoWeekday(d);
    if (wd !== 0 && wd !== 6) return d;
    d = addCalendarDays(d, -1);
  }
  return d;
}

const prevMonth = (y: number, m: number) => (m === 1 ? { y: y - 1, m: 12 } : { y, m: m - 1 });

/** Indian fiscal-year label for a quarter ending in month m of year y: "Q2 FY27". */
export function fiscalQuarterLabel(y: number, m: number): string {
  const q = m <= 3 ? 4 : m <= 6 ? 1 : m <= 9 ? 2 : 3;
  const fy = m <= 3 ? y : y + 1;
  return `Q${q} FY${pad(fy % 100)}`;
}

function ev(e: Omit<MarketEvent, "id" | "source" | "verify">, slug: string): MarketEvent {
  return { ...e, id: `${e.kind}:${e.date}:${slug}`, source: "schedule", verify: true };
}

let cache: MarketEvent[] | null = null;

/** Every static macro event in MACRO_COVERAGE, sorted by date and time. */
export function allMacroEvents(): MarketEvent[] {
  if (cache) return cache;
  const out: MarketEvent[] = [];

  for (const date of RBI_MPC_DATES) {
    out.push(
      ev(
        {
          date,
          time: "10:00",
          kind: "india-macro",
          category: "RBI MPC",
          title: "RBI monetary policy decision",
          detail: "Repo rate, stance and the Governor's statement. Rate-sensitive: BANKNIFTY, financials, realty, autos.",
          symbol: "BANKNIFTY",
          symbols: ["BANKNIFTY", "NIFTY", "FINNIFTY"],
          impact: "high",
          region: "IN",
        },
        "rbi-mpc",
      ),
    );
  }

  for (const date of UNION_BUDGET_DATES) {
    out.push(
      ev(
        {
          date,
          time: "11:00",
          kind: "india-macro",
          category: "Union Budget",
          title: `Union Budget ${date.slice(0, 4)}–${pad((+date.slice(0, 4) + 1) % 100)}`,
          detail: "Finance Minister's Budget speech: fiscal deficit, capex, taxes (STT and capital gains matter for F&O).",
          symbol: "NIFTY",
          symbols: ["NIFTY", "BANKNIFTY"],
          impact: "high",
          region: "IN",
        },
        "union-budget",
      ),
    );
  }

  for (let y = 2026; y <= 2027; y++) {
    for (let m = 1; m <= 12; m++) {
      const ref = prevMonth(y, m);
      const refLabel = `${MONTHS[ref.m - 1]} ${ref.y}`;
      out.push(
        ev(
          {
            date: weekdayOnOrAfter(ymd(y, m, 12)),
            time: "16:00",
            kind: "india-macro",
            category: "CPI",
            title: `India CPI inflation (${refLabel})`,
            detail: "MoSPI retail inflation print; the RBI's main policy target.",
            symbol: "NIFTY",
            impact: "medium",
            region: "IN",
          },
          "in-cpi",
        ),
      );
      out.push(
        ev(
          {
            date: weekdayOnOrAfter(ymd(y, m, 28)),
            time: "16:00",
            kind: "india-macro",
            category: "IIP",
            title: `India IIP (${refLabel})`,
            detail: "MoSPI index of industrial production.",
            symbol: "NIFTY",
            impact: "low",
            region: "IN",
          },
          "in-iip",
        ),
      );
      if (m === 2 || m === 5 || m === 8 || m === 11) {
        const qEnd = m === 2 ? { y: y - 1, m: 12 } : { y, m: m - 2 };
        out.push(
          ev(
            {
              date: lastWeekdayOfMonth(y, m),
              time: "16:00",
              kind: "india-macro",
              category: "GDP",
              title: `India GDP, ${fiscalQuarterLabel(qEnd.y, qEnd.m)}`,
              detail: "MoSPI quarterly GDP estimate, released after market hours.",
              symbol: "NIFTY",
              impact: "medium",
              region: "IN",
            },
            "in-gdp",
          ),
        );
      }
    }
  }

  for (const et of FOMC_DATES_ET) {
    const ist = usEasternToIst(et, "14:00");
    if (!ist) continue;
    out.push(
      ev(
        {
          date: ist.date,
          time: ist.time,
          kind: "global-macro",
          category: "FOMC",
          title: FOMC_SEP.has(et) ? "FOMC decision + dot plot" : "FOMC decision",
          detail: `US Federal Reserve rate decision (14:00 ET on ${et}). Indian markets react at the next session's open.`,
          symbol: "NIFTY",
          impact: "high",
          region: "US",
        },
        "fomc",
      ),
    );
  }

  for (const et of US_CPI_DATES_ET) {
    const ist = usEasternToIst(et, "08:30");
    if (!ist) continue;
    const ref = prevMonth(+et.slice(0, 4), +et.slice(5, 7));
    out.push(
      ev(
        {
          date: ist.date,
          time: ist.time,
          kind: "global-macro",
          category: "US CPI",
          title: `US CPI (${MONTHS[ref.m - 1]} ${ref.y})`,
          detail: "BLS consumer prices, released after the Indian cash close; moves GIFT Nifty and the next open.",
          symbol: "NIFTY",
          impact: "medium",
          region: "US",
        },
        "us-cpi",
      ),
    );
  }

  out.sort((a, b) => (a.date === b.date ? (a.time ?? "").localeCompare(b.time ?? "") : a.date < b.date ? -1 : 1));
  cache = out;
  return out;
}

/** Static macro events whose date falls in [from, to]. */
export function macroEvents(range: EventRange): MarketEvent[] {
  return allMacroEvents().filter((e) => e.date >= range.from && e.date <= range.to);
}
