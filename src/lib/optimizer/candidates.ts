/**
 * Strategy Optimizer: liquidity-filtered quotes and candidate enumeration.
 *
 * Short and centre legs sit within ±N listed strikes of ATM; wings are 1–6 listed strikes away
 * (index offsets in the sorted strike list, so uneven stock strike grids still work).
 */
import type { OptionData, OptionLegData } from "@/lib/mockData";
import { pctToDec, type OptionType, type Side } from "@/lib/options";
import { KIND_META, type Candidate, type CandidateLeg, type Pricing, type StrategyKind } from "./types";

export const MAX_WING_STEPS = 6;

export interface LiquidityRules {
  minOiPct: number;
  maxSpreadPct: number;
  minPremium: number;
  pricing: Pricing;
}

export interface QuoteBook {
  expiry: string;
  strikes: number[];
  rows: Map<number, OptionData>;
  maxOi: number;
}

const pos = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x) && x > 0;

export function buildQuoteBook(expiry: string, chain: OptionData[]): QuoteBook {
  const rows = new Map<number, OptionData>();
  let maxOi = 0;
  for (const row of Array.isArray(chain) ? chain : []) {
    if (!row || !pos(row.strikePrice)) continue;
    rows.set(row.strikePrice, row);
    if (pos(row.ce?.oi)) maxOi = Math.max(maxOi, row.ce.oi);
    if (pos(row.pe?.oi)) maxOi = Math.max(maxOi, row.pe.oi);
  }
  const strikes = Array.from(rows.keys()).sort((a, b) => a - b);
  return { expiry, strikes, rows, maxOi };
}

/** Index of the listed strike nearest to spot (−1 for an empty book). */
export function atmIndex(book: QuoteBook, spot: number): number {
  let best = -1;
  let bestDiff = Infinity;
  book.strikes.forEach((k, i) => {
    const d = Math.abs(k - spot);
    if (d < bestDiff) {
      bestDiff = d;
      best = i;
    }
  });
  return best;
}

export type LegQuote = Omit<CandidateLeg, "ratio">;

/**
 * Price one leg after the liquidity rules. Returns null when the leg fails OI, spread or minimum
 * premium. Without a two-sided quote, LTP is used and the leg is flagged (noQuote).
 */
export function quoteLeg(book: QuoteBook, strike: number, type: OptionType, side: Side, rules: LiquidityRules): LegQuote | null {
  const row = book.rows.get(strike);
  const leg: OptionLegData | undefined = row ? (type === "CE" ? row.ce : row.pe) : undefined;
  if (!leg) return null;
  const oi = pos(leg.oi) ? leg.oi : 0;
  if (book.maxOi > 0 && rules.minOiPct > 0 && oi < rules.minOiPct * book.maxOi) return null;
  const bid = pos(leg.bidPrice) ? leg.bidPrice : 0;
  const ask = pos(leg.askPrice) ? leg.askPrice : 0;
  const twoSided = bid > 0 && ask > 0 && ask >= bid;
  let premium: number;
  let spreadPct: number | null = null;
  if (twoSided) {
    const mid = (bid + ask) / 2;
    spreadPct = mid > 0 ? (ask - bid) / mid : null;
    if (spreadPct !== null && spreadPct > rules.maxSpreadPct) return null;
    premium = rules.pricing === "natural" ? (side === "BUY" ? ask : bid) : mid;
  } else {
    if (!pos(leg.ltp)) return null;
    premium = leg.ltp;
  }
  if (!(premium >= rules.minPremium) || !(premium > 0)) return null;
  return {
    type,
    side,
    strike,
    expiry: book.expiry,
    premium: Math.round(premium * 100) / 100,
    iv: pos(leg.iv) ? pctToDec(leg.iv) : null,
    oi,
    spreadPct,
    noQuote: !twoSided,
  };
}

/**
 * Defined risk: for each option type, long lots cover short lots, counting only longs that expire
 * on or after the short leg. A covered short call caps the upside loss; a covered short put caps the
 * downside beyond the long strike.
 */
export function isDefinedRisk(legs: Array<Pick<CandidateLeg, "type" | "side" | "ratio" | "expiry">>): boolean {
  for (const type of ["CE", "PE"] as const) {
    const shorts = legs.filter((l) => l.type === type && l.side === "SELL");
    for (const s of shorts) {
      const shortQty = shorts.filter((x) => x.expiry <= s.expiry).reduce((a, x) => a + x.ratio, 0);
      const longQty = legs.filter((l) => l.type === type && l.side === "BUY" && l.expiry >= s.expiry).reduce((a, x) => a + x.ratio, 0);
      if (longQty < shortQty) return false;
    }
  }
  return true;
}

export function candidateId(kind: StrategyKind, legs: CandidateLeg[]): string {
  return `${kind}:${legs.map((l) => `${l.side === "BUY" ? "B" : "S"}${l.ratio}${l.type}${l.strike}@${l.expiry}`).join("|")}`;
}

export interface EnumerateOptions {
  front: QuoteBook;
  back?: QuoteBook | null;
  spot: number;
  strikesAroundAtm: number;
  definedRiskOnly: boolean;
  kinds?: StrategyKind[] | null;
  rules: LiquidityRules;
}

export interface EnumerateResult {
  candidates: Candidate[];
  /** Structures considered (before liquidity and risk filters). */
  enumerated: number;
  liquidityRejected: number;
  riskSkipped: number;
  multiExpirySkipped: boolean;
}

type LegSpec = { book: QuoteBook; i: number; type: OptionType; side: Side; ratio?: number };

/** Enumerate every candidate structure, apply the liquidity rules and the defined-risk toggle. */
export function enumerateCandidates(o: EnumerateOptions): EnumerateResult {
  const { front } = o;
  const back = o.back && o.back.strikes.length > 0 && o.back.expiry > front.expiry ? o.back : null;
  const wanted = new Set<StrategyKind>(o.kinds && o.kinds.length > 0 ? o.kinds : (Object.keys(KIND_META) as StrategyKind[]));
  const out: Candidate[] = [];
  const seen = new Set<string>();
  let enumerated = 0;
  let liquidityRejected = 0;
  let riskSkipped = 0;
  const wantsMulti = Array.from(wanted).some((k) => KIND_META[k].multiExpiry);
  const multiExpirySkipped = wantsMulti && !back;

  const a = atmIndex(front, o.spot);
  if (a < 0) return { candidates: [], enumerated: 0, liquidityRejected: 0, riskSkipped: 0, multiExpirySkipped };
  const n = Math.max(1, Math.min(30, Math.round(o.strikesAroundAtm)));
  const S = front.strikes;
  const lo = Math.max(0, a - n);
  const hi = Math.min(S.length - 1, a + n);

  const cache = new Map<string, LegQuote | null>();
  const quote = (book: QuoteBook, i: number, type: OptionType, side: Side): LegQuote | null => {
    if (i < 0 || i >= book.strikes.length) return null;
    const strike = book.strikes[i];
    const key = `${book.expiry}|${strike}|${type}|${side}`;
    if (!cache.has(key)) cache.set(key, quoteLeg(book, strike, type, side, o.rules));
    return cache.get(key) ?? null;
  };

  const emit = (kind: StrategyKind, specs: LegSpec[]) => {
    if (!wanted.has(kind)) return;
    if (specs.some((s) => s.i < 0 || s.i >= s.book.strikes.length)) return;
    enumerated++;
    const meta = KIND_META[kind];
    if (o.definedRiskOnly && !meta.definedRisk) {
      riskSkipped++;
      return;
    }
    const legs: CandidateLeg[] = [];
    for (const s of specs) {
      const q = quote(s.book, s.i, s.type, s.side);
      if (!q) {
        liquidityRejected++;
        return;
      }
      legs.push({ ...q, ratio: s.ratio ?? 1 });
    }
    if (o.definedRiskOnly && !isDefinedRisk(legs)) {
      riskSkipped++;
      return;
    }
    const id = candidateId(kind, legs);
    if (seen.has(id)) return;
    seen.add(id);
    out.push({ id, kind, category: meta.category, legs });
  };

  const F = front;
  const W = MAX_WING_STEPS;

  for (let i = lo; i <= hi; i++) {
    // Singles
    emit("long_call", [{ book: F, i, type: "CE", side: "BUY" }]);
    emit("long_put", [{ book: F, i, type: "PE", side: "BUY" }]);
    emit("short_straddle", [
      { book: F, i, type: "CE", side: "SELL" },
      { book: F, i, type: "PE", side: "SELL" },
    ]);

    for (let w = 1; w <= W; w++) {
      // Verticals (lower strike i, upper strike i + w)
      emit("bull_call_spread", [
        { book: F, i, type: "CE", side: "BUY" },
        { book: F, i: i + w, type: "CE", side: "SELL" },
      ]);
      emit("bear_call_spread", [
        { book: F, i, type: "CE", side: "SELL" },
        { book: F, i: i + w, type: "CE", side: "BUY" },
      ]);
      emit("bull_put_spread", [
        { book: F, i, type: "PE", side: "BUY" },
        { book: F, i: i + w, type: "PE", side: "SELL" },
      ]);
      emit("bear_put_spread", [
        { book: F, i, type: "PE", side: "SELL" },
        { book: F, i: i + w, type: "PE", side: "BUY" },
      ]);
      // Iron fly centred at i
      emit("iron_fly", [
        { book: F, i: i - w, type: "PE", side: "BUY" },
        { book: F, i, type: "PE", side: "SELL" },
        { book: F, i, type: "CE", side: "SELL" },
        { book: F, i: i + w, type: "CE", side: "BUY" },
      ]);
      // 1×2 ratio spreads
      emit("call_ratio_spread", [
        { book: F, i, type: "CE", side: "BUY" },
        { book: F, i: i + w, type: "CE", side: "SELL", ratio: 2 },
      ]);
      emit("put_ratio_spread", [
        { book: F, i, type: "PE", side: "BUY" },
        { book: F, i: i - w, type: "PE", side: "SELL", ratio: 2 },
      ]);
      // Broken-wing butterflies: near wing w1, far (wider) wing w2 > w1
      for (let w2 = w + 1; w2 <= W; w2++) {
        emit("call_bwb", [
          { book: F, i, type: "CE", side: "BUY" },
          { book: F, i: i + w, type: "CE", side: "SELL", ratio: 2 },
          { book: F, i: i + w + w2, type: "CE", side: "BUY" },
        ]);
        emit("put_bwb", [
          { book: F, i, type: "PE", side: "BUY" },
          { book: F, i: i - w, type: "PE", side: "SELL", ratio: 2 },
          { book: F, i: i - w - w2, type: "PE", side: "BUY" },
        ]);
      }
    }

    if (back) {
      const strike = S[i];
      const bi = back.strikes.indexOf(strike);
      if (bi >= 0) {
        emit("call_calendar", [
          { book: F, i, type: "CE", side: "SELL" },
          { book: back, i: bi, type: "CE", side: "BUY" },
        ]);
        emit("put_calendar", [
          { book: F, i, type: "PE", side: "SELL" },
          { book: back, i: bi, type: "PE", side: "BUY" },
        ]);
        for (let w = 1; w <= W; w++) {
          // Debit diagonals: long back-month nearer the money, short front-month further out.
          const ceShort = i + w;
          const peShort = i - w;
          if (ceShort < S.length) {
            emit("call_diagonal", [
              { book: back, i: bi, type: "CE", side: "BUY" },
              { book: F, i: ceShort, type: "CE", side: "SELL" },
            ]);
          }
          if (peShort >= 0) {
            emit("put_diagonal", [
              { book: back, i: bi, type: "PE", side: "BUY" },
              { book: F, i: peShort, type: "PE", side: "SELL" },
            ]);
          }
        }
      }
    }
  }

  // Two-sided short structures: short put at p (≤ ATM), short call at c (≥ ATM)
  for (let p = lo; p <= a; p++) {
    for (let c = a; c <= hi; c++) {
      if (c <= p) continue;
      emit("short_strangle", [
        { book: F, i: p, type: "PE", side: "SELL" },
        { book: F, i: c, type: "CE", side: "SELL" },
      ]);
      for (let w = 1; w <= W; w++) {
        emit("iron_condor", [
          { book: F, i: p - w, type: "PE", side: "BUY" },
          { book: F, i: p, type: "PE", side: "SELL" },
          { book: F, i: c, type: "CE", side: "SELL" },
          { book: F, i: c + w, type: "CE", side: "BUY" },
        ]);
        if (c > a) {
          emit("jade_lizard", [
            { book: F, i: p, type: "PE", side: "SELL" },
            { book: F, i: c, type: "CE", side: "SELL" },
            { book: F, i: c + w, type: "CE", side: "BUY" },
          ]);
        }
      }
    }
  }

  return { candidates: out, enumerated, liquidityRejected, riskSkipped, multiExpirySkipped };
}
