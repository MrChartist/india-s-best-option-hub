import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { black76Price, forwardFromSpot, probOfReachingProfit, timeToExpiryYears } from "@/lib/options";
import { analyseStrategy, computeP50 } from "./strategyAnalysis";
import { encodeBase64Url, encodeLegsParam, parseLegsParam, resolveInitialState, type BuilderLeg } from "./strategyState";
import { LegEditor } from "./LegEditor";

const lotSizeFor = () => 65;

describe("computeP50", () => {
  it("passes the chain-implied dividend yield through to the Monte-Carlo", () => {
    const now = new Date("2026-10-19T05:00:00Z");
    const expiry = "2026-11-24";
    const spot = 25000;
    const r = 0.065;
    const q = 0.013;
    const sigma = 0.13;
    const T = timeToExpiryYears(expiry, now);
    const F = forwardFromSpot(spot, T, r, q);
    const mk = (type: "CE" | "PE"): BuilderLeg => ({
      id: type,
      enabled: true,
      symbol: "NIFTY",
      type,
      side: "SELL",
      strike: 25000,
      expiry,
      lots: 1,
      lotSize: 65,
      iv: sigma,
      premium: black76Price({ F, K: 25000, T, r, sigma, type }),
    });
    const a = analyseStrategy({ legs: [mk("CE"), mk("PE")], spot, now, r, q, atmIv: sigma, smile: () => sigma, roundTrip: false });
    expect(Math.abs(a.pnlNow)).toBeLessThan(1);
    const base = { S: spot, T: a.T, sigma, target: 0.5 * a.maxProfit, paths: 1200, seed: 50, r };
    const withQ = probOfReachingProfit(a.active, { ...base, q });
    const withoutQ = probOfReachingProfit(a.active, base);
    expect(withQ).not.toBe(withoutQ);
    expect(computeP50(a, spot, sigma, r, q)).toBe(withQ);
  });
});

describe("?legs= IV units", () => {
  it("round-trips leg IVs of 3% or less without inflating them 100x", () => {
    const legs: BuilderLeg[] = [0.02, 0.001, 0.142, 0.45].map((iv, i) => ({
      id: String(i),
      enabled: true,
      symbol: "NIFTY",
      type: "CE",
      side: "BUY",
      strike: 25000 + i * 100,
      expiry: "2026-11-24",
      lots: 1,
      lotSize: 65,
      premium: 10,
      iv,
    }));
    const back = parseLegsParam(encodeLegsParam(legs), lotSizeFor).map((l) => l.iv);
    expect(back).toEqual([0.02, 0.001, 0.142, 0.45]);
  });

  it("still reads legacy baskets that carry iv in percent or decimal", () => {
    const enc = encodeBase64Url(
      JSON.stringify([
        { symbol: "NIFTY", expiry: "2026-11-24", strike: 25000, type: "CE", side: "BUY", lots: 1, premium: 10, iv: 14.2 },
        { symbol: "NIFTY", expiry: "2026-11-24", strike: 25100, type: "CE", side: "BUY", lots: 1, premium: 10, iv: 0.142 },
      ]),
    );
    expect(parseLegsParam(enc, lotSizeFor).map((l) => l.iv)).toEqual([0.142, 0.142]);
  });
});

describe("resolveInitialState with unknown underlyings", () => {
  const today = "2026-10-18";
  it("ignores a ?symbol= that is not an F&O underlying and says so", () => {
    const s = resolveInitialState({ params: new URLSearchParams("symbol=FOOBAR"), draft: null, today, lotSizeFor });
    expect(s.symbol).toBe("NIFTY");
    expect(s.fromParams).toBe(false);
    expect(s.message).toContain("FOOBAR");
  });

  it("accepts indices, spec'd stocks and the wider F&O stock list", () => {
    for (const sym of ["BANKNIFTY", "RELIANCE"]) {
      expect(resolveInitialState({ params: new URLSearchParams(`symbol=${sym}`), draft: null, today, lotSizeFor }).symbol).toBe(sym);
    }
  });

  it("drops basket legs on an unknown underlying", () => {
    const enc = encodeBase64Url(
      JSON.stringify([
        { symbol: "FOOBAR", expiry: "2026-11-24", strike: 100, type: "CE", side: "BUY", lots: 1, premium: 1 },
        { symbol: "NIFTY", expiry: "2026-11-24", strike: 25000, type: "CE", side: "BUY", lots: 1, premium: 10 },
      ]),
    );
    const s = resolveInitialState({ params: new URLSearchParams(`legs=${enc}`), draft: null, today, lotSizeFor });
    expect(s.symbol).toBe("NIFTY");
    expect(s.legs.map((l) => l.symbol)).toEqual(["NIFTY"]);
    expect(s.skipped).toEqual([]);
    expect(s.message).toContain("FOOBAR");
  });
});

describe("LegEditor lots field", () => {
  function Harness() {
    const [leg, setLeg] = useState<BuilderLeg>({
      id: "l1",
      enabled: true,
      symbol: "NIFTY",
      type: "CE",
      side: "BUY",
      strike: 25000,
      expiry: "2026-11-24",
      lots: 1,
      lotSize: 65,
      premium: 100,
    });
    return (
      <>
        <LegEditor
          leg={leg}
          index={0}
          expiries={["2026-11-24"]}
          strikes={[25000]}
          focused={false}
          onChange={(_id, patch) => setLeg((l) => ({ ...l, ...patch }))}
          onRemove={() => {}}
          onFocus={() => {}}
        />
        <output data-testid="lots">{leg.lots}</output>
      </>
    );
  }

  it("can be cleared and retyped without prepending the old value", () => {
    render(<Harness />);
    const input = screen.getByLabelText("Lots") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "" } });
    expect(input.value).toBe("");
    fireEvent.change(input, { target: { value: "5" } });
    expect(input.value).toBe("5");
    expect(screen.getByTestId("lots").textContent).toBe("5");
  });

  it("snaps a blank field back to the current lots on blur", () => {
    render(<Harness />);
    const input = screen.getByLabelText("Lots") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);
    expect(input.value).toBe("1");
    fireEvent.click(screen.getByLabelText("Increase lots"));
    expect(input.value).toBe("2");
  });
});
