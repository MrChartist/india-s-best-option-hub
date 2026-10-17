/**
 * Basket of option legs shared with the Strategy Builder, Paper Trading and the Optimizer.
 *
 * Contract (shared across streams):
 *  - localStorage key "mc_basket_v1" holds BasketLeg[].
 *  - "Open in Strategy Builder" navigates to /strategy-builder?legs=<base64url(JSON.stringify(BasketLeg[]))>.
 *  - `premium` is rupees per unit (mid when a two-sided quote exists, else LTP).
 *  - `iv` is a DECIMAL (0.142 = 14.2%), matching Leg.iv in "@/lib/options"; null when unknown.
 */
import type { OptionType, Side } from "@/lib/options";
import type { RowView } from "./chainModel";
import { nearestStrike } from "./chainModel";

export const BASKET_KEY = "mc_basket_v1";
export const STRATEGY_BUILDER_PATH = "/strategy-builder";

export interface BasketLeg {
  symbol: string;
  expiry: string;
  strike: number;
  type: OptionType;
  side: Side;
  lots: number;
  premium: number;
  iv: number | null;
}

const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

/** Validate one unknown value as a BasketLeg (used when reading storage). */
export function isBasketLeg(x: unknown): x is BasketLeg {
  if (!x || typeof x !== "object") return false;
  const l = x as Record<string, unknown>;
  return (
    typeof l.symbol === "string" &&
    typeof l.expiry === "string" &&
    isNum(l.strike) &&
    (l.type === "CE" || l.type === "PE") &&
    (l.side === "BUY" || l.side === "SELL") &&
    isNum(l.lots) &&
    isNum(l.premium) &&
    (l.iv === null || l.iv === undefined || isNum(l.iv))
  );
}

/** Two legs are the same contract and direction. */
export function sameLeg(a: BasketLeg, b: BasketLeg): boolean {
  return a.symbol === b.symbol && a.expiry === b.expiry && a.strike === b.strike && a.type === b.type && a.side === b.side;
}

/** Add legs, merging lots into an existing identical leg (and refreshing its premium and IV). */
export function addLegs(basket: BasketLeg[], legs: BasketLeg[]): BasketLeg[] {
  const out = basket.map((l) => ({ ...l }));
  for (const leg of legs) {
    const i = out.findIndex((l) => sameLeg(l, leg));
    if (i >= 0) out[i] = { ...out[i], lots: out[i].lots + leg.lots, premium: leg.premium, iv: leg.iv };
    else out.push({ ...leg });
  }
  return out;
}

export function readBasket(): BasketLeg[] {
  try {
    const raw = localStorage.getItem(BASKET_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isBasketLeg).map((l) => ({ ...l, iv: l.iv ?? null })) : [];
  } catch {
    return [];
  }
}

export function writeBasket(legs: BasketLeg[]): void {
  try {
    localStorage.setItem(BASKET_KEY, JSON.stringify(legs));
  } catch {
    /* storage full or blocked: the basket stays in memory for this session */
  }
}

/** UTF-8 safe base64url (no padding). */
export function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64Url(s: string): string {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  const bin = atob(padded);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

export function encodeLegs(legs: BasketLeg[]): string {
  return toBase64Url(JSON.stringify(legs));
}

export function decodeLegs(s: string): BasketLeg[] {
  try {
    const parsed: unknown = JSON.parse(fromBase64Url(s));
    return Array.isArray(parsed) ? parsed.filter(isBasketLeg) : [];
  } catch {
    return [];
  }
}

export function strategyBuilderUrl(legs: BasketLeg[]): string {
  return `${STRATEGY_BUILDER_PATH}?legs=${encodeLegs(legs)}`;
}

/** Net premium in rupees for the basket: positive = credit received. */
export function basketNetPremium(legs: BasketLeg[], lotSizeFor: (symbol: string, expiry: string) => number): number {
  let net = 0;
  for (const l of legs) net += (l.side === "SELL" ? 1 : -1) * l.premium * l.lots * lotSizeFor(l.symbol, l.expiry);
  return net;
}

// ── Leg builders from chain rows ──

export interface LegContext {
  symbol: string;
  expiry: string;
  lots?: number;
}

const round2 = (v: number) => Math.round(v * 100) / 100;

export function legFromRow(row: RowView, type: OptionType, side: Side, c: LegContext): BasketLeg {
  const lv = type === "CE" ? row.ce : row.pe;
  const premium = lv.mid > 0 ? lv.mid : lv.leg.ltp || 0;
  const iv = lv.leg.iv > 0 ? Math.round(lv.leg.iv * 100) / 10000 : null;
  return { symbol: c.symbol, expiry: c.expiry, strike: row.strike, type, side, lots: c.lots ?? 1, premium: round2(premium), iv };
}

function rowAt(rows: RowView[], strike: number): RowView | undefined {
  return rows.find((r) => r.strike === strike);
}

/** CE + PE at the same strike. */
export function buildStraddle(rows: RowView[], strike: number, side: Side, c: LegContext): BasketLeg[] {
  const row = rowAt(rows, strike);
  if (!row) return [];
  return [legFromRow(row, "CE", side, c), legFromRow(row, "PE", side, c)];
}

/** OTM CE at centre + 1σ and OTM PE at centre − 1σ (nearest listed strikes). */
export function buildStrangle(rows: RowView[], centre: number, sigmaPoints: number, side: Side, c: LegContext): BasketLeg[] {
  if (!(sigmaPoints > 0)) return [];
  const ceK = nearestStrike(rows, centre + sigmaPoints);
  const peK = nearestStrike(rows, centre - sigmaPoints);
  const ce = rowAt(rows, ceK);
  const pe = rowAt(rows, peK);
  if (!ce || !pe || ceK === peK) return [];
  return [legFromRow(ce, "CE", side, c), legFromRow(pe, "PE", side, c)];
}

/**
 * Short iron fly: sell the CE and PE at the centre, buy wings at centre ± straddle premium
 * (nearest listed strikes, at least one strike away).
 */
export function buildIronFly(rows: RowView[], centre: number, c: LegContext): BasketLeg[] {
  const idx = rows.findIndex((r) => r.strike === centre);
  if (idx < 0) return [];
  const body = rows[idx];
  const straddle = (body.ce.mid || body.ce.leg.ltp) + (body.pe.mid || body.pe.leg.ltp);
  if (!(straddle > 0)) return [];
  let up = rows.findIndex((r) => r.strike === nearestStrike(rows, centre + straddle));
  let dn = rows.findIndex((r) => r.strike === nearestStrike(rows, centre - straddle));
  if (up <= idx) up = idx + 1;
  if (dn >= idx) dn = idx - 1;
  if (up >= rows.length || dn < 0) return [];
  return [
    legFromRow(body, "CE", "SELL", c),
    legFromRow(body, "PE", "SELL", c),
    legFromRow(rows[up], "CE", "BUY", c),
    legFromRow(rows[dn], "PE", "BUY", c),
  ];
}
