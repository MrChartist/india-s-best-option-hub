import { useCallback, useSyncExternalStore } from "react";
import type { GexConvention } from "@/lib/gexData";
import { DEFAULT_PAGE_CONVENTION, readGexConvention, subscribeGexConvention, writeGexConvention } from "@/lib/gex";

/**
 * The stored GEX sign convention as React state. The GEX page and the dashboard Gamma Levels
 * card both use this, so switching the view in one place updates the other (and other tabs).
 */
export function useGexConvention(): [GexConvention, (v: GexConvention) => void] {
  const value = useSyncExternalStore(subscribeGexConvention, readGexConvention, () => DEFAULT_PAGE_CONVENTION);
  const set = useCallback((v: GexConvention) => writeGexConvention(v), []);
  return [value, set];
}
