import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { FuturesOverviewTable } from "./FuturesOverviewTable";

/* Minimal token resolver for index.css: `--name: H S% L% [/ a];` in :root and .dark blocks. */
const css = readFileSync(resolve(__dirname, "../../index.css"), "utf8");
function block(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  const end = css.indexOf("}", start);
  const out: Record<string, string> = {};
  for (const m of css.slice(start, end).matchAll(/--([\w-]+):\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}
const root = block(":root");
const dark = block(".dark");
function token(name: string): string {
  let v = dark[name] ?? root[name];
  for (let i = 0; i < 5 && v?.startsWith("var("); i++) {
    const ref = v.slice(6, -1);
    v = dark[ref] ?? root[ref];
  }
  return v;
}
function hsla(v: string): [number, number, number, number] {
  const [hsl, a] = v.split("/").map((x) => x.trim());
  const [h, s, l] = hsl.split(/\s+/).map((x) => parseFloat(x));
  const S = s / 100;
  const L = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const f = (n: number) => L - S * Math.min(L, 1 - L) * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [f(0), f(8), f(4), a === undefined ? 1 : parseFloat(a)];
}
const lum = ([r, g, b]: number[]) => {
  const c = (x: number) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4);
  return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(b);
};
function contrast(fg: number[], bg: number[]) {
  const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x);
  return (a + 0.05) / (b + 0.05);
}

describe("FuturesOverviewTable", () => {
  it("keeps bearish micro text at 4.5:1 on the selected row in dark mode", () => {
    render(
      <FuturesOverviewTable
        snapshots={[
          { symbol: "NIFTY", latest: null, prev: null, source: "sample" } as never,
          { symbol: "BANKNIFTY", latest: null, prev: null, source: "sample" } as never,
        ]}
        selected="NIFTY"
        onSelect={() => {}}
        caption="Futures"
      />,
    );
    const row = screen.getByRole("button", { name: "NIFTY" }).closest("tr")!;
    const cls = ` ${row.className} `;
    // The fill the selected row actually gets in dark mode (a dark: override wins over the base class).
    const darkFill = / dark:bg-([\w-]+) /.exec(cls)?.[1] ?? / bg-(selection-unfocused|control-track) /.exec(cls)?.[1];
    expect(darkFill).toBeTruthy();
    const card = hsla(token("card"));
    const [r, g, b, a] = hsla(token(darkFill!));
    const bg = [0, 1, 2].map((i) => [r, g, b][i] * a + card[i] * (1 - a));
    expect(contrast(hsla(token("bearish")), bg)).toBeGreaterThanOrEqual(4.5);
  });
});
