/**
 * Daily market brief: a handful of plain-language lines (gap, VIX, PCR, max pain shift, FII
 * positioning, OI walls, events today), each pointing at the page that explains it. Pure, so the
 * wording and banding are unit-tested; the card in DailyBrief.tsx only gathers inputs and renders.
 */
import {
  DASH,
  dteLabel,
  formatDateIST,
  formatNumberIN,
  formatPct,
  formatSigned,
  getExpiries,
  getMarketSession,
  isHoliday,
  istDateString,
  isoWeekday,
  nextTradingDay,
  nowIST,
  toISTDate,
} from "@/lib/options";
import { pcrSignal } from "@/lib/oiUtils";
import { DASHBOARD_INDEX_EXPIRIES, vixRegime, type Tone } from "./dashboardModel";

export type BriefKey = "gap" | "vix" | "pcr" | "maxPain" | "fii" | "walls" | "events";

export interface BriefItem {
  key: BriefKey;
  label: string;
  /** Headline value, e.g. "+0.42%" or "1.08". */
  value: string;
  /** One short sentence of context. */
  detail: string;
  tone: Tone;
  /** Page that explains the line. */
  to: string;
  /** The inputs came from the labelled sample snapshot. */
  sample: boolean;
  /** False when the line needs live data that is not available; such lines go to the "needs live data" strip. */
  available: boolean;
  /** Terse phrase for the one-line headline, e.g. "gap up" or "VIX low". */
  phrase?: string;
}

export interface BriefInputs {
  now: Date;
  nifty?: { ltp: number; open: number; prevClose: number; sample: boolean } | null;
  /**
   * GIFT Nifty and the NIFTY close, for a pre-open gap estimate. `changePercent`
   * is GIFT's move against its own previous close/settlement; it is what drives
   * the estimate, because GIFT (a futures price) trades at a carry premium to
   * NIFTY spot and comparing the two levels shows a gap-up bias every morning.
   */
  gift?: { lastPrice: number; niftyClose: number; changePercent?: number | null } | null;
  vix?: { value: number; changePercent: number; sample: boolean } | null;
  pcr?: { value: number; prev?: number | null; sample: boolean } | null;
  maxPain?: { value: number; prev?: number | null; spot: number; expiry?: string; sample: boolean } | null;
  fii?: { longPct: number; changePts: number | null; zone: string; tone: Tone; sample: boolean } | null;
  walls?: { resistance: number | null; support: number | null; spot: number; sample: boolean } | null;
}

const pos = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x) && x > 0;
const n0 = (v: number) => formatNumberIN(v, 0);
const n2 = (v: number) => formatNumberIN(v, 2, { minDecimals: 2 });
const short = (iso: string) => formatDateIST(iso).replace(/ \d{4}$/, "");
/** "A", "A and B", "A, B and C". */
export function joinList(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
const toneOf = (v: number): Tone => (v > 0 ? "bullish" : v < 0 ? "bearish" : "neutral");

/** Opening gap from the NIFTY open vs the previous close. Moves within ±0.1% read as a flat open. */
export function gapLine(i: BriefInputs): BriefItem {
  const base = { key: "gap" as const, label: "Opening gap", to: "/option-chain?symbol=NIFTY" };
  const session = getMarketSession(i.now);
  const n = i.nifty;
  const ist = nowIST(i.now);
  const beforeOpen = session === "pre-open" || (session === "closed" && ist.hh * 60 + ist.mm < 9 * 60 + 15);
  if (beforeOpen && i.gift && pos(i.gift.lastPrice) && pos(i.gift.niftyClose)) {
    const own = i.gift.changePercent;
    const hasOwn = typeof own === "number" && Number.isFinite(own);
    // Preferred: GIFT's own % change applied to the NIFTY close (carry cancels out).
    // Fallback (no GIFT previous close): the raw level difference, which includes the futures carry.
    const pct = hasOwn ? own : ((i.gift.lastPrice - i.gift.niftyClose) / i.gift.niftyClose) * 100;
    const pts = hasOwn ? (i.gift.niftyClose * own) / 100 : i.gift.lastPrice - i.gift.niftyClose;
    return {
      ...base,
      value: formatPct(pct, { signed: true }),
      detail: hasOwn
        ? `GIFT Nifty implies ${formatSigned(pts, 0)} pts on NIFTY's last close of ${n0(i.gift.niftyClose)} (GIFT ${formatPct(own, { signed: true })} vs its own previous close).`
        : `GIFT Nifty implies ${formatSigned(pts, 0)} pts vs NIFTY's last close of ${n0(i.gift.niftyClose)}, including the futures carry premium.`,
      tone: Math.abs(pct) < 0.1 ? "neutral" : toneOf(pct),
      sample: false,
      available: true,
      phrase: `GIFT Nifty points to ${Math.abs(pct) < 0.1 ? "a flat" : pct > 0 ? "a higher" : "a lower"} open`,
    };
  }
  if (!n || !pos(n.open) || !pos(n.prevClose)) {
    return { ...base, value: DASH, detail: "Needs today's NIFTY open and the previous close.", tone: "neutral", sample: false, available: false };
  }
  const pts = n.open - n.prevClose;
  const pct = (pts / n.prevClose) * 100;
  const flat = Math.abs(pct) < 0.1;
  const sinceOpen = pos(n.ltp) ? n.ltp - n.open : NaN;
  const follow = Number.isFinite(sinceOpen) && !flat ? (Math.sign(sinceOpen) === Math.sign(pts) ? "extended" : "faded") : null;
  return {
    ...base,
    value: formatPct(pct, { signed: true }),
    detail: `${flat ? "Flat open" : pts > 0 ? "Gap up" : "Gap down"} of ${formatSigned(pts, 0)} pts at ${n0(n.open)}${follow ? `; the move has ${follow} since (${formatSigned(sinceOpen, 0)} pts)` : ""}.`,
    tone: flat ? "neutral" : toneOf(pct),
    sample: n.sample,
    available: true,
    phrase: flat ? "flat open" : pts > 0 ? "gap up" : "gap down",
  };
}

/** India VIX with its regime. Rising VIX is shown in the bearish colour (more fear, dearer options). */
export function vixLine(i: BriefInputs): BriefItem {
  const base = { key: "vix" as const, label: "India VIX", to: "/volatility" };
  const v = i.vix;
  if (!v || !pos(v.value)) return { ...base, value: DASH, detail: "Needs the India VIX quote.", tone: "neutral", sample: false, available: false };
  const regime = vixRegime(v.value);
  const chg = Number.isFinite(v.changePercent) ? v.changePercent : 0;
  return {
    ...base,
    value: n2(v.value),
    detail: `${formatPct(chg, { signed: true })} today · ${regime ? `${regime.label}: ${regime.note}` : ""}`.trim(),
    tone: chg > 0.5 ? "bearish" : chg < -0.5 ? "bullish" : regime?.tone ?? "neutral",
    sample: v.sample,
    available: true,
    phrase: regime ? `VIX ${regime.label.toLowerCase()}` : undefined,
  };
}

/** NIFTY OI PCR with the same banding as the PCR suite (0.7 to 1.2 is balanced). */
export function pcrLine(i: BriefInputs): BriefItem {
  const base = { key: "pcr" as const, label: "NIFTY PCR (OI)", to: "/max-pain-pcr?symbol=NIFTY" };
  const p = i.pcr;
  if (!p || !pos(p.value)) return { ...base, value: DASH, detail: "Needs the NIFTY option chain.", tone: "neutral", sample: false, available: false };
  const s = pcrSignal(p.value);
  const prev = pos(p.prev) ? p.prev : null;
  const tone: Tone = s.tone === "warning" ? "warning" : s.tone;
  return {
    ...base,
    value: formatNumberIN(p.value, 2, { minDecimals: 2 }),
    detail: `${s.label}.${prev !== null ? ` ${p.value > prev ? "Up" : p.value < prev ? "Down" : "Unchanged"} from ${formatNumberIN(prev, 2, { minDecimals: 2 })} at the previous close.` : ""}`,
    tone,
    sample: p.sample,
    available: true,
    phrase: `PCR ${s.band === "balanced" ? "balanced" : s.band === "call-heavy" ? "call heavy" : s.band === "put-heavy" ? "put heavy" : "at a put-heavy extreme"}`,
  };
}

/** Max pain and how far it moved since the previous recorded close. */
export function maxPainLine(i: BriefInputs): BriefItem {
  const base = { key: "maxPain" as const, label: "Max pain shift", to: "/max-pain-pcr?symbol=NIFTY" };
  const m = i.maxPain;
  if (!m || !pos(m.value)) return { ...base, value: DASH, detail: "Needs the NIFTY option chain.", tone: "neutral", sample: false, available: false };
  const exp = m.expiry ? ` for ${short(m.expiry)}` : "";
  const dist = pos(m.spot) ? m.spot - m.value : NaN;
  const where = Number.isFinite(dist) ? (Math.round(dist) === 0 ? "Spot is at max pain." : `Spot is ${n0(Math.abs(dist))} pts ${dist > 0 ? "above" : "below"}.`) : "";
  if (!pos(m.prev)) {
    return { ...base, value: n0(m.value), detail: `Max pain ${n0(m.value)}${exp}. ${where} No previous close is recorded yet, so the shift needs a day of history.`.trim(), tone: "neutral", sample: m.sample, available: true };
  }
  const shift = m.value - m.prev;
  return {
    ...base,
    value: shift === 0 ? "Unchanged" : `${formatSigned(shift, 0)} pts`,
    detail: `${n0(m.prev)} → ${n0(m.value)}${exp}. ${where}`.trim(),
    tone: toneOf(shift),
    sample: m.sample,
    available: true,
  };
}

/** FII index-futures long share from NSE participant-wise OI. */
export function fiiLine(i: BriefInputs): BriefItem {
  const base = { key: "fii" as const, label: "FII index futures", to: "/participants" };
  const f = i.fii;
  if (!f || !Number.isFinite(f.longPct)) return { ...base, value: DASH, detail: "Needs NSE participant-wise OI.", tone: "neutral", sample: false, available: false };
  const chg = f.changePts !== null && Number.isFinite(f.changePts) ? ` (${formatSigned(f.changePts, 1)} pts on the day)` : "";
  return { ...base, value: `${formatNumberIN(f.longPct, 1)}% long`, detail: `${f.zone}${chg}.`, tone: f.tone, sample: f.sample, available: true };
}

/** Strongest call-OI strike above spot (resistance) and put-OI strike below (support). */
export function wallsLine(i: BriefInputs): BriefItem {
  const base = { key: "walls" as const, label: "OI walls", to: "/oi-analysis?symbol=NIFTY" };
  const w = i.walls;
  if (!w || (!pos(w.resistance) && !pos(w.support))) return { ...base, value: DASH, detail: "Needs the NIFTY option chain.", tone: "neutral", sample: false, available: false };
  const res = pos(w.resistance) ? n0(w.resistance) : DASH;
  const sup = pos(w.support) ? n0(w.support) : DASH;
  const width = pos(w.resistance) && pos(w.support) && pos(w.spot) ? ((w.resistance - w.support) / w.spot) * 100 : NaN;
  return {
    ...base,
    value: `${sup} – ${res}`,
    detail: `Put writers defend ${sup}, call writers cap ${res}${Number.isFinite(width) ? `; a ${formatPct(width, { decimals: 1 })} range` : ""}.`,
    tone: "neutral",
    sample: w.sample,
    available: true,
  };
}

export interface TodayEvents {
  /** Index weekly or monthly expiries falling today (IST). */
  expiries: Array<{ symbol: string; type: "weekly" | "monthly" }>;
  closed: null | "weekend" | "holiday";
  nextTradingDay: string;
  /** The nearest NIFTY expiry, for the "no expiry today" line. */
  nextNifty: string | null;
  /** Past the 15:30 IST close. */
  afterClose: boolean;
}

/** Calendar facts for today in IST: index expiries, weekend or exchange holiday, next session. */
export function eventsToday(now: Date, symbols: readonly string[] = DASHBOARD_INDEX_EXPIRIES): TodayEvents {
  const today = istDateString(now);
  const wd = isoWeekday(today);
  const closed = wd === 0 || wd === 6 ? "weekend" : isHoliday(today) ? "holiday" : null;
  // Look from the start of the IST day, so an expiry still counts as "today" after the 15:30 close.
  const dayStart = toISTDate(today, "00:00");
  const expiries: TodayEvents["expiries"] = [];
  for (const symbol of symbols) {
    const e = getExpiries(symbol, dayStart, 1)[0];
    if (e && e.date === today) expiries.push({ symbol, type: e.type });
  }
  const nifty = getExpiries("NIFTY", now, 1)[0];
  const ist = nowIST(now);
  return { expiries, closed, nextTradingDay: nextTradingDay(today), nextNifty: nifty?.date ?? null, afterClose: ist.hh * 60 + ist.mm >= 15 * 60 + 30 };
}

export function eventsLine(i: BriefInputs): BriefItem {
  const base = { key: "events" as const, label: "Events today", to: "/expiry-day", sample: false, available: true };
  const ev = eventsToday(i.now);
  const next = ev.nextNifty ? `NIFTY weekly expiry ${short(ev.nextNifty)} (${dteLabel(ev.nextNifty, i.now)})` : "";
  if (ev.closed) {
    return {
      ...base,
      value: ev.closed === "weekend" ? "Weekend" : "Holiday",
      detail: `Markets are shut. Next session ${short(ev.nextTradingDay)}${next ? `; ${next}` : ""}.`,
      tone: "neutral",
      phrase: "markets shut today",
    };
  }
  if (ev.expiries.length > 0) {
    const names = joinList(ev.expiries.map((e) => `${e.symbol} ${e.type}`));
    const one = ev.expiries.length === 1;
    return {
      ...base,
      value: one ? "Expiry day" : `${ev.expiries.length} expiries`,
      detail: ev.afterClose
        ? `${names} expired today at 15:30 IST.${next ? ` Next: ${next}.` : ""}`
        : `${names} expire${one ? "s" : ""} today at 15:30 IST. Gamma risk is highest into the close.`,
      tone: ev.afterClose ? "neutral" : "warning",
      phrase: `${joinList(ev.expiries.map((e) => e.symbol))} ${one ? "expiry" : "expiries"} today`,
    };
  }
  return { ...base, value: "No expiry", detail: next ? `Next ${next}.` : "No index expiry today.", tone: "neutral" };
}

/** All brief lines in display order. */
export function buildMarketBrief(i: BriefInputs): BriefItem[] {
  return [gapLine(i), vixLine(i), pcrLine(i), maxPainLine(i), fiiLine(i), wallsLine(i), eventsLine(i)];
}

/** One-sentence summary from the available lines, e.g. "Gap up, VIX low, PCR balanced, NIFTY expiry today." */
export function briefHeadline(items: readonly BriefItem[]): string {
  const parts = items.filter((x) => x.available && x.phrase).map((x) => x.phrase as string);
  if (parts.length === 0) return "Waiting for market data.";
  const s = parts.join(", ");
  return `${s.charAt(0).toUpperCase()}${s.slice(1)}.`;
}
