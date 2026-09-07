/**
 * Per-position Set-SL / Set-Target cell state (1CLIQ-TRADE-SPEC.md §10):
 * idle -> pending (optimistic) -> live | failed.
 *
 * One managed position on the server always carries BOTH an SL and a Target
 * together (riskArmValidation.mjs requires both slPts and tgtPts as positive
 * numbers in the same armPosition() call — there is no "arm just the SL"
 * request) so the SL and Target cells for one row share a single lifecycle
 * here; the caller renders that lifecycle twice, once per cell.
 *
 * "hit" is intentionally NOT reachable from this hook. Detecting a real SL/
 * Target fill would need a per-position status endpoint, and none exists —
 * riskEngine.mjs's own header says exitExecutor is "an INJECTABLE STUB, not
 * live order placement... Phase 3 wires the real placeOrder path", and
 * proxy-server.mjs exposes no per-position read, only the aggregate
 * risk-status. Faking a "hit" transition here would be indistinguishable
 * from a real fill in the UI, which is exactly the kind of fabrication
 * spec §10 rules out ("worst available failure mode"). The type is kept so
 * the day that endpoint exists, only this hook needs to change.
 */

import { useCallback, useMemo, useState } from "react";
import { SYMBOL_TO_SECURITY_ID } from "@/lib/instrumentKeys";
import { armRiskPosition, disarmRiskPosition } from "../lib/riskApi";
import { isArmConfigSane } from "../lib/riskLevels";
import type { Position } from "@/lib/mockData";

export type RiskCellStatus = "idle" | "pending" | "live" | "hit" | "failed";

export interface PositionRiskState {
  status: RiskCellStatus;
  slPts: number | null;
  tgtPts: number | null;
  riskId: string | null;
  failureReason: string | null;
  hitAt: number | null;
}

const IDLE_STATE: PositionRiskState = {
  status: "idle", slPts: null, tgtPts: null, riskId: null, failureReason: null, hitAt: null,
};

export function useLegRiskArm() {
  const [states, setStates] = useState<Record<string, PositionRiskState>>({});

  const getState = useCallback((positionId: string): PositionRiskState => states[positionId] ?? IDLE_STATE, [states]);

  /**
   * Update one field's draft value while idle/failed. A no-op while
   * pending/live — the input is disabled in that state anyway (see
   * RiskTriggerCell's `editable`), but this guards direct callers too.
   */
  const setDraft = useCallback((positionId: string, field: "slPts" | "tgtPts", value: number) => {
    setStates((prev) => {
      const cur = prev[positionId] ?? IDLE_STATE;
      if (cur.status === "pending" || cur.status === "live") return prev;
      return { ...prev, [positionId]: { ...cur, status: "idle", [field]: value, failureReason: null } };
    });
  }, []);

  const setFailed = useCallback((positionId: string, slPts: number, tgtPts: number, reason: string) => {
    setStates((prev) => ({ ...prev, [positionId]: { status: "failed", slPts, tgtPts, riskId: null, failureReason: reason, hitAt: null } }));
  }, []);

  /**
   * Arm both triggers for one position. `spot` is the anchor S0 the caller
   * read at click time — paper positions never captured a true fill-time S0
   * (spec §4 wants that server-side, from the live tick, at the real fill),
   * so this is an honest approximation for Phase 1/2 paper legs only.
   */
  const arm = useCallback(async (position: Position, spot: number, slPts: number, tgtPts: number) => {
    const positionId = position.id;

    if (!isArmConfigSane(position.action, position.type, slPts, tgtPts)) {
      setFailed(positionId, slPts, tgtPts, "SL and Target must both be positive numbers before arming.");
      return;
    }
    const underlyingSecurityId = SYMBOL_TO_SECURITY_ID[position.symbol];
    if (!underlyingSecurityId) {
      setFailed(positionId, slPts, tgtPts, `No underlying security id mapped for ${position.symbol} — cannot reference spot.`);
      return;
    }
    if (!Number.isFinite(spot) || spot <= 0) {
      setFailed(positionId, slPts, tgtPts, "No live spot price yet — cannot anchor S0.");
      return;
    }

    // Optimistic: the cell shows "pending" (italic + spinner) immediately.
    setStates((prev) => ({ ...prev, [positionId]: { status: "pending", slPts, tgtPts, riskId: null, failureReason: null, hitAt: null } }));

    try {
      const result = await armRiskPosition({
        exchangeSegment: "IDX_I",
        securityId: underlyingSecurityId,
        s0: spot,
        side: position.action,
        optionType: position.type,
        slPts,
        tgtPts,
      });
      setStates((prev) => ({ ...prev, [positionId]: { status: "live", slPts, tgtPts, riskId: result.id, failureReason: null, hitAt: null } }));
    } catch (e) {
      // Revert the optimistic value rather than leaving it looking live —
      // spec §10: "Optimistic values revert on failure, never linger looking live."
      setFailed(positionId, slPts, tgtPts, (e as Error).message);
    }
  }, [setFailed]);

  const disarm = useCallback(async (positionId: string) => {
    const cur = states[positionId];
    if (!cur?.riskId) {
      setStates((prev) => ({ ...prev, [positionId]: IDLE_STATE }));
      return;
    }
    setStates((prev) => ({ ...prev, [positionId]: { ...cur, status: "pending" } }));
    try {
      await disarmRiskPosition(cur.riskId);
      setStates((prev) => ({ ...prev, [positionId]: IDLE_STATE }));
    } catch (e) {
      setStates((prev) => ({ ...prev, [positionId]: { ...cur, status: "failed", failureReason: (e as Error).message } }));
    }
  }, [states]);

  // Stable identity across renders when nothing actually changed, so a
  // consumer memoizing on this object (e.g. PositionsGrid's column list)
  // doesn't rebuild every render for no reason.
  return useMemo(() => ({ getState, setDraft, arm, disarm }), [getState, setDraft, arm, disarm]);
}
