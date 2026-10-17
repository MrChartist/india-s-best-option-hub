/** The paper account's open positions as tracked positions, so Positions' Greeks, scenarios, payoff and hints apply to them. */
import { formatDateIST, istDateString } from "@/lib/options";
import type { PaperPosition } from "@/lib/paperTrading";
import { createPosition, type TrackedPosition } from "@/lib/positionStore";

export function paperToTracked(p: PaperPosition): TrackedPosition {
  const opened = new Date(Number.isFinite(p.openedAt) ? p.openedAt : Date.now());
  const iso = istDateString(opened);
  return createPosition({
    id: `paper:${p.key}`,
    symbol: p.symbol,
    type: p.type,
    action: p.netLots > 0 ? "BUY" : "SELL",
    strike: p.strike,
    entryPrice: p.avgPrice,
    currentPrice: p.ltp !== undefined && p.ltp >= 0 ? p.ltp : p.avgPrice,
    lots: Math.abs(p.netLots),
    lotSize: p.lotSize,
    expiry: p.expiry,
    entryDateIso: iso,
    entryDate: formatDateIST(iso),
    iv: p.context?.iv ?? undefined,
    source: p.markSource === "sample" ? "sample" : undefined,
  });
}

export function paperPositionsAsTracked(positions: PaperPosition[] | undefined | null): TrackedPosition[] {
  return (positions ?? []).filter((p) => p.netLots !== 0).map(paperToTracked);
}
