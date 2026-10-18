import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { generateSampleChain, getExpiries } from "@/lib/options";
import { IDLE_FEED_MS, flowStore } from "@/lib/flow";
import { FlowFeeder } from "./FlowFeeder";

const expiry = getExpiries("NIFTY", new Date("2026-10-19T05:00:00Z"), 1)[0].date;
const { chain } = generateSampleChain({ symbol: "NIFTY", spot: 25000, expiry });
// A stale after-hours chain: the same object on every render, so the ingest effect runs once.
const stale = {
  expiry,
  lotSize: 65,
  spotPrice: 25000,
  chain,
  source: "cache",
  asOf: Date.UTC(2026, 9, 19, 10, 0),
  stale: true,
  isLive: false,
  reason: "after hours",
};
vi.mock("@/hooks/useMarketData", () => ({ useLiveOptionChain: () => ({ data: stale }) }));
vi.mock("@/lib/snapshotStore", async (orig) => ({
  ...(await orig<typeof import("@/lib/snapshotStore")>()),
  getLatestSnapshots: vi.fn(async () => []),
  recordSnapshot: vi.fn(async () => undefined),
}));

beforeEach(() => {
  flowStore.reset();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-19T10:30:00Z"));
});
afterEach(() => vi.useRealTimers());

describe("FlowFeeder", () => {
  it("keeps its feed while mounted even when the data stops changing", () => {
    const view = render(<FlowFeeder symbol="NIFTY" persist={false} />);
    expect(Object.keys(flowStore.getState().feeds)).toContain("NIFTY");

    vi.setSystemTime(Date.now() + IDLE_FEED_MS + 60_000);
    const other = generateSampleChain({ symbol: "BANKNIFTY", spot: 56000, expiry }).chain;
    flowStore.ingest({ symbol: "BANKNIFTY", expiry, lotSize: 35, spot: 56000, chain: other, source: "sample", asOf: Date.now(), stale: false, isLive: false });
    expect(Object.keys(flowStore.getState().feeds).sort()).toEqual(["BANKNIFTY", "NIFTY"]);

    // Once the feeder unmounts, its feed is released.
    view.unmount();
    expect(Object.keys(flowStore.getState().feeds)).toEqual(["BANKNIFTY"]);
  });
});
