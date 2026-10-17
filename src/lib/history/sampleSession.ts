/**
 * SAMPLE intraday session and daily history for one option contract (always labelled "Sample").
 *
 * Deterministic for a given symbol, expiry, strike and session: the same inputs always draw the
 * same path. The session is anchored to generateSampleChain at `now`: the last snapshot carries the
 * sample chain's LTP, OI, volume and IV for the strike (both CE and PE), so the Contract page and
 * the sample option chain agree. Earlier snapshots replay a plausible day: a Brownian-bridge spot
 * path into the anchor, an IV drift, Black-76 prices on the sample smile, OI building from the
 * open (OI minus the day's change) and U-shaped cumulative volume.
 *
 * Never present anything built here as market data.
 */
import type { OptionData } from "@/lib/mockData";
import type { ChainSnapshot, StrikeSnap } from "@/lib/snapshotStore";
import {
  black76Price,
  generateSampleChain,
  getDividendYield,
  getLotSize,
  getStrikeStep,
  isTradingDay,
  istDateString,
  mulberry32,
  nowIST,
  previousTradingDay,
  sampleSmile,
  timeToExpiryYears,
  toISTDate,
  type OptionType,
} from "@/lib/options";

const SAMPLE_R = 0.065;
const SAMPLE_ATM_IV = 0.14;
const TICK = 0.05;
const roundTick = (x: number) => Math.max(TICK, Math.round(x / TICK) * TICK);
const r2 = (x: number) => Math.round(x * 100) / 100;

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Standard normal draw (Box–Muller) from a uniform generator. */
function gauss(rand: () => number): number {
  const u = Math.max(1e-12, rand());
  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Session the sample covers: today once 09:20 IST has passed on a trading day, else the previous trading day. */
export function sampleContractWindow(now: Date = new Date()): { date: string; start: number; end: number } {
  const t = nowIST(now);
  const today = istDateString(now);
  const afterOpen = isTradingDay(today) && t.hh * 60 + t.mm >= 9 * 60 + 20;
  const date = afterOpen ? today : previousTradingDay(today) || today;
  const start = toISTDate(date, "09:15").getTime();
  const close = toISTDate(date, "15:30").getTime();
  return { date, start, end: afterOpen ? Math.min(now.getTime(), close) : close };
}

/** Black-76 price of the contract on the sample smile at a given spot, ATM IV and time. */
function modelPrice(symbol: string, K: number, type: OptionType, S: number, atmIv: number, T: number): { price: number; iv: number } {
  const q = getDividendYield(symbol);
  const Tm = Math.max(T, 1 / (365 * 24 * 60));
  const F = S * Math.exp((SAMPLE_R - q) * Tm);
  const z = Math.log(K / F) / Math.max(atmIv * Math.sqrt(Tm), 1e-6);
  const iv = sampleSmile(atmIv, z);
  return { price: black76Price({ F, K, T: Tm, r: SAMPLE_R, sigma: iv, type }), iv };
}

/** Sample chain at `now` wide enough to contain the strike (null when the strike is off the grid). */
function anchorRow(symbol: string, expiry: string, strike: number, spot: number, now: Date): OptionData | null {
  const step = getStrikeStep(symbol);
  const atm = Math.round(spot / step) * step;
  const need = Math.ceil(Math.abs(strike - atm) / step) * 2 + 5;
  if (need > 201) return null;
  const { chain } = generateSampleChain({ symbol, spot, expiry, now, strikes: Math.max(41, need) });
  return chain.find((r) => r.strikePrice === strike) ?? null;
}

export interface SampleContractInput {
  symbol: string;
  expiry: string;
  strike: number;
  spot: number;
  now?: Date;
  /** Minutes between snapshots (default 5). */
  stepMin?: number;
}

/**
 * Sample intraday snapshots for one strike (rows for CE and PE), oldest first. Empty when the
 * inputs are unusable (no spot, bad strike, expired contract).
 */
export function buildSampleContractSession(o: SampleContractInput): ChainSnapshot[] {
  const symbol = String(o?.symbol || "").toUpperCase();
  const K = Number(o?.strike);
  const spot = Number(o?.spot);
  if (!symbol || !(K > 0) || !(spot > 0) || !o.expiry) return [];
  const now = o.now ?? new Date();
  const { start, end } = sampleContractWindow(now);
  if (!(timeToExpiryYears(o.expiry, new Date(start)) > 0)) return [];
  const stepMs = Math.max(1, Math.round(o.stepMin ?? 5)) * 60_000;
  const times: number[] = [];
  for (let t = start; t < end; t += stepMs) times.push(t);
  times.push(end);
  const n = times.length;
  const rand = mulberry32(hashString(`${symbol}|${o.expiry}|${K}|${start}`));

  // Spot: Brownian bridge from an opening gap into the anchor spot.
  const sessionVol = SAMPLE_ATM_IV * Math.sqrt(1 / 252);
  const gap = gauss(rand) * sessionVol * 0.6;
  const walk: number[] = [0];
  for (let i = 1; i < n; i++) walk.push(walk[i - 1] + gauss(rand) * sessionVol * Math.sqrt(1 / Math.max(1, n - 1)));
  const spots = times.map((_, i) => {
    const w = n > 1 ? i / (n - 1) : 1;
    const b = gap * (1 - w) + (walk[i] - walk[n - 1] * w);
    return r2(spot * Math.exp(b));
  });
  spots[n - 1] = spot;
  // ATM IV: a little richer at the open, easing into the anchor level.
  const ivOpenBump = 0.02 + 0.04 * rand();
  const atmIvs = times.map((_, i) => {
    const w = n > 1 ? i / (n - 1) : 1;
    return SAMPLE_ATM_IV * (1 + ivOpenBump * (1 - w) + 0.006 * gauss(rand) * (1 - w));
  });
  atmIvs[n - 1] = SAMPLE_ATM_IV;

  const anchor = anchorRow(symbol, o.expiry, K, spot, now);
  const lot = getLotSize(symbol, o.expiry) ?? 1;
  // U-shaped intensity for cumulative volume.
  const intensity = times.map((_, i) => {
    const x = n > 1 ? i / (n - 1) : 1;
    return 0.35 + 2.2 * (x - 0.5) ** 2 * 4 + 0.25 * rand();
  });
  const cumIntensity: number[] = [];
  intensity.reduce((acc, v, i) => (cumIntensity[i] = acc + v), 0);
  const totalIntensity = cumIntensity[n - 1] || 1;

  const sides: Array<{ type: OptionType; leg: OptionData["ce"] | null }> = [
    { type: "CE", leg: anchor?.ce ?? null },
    { type: "PE", leg: anchor?.pe ?? null },
  ];
  const series = sides.map(({ type, leg }) => {
    const model = times.map((t, i) => modelPrice(symbol, K, type, spots[i], atmIvs[i], timeToExpiryYears(o.expiry, new Date(t))));
    const endModel = model[n - 1].price;
    const finalLtp = leg && leg.ltp > 0 ? leg.ltp : endModel;
    const offset = finalLtp - endModel;
    const finalIv = leg && leg.iv > 0 ? leg.iv : r2(model[n - 1].iv * 100);
    const ivOffset = finalIv - model[n - 1].iv * 100;
    const finalOi = leg ? leg.oi : Math.round(20_000 * Math.exp(-Math.abs(Math.log(K / spot)) * 30));
    const openOi = Math.max(0, finalOi - (leg ? leg.oiChange : Math.round(finalOi * 0.1)));
    const finalVol = leg ? leg.volume : Math.round(finalOi * 1.5);
    const spreadPct = leg && leg.ltp > 0 && leg.askPrice > leg.bidPrice ? (leg.askPrice - leg.bidPrice) / leg.ltp : 0.01;
    let oiNoise = 0;
    return times.map((_, i) => {
      const w = n > 1 ? i / (n - 1) : 1;
      const ltp = i === n - 1 ? finalLtp : roundTick(model[i].price + offset * w);
      const iv = i === n - 1 ? finalIv : r2(model[i].iv * 100 + ivOffset * w);
      oiNoise = i === n - 1 ? 0 : oiNoise * 0.85 + gauss(rand) * 0.004;
      const shape = 1 / (1 + Math.exp(-8 * (w - 0.45)));
      const shape0 = 1 / (1 + Math.exp(3.6));
      const shape1 = 1 / (1 + Math.exp(-4.4));
      const frac = (shape - shape0) / (shape1 - shape0);
      const oi = i === n - 1 ? finalOi : Math.max(0, Math.round((openOi + (finalOi - openOi) * frac) * (1 + oiNoise * 4 * w * (1 - w))));
      const vol = i === n - 1 ? finalVol : Math.round((finalVol * cumIntensity[i]) / totalIntensity);
      const spread = roundTick(Math.max(TICK, ltp * spreadPct));
      const bid = i === n - 1 && leg ? leg.bidPrice : r2(Math.max(TICK, roundTick(ltp - spread / 2)));
      const ask = i === n - 1 && leg ? leg.askPrice : r2(roundTick(bid + spread));
      const row: StrikeSnap = {
        strike: K,
        side: type,
        ltp: r2(ltp),
        oi,
        vol,
        iv,
        bid,
        ask,
        bidQty: lot * (1 + Math.floor(rand() * 40)),
        askQty: lot * (1 + Math.floor(rand() * 40)),
      };
      return row;
    });
  });

  return times.map((ts, i) => ({
    id: `${symbol}|${o.expiry}|${ts}`,
    symbol,
    expiry: o.expiry,
    ts,
    spot: spots[i],
    rows: [series[0][i], series[1][i]],
  }));
}

/** One day of end-of-day data for a contract (bhavcopy shape). */
export interface ContractDailyRow {
  date: string;
  close: number;
  settle: number;
  oi: number;
  chgOi: number;
  volume: number;
  underlyingClose: number;
}

/**
 * Sample end-of-day history for the contract over the last `days` trading days before the session
 * date, oldest first. Underlying closes walk back from today's sample spot; premiums are Black-76 on
 * the sample smile at each day's 15:30 IST.
 */
export function buildSampleDailyHistory(o: SampleContractInput & { type: OptionType; days?: number }): ContractDailyRow[] {
  const symbol = String(o?.symbol || "").toUpperCase();
  const K = Number(o?.strike);
  const spot = Number(o?.spot);
  if (!symbol || !(K > 0) || !(spot > 0) || !o.expiry) return [];
  const now = o.now ?? new Date();
  const days = Math.max(1, Math.min(60, Math.round(o.days ?? 10)));
  const { date: sessionDate } = sampleContractWindow(now);
  const rand = mulberry32(hashString(`daily|${symbol}|${o.expiry}|${K}|${o.type}|${sessionDate}`));
  const dates: string[] = [];
  let d = previousTradingDay(sessionDate);
  while (d && dates.length < days) {
    dates.unshift(d);
    d = previousTradingDay(d);
  }
  const dailyVol = SAMPLE_ATM_IV / Math.sqrt(252);
  const closes: number[] = new Array(dates.length);
  let s = spot;
  for (let i = dates.length - 1; i >= 0; i--) {
    s = s * Math.exp(-gauss(rand) * dailyVol);
    closes[i] = r2(s);
  }
  const rows: ContractDailyRow[] = [];
  let prevOi = 0;
  dates.forEach((date, i) => {
    const T = timeToExpiryYears(o.expiry, toISTDate(date, "15:30"));
    if (!(T > 0)) return;
    const atmIv = SAMPLE_ATM_IV * (1 + 0.05 * gauss(rand));
    const { price } = modelPrice(symbol, K, o.type, closes[i], atmIv, T);
    const ltp = r2(roundTick(price));
    const base = 8_000 * Math.exp(-Math.abs(Math.log(K / closes[i])) * 25);
    const oi = Math.round(base * (0.4 + (0.6 * (i + 1)) / dates.length) * (0.85 + 0.3 * rand()));
    rows.push({
      date,
      close: ltp,
      settle: ltp,
      oi,
      chgOi: rows.length === 0 ? Math.round(oi * 0.05) : oi - prevOi,
      volume: Math.round(oi * (0.8 + 2 * rand())),
      underlyingClose: closes[i],
    });
    prevOi = oi;
  });
  return rows;
}
