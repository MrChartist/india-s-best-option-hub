/**
 * Build the per-symbol market context the alert engine evaluates, from a real chain feed.
 * PCR comes from chain OI, ATM IV from the chain (Black-76 on the parity forward), IVP from
 * recorded end-of-day ATM IV history. Sample feeds are never turned into alert context.
 */
import type { OptionData } from "@/lib/mockData";
import { atmIV, chainForward, getMarketParams, ivPercentile, maxPain, timeToExpiryYears } from "@/lib/options";
import { computeGammaLevels } from "@/lib/gexData";
import type { FeedEntry } from "./flowStore";
import type { StrikeOI, SymbolMarket } from "./rules";

const finite = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

export function chainPCR(chain: OptionData[]): number {
  let ce = 0;
  let pe = 0;
  for (const r of chain ?? []) {
    ce += finite(r?.ce?.oi) ? r.ce.oi : 0;
    pe += finite(r?.pe?.oi) ? r.pe.oi : 0;
  }
  return ce > 0 ? pe / ce : NaN;
}

export function strikeOI(chain: OptionData[]): StrikeOI[] {
  return (chain ?? [])
    .filter((r) => r && finite(r.strikePrice))
    .map((r) => ({
      strike: r.strikePrice,
      ceOi: finite(r.ce?.oi) ? r.ce.oi : 0,
      peOi: finite(r.pe?.oi) ? r.pe.oi : 0,
      ceOiChg: finite(r.ce?.oiChange) ? r.ce.oiChange : 0,
      peOiChg: finite(r.pe?.oiChange) ? r.pe.oiChange : 0,
    }));
}

export function buildSymbolMarket(
  feed: Pick<FeedEntry, "symbol" | "expiry" | "chain" | "spot" | "asOf" | "lotSize" | "mode">,
  o: { now?: Date; ivHistory?: number[]; withFlip?: boolean } = {},
): SymbolMarket | null {
  if (!feed || feed.mode === "sample" || !Array.isArray(feed.chain) || feed.chain.length === 0 || !(feed.spot > 0)) return null;
  const now = o.now ?? new Date();
  const T = timeToExpiryYears(feed.expiry, now);
  const F = chainForward(feed.chain, feed.spot, T, getMarketParams().r);
  const iv = finite(F) ? atmIV(feed.chain, F) : NaN;
  const m: SymbolMarket = {
    symbol: feed.symbol,
    ts: feed.asOf,
    spot: feed.spot,
    strikes: strikeOI(feed.chain),
    maxPain: maxPain(feed.chain),
  };
  const pcr = chainPCR(feed.chain);
  if (finite(pcr)) m.pcr = pcr;
  if (finite(iv) && iv > 0) {
    m.atmIv = iv;
    if (o.ivHistory && o.ivHistory.length > 0) m.ivp = ivPercentile(iv, o.ivHistory);
    else m.ivp = null;
  }
  if (o.withFlip) {
    try {
      m.gammaFlip = computeGammaLevels(feed.chain, feed.spot, feed.expiry, feed.lotSize).flip;
    } catch {
      m.gammaFlip = null;
    }
  }
  return m;
}
