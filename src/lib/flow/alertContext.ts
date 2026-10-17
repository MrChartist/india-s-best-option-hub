/**
 * Build the per-symbol market context the alert engine evaluates, from a real chain feed.
 * PCR comes from chain OI, ATM IV from the chain (Black-76 on the parity forward), IVP from
 * recorded end-of-day ATM IV history, per-strike quotes for contract rules and the session's
 * Premium Tide from derived prints. Sample feeds are never turned into alert context.
 *
 * Inputs come from the network and IndexedDB, so they are checked with the hand-written guards
 * below rather than trusted.
 */
import type { OptionData } from "@/lib/mockData";
import { atmIV, chainForward, getMarketParams, ivPercentile, maxPain, timeToExpiryYears } from "@/lib/options";
import { computeGammaLevels } from "@/lib/gexData";
import { latestTideNet, strikeQuotes } from "@/lib/alerts/context";
import type { FeedEntry } from "./flowStore";
import type { StrikeOI, SymbolMarket } from "./rules";
import type { FlowPrint } from "./types";

const finite = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object";

/** True for a chain row with a numeric strike (legs are read defensively). */
export function isChainRow(x: unknown): x is OptionData {
  return (
    isObj(x) && finite(x.strikePrice) && (x.ce === undefined || isObj(x.ce)) && (x.pe === undefined || isObj(x.pe))
  );
}

export type AlertFeedInput = Pick<FeedEntry, "symbol" | "expiry" | "chain" | "spot" | "asOf" | "lotSize" | "mode">;

/** True when a feed can be turned into alert context: real (not sample), priced, with a chain. */
export function isUsableFeed(x: unknown): x is AlertFeedInput {
  if (!isObj(x)) return false;
  return (
    typeof x.symbol === "string" &&
    x.symbol.length > 0 &&
    typeof x.expiry === "string" &&
    (x.mode === "live" || x.mode === "recorded") &&
    finite(x.spot) &&
    x.spot > 0 &&
    finite(x.asOf) &&
    Array.isArray(x.chain) &&
    x.chain.length > 0
  );
}

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
  return (chain ?? []).filter(isChainRow).map((r) => ({
    strike: r.strikePrice,
    ceOi: finite(r.ce?.oi) ? r.ce.oi : 0,
    peOi: finite(r.pe?.oi) ? r.pe.oi : 0,
    ceOiChg: finite(r.ce?.oiChange) ? r.ce.oiChange : 0,
    peOiChg: finite(r.pe?.oiChange) ? r.pe.oiChange : 0,
  }));
}

export function buildSymbolMarket(
  feed: AlertFeedInput,
  o: { now?: Date; ivHistory?: number[]; withFlip?: boolean; prints?: FlowPrint[] } = {},
): SymbolMarket | null {
  if (!isUsableFeed(feed)) return null;
  const chain = feed.chain.filter(isChainRow);
  if (chain.length === 0) return null;
  const now = o.now ?? new Date();
  const T = timeToExpiryYears(feed.expiry, now);
  const F = chainForward(chain, feed.spot, T, getMarketParams().r);
  const iv = finite(F) ? atmIV(chain, F) : NaN;
  const m: SymbolMarket = {
    symbol: feed.symbol,
    ts: feed.asOf,
    spot: feed.spot,
    expiry: feed.expiry,
    strikes: strikeOI(chain),
    quotes: strikeQuotes(chain),
    maxPain: maxPain(chain),
  };
  const pcr = chainPCR(chain);
  if (finite(pcr)) m.pcr = pcr;
  if (finite(iv) && iv > 0) {
    m.atmIv = iv;
    const history = (o.ivHistory ?? []).filter((v) => finite(v) && v > 0);
    m.ivp = history.length > 0 ? ivPercentile(iv, history) : null;
  }
  if (o.withFlip) {
    try {
      const flip = computeGammaLevels(chain, feed.spot, feed.expiry, feed.lotSize).flip;
      m.gammaFlip = finite(flip) ? flip : null;
    } catch {
      m.gammaFlip = null;
    }
  }
  if (o.prints) {
    const tide = latestTideNet(o.prints, feed.symbol);
    if (finite(tide)) m.tideNet = tide;
  }
  return m;
}
