/**
 * Deterministic, clearly labelled sample data for the screener. Used only when the live
 * F&O list (or a panel's endpoint) returns nothing. Every row carries isSample = true.
 */
import type { BanListData, MwplRow } from "./ban";
import type { DealRow } from "./bigMoney";
import { buildupTag, mwplStatus, type ScreenerRow } from "./metrics";
import { FNO_INDICES, STATIC_FNO_STOCKS, sectorOf } from "./universe";

/** mulberry32: small, fast, deterministic PRNG. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSymbol(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const r2 = (x: number) => Math.round(x * 100) / 100;

const INDEX_SPOT: Record<string, number> = { NIFTY: 25200, BANKNIFTY: 56400, FINNIFTY: 26700, MIDCPNIFTY: 13100 };

/** One sample row per static F&O stock plus the four indices. Same output for the same seed. */
export function sampleRows(seed = 20261017): ScreenerRow[] {
  const symbols = [...FNO_INDICES, ...STATIC_FNO_STOCKS];
  return symbols.map((symbol) => {
    const rnd = seededRandom(hashSymbol(symbol) ^ seed);
    const isIndex = FNO_INDICES.includes(symbol);
    const ltp = isIndex ? INDEX_SPOT[symbol] ?? 20000 : r2(80 + rnd() * 4200);
    const changePct = r2((rnd() - 0.5) * (isIndex ? 2.4 : 7));
    const oiChangePct = r2((rnd() - 0.45) * 24);
    const hv20 = r2((isIndex ? 10 : 18) + rnd() * (isIndex ? 8 : 26));
    const atmIv = r2(hv20 * (0.75 + rnd() * 0.75));
    const mwplPct = isIndex ? null : r2(Math.min(99, Math.pow(rnd(), 1.6) * 100));
    const banned = mwplPct !== null && mwplPct >= 95;
    const volRatio = r2(0.4 + Math.pow(rnd(), 3) * 4.2);
    const basisPct = r2(0.1 + rnd() * 0.9);
    const futDte = 3 + Math.floor(rnd() * 25);
    return {
      symbol,
      kind: isIndex ? "INDEX" : "STOCK",
      sector: sectorOf(symbol),
      ltp,
      changePct,
      volume: isIndex ? 0 : Math.round(1e5 + rnd() * 2e7),
      oiChangePct,
      oiSource: "sample",
      buildup: buildupTag(changePct, oiChangePct),
      atmIv,
      ivp: Math.round(rnd() * 100),
      hv20,
      ivHvRatio: r2(atmIv / hv20),
      pcrOi: r2(0.4 + rnd() * 1.1),
      pcrSource: "sample",
      chainStale: false,
      volRatio,
      mwplPct,
      banned,
      mwplStatus: isIndex ? null : mwplStatus(mwplPct, banned),
      basis: r2((ltp * basisPct) / 100),
      basisPct,
      carryPct: r2((basisPct / 100) * (365 / futDte) * 100),
      rolloverPct: r2(Math.max(2, Math.min(95, ((30 - futDte) / 30) * 85 + rnd() * 10))),
      futDte,
      isSample: true,
      scannedAt: null,
    } satisfies ScreenerRow;
  });
}

export function sampleMwpl(seed = 20261017): MwplRow[] {
  return sampleRows(seed)
    .filter((r) => r.mwplPct !== null)
    .map((r) => ({ symbol: r.symbol, mwplPct: r.mwplPct as number }))
    .sort((a, b) => b.mwplPct - a.mwplPct);
}

export function sampleBanList(date: string, seed = 20261017): BanListData {
  return { date, symbols: sampleRows(seed).filter((r) => r.banned).map((r) => r.symbol).sort() };
}


const SAMPLE_CLIENTS = ["Sample Fund A", "Sample Securities LLP", "Sample Capital Ltd", "Sample Investments", "Sample Ventures"];

export function sampleDeals(kind: "bulk" | "block", date: string, seed = 20261017): DealRow[] {
  const rnd = seededRandom(seed ^ (kind === "bulk" ? 11 : 29));
  const pool = STATIC_FNO_STOCKS;
  const n = kind === "bulk" ? 8 : 5;
  const out: DealRow[] = [];
  for (let i = 0; i < n; i++) {
    const symbol = pool[Math.floor(rnd() * pool.length)];
    out.push({
      date,
      symbol,
      name: symbol,
      client: SAMPLE_CLIENTS[Math.floor(rnd() * SAMPLE_CLIENTS.length)],
      side: rnd() > 0.5 ? "BUY" : "SELL",
      qty: Math.round((kind === "block" ? 2e5 : 5e4) + rnd() * 3e6),
      price: r2(100 + rnd() * 3000),
    });
  }
  return out;
}
