import { describe, expect, it } from "vitest";
import { routesByGroup } from "@/lib/routes";
import { STATIC_FNO_STOCKS } from "@/lib/screener/universe";
import { rankEntries, scoreEntry, type PaletteEntry } from "../commandPaletteSearch";

const entries: PaletteEntry[] = [
  ...routesByGroup().flatMap(({ group, routes }) =>
    routes.map((r) => ({ id: r.path, kind: "route" as const, label: r.navLabel, alt: r.title, keywords: r.keywords, path: r.path, group })),
  ),
  ...["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY"].map((s) => ({
    id: `i:${s}`,
    kind: "index" as const,
    label: s,
    keywords: ["index"],
    path: `/option-chain?symbol=${s}`,
    group: "Index",
  })),
  ...STATIC_FNO_STOCKS.map((s) => ({ id: `s:${s}`, kind: "stock" as const, label: s, keywords: [], path: `/option-chain?symbol=${s}`, group: "Stock" })),
];

const top = (q: string) => rankEntries(entries, q)[0]?.entry.path;

describe("command palette ranking", () => {
  it.each([
    ["gex", "/gex"],
    ["gamma", "/gex"],
    ["reliance", "/option-chain?symbol=RELIANCE"],
    ["RELIANCE", "/option-chain?symbol=RELIANCE"],
    ["banknifty", "/option-chain?symbol=BANKNIFTY"],
    ["pcr", "/max-pain-pcr"],
    ["max pain", "/max-pain-pcr"],
    ["iv", "/volatility"],
    ["charges", "/calculators"],
    ["nism", "/learn"],
    ["fii", "/participants"],
    ["option chain", "/option-chain"],
    ["oc", "/option-chain"],
  ])("'%s' opens %s", (q, path) => {
    expect(top(q)).toBe(path);
  });

  it("drops loose subsequence matches", () => {
    const events = entries.find((e) => e.path === "/events")!;
    expect(scoreEntry(events, "gex")).toBe(0);
    expect(scoreEntry(events, "nism")).toBe(0);
  });

  it("returns nothing for an empty query", () => {
    expect(rankEntries(entries, "  ")).toEqual([]);
  });
});
