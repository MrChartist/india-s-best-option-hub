import { describe, it, expect } from "vitest";
import {
  bias,
  computeAdv,
  slLevel,
  tgtLevel,
  shouldTriggerSL,
  shouldTriggerTarget,
  validateArmConfig,
  nextStopAdv,
  TRAIL_MODES,
} from "./riskMath.mjs";

// 1CLIQ-TRADE-SPEC.md §4 worked example: S0 = 58090, SL 50 pts, Target 80 pts.
const S0 = 58090;
const SL_PTS = 50;
const TGT_PTS = 80;

// The exact table from the spec — the one thing that must never regress,
// because a wrong sign here means "zero protection on the losing side" (§13 #3).
const LEG_TABLE = [
  { name: "BUY CE", side: "BUY", optionType: "CE", expectedBias: 1, slFiresAt: 58040, tgtFiresAt: 58170 },
  { name: "SELL CE", side: "SELL", optionType: "CE", expectedBias: -1, slFiresAt: 58140, tgtFiresAt: 58010 },
  { name: "BUY PE", side: "BUY", optionType: "PE", expectedBias: -1, slFiresAt: 58140, tgtFiresAt: 58010 },
  { name: "SELL PE", side: "SELL", optionType: "PE", expectedBias: 1, slFiresAt: 58040, tgtFiresAt: 58170 },
];

describe("bias — all four leg combinations", () => {
  for (const leg of LEG_TABLE) {
    it(`${leg.name} => ${leg.expectedBias > 0 ? "+1" : "-1"}`, () => {
      expect(bias(leg.side, leg.optionType)).toBe(leg.expectedBias);
    });
  }
});

describe("slLevel / tgtLevel — exact levels from the spec's worked example", () => {
  for (const leg of LEG_TABLE) {
    it(`${leg.name}: SL level ${leg.slFiresAt}, Target level ${leg.tgtFiresAt}`, () => {
      expect(slLevel(S0, leg.side, leg.optionType, SL_PTS)).toBe(leg.slFiresAt);
      expect(tgtLevel(S0, leg.side, leg.optionType, TGT_PTS)).toBe(leg.tgtFiresAt);
    });
  }
});

describe("computeAdv — sign-normalised so adv > 0 always means 'winning'", () => {
  it("BUY CE: adv rises with spot", () => {
    expect(computeAdv(58140, S0, "BUY", "CE")).toBe(50);
    expect(computeAdv(58040, S0, "BUY", "CE")).toBe(-50);
  });
  it("SELL CE: adv falls as spot rises (profits from a fall)", () => {
    expect(computeAdv(58140, S0, "SELL", "CE")).toBe(-50);
    expect(computeAdv(58040, S0, "SELL", "CE")).toBe(50);
  });
  it("BUY PE: same sign convention as SELL CE", () => {
    expect(computeAdv(58140, S0, "BUY", "PE")).toBe(-50);
    expect(computeAdv(58040, S0, "BUY", "PE")).toBe(50);
  });
  it("SELL PE: same sign convention as BUY CE", () => {
    expect(computeAdv(58140, S0, "SELL", "PE")).toBe(50);
    expect(computeAdv(58040, S0, "SELL", "PE")).toBe(-50);
  });
});

describe("shouldTriggerSL / shouldTriggerTarget — exact-level equality, all four legs", () => {
  for (const leg of LEG_TABLE) {
    describe(leg.name, () => {
      it("SL fires exactly at the level (equality, not strict inequality)", () => {
        const adv = computeAdv(leg.slFiresAt, S0, leg.side, leg.optionType);
        expect(shouldTriggerSL(adv, SL_PTS)).toBe(true);
      });
      it("SL does not fire one point short of the level", () => {
        const oneShort = leg.slFiresAt + (leg.slFiresAt < S0 ? 1 : -1);
        const adv = computeAdv(oneShort, S0, leg.side, leg.optionType);
        expect(shouldTriggerSL(adv, SL_PTS)).toBe(false);
      });
      it("SL fires on a gap-through past the level (<=, not <)", () => {
        const gapped = leg.slFiresAt + (leg.slFiresAt < S0 ? -5 : 5);
        const adv = computeAdv(gapped, S0, leg.side, leg.optionType);
        expect(shouldTriggerSL(adv, SL_PTS)).toBe(true);
      });

      it("Target fires exactly at the level (equality, not strict inequality)", () => {
        const adv = computeAdv(leg.tgtFiresAt, S0, leg.side, leg.optionType);
        expect(shouldTriggerTarget(adv, TGT_PTS)).toBe(true);
      });
      it("Target does not fire one point short of the level", () => {
        const oneShort = leg.tgtFiresAt + (leg.tgtFiresAt < S0 ? 1 : -1);
        const adv = computeAdv(oneShort, S0, leg.side, leg.optionType);
        expect(shouldTriggerTarget(adv, TGT_PTS)).toBe(false);
      });
      it("Target fires on a gap-through past the level (>=, not >)", () => {
        const gapped = leg.tgtFiresAt + (leg.tgtFiresAt < S0 ? -5 : 5);
        const adv = computeAdv(gapped, S0, leg.side, leg.optionType);
        expect(shouldTriggerTarget(adv, TGT_PTS)).toBe(true);
      });
    });
  }
});

describe("validateArmConfig — arm-time rejection", () => {
  for (const leg of LEG_TABLE) {
    it(`${leg.name}: accepts a normal positive SL/Target config`, () => {
      expect(validateArmConfig(S0, leg.side, leg.optionType, SL_PTS, TGT_PTS)).toEqual({ ok: true });
    });
  }

  it("rejects zero SL and zero Target (target does not sit beyond SL at all)", () => {
    const v = validateArmConfig(S0, "BUY", "CE", 0, 0);
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/target level/i);
  });

  it("rejects when the combined SL+Target distance is negative", () => {
    // slPts + tgtPts <= 0 is the invariant this collapses to algebraically,
    // and it holds identically across all four leg directions.
    const v = validateArmConfig(S0, "SELL", "PE", -30, -30);
    expect(v.ok).toBe(false);
  });

  it("rejects consistently regardless of which leg direction is used", () => {
    for (const leg of LEG_TABLE) {
      const v = validateArmConfig(S0, leg.side, leg.optionType, -10, -10);
      expect(v.ok).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// nextStopAdv — example-based checks per mode, then a property test.
// ---------------------------------------------------------------------------

describe("nextStopAdv — fixed-point mode", () => {
  const params = { activation: 20, trailPts: 10 };

  it("does not move the stop before activation", () => {
    expect(nextStopAdv(TRAIL_MODES.FIXED_POINT, params, 10, -SL_PTS, SL_PTS)).toBe(-SL_PTS);
  });

  it("moves the stop to mfe - trailPts once activation is reached", () => {
    expect(nextStopAdv(TRAIL_MODES.FIXED_POINT, params, 20, -SL_PTS, SL_PTS)).toBe(10);
    expect(nextStopAdv(TRAIL_MODES.FIXED_POINT, params, 50, 10, SL_PTS)).toBe(40);
  });

  it("never lowers the stop even if a later candidate would be smaller", () => {
    // mfe retraces from 50 to 25: candidate = 15, but current stop is already 40.
    expect(nextStopAdv(TRAIL_MODES.FIXED_POINT, params, 25, 40, SL_PTS)).toBe(40);
  });
});

describe("nextStopAdv — percentage give-back mode", () => {
  const params = { p: 0.3 };

  it("does not move the stop while mfe <= 0", () => {
    expect(nextStopAdv(TRAIL_MODES.PERCENTAGE_GIVEBACK, params, 0, -SL_PTS, SL_PTS)).toBe(-SL_PTS);
    expect(nextStopAdv(TRAIL_MODES.PERCENTAGE_GIVEBACK, params, -20, -SL_PTS, SL_PTS)).toBe(-SL_PTS);
  });

  it("gives back exactly fraction p of mfe once mfe > 0", () => {
    expect(nextStopAdv(TRAIL_MODES.PERCENTAGE_GIVEBACK, params, 100, -SL_PTS, SL_PTS)).toBe(70);
  });

  it("never lowers the stop on a retrace", () => {
    expect(nextStopAdv(TRAIL_MODES.PERCENTAGE_GIVEBACK, params, 100, 70, SL_PTS)).toBe(70);
    expect(nextStopAdv(TRAIL_MODES.PERCENTAGE_GIVEBACK, params, 50, 70, SL_PTS)).toBe(70); // retrace to 50 -> candidate 35, ratchet holds
  });
});

describe("nextStopAdv — step/ratchet mode", () => {
  const params = { A: 20, stepX: 10, stepY: 5 };

  it("stays at the -slPts baseline before A is reached", () => {
    expect(nextStopAdv(TRAIL_MODES.STEP_RATCHET, params, 15, -SL_PTS, SL_PTS)).toBe(-SL_PTS);
  });

  it("steps up by stepY for every stepX of mfe past A", () => {
    // mfe=20 -> 0 steps -> -50; mfe=30 -> 1 step -> -45; mfe=45 -> 2 steps -> -40
    expect(nextStopAdv(TRAIL_MODES.STEP_RATCHET, params, 20, -SL_PTS, SL_PTS)).toBe(-50);
    expect(nextStopAdv(TRAIL_MODES.STEP_RATCHET, params, 30, -50, SL_PTS)).toBe(-45);
    expect(nextStopAdv(TRAIL_MODES.STEP_RATCHET, params, 45, -45, SL_PTS)).toBe(-40);
  });

  it("never lowers the stop when mfe retraces between steps", () => {
    // Stop already ratcheted to -40 (2 steps); mfe retraces to 35 (still 1 step, -45).
    expect(nextStopAdv(TRAIL_MODES.STEP_RATCHET, params, 35, -40, SL_PTS)).toBe(-40);
  });
});

describe("nextStopAdv — invalid mode", () => {
  it("throws rather than silently no-op'ing on an unknown mode", () => {
    expect(() => nextStopAdv("not-a-mode", {}, 10, -SL_PTS, SL_PTS)).toThrow(/unknown trailing mode/i);
  });
});

// ---------------------------------------------------------------------------
// Property test: the ratchet invariant must hold over ANY tick sequence, for
// ANY of the three modes. Uses a seeded PRNG (mulberry32) so failures are
// reproducible — same philosophy as the paper-mode fill model in §7.
// ---------------------------------------------------------------------------

function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MODE_FIXTURES = [
  { mode: TRAIL_MODES.FIXED_POINT, params: { activation: 20, trailPts: 10 }, earlyGuard: (mfe, p) => mfe < p.activation },
  { mode: TRAIL_MODES.PERCENTAGE_GIVEBACK, params: { p: 0.4 }, earlyGuard: (mfe) => mfe <= 0 },
  { mode: TRAIL_MODES.STEP_RATCHET, params: { A: 20, stepX: 10, stepY: 5 }, earlyGuard: (mfe, p) => mfe < p.A },
];

describe("nextStopAdv — property test over random tick sequences", () => {
  const SEEDS = 40;
  const TICKS_PER_RUN = 60;

  for (const fixture of MODE_FIXTURES) {
    describe(`mode = ${fixture.mode}`, () => {
      it("stopAdv is monotone non-decreasing, never activates early, and mfe<=0 never raises it", () => {
        for (let seed = 0; seed < SEEDS; seed++) {
          const rand = mulberry32(seed * 7919 + 1);
          let mfe = -Infinity;
          let stopAdv = -SL_PTS;

          for (let t = 0; t < TICKS_PER_RUN; t++) {
            // Random adv tick in [-200, 200], simulating spot moving against or
            // in favour of the leg.
            const adv = rand() * 400 - 200;
            mfe = Math.max(mfe, adv);

            const before = stopAdv;
            const next = nextStopAdv(fixture.mode, fixture.params, mfe, stopAdv, SL_PTS);

            // 1. Monotone non-decreasing, no matter what the tick sequence did.
            expect(next).toBeGreaterThanOrEqual(before);

            // 2. Trailing must not have activated yet — stop stays at the
            //    untouched -slPts baseline while the mode's own threshold
            //    hasn't been crossed.
            if (fixture.earlyGuard(mfe, fixture.params)) {
              expect(next).toBe(-SL_PTS);
            }

            // 3. mfe <= 0 must never raise the stop (a losing/breakeven trade
            //    earns no trail credit).
            if (mfe <= 0) {
              expect(next).toBe(before);
            }

            stopAdv = next;
          }
        }
      });
    });
  }
});
