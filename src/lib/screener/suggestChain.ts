/**
 * Chain loader for the screener's "Suggested structure": the live chain for the chosen expiry via
 * the proxy (gated, so an offline proxy fails fast), else a clearly labelled Black-76 sample chain
 * seeded from the row's price and ATM IV.
 */
import { buildChainModel, type ChainModel } from "@/components/option-chain/chainModel";
import { fetchChainMulti } from "@/lib/marketApi";
import { generateSampleChain, getLotSize } from "@/lib/options";
import type { ScreenerRow } from "./metrics";
import { pickExpiry } from "./suggest";

export type SuggestionChainSource = "live" | "cache" | "sample";

export interface SuggestionChain {
  model: ChainModel;
  expiry: string;
  source: SuggestionChainSource;
  /** Why the live chain was not used (sample only). */
  reason?: string;
}

/** Sample chain model for a row (pure apart from the clock). Null when the row has no usable price. */
export function sampleSuggestionChain(
  row: Pick<ScreenerRow, "symbol" | "ltp" | "atmIv">,
  expiry: string,
  now: Date = new Date(),
): ChainModel | null {
  if (!(row.ltp > 0) || !expiry) return null;
  const atmIv = row.atmIv !== null && row.atmIv > 0 ? row.atmIv / 100 : undefined;
  const { chain, spotPrice } = generateSampleChain({
    symbol: row.symbol,
    spot: row.ltp,
    expiry,
    atmIv,
    strikes: 41,
    now,
  });
  if (chain.length === 0) return null;
  return buildChainModel(chain, {
    spot: spotPrice,
    expiry,
    lotSize: getLotSize(row.symbol, expiry) ?? 1,
    symbol: row.symbol,
    now,
  });
}

/**
 * Load the chain for a suggestion. `allowLive` false (the screener is in sample mode) skips the
 * proxy entirely so sample rows are never mixed with live premiums.
 */
export async function loadSuggestionChain(
  row: ScreenerRow,
  opts: { allowLive: boolean; signal?: AbortSignal; now?: Date },
): Promise<SuggestionChain | null> {
  const now = opts.now ?? new Date();
  const expiry = pickExpiry(row.symbol, now);
  if (!expiry) return null;
  let reason = "The screener is showing sample data.";
  if (opts.allowLive) {
    try {
      const env = await fetchChainMulti(row.symbol, [expiry], opts.signal);
      const exp = env.data?.expiries.find((e) => e.chain.length > 0);
      if (env.data && exp && env.data.spot > 0) {
        const model = buildChainModel(exp.chain, {
          spot: env.data.spot,
          expiry: exp.expiry,
          lotSize: getLotSize(row.symbol, exp.expiry) ?? 1,
          symbol: row.symbol,
          now,
        });
        if (model.rows.length > 0)
          return {
            model,
            expiry: exp.expiry,
            source: env.meta.stale || env.meta.source === "cache" ? "cache" : "live",
          };
      }
      reason = env.meta.reason ? `Live chain unavailable (${env.meta.reason}).` : "Live chain unavailable.";
    } catch (e) {
      if (opts.signal?.aborted) return null;
      reason = e instanceof Error && e.message ? `Live chain unavailable (${e.message}).` : "Live chain unavailable.";
    }
  }
  const model = sampleSuggestionChain(row, expiry, now);
  return model ? { model, expiry, source: "sample", reason } : null;
}
