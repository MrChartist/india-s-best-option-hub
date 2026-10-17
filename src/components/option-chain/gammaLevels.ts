/**
 * Gamma-level badges (CW / PW / AG / FLIP) for chain rows.
 *
 * `computeGammaLevels` is owned by the GEX stream in "@/lib/gexData". It is looked up on the
 * module namespace at runtime so the chain keeps rendering (without badges) if the function is
 * missing, has a different shape, or throws.
 */
import type { OptionData } from "@/lib/mockData";
import * as gexModule from "@/lib/gexData";

export interface GammaLevels {
  callWall: number;
  putWall: number;
  absGamma: number;
  flip: number | null;
}

export type GammaBadge = "CW" | "PW" | "AG" | "FLIP";

export const GAMMA_BADGE_TITLE: Record<GammaBadge, string> = {
  CW: "Call wall: strike with the largest call gamma exposure (resistance)",
  PW: "Put wall: strike with the largest put gamma exposure (support)",
  AG: "Absolute gamma: strike with the largest total gamma exposure (magnet)",
  FLIP: "Gamma flip: where net dealer gamma changes sign (nearest strike shown)",
};

type ComputeFn = (chain: OptionData[], spot: number, expiry: string, lotSize: number) => unknown;

function isLevels(x: unknown): x is GammaLevels {
  if (!x || typeof x !== "object") return false;
  const l = x as Record<string, unknown>;
  return typeof l.callWall === "number" && typeof l.putWall === "number" && typeof l.absGamma === "number" && (l.flip === null || typeof l.flip === "number");
}

export function safeGammaLevels(chain: OptionData[], spot: number, expiry: string, lotSize: number): GammaLevels | null {
  try {
    const fn = (gexModule as unknown as Record<string, unknown>).computeGammaLevels;
    if (typeof fn !== "function") return null;
    const res = (fn as ComputeFn)(chain, spot, expiry, lotSize);
    return isLevels(res) ? res : null;
  } catch {
    return null;
  }
}

/** Map strike → badges. FLIP snaps to the nearest listed strike. */
export function gammaBadgeMap(levels: GammaLevels | null, strikes: number[]): Map<number, GammaBadge[]> {
  const map = new Map<number, GammaBadge[]>();
  if (!levels || strikes.length === 0) return map;
  const add = (k: number, b: GammaBadge) => {
    if (!Number.isFinite(k) || k <= 0) return;
    const list = map.get(k) ?? [];
    if (!list.includes(b)) list.push(b);
    map.set(k, list);
  };
  add(levels.callWall, "CW");
  add(levels.putWall, "PW");
  add(levels.absGamma, "AG");
  if (levels.flip !== null && Number.isFinite(levels.flip)) {
    let best = strikes[0];
    for (const s of strikes) if (Math.abs(s - levels.flip) < Math.abs(best - levels.flip)) best = s;
    add(best, "FLIP");
  }
  return map;
}
