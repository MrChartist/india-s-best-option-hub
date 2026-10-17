import type { Buildup } from "@/lib/options";

/** Badge variant per buildup: LB bullish, SB bearish, SC info, LU warning. */
export const BUILDUP_VARIANT: Record<Buildup, "bullish" | "bearish" | "info" | "warning" | "neutral"> = {
  LONG_BUILDUP: "bullish",
  SHORT_BUILDUP: "bearish",
  SHORT_COVERING: "info",
  LONG_UNWINDING: "warning",
  NEUTRAL: "neutral",
};

export const BUILDUP_SHORT: Record<Buildup, string> = {
  LONG_BUILDUP: "Long BU",
  SHORT_BUILDUP: "Short BU",
  SHORT_COVERING: "Short cov",
  LONG_UNWINDING: "Long unw",
  NEUTRAL: "Neutral",
};
