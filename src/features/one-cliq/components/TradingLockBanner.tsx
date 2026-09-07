import { useState } from "react";
import { Lock, ShieldAlert, Unlock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LOCK_STATES, type TradingLockRecord } from "../lib/panicApi";

interface Props {
  lock: TradingLockRecord;
  isLossTriggered: boolean;
  busy: boolean;
  unlockError: string | null;
  onUnlockDirect: () => void;
  onRequestUnlock: (typedFigure: string, actualRealisedLoss: number) => Promise<boolean>;
}

const REASON_COPY: Record<string, string> = {
  [LOCK_STATES.LOCKED_BY_USER]: "You locked new entries manually.",
  [LOCK_STATES.LOCKED_BY_MTM_LOSS]: "Auto-locked — MTM loss limit hit.",
  [LOCK_STATES.LOCKED_BY_DAILY_LOSS_LIMIT]: "Auto-locked — daily loss limit hit.",
  [LOCK_STATES.LOCKED_BY_ENGINE_FAULT]: "Engine could not confirm its own state — reads as locked until fixed.",
};

/**
 * Persistent banner for any tradingLockState other than "unlocked"
 * (1CLIQ-TRADE-SPEC.md §5). Deliberately renders nothing when unlocked.
 *
 * This banner controls ENTRY only. Close All / Cancel All in ActionBar are
 * never disabled by lock state — the server enforces that same rule by
 * omission (panicLayer.mjs's handlers never import tradingLockState at all),
 * so there is nothing for this component to gate on the exit side.
 */
export function TradingLockBanner({ lock, isLossTriggered, busy, unlockError, onUnlockDirect, onRequestUnlock }: Props) {
  const [typedFigure, setTypedFigure] = useState("");
  const [actualLoss, setActualLoss] = useState("");

  if (lock.state === LOCK_STATES.UNLOCKED) return null;

  const canSelfService = lock.state !== LOCK_STATES.LOCKED_BY_ENGINE_FAULT;
  const sinceLabel = lock.since ? new Date(lock.since).toLocaleTimeString("en-IN", { hour12: false }) : "unknown";

  const handleUnlock = async () => {
    if (isLossTriggered) {
      const loss = Number(actualLoss);
      if (!Number.isFinite(loss)) return;
      const ok = await onRequestUnlock(typedFigure, loss);
      if (ok) { setTypedFigure(""); setActualLoss(""); }
    } else {
      onUnlockDirect();
    }
  };

  return (
    <div className="flex flex-col gap-2 px-3 py-2 rounded-md border border-warning/50 bg-warning/10 text-xs" role="alert">
      <div className="flex items-center gap-2 flex-wrap">
        {lock.state === LOCK_STATES.LOCKED_BY_ENGINE_FAULT ? (
          <ShieldAlert className="h-3.5 w-3.5 text-bearish shrink-0" />
        ) : (
          <Lock className="h-3.5 w-3.5 text-warning shrink-0" />
        )}
        <span className="font-semibold">TRADING LOCKED</span>
        <span className="text-muted-foreground">{REASON_COPY[lock.state] || lock.state} · since {sinceLabel}</span>
        <span className="flex-1" />
        <span className="text-muted-foreground">New entries are blocked. Exiting existing positions (F6/F7) still works.</span>
      </div>

      {canSelfService && (
        <div className="flex items-center gap-2 flex-wrap">
          {isLossTriggered ? (
            <>
              <span className="text-muted-foreground">Type the realised loss figure to confirm you've seen it:</span>
              <Input
                className="h-7 w-28 text-xs font-mono"
                placeholder="Actual loss"
                inputMode="decimal"
                value={actualLoss}
                onChange={(e) => setActualLoss(e.target.value)}
              />
              <Input
                className="h-7 w-28 text-xs font-mono"
                placeholder="Typed figure"
                value={typedFigure}
                onChange={(e) => setTypedFigure(e.target.value)}
              />
              <Button size="sm" variant="outline" className="h-7 text-xs" disabled={busy} onClick={handleUnlock}>
                <Unlock className="h-3 w-3 mr-1" /> Attempt unlock
              </Button>
            </>
          ) : (
            <Button size="sm" variant="outline" className="h-7 text-xs" disabled={busy} onClick={handleUnlock}>
              <Unlock className="h-3 w-3 mr-1" /> Unlock
            </Button>
          )}
          {unlockError && <span className="text-bearish">{unlockError}</span>}
        </div>
      )}
    </div>
  );
}
