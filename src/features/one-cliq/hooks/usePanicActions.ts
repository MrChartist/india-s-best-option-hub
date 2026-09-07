/**
 * The LIVE-mode F6/F7 path (1CLIQ-TRADE-SPEC.md §5).
 *
 * Split out from useTerminalActions so the existing paper closeAll/cancelAll
 * (local-storage based, unconditionally available) is never at risk of being
 * edited while wiring the live path in alongside it — see that hook's own
 * header for why the two must not merge into one branchy function.
 */

import { useCallback, useState } from "react";
import { panicCloseAll, panicCancelAll } from "../lib/panicApi";
import type { TerminalMessage } from "../types";

export interface PanicActionDeps {
  pushMessage: (tone: TerminalMessage["tone"], text: string) => void;
}

export function usePanicActions({ pushMessage }: PanicActionDeps) {
  const [panicBusy, setPanicBusy] = useState(false);

  const closeAllLive = useCallback(async () => {
    setPanicBusy(true);
    pushMessage("warning", "LIVE Close All: cancelling resting orders, then flattening every position…");
    try {
      const result = await panicCloseAll("F6");
      const { closeAll, cancelAll } = result;
      // "Success" is a re-verified empty book, not an HTTP 200 (spec §13 #5) —
      // closeAll.success/remainingPositions already carry that re-verification,
      // so this message reports exactly what the server confirmed, nothing more.
      if (closeAll.success) {
        pushMessage("success", `LIVE Close All complete — book is flat. Cancel-all ${cancelAll.success ? "succeeded" : "left orders behind, check Orders"}.`);
      } else {
        pushMessage("error", `LIVE Close All did NOT finish — ${closeAll.remainingPositions.length} position(s) still open. Check Positions and retry F6.`);
      }
    } catch (e) {
      pushMessage("error", `LIVE Close All failed to run: ${(e as Error).message}`);
    } finally {
      setPanicBusy(false);
    }
  }, [pushMessage]);

  const cancelAllLive = useCallback(async () => {
    setPanicBusy(true);
    pushMessage("info", "LIVE Cancel All: cancelling every resting order…");
    try {
      const result = await panicCancelAll("F7");
      if (result.success) {
        pushMessage("success", "LIVE Cancel All complete — no resting orders remain.");
      } else {
        pushMessage("error", `LIVE Cancel All did NOT finish — ${result.remainingOrders.length} order(s) still resting. Check Orders and retry F7.`);
      }
    } catch (e) {
      pushMessage("error", `LIVE Cancel All failed to run: ${(e as Error).message}`);
    } finally {
      setPanicBusy(false);
    }
  }, [pushMessage]);

  return { closeAllLive, cancelAllLive, panicBusy };
}
