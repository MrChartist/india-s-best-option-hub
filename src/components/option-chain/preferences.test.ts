import { beforeEach, describe, expect, it } from "vitest";
import { COLUMNS_KEY, MOBILE_COLUMNS_KEY, MOBILE_DEFAULT_PRESET, PRESETS, matchPreset, presetColumns, readColumnPrefs, writeColumnPrefs } from "./preferences";

describe("phone column preferences", () => {
  beforeEach(() => localStorage.clear());

  it("defaults phones to the compact preset: LTP and OI, no Buildup or OI bar", () => {
    const p = readColumnPrefs(MOBILE_COLUMNS_KEY, MOBILE_DEFAULT_PRESET);
    expect(p.preset).toBe("compact");
    expect(p.visible).toEqual(["oi", "ltp"]);
    expect(p.visible).not.toContain("buildup");
    expect(p.visible).not.toContain("oiBar");
    expect(matchPreset(["ltp", "oi"])).toBe("compact");
  });

  it("stores phone and desktop choices separately", () => {
    writeColumnPrefs({ preset: "greeks", visible: presetColumns("greeks") }, MOBILE_COLUMNS_KEY);
    expect(readColumnPrefs(MOBILE_COLUMNS_KEY, MOBILE_DEFAULT_PRESET).preset).toBe("greeks");
    expect(readColumnPrefs().preset).toBe("sensibull");
    expect(localStorage.getItem(COLUMNS_KEY)).toBeNull();
  });

  it("folds the LTP change % into the LTP cell (no separate column)", () => {
    expect(PRESETS.sensibull.columns).not.toContain("ltpChg" as never);
    localStorage.setItem(COLUMNS_KEY, JSON.stringify({ visible: ["ltpChg", "ltp", "iv"] }));
    expect(readColumnPrefs().visible).toEqual(["iv", "ltp"]);
  });
});
