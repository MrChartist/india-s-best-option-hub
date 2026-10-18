import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { alertStore, resetDeliveryRegistry } from "@/lib/alerts";
import { useStrikeAlerts } from "./hooks";
import type { StrikeAlert } from "./alerts";

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), warning: vi.fn() }) }));

const alert = (id: string, strike: number): StrikeAlert => ({
  id,
  symbol: "NIFTY",
  expiry: "2026-10-27",
  strike,
  type: "CE",
  field: "premium",
  op: "gte",
  value: 1,
});

beforeEach(() => {
  localStorage.clear();
  alertStore.resetForTests();
  resetDeliveryRegistry();
});

describe("useStrikeAlerts", () => {
  it("follows same-tab deletes and pauses from the alert store and never resurrects them", () => {
    const { result } = renderHook(() => useStrikeAlerts("NIFTY", "2026-10-27", [], 0));
    act(() => {
      result.current.addAlert(alert("sa_a", 25000));
      result.current.addAlert(alert("sa_c", 25100));
    });
    expect(result.current.alerts.map((a) => a.id)).toEqual(["sa_a", "sa_c"]);

    // The Alerts sheet deletes one rule and pauses the other in the same tab.
    act(() => {
      alertStore.removeRule("sa_a");
      alertStore.toggleRule("sa_c", false);
    });
    expect(result.current.alerts.map((a) => [a.id, a.paused === true])).toEqual([["sa_c", true]]);

    // A later add on the chain must not bring the deleted rule back or re-enable the paused one.
    act(() => result.current.addAlert(alert("sa_b", 25200)));
    const strike = alertStore.getState().rules.filter((r) => r.type === "strike_level");
    expect(strike.map((r) => [r.id, r.enabled])).toEqual([
      ["sa_c", false],
      ["sa_b", true],
    ]);

    act(() => result.current.deleteAlert("sa_b"));
    expect(alertStore.getState().rules.map((r) => r.id)).toEqual(["sa_c"]);
  });
});
