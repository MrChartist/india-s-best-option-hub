/**
 * Indian F&O transaction charges: brokerage, STT, exchange transaction charges,
 * SEBI turnover fee, stamp duty and GST — from a dated rate table.
 *
 * All rates are fractions of turnover (premium × qty for options, price × qty for futures).
 * verify: true — confirm against the latest exchange / SEBI / Finance Act notifications.
 */
import { breakevens } from "./payoff";
import { getContractSpec } from "./instruments";
import { istDateString } from "./time";
import type { Exchange, Leg, OptionType, Side } from "./types";
import { isLegEnabled } from "./types";

export interface BrokerPreset {
  id: string;
  name: string;
  /** Flat brokerage per executed order (₹). */
  perOrder: number;
  /** Optional percentage-of-turnover brokerage (fraction), capped at `cap` (or perOrder). */
  pctOfTurnover?: number;
  cap?: number;
}

export const BROKER_PRESETS: BrokerPreset[] = [
  { id: "zerodha", name: "Zerodha", perOrder: 20 },
  { id: "dhan", name: "Dhan", perOrder: 20 },
  { id: "upstox", name: "Upstox", perOrder: 20 },
  { id: "angel", name: "Angel One", perOrder: 20 },
  { id: "fyers", name: "Fyers", perOrder: 20 },
  { id: "custom", name: "Custom", perOrder: 0 },
];

export function getBrokerPreset(id: string): BrokerPreset | undefined {
  return BROKER_PRESETS.find((b) => b.id === id);
}

export interface ChargeRates {
  effectiveFrom: string;
  sttOptionSell: number;
  sttOptionExercise: number;
  sttFutSell: number;
  nseTxnOpt: number;
  bseTxnOpt: number;
  nseTxnFut: number;
  /** ₹ per crore of turnover */
  sebiPerCrore: number;
  stampOptBuy: number;
  stampFutBuy: number;
  gst: number;
}

/** Sorted ascending by effectiveFrom. verify: true */
export const CHARGE_RATE_TABLE: ChargeRates[] = [
  {
    effectiveFrom: "2024-10-01",
    sttOptionSell: 0.001,
    sttOptionExercise: 0.00125,
    sttFutSell: 0.0002,
    nseTxnOpt: 0.0003503,
    bseTxnOpt: 0.000325,
    nseTxnFut: 0.0000173,
    sebiPerCrore: 10,
    stampOptBuy: 0.00003,
    stampFutBuy: 0.00002,
    gst: 0.18,
  },
  {
    effectiveFrom: "2026-04-01",
    sttOptionSell: 0.0015,
    sttOptionExercise: 0.0015,
    sttFutSell: 0.0005,
    nseTxnOpt: 0.0003503,
    bseTxnOpt: 0.000325,
    nseTxnFut: 0.0000173,
    sebiPerCrore: 10,
    stampOptBuy: 0.00003,
    stampFutBuy: 0.00002,
    gst: 0.18,
  },
];

/** Rates in force on a date (ISO, default today IST). Dates before the table use the first row. */
export function getChargeRates(onDate?: string): ChargeRates {
  const d = onDate && /^\d{4}-\d{2}-\d{2}$/.test(onDate) ? onDate : istDateString();
  let rates = CHARGE_RATE_TABLE[0];
  for (const row of CHARGE_RATE_TABLE) if (row.effectiveFrom <= d) rates = row;
  return rates;
}

export interface Fill {
  type: OptionType | "FUT";
  side: Side;
  price: number;
  /** units, not lots */
  qty: number;
  exchange?: Exchange;
}

export interface ChargesBreakdown {
  brokerage: number;
  stt: number;
  exchange: number;
  sebi: number;
  stamp: number;
  gst: number;
  total: number;
}

const EMPTY: ChargesBreakdown = { brokerage: 0, stt: 0, exchange: 0, sebi: 0, stamp: 0, gst: 0, total: 0 };

function brokerageFor(turnover: number, broker: BrokerPreset): number {
  if (broker.pctOfTurnover && broker.pctOfTurnover > 0) return Math.min(broker.pctOfTurnover * turnover, broker.cap ?? broker.perOrder);
  return Math.max(0, broker.perOrder || 0);
}

/** Charges for a list of executed fills; each fill counts as one order for brokerage. */
export function calcCharges(fills: Fill[], o?: { broker?: BrokerPreset; onDate?: string }): ChargesBreakdown {
  const broker = o?.broker ?? BROKER_PRESETS[0];
  const rates = getChargeRates(o?.onDate);
  const out: ChargesBreakdown = { ...EMPTY };
  for (const f of Array.isArray(fills) ? fills : []) {
    if (!f || !(f.qty > 0) || !(f.price >= 0) || !Number.isFinite(f.price)) continue;
    const turnover = f.price * f.qty;
    const isFut = f.type === "FUT";
    out.brokerage += brokerageFor(turnover, broker);
    if (f.side === "SELL") out.stt += turnover * (isFut ? rates.sttFutSell : rates.sttOptionSell);
    out.exchange += turnover * (isFut ? rates.nseTxnFut : f.exchange === "BSE" ? rates.bseTxnOpt : rates.nseTxnOpt);
    out.sebi += (turnover * rates.sebiPerCrore) / 1e7;
    if (f.side === "BUY") out.stamp += turnover * (isFut ? rates.stampFutBuy : rates.stampOptBuy);
  }
  out.gst = rates.gst * (out.brokerage + out.exchange + out.sebi);
  out.total = out.brokerage + out.stt + out.exchange + out.sebi + out.stamp + out.gst;
  return out;
}

/** STT charged when a long ITM option is exercised at expiry (on intrinsic value). */
export function exerciseSTT(intrinsicPerUnit: number, qty: number, onDate?: string): number {
  if (!Number.isFinite(intrinsicPerUnit) || !Number.isFinite(qty) || intrinsicPerUnit <= 0 || qty <= 0) return 0;
  return intrinsicPerUnit * qty * getChargeRates(onDate).sttOptionExercise;
}

function legExchange(leg: Leg): Exchange {
  return getContractSpec(leg.symbol)?.exchange ?? "NSE";
}

function legsToFills(legs: Leg[], roundTrip: boolean): Fill[] {
  const fills: Fill[] = [];
  for (const l of Array.isArray(legs) ? legs : []) {
    if (!l || !isLegEnabled(l)) continue;
    const qty = (Number(l.lots) || 0) * (Number(l.lotSize) || 0);
    if (!(qty > 0)) continue;
    const base = { type: l.type, price: Number(l.premium) || 0, qty, exchange: legExchange(l) };
    fills.push({ ...base, side: l.side });
    if (roundTrip) fills.push({ ...base, side: l.side === "BUY" ? "SELL" : "BUY" });
  }
  return fills;
}

/**
 * Charges for strategy legs at their entry premium. roundTrip (default false) adds an exit order on
 * each leg at the same premium — a conservative estimate when the exit price is unknown.
 */
export function chargesForLegs(legs: Leg[], o?: { roundTrip?: boolean; broker?: BrokerPreset; onDate?: string }): ChargesBreakdown {
  return calcCharges(legsToFills(legs, !!o?.roundTrip), { broker: o?.broker, onDate: o?.onDate });
}

/** Expiry breakevens after subtracting round-trip charges from the payoff. */
export function breakevensAfterCharges(legs: Leg[], o?: { broker?: BrokerPreset; onDate?: string }): number[] {
  const cost = chargesForLegs(legs, { roundTrip: true, broker: o?.broker, onDate: o?.onDate }).total;
  if (!(cost > 0)) return breakevens(legs);
  // A long put struck at 0 never pays out, so it shifts the whole payoff down by exactly `cost`.
  const costLeg: Leg = { symbol: "COST", type: "PE", side: "BUY", strike: 0, expiry: "", lots: 1, lotSize: 1, premium: cost };
  return breakevens([...(Array.isArray(legs) ? legs : []), costLeg]);
}
