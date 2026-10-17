import { useMemo, type ProfilerOnRenderCallback } from "react";
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { generateSampleChain } from "@/lib/options";
import type { OptionData } from "@/lib/mockData";
import { ChainTable } from "./ChainTable";
import { buildChainModel, deltaTargets, sliceAroundATM } from "./chainModel";
import { visibleColumns } from "./columns";
import { presetColumns } from "./preferences";
import { useLatestCallback, useStableBadgeMap, useStableRows } from "./stableRows";
import type { GammaBadge } from "./gammaLevels";

const NOW = new Date("2026-10-15T05:00:00Z");
const SPOT = 24512.3;
const EXPIRY = "2026-10-20";
const base = generateSampleChain({ symbol: "NIFTY", spot: SPOT, expiry: EXPIRY, now: NOW, seed: 21, strikes: 41 }).chain;
const columns = visibleColumns(presetColumns("sensibull"));
const noop = () => {};

function Harness({ chain, onRowRender }: { chain: OptionData[]; onRowRender: ProfilerOnRenderCallback }) {
  const model = useMemo(() => buildChainModel(chain, { spot: SPOT, expiry: EXPIRY, lotSize: 65, symbol: "NIFTY", now: NOW }), [chain]);
  const rows = useStableRows(useMemo(() => sliceAroundATM(model.rows, model.atmStrike, 10), [model]));
  // A fresh map with equal content on every render, like a poll would produce.
  const gammaMap = useStableBadgeMap(new Map<number, GammaBadge[]>([[model.atmStrike, ["AG"]]]));
  const onTrade = useLatestCallback(() => model.rows.length);
  return (
    <ChainTable
      symbol="NIFTY"
      expiry={EXPIRY}
      model={model}
      rows={rows}
      columns={columns}
      deltaView={false}
      deltas={deltaTargets(model.rows)}
      gammaMap={gammaMap}
      focusedStrike={null}
      focusedSide="CE"
      onFocusRow={noop}
      sigmaPoints={300}
      onTrade={onTrade}
      onStraddle={noop}
      onStrangle={noop}
      onIronFly={noop}
      onAlert={noop}
      onOIAnalysis={noop}
      onOpenContract={noop}
      onRowRender={onRowRender}
    />
  );
}

describe("ChainTable render performance", () => {
  it("commits fewer than 10 ChainRows when one leg changes on a poll", () => {
    // One stable Profiler callback: each call is one ChainRow commit.
    const commits = vi.fn<ProfilerOnRenderCallback>();
    const { rerender, container } = render(<Harness chain={base} onRowRender={commits} />);
    const rowCount = container.querySelectorAll("tbody tr[data-strike]").length;
    expect(rowCount).toBe(21);
    expect(commits).toHaveBeenCalledTimes(rowCount);

    // Next poll: a brand-new chain array where only one OTM call's LTP ticked.
    const atmIdx = base.findIndex((r) => r.strikePrice >= SPOT);
    const k = atmIdx + 6;
    const next = base.map((r, i) => (i === k ? { ...r, ce: { ...r.ce, ltp: r.ce.ltp + 0.35 } } : { ...r, ce: { ...r.ce }, pe: { ...r.pe } }));
    commits.mockClear();
    rerender(<Harness chain={next} onRowRender={commits} />);
    expect(commits.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(commits.mock.calls.length).toBeLessThan(10);
    expect(commits.mock.calls.map((c) => c[0])).toContain(`chain-row-${base[k].strikePrice}`);
  });
});
