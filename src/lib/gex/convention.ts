/**
 * One stored GEX sign-convention preference, shared by the Gamma Exposure page and the dashboard
 * Gamma Levels card so both always show the same view.
 *
 *   sellerShortBoth          India seller view (default): writers short calls and puts.
 *   dealerLongCallShortPut   US dealer model: dealers long calls, short puts (has a gamma flip).
 */
import type { GexConvention } from "@/lib/gexData";

export const GEX_CONVENTION_KEY = "mc_gex_convention";
export const GEX_CONVENTION_EVENT = "mc:gex-convention";
export const DEFAULT_PAGE_CONVENTION: GexConvention = "sellerShortBoth";

/** Short, user-facing names for the two views (match the toggle on the GEX page). */
export const GEX_CONVENTION_SHORT: Record<GexConvention, string> = {
  sellerShortBoth: "Seller view (India)",
  dealerLongCallShortPut: "Dealer model (US)",
};

/** Validate a stored value; anything unknown falls back to the India seller view. */
export function parseGexConvention(v: unknown): GexConvention {
  return v === "sellerShortBoth" || v === "dealerLongCallShortPut" ? v : DEFAULT_PAGE_CONVENTION;
}

export function readGexConvention(): GexConvention {
  try {
    return parseGexConvention(globalThis.localStorage?.getItem(GEX_CONVENTION_KEY));
  } catch {
    return DEFAULT_PAGE_CONVENTION;
  }
}

/** Persist and broadcast so every mounted consumer in this tab updates at once. */
export function writeGexConvention(v: GexConvention): void {
  const next = parseGexConvention(v);
  try {
    globalThis.localStorage?.setItem(GEX_CONVENTION_KEY, next);
  } catch {
    /* storage unavailable: the in-tab event still syncs consumers */
  }
  try {
    if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(GEX_CONVENTION_EVENT, { detail: next }));
  } catch {
    /* CustomEvent unavailable */
  }
}

/** Subscribe to changes from this tab (custom event) and other tabs (storage event). */
export function subscribeGexConvention(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === GEX_CONVENTION_KEY) cb();
  };
  window.addEventListener(GEX_CONVENTION_EVENT, cb);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(GEX_CONVENTION_EVENT, cb);
    window.removeEventListener("storage", onStorage);
  };
}
