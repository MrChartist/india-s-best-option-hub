/**
 * Paper fill simulation.
 *
 * The reference product (1Cliq) has no paper mode at all. That is the opening —
 * but only if paper is honest. A simulator that always fills instantly at LTP
 * teaches a scalper habits that lose money the moment they go live, because the
 * two things that actually hurt in options are the spread and the slippage on an
 * illiquid strike.
 *
 * So this model:
 *   - fills BUY at the ASK and SELL at the BID, never at LTP
 *   - adds slippage that scales with spread, moneyness and liquidity
 *   - partially fills when size exceeds what is quoted at the touch
 *   - rejects sometimes, so the user builds a rejection reflex
 *   - takes 80-250ms, so a keypress does not resolve on the same frame
 *
 * Everything is pure and seeded (see prng.ts), so a given intent always produces
 * the same fill and the whole thing is testable without a clock or a network.
 */

import { createRng, seedFrom } from "./prng";
import type { FillResult, OrderIntent } from "../types";

export const TICK_SIZE = 0.05;

export interface FillModelInputs {
  /** Best bid/ask when known. Falls back to a synthetic spread around refPrice. */
  bid?: number | null;
  ask?: number | null;
  /** |delta| of the leg, for the OTM penalty. Unknown ⇒ treated as ATM. */
  absDelta?: number | null;
  openInterest?: number | null;
  volume?: number | null;
  /** Lots quoted at the touch. Beyond this, the order fills partially. */
  lotsAtTouch?: number | null;
  /** Set false to disable stochastic rejections (used by tests). */
  allowRandomRejects?: boolean;
}

/**
 * Number of ticks in a price, snapped when it is a hair off an exact tick.
 *
 * Binary floating point makes 100.05 / 0.05 = 2000.9999999999998, so a bare
 * floor() moves an already-valid tick price a full tick the wrong way. At ₹0.05
 * a tick that is a real rupee of slippage per lot of BANKNIFTY.
 */
function ticksIn(price: number, tickSize: number): number {
  const ticks = price / tickSize;
  const nearest = Math.round(ticks);
  return Math.abs(ticks - nearest) < 1e-9 ? nearest : ticks;
}

/** Round to the exchange tick, against the side that would flatter the fill. */
export function roundToTick(price: number, side: "BUY" | "SELL"): number {
  const ticks = ticksIn(price, TICK_SIZE);
  // A BUY rounds UP and a SELL rounds DOWN, so rounding never makes a simulated
  // fill look better than reality would.
  const rounded = side === "BUY" ? Math.ceil(ticks) : Math.floor(ticks);
  return Number((rounded * TICK_SIZE).toFixed(2));
}

/**
 * Synthesise a spread when the feed gives no depth.
 *
 * Wider for cheap and far-OTM options, which is where real spreads blow out.
 */
export function syntheticSpread(refPrice: number, absDelta: number | null | undefined): number {
  const base = Math.max(TICK_SIZE, refPrice * 0.004);
  const d = absDelta ?? 0.5;
  const otmPenalty = d < 0.15 ? 3 : d < 0.3 ? 1.8 : 1;
  const cheapPenalty = refPrice < 10 ? 2 : refPrice < 30 ? 1.4 : 1;
  return base * otmPenalty * cheapPenalty;
}

/**
 * Slippage in TICKS beyond the touch price.
 *
 * Half the spread as a base, multiplied by a liquidity factor, plus one tick for
 * every lot beyond what is quoted at the touch.
 */
export function slippageTicks(
  spread: number,
  lots: number,
  inputs: FillModelInputs,
): number {
  const base = Math.ceil((spread / TICK_SIZE) * 0.5);

  const d = inputs.absDelta ?? 0.5;
  const moneynessFactor = d < 0.15 ? 2.2 : d < 0.3 ? 1.6 : 1.0;

  const oi = inputs.openInterest ?? Number.POSITIVE_INFINITY;
  const vol = inputs.volume ?? Number.POSITIVE_INFINITY;
  const illiquid = oi < 50_000 || vol < 5_000;
  const liquidityFactor = illiquid ? 2.2 : 1.0;

  const atTouch = inputs.lotsAtTouch ?? Number.POSITIVE_INFINITY;
  const sizePenalty = Number.isFinite(atTouch) ? Math.max(0, lots - atTouch) : 0;

  return Math.max(0, Math.round(base * moneynessFactor * liquidityFactor) + sizePenalty);
}

/**
 * Simulate a fill for one intent. Pure: same intent + inputs ⇒ same result.
 */
export function simulateFill(intent: OrderIntent, inputs: FillModelInputs = {}): FillResult {
  const rng = createRng(seedFrom(intent.intentId));
  const ref = intent.refPrice;

  if (!Number.isFinite(ref) || ref <= 0) {
    return { status: "REJECTED", lots: 0, price: 0, slippage: 0, latencyMs: 0, reason: "No reference price for this strike." };
  }

  const spread = Number.isFinite(inputs.bid as number) && Number.isFinite(inputs.ask as number) && (inputs.ask as number) > (inputs.bid as number)
    ? (inputs.ask as number) - (inputs.bid as number)
    : syntheticSpread(ref, inputs.absDelta);

  const bid = Number.isFinite(inputs.bid as number) ? (inputs.bid as number) : Math.max(TICK_SIZE, ref - spread / 2);
  const ask = Number.isFinite(inputs.ask as number) ? (inputs.ask as number) : ref + spread / 2;

  const latencyMs = Math.round(rng.range(80, 250));

  // Stochastic rejection. Small, but present — a trader who has never seen a
  // rejection in paper will freeze the first time they see one live.
  if (inputs.allowRandomRejects !== false && rng.chance(0.01)) {
    return { status: "REJECTED", lots: 0, price: 0, slippage: 0, latencyMs, reason: "RMS: Order rejected (simulated)." };
  }

  const ticks = slippageTicks(spread, intent.lots, inputs);
  const slip = ticks * TICK_SIZE;

  // Cross the spread, then pay slippage on top, always against you.
  const raw = intent.side === "BUY" ? ask + slip : Math.max(TICK_SIZE, bid - slip);
  const price = roundToTick(raw, intent.side);

  const atTouch = inputs.lotsAtTouch ?? Number.POSITIVE_INFINITY;
  const filledLots = Number.isFinite(atTouch) ? Math.min(intent.lots, Math.max(1, Math.floor(atTouch))) : intent.lots;

  if (filledLots < intent.lots) {
    return {
      status: "PARTIAL",
      lots: filledLots,
      price,
      slippage: Number((price - ref).toFixed(2)),
      latencyMs,
      reason: `Only ${filledLots} of ${intent.lots} lots available at the touch.`,
    };
  }

  return {
    status: "FILLED",
    lots: filledLots,
    price,
    slippage: Number((price - ref).toFixed(2)),
    latencyMs,
  };
}

/**
 * Market-protection limit price: a market order expressed as an aggressive limit
 * at LTP ± pct, so you cross the spread but cannot print at an absurd price on
 * an illiquid strike.
 *
 * Rounds BUY down and SELL up — the opposite of the fill model's rounding —
 * because here the rounding must never WIDEN the worst case you accept.
 */
export function marketProtectionPrice(ltp: number, side: "BUY" | "SELL", pct: number): number {
  if (!Number.isFinite(ltp) || ltp <= 0) return 0;
  const raw = side === "BUY" ? ltp * (1 + pct / 100) : ltp * (1 - pct / 100);
  const ticks = ticksIn(raw, TICK_SIZE);
  const rounded = side === "BUY" ? Math.floor(ticks) : Math.ceil(ticks);
  return Math.max(TICK_SIZE, Number((rounded * TICK_SIZE).toFixed(2)));
}
