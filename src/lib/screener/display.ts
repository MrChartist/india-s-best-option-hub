/** Display constants shared by screener components (kept out of component files for fast refresh). */
import type { BuildupKind } from "@/components/ui/buildup-badge";
import type { Buildup } from "@/lib/options";

/** Two-letter code used by the shared BuildupBadge; null for neutral. */
export const BUILDUP_KIND: Readonly<Record<Buildup, BuildupKind | null>> = {
  LONG_BUILDUP: "LB",
  SHORT_BUILDUP: "SB",
  SHORT_COVERING: "SC",
  LONG_UNWINDING: "LU",
  NEUTRAL: null,
};

/** Deep links for a symbol. Pure, so the menu and tests share one definition. */
export function symbolLinks(symbol: string) {
  const s = encodeURIComponent(symbol);
  return {
    chain: `/option-chain?symbol=${s}`,
    builder: `/strategy-builder?symbol=${s}`,
    optimizer: `/optimizer?symbol=${s}`,
  };
}
