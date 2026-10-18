/**
 * Instrument registry: lot sizes, strike steps, freeze quantities and expiry rules.
 *
 * Every figure here is marked verify:true. Exchange circulars change lot sizes
 * twice a year; refresh via registerContractSpecs() from the instrument master
 * or the proxy lot-size endpoint. Lot size is fixed per contract, so an older
 * expiry keeps its old lot (see LOT_SIZE_HISTORY and getLotSize(symbol, expiry)).
 */
import {
  addCalendarDays,
  calendarDaysBetween,
  isoWeekday,
  istDateString,
  isValidIsoDate,
  toISTDate,
  tradingDayOnOrBefore,
  tradingDaysBetween,
} from "./time";
import type { Exchange } from "./types";

export interface ContractSpec {
  symbol: string;
  exchange: Exchange;
  kind: "INDEX" | "STOCK";
  lotSize: number;
  strikeStep: number;
  tickSize: number;
  freezeQty?: number;
  weekly: boolean;
  /** 2 = Tuesday, 4 = Thursday */
  expiryWeekday: number;
  /** First expiry date (ISO) on which this lot size applies. */
  effectiveFrom: string;
  verify?: boolean;
  name?: string;
}

/** Effective (first affected expiry) of the Dec-2025 lot-size revision. */
const REV_DEC_2025 = "2025-12-31";

function index(symbol: string, exchange: Exchange, lotSize: number, strikeStep: number, weekly: boolean, expiryWeekday: number, freezeQty: number, name: string): ContractSpec {
  return { symbol, exchange, kind: "INDEX", lotSize, strikeStep, tickSize: 0.05, freezeQty, weekly, expiryWeekday, effectiveFrom: REV_DEC_2025, verify: true, name };
}

function stock(symbol: string, lotSize: number, strikeStep: number, name: string): ContractSpec {
  return { symbol, exchange: "NSE", kind: "STOCK", lotSize, strikeStep, tickSize: 0.05, weekly: false, expiryWeekday: 2, effectiveFrom: REV_DEC_2025, verify: true, name };
}

const BASE_SPECS: ContractSpec[] = [
  index("NIFTY", "NSE", 65, 50, true, 2, 1800, "Nifty 50"),
  index("BANKNIFTY", "NSE", 30, 100, false, 2, 600, "Nifty Bank"),
  index("FINNIFTY", "NSE", 60, 50, false, 2, 1200, "Nifty Financial Services"),
  index("MIDCPNIFTY", "NSE", 120, 25, false, 2, 2800, "Nifty Midcap Select"),
  index("NIFTYNXT50", "NSE", 25, 100, false, 2, 600, "Nifty Next 50"),
  index("SENSEX", "BSE", 20, 100, true, 4, 1000, "BSE Sensex"),
  index("BANKEX", "BSE", 30, 100, false, 4, 900, "BSE Bankex"),
  // Liquid F&O stocks (lot sizes per the Dec-2025 revision; verify against the NSE circular)
  stock("RELIANCE", 500, 10, "Reliance Industries"),
  stock("HDFCBANK", 550, 10, "HDFC Bank"),
  stock("ICICIBANK", 700, 10, "ICICI Bank"),
  stock("INFY", 400, 20, "Infosys"),
  stock("TCS", 175, 20, "Tata Consultancy Services"),
  stock("SBIN", 750, 5, "State Bank of India"),
  stock("AXISBANK", 625, 10, "Axis Bank"),
  stock("KOTAKBANK", 400, 20, "Kotak Mahindra Bank"),
  stock("LT", 175, 20, "Larsen & Toubro"),
  stock("ITC", 1600, 5, "ITC"),
  stock("BHARTIARTL", 475, 20, "Bharti Airtel"),
  stock("HINDUNILVR", 300, 20, "Hindustan Unilever"),
  stock("BAJFINANCE", 750, 10, "Bajaj Finance"),
  stock("MARUTI", 50, 100, "Maruti Suzuki"),
  stock("M&M", 200, 50, "Mahindra & Mahindra"),
  stock("SUNPHARMA", 350, 10, "Sun Pharmaceutical"),
  stock("TITAN", 175, 20, "Titan Company"),
  stock("ASIANPAINT", 250, 20, "Asian Paints"),
  stock("ULTRACEMCO", 50, 100, "UltraTech Cement"),
  stock("NTPC", 1500, 5, "NTPC"),
  stock("POWERGRID", 1900, 5, "Power Grid Corporation"),
  stock("ONGC", 2250, 2.5, "Oil & Natural Gas Corporation"),
  stock("COALINDIA", 1350, 5, "Coal India"),
  stock("TATASTEEL", 5500, 2, "Tata Steel"),
  stock("JSWSTEEL", 675, 10, "JSW Steel"),
  stock("HINDALCO", 700, 10, "Hindalco Industries"),
  stock("ADANIENT", 300, 20, "Adani Enterprises"),
  stock("ADANIPORTS", 475, 20, "Adani Ports & SEZ"),
  stock("WIPRO", 3000, 2.5, "Wipro"),
  stock("HCLTECH", 350, 20, "HCL Technologies"),
  stock("TECHM", 600, 20, "Tech Mahindra"),
  stock("BAJAJFINSV", 250, 20, "Bajaj Finserv"),
  stock("BAJAJ-AUTO", 75, 100, "Bajaj Auto"),
  stock("HEROMOTOCO", 150, 50, "Hero MotoCorp"),
  stock("EICHERMOT", 175, 50, "Eicher Motors"),
  stock("DRREDDY", 625, 10, "Dr. Reddy's Laboratories"),
  stock("CIPLA", 375, 10, "Cipla"),
  stock("DIVISLAB", 100, 50, "Divi's Laboratories"),
  stock("APOLLOHOSP", 125, 50, "Apollo Hospitals"),
  stock("NESTLEIND", 500, 10, "Nestle India"),
  stock("BRITANNIA", 125, 50, "Britannia Industries"),
  stock("TATACONSUM", 550, 10, "Tata Consumer Products"),
  stock("INDUSINDBK", 700, 10, "IndusInd Bank"),
  stock("HDFCLIFE", 1100, 5, "HDFC Life Insurance"),
  stock("SBILIFE", 375, 20, "SBI Life Insurance"),
  stock("GRASIM", 250, 20, "Grasim Industries"),
  stock("BPCL", 1975, 5, "Bharat Petroleum"),
  stock("IOC", 4875, 1, "Indian Oil Corporation"),
  stock("DLF", 825, 10, "DLF"),
  stock("VEDL", 1150, 5, "Vedanta"),
  stock("ETERNAL", 2425, 5, "Eternal (Zomato)"),
  stock("TRENT", 100, 50, "Trent"),
  stock("BEL", 1425, 5, "Bharat Electronics"),
  stock("HAL", 150, 50, "Hindustan Aeronautics"),
  stock("PNB", 8000, 1, "Punjab National Bank"),
  stock("BANKBARODA", 2925, 2.5, "Bank of Baroda"),
  stock("CANBK", 6750, 1, "Canara Bank"),
  stock("LTIM", 150, 50, "LTIMindtree"),
  stock("PIDILITIND", 500, 20, "Pidilite Industries"),
  stock("SIEMENS", 125, 50, "Siemens"),
  stock("DMART", 150, 50, "Avenue Supermarts"),
  stock("JIOFIN", 2350, 5, "Jio Financial Services"),
  stock("TATAPOWER", 1450, 5, "Tata Power"),
  stock("IRFC", 4250, 1, "Indian Railway Finance Corporation"),
  stock("GAIL", 3150, 2, "GAIL (India)"),
  stock("SHRIRAMFIN", 825, 10, "Shriram Finance"),
  stock("CHOLAFIN", 625, 20, "Cholamandalam Investment & Finance"),
  stock("ADANIGREEN", 600, 20, "Adani Green Energy"),
];

export const CONTRACT_SPECS: Record<string, ContractSpec> = Object.fromEntries(BASE_SPECS.map((s) => [s.symbol, s]));

/**
 * Lot-size history keyed by the first expiry each lot applies to.
 * verify: true
 */
export const LOT_SIZE_HISTORY: Record<string, Array<{ from: string; lotSize: number }>> = {
  NIFTY: [
    { from: "2021-07-01", lotSize: 50 },
    { from: "2024-04-26", lotSize: 25 },
    { from: "2024-11-20", lotSize: 75 },
    { from: REV_DEC_2025, lotSize: 65 },
  ],
  BANKNIFTY: [
    { from: "2023-07-01", lotSize: 15 },
    { from: "2024-11-20", lotSize: 30 },
    { from: "2025-04-25", lotSize: 35 },
    { from: REV_DEC_2025, lotSize: 30 },
  ],
  FINNIFTY: [
    { from: "2024-04-26", lotSize: 25 },
    { from: "2024-11-20", lotSize: 65 },
    { from: REV_DEC_2025, lotSize: 60 },
  ],
  MIDCPNIFTY: [
    { from: "2024-04-26", lotSize: 50 },
    { from: "2024-11-20", lotSize: 120 },
    { from: "2025-04-25", lotSize: 140 },
    { from: REV_DEC_2025, lotSize: 120 },
  ],
  SENSEX: [
    { from: "2023-05-15", lotSize: 10 },
    { from: "2024-11-20", lotSize: 20 },
  ],
  BANKEX: [
    { from: "2023-10-16", lotSize: 15 },
    { from: "2024-11-20", lotSize: 30 },
  ],
};

const ALIASES: Record<string, string> = {
  "NIFTY50": "NIFTY",
  "NIFTY 50": "NIFTY",
  "NIFTYBANK": "BANKNIFTY",
  "NIFTY BANK": "BANKNIFTY",
  "BANK NIFTY": "BANKNIFTY",
  "NIFTYFINSERVICE": "FINNIFTY",
  "NIFTY FIN SERVICE": "FINNIFTY",
  "NIFTY FINANCIAL SERVICES": "FINNIFTY",
  "NIFTYMIDSELECT": "MIDCPNIFTY",
  "NIFTY MID SELECT": "MIDCPNIFTY",
  "NIFTY MIDCAP SELECT": "MIDCPNIFTY",
  "NIFTY NEXT 50": "NIFTYNXT50",
  "BSE SENSEX": "SENSEX",
  "SENSEX50": "SENSEX",
  "BSE BANKEX": "BANKEX",
  "ZOMATO": "ETERNAL",
  "MM": "M&M",
  "BAJAJAUTO": "BAJAJ-AUTO",
};

/** Canonical upper-case symbol ("Nifty 50" → "NIFTY"). */
export function normalizeSymbol(symbol: string): string {
  if (typeof symbol !== "string") return "";
  const up = symbol.trim().toUpperCase().replace(/\s+/g, " ");
  return ALIASES[up] ?? ALIASES[up.replace(/\s/g, "")] ?? up;
}

export function getContractSpec(symbol: string): ContractSpec | undefined {
  return CONTRACT_SPECS[normalizeSymbol(symbol)];
}

export function isIndexSymbol(symbol: string): boolean {
  return getContractSpec(symbol)?.kind === "INDEX";
}

/**
 * Lot size for a symbol, optionally for a specific contract expiry (older contracts keep
 * their old lot). Returns undefined for an unknown symbol.
 */
export function getLotSize(symbol: string, expiryIso?: string): number | undefined {
  const sym = normalizeSymbol(symbol);
  const spec = CONTRACT_SPECS[sym];
  if (!spec) return undefined;
  if (!expiryIso || !isValidIsoDate(expiryIso)) return spec.lotSize;
  if (expiryIso >= spec.effectiveFrom) return spec.lotSize;
  const hist = LOT_SIZE_HISTORY[sym];
  if (!hist || hist.length === 0) return spec.lotSize;
  let lot: number | undefined;
  for (const h of hist) if (h.from <= expiryIso) lot = h.lotSize;
  return lot ?? hist[0].lotSize;
}

/** Strike step for a symbol; 50 when unknown. */
export function getStrikeStep(symbol: string): number {
  return getContractSpec(symbol)?.strikeStep ?? 50;
}

/** Runtime override/extension from an instrument master or proxy lot-size endpoint. */
export function registerContractSpecs(specs: Partial<ContractSpec>[]): void {
  if (!Array.isArray(specs)) return;
  for (const s of specs) {
    if (!s || typeof s.symbol !== "string" || !s.symbol.trim()) continue;
    const sym = normalizeSymbol(s.symbol);
    const prev = CONTRACT_SPECS[sym];
    const base: ContractSpec = prev ?? {
      symbol: sym,
      exchange: "NSE",
      kind: "STOCK",
      lotSize: NaN,
      strikeStep: 50,
      tickSize: 0.05,
      weekly: false,
      expiryWeekday: 2,
      effectiveFrom: istDateString(),
      verify: true,
    };
    const next: ContractSpec = { ...base };
    if (s.exchange === "NSE" || s.exchange === "BSE") next.exchange = s.exchange;
    if (s.kind === "INDEX" || s.kind === "STOCK") next.kind = s.kind;
    if (typeof s.lotSize === "number" && s.lotSize > 0) next.lotSize = s.lotSize;
    if (typeof s.strikeStep === "number" && s.strikeStep > 0) next.strikeStep = s.strikeStep;
    if (typeof s.tickSize === "number" && s.tickSize > 0) next.tickSize = s.tickSize;
    if (typeof s.freezeQty === "number" && s.freezeQty > 0) next.freezeQty = s.freezeQty;
    if (typeof s.weekly === "boolean") next.weekly = s.weekly;
    if (typeof s.expiryWeekday === "number" && s.expiryWeekday >= 1 && s.expiryWeekday <= 5) next.expiryWeekday = s.expiryWeekday;
    if (typeof s.effectiveFrom === "string" && isValidIsoDate(s.effectiveFrom)) next.effectiveFrom = s.effectiveFrom;
    if (typeof s.verify === "boolean") next.verify = s.verify;
    if (typeof s.name === "string") next.name = s.name;
    if (!(next.lotSize > 0)) continue; // never register a spec without a usable lot size
    // keep history so older contracts resolve to the previous lot
    if (prev && prev.lotSize !== next.lotSize && next.effectiveFrom > prev.effectiveFrom) {
      const hist = (LOT_SIZE_HISTORY[sym] ??= [{ from: prev.effectiveFrom, lotSize: prev.lotSize }]);
      if (!hist.some((h) => h.from === next.effectiveFrom)) hist.push({ from: next.effectiveFrom, lotSize: next.lotSize });
      hist.sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
    }
    CONTRACT_SPECS[sym] = next;
  }
}

// ---------- expiry rules ----------

interface ExpiryRule {
  weekly: boolean;
  weekday: number;
  exchange: Exchange;
}

function ruleFor(symbol: string): ExpiryRule {
  const spec = getContractSpec(symbol);
  if (!spec) return { weekly: false, weekday: 2, exchange: "NSE" };
  return { weekly: spec.weekly, weekday: spec.expiryWeekday, exchange: spec.exchange };
}

function ymIso(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** NSE moved F&O expiries from Thursday to Tuesday for contracts expiring from 1 Sep 2025 (SEBI/NSE circular). */
const NSE_TUESDAY_FROM = "2025-09-01";

/**
 * The rule as it applied in a past month: NSE contracts expired on Thursday before Sep 2025. Used when
 * checking whether a given date was an expiry (tradebook symbols, contract validation).
 */
function historicalRule(rule: ExpiryRule, y: number, m: number): ExpiryRule {
  return rule.exchange === "NSE" && ymIso(y, m, 1) < NSE_TUESDAY_FROM ? { ...rule, weekday: 4 } : rule;
}

/** All raw (pre-shift) expiry-weekday dates of a month, plus which one is the monthly. */
function expiriesInMonth(rule: ExpiryRule, y: number, m: number): Array<{ date: string; type: "weekly" | "monthly" }> {
  const first = ymIso(y, m, 1);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const days: string[] = [];
  const offset = (rule.weekday - isoWeekday(first) + 7) % 7;
  for (let d = 1 + offset; d <= lastDay; d += 7) days.push(ymIso(y, m, d));
  if (days.length === 0) return [];
  const monthlyRaw = days[days.length - 1];
  const raws = rule.weekly ? days : [monthlyRaw];
  return raws.map((raw) => ({
    date: tradingDayOnOrBefore(raw, rule.exchange),
    type: raw === monthlyRaw ? ("monthly" as const) : ("weekly" as const),
  }));
}

/**
 * Upcoming expiries for a symbol following SEBI rules (NIFTY weekly Tuesday + monthly last Tuesday;
 * BANKNIFTY/FINNIFTY/MIDCPNIFTY/stocks monthly last Tuesday; SENSEX weekly Thursday; BANKEX monthly
 * last Thursday). A holiday moves the expiry to the previous trading day. Today's expiry is included
 * until 15:30 IST.
 */
export function getExpiries(
  symbol: string,
  from: Date = new Date(),
  count = 6,
): Array<{ date: string; type: "weekly" | "monthly"; dte: number; tradingDte: number; lotSize?: number }> {
  const t0 = from instanceof Date ? from.getTime() : NaN;
  if (!Number.isFinite(t0) || !(count > 0)) return [];
  const rule = ruleFor(symbol);
  const today = istDateString(from);
  let y = +today.slice(0, 4);
  let m = +today.slice(5, 7);
  const out: Array<{ date: string; type: "weekly" | "monthly"; dte: number; tradingDte: number; lotSize?: number }> = [];
  const seen = new Set<string>();
  for (let i = 0; i < 48 && out.length < count; i++) {
    for (const e of expiriesInMonth(rule, y, m)) {
      if (out.length >= count) break;
      if (!e.date || seen.has(e.date)) continue;
      if (toISTDate(e.date, "15:30").getTime() <= t0) continue;
      seen.add(e.date);
      out.push({
        date: e.date,
        type: e.type,
        dte: calendarDaysBetween(today, e.date),
        tradingDte: tradingDaysBetween(today, e.date, rule.exchange),
        lotSize: getLotSize(symbol, e.date),
      });
    }
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : 1));
}

/** True when isoDate is a weekly (non-monthly) expiry for the symbol. */
export function isWeeklyExpiry(symbol: string, isoDate: string): boolean {
  if (!isValidIsoDate(isoDate)) return false;
  const rule = ruleFor(symbol);
  if (!rule.weekly) return false;
  const y = +isoDate.slice(0, 4);
  const m = +isoDate.slice(5, 7);
  const next = addCalendarDays(ymIso(y, m, 1), 40);
  const candidates = [...expiriesInMonth(historicalRule(rule, y, m), y, m), ...expiriesInMonth(historicalRule(rule, +next.slice(0, 4), +next.slice(5, 7)), +next.slice(0, 4), +next.slice(5, 7))];
  const hit = candidates.find((c) => c.date === isoDate);
  return hit?.type === "weekly";
}

/** True when isoDate is the monthly expiry for the symbol. */
export function isMonthlyExpiry(symbol: string, isoDate: string): boolean {
  if (!isValidIsoDate(isoDate)) return false;
  const rule = ruleFor(symbol);
  const y = +isoDate.slice(0, 4);
  const m = +isoDate.slice(5, 7);
  const next = addCalendarDays(ymIso(y, m, 1), 40);
  const candidates = [...expiriesInMonth(historicalRule(rule, y, m), y, m), ...expiriesInMonth(historicalRule(rule, +next.slice(0, 4), +next.slice(5, 7)), +next.slice(0, 4), +next.slice(5, 7))];
  return candidates.some((c) => c.date === isoDate && c.type === "monthly");
}
