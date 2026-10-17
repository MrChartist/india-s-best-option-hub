import { describe, expect, it } from "vitest";
import { generateSampleChain } from "@/lib/options";
import { buildChainModel } from "./chainModel";
import { legViewEqual, rowViewEqual, stabiliseBadgeMap, stabiliseRows } from "./stableRows";
import type { GammaBadge } from "./gammaLevels";

const NOW = new Date("2026-10-15T05:00:00Z");
const opts = { spot: 24512.3, expiry: "2026-10-20", lotSize: 65, symbol: "NIFTY", now: NOW };
const chain = generateSampleChain({ symbol: "NIFTY", spot: 24512.3, expiry: "2026-10-20", now: NOW, seed: 8, strikes: 21 }).chain;

describe("stabiliseRows", () => {
  it("returns the previous array when nothing rendered changed", () => {
    const a = buildChainModel(chain, opts).rows;
    const b = buildChainModel(chain.map((r) => ({ ...r })), opts).rows;
    expect(b[0]).not.toBe(a[0]);
    expect(stabiliseRows(a, b)).toBe(a);
  });

  it("reuses unchanged rows and swaps in only the changed one", () => {
    const a = buildChainModel(chain, opts).rows;
    const k = 15;
    const next = chain.map((r, i) => (i === k ? { ...r, pe: { ...r.pe, oi: r.pe.oi + 75 } } : r));
    const b = buildChainModel(next, opts).rows;
    const out = stabiliseRows(a, b);
    expect(out).not.toBe(a);
    out.forEach((r, i) => (i === k ? expect(r).toBe(b[i]) : expect(r).toBe(a[i])));
  });

  it("handles first render, range changes and NaN-equal fields", () => {
    const a = buildChainModel(chain, opts).rows;
    expect(stabiliseRows(undefined, a)).toBe(a);
    const sliced = a.slice(2, 8);
    const out = stabiliseRows(a, sliced);
    expect(out).not.toBe(a);
    expect(out[0]).toBe(a[2]);
    const r = a[3];
    const clone = { ...r, ce: { ...r.ce, leg: { ...r.ce.leg, iv: Number.NaN } } };
    expect(legViewEqual(clone.ce, { ...clone.ce, leg: { ...clone.ce.leg } })).toBe(true);
    expect(rowViewEqual(r, { ...r, ce: { ...r.ce, itm: !r.ce.itm } })).toBe(false);
  });
});

describe("stabiliseBadgeMap", () => {
  it("keeps equal badge arrays and the map itself", () => {
    const a = new Map<number, GammaBadge[]>([[24500, ["AG", "FLIP"]], [25000, ["CW"]]]);
    const b = new Map<number, GammaBadge[]>([[24500, ["AG", "FLIP"]], [25000, ["CW"]]]);
    expect(stabiliseBadgeMap(a, b)).toBe(a);
    const c = new Map<number, GammaBadge[]>([[24500, ["AG", "FLIP"]], [25000, ["CW", "PW"]]]);
    const out = stabiliseBadgeMap(a, c);
    expect(out).not.toBe(a);
    expect(out.get(24500)).toBe(a.get(24500));
    expect(out.get(25000)).toBe(c.get(25000));
    expect(stabiliseBadgeMap(undefined, c)).toBe(c);
  });
});
