import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Ban, RefreshCw, XOctagon } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ArmState } from "../types";

interface Props {
  armState: ArmState;
  busy: boolean;
  /** A LIVE panic-close/cancel sweep is already in flight — see usePanicActions. */
  panicBusy?: boolean;
  awaitingCloseAllConfirm: boolean;
  onBuyCall: () => void;
  onSellCall: () => void;
  onBuyPut: () => void;
  onSellPut: () => void;
  onCloseAll: () => void;
  onCancelAll: () => void;
  onRefresh: () => void;
}

/** Each button carries its key, so the keymap is learned by using the mouse. */
function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="ml-1.5 px-1 py-0.5 rounded bg-background/25 text-[9px] font-mono leading-none border border-current/20">
      {children}
    </kbd>
  );
}

/**
 * The execution row. Buy/Sell for each leg on the outside, panic controls in the
 * centre — the reference terminal's arrangement, which puts the two "undo
 * everything" buttons where they are reachable without aiming.
 *
 * Deliberately no split dropdowns on the four order buttons: that would put
 * eight targets in the highest-stakes row. Order type lives one row up.
 */
export function ActionBar({
  armState, busy, panicBusy, awaitingCloseAllConfirm,
  onBuyCall, onSellCall, onBuyPut, onSellPut, onCloseAll, onCancelAll, onRefresh,
}: Props) {
  const disabled = busy || armState !== "HOT";
  const title = armState === "HOT" ? undefined : "Arm one-click (O) to enable execution";

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <div className="flex items-center gap-1.5">
        <Button
          size="sm" variant="destructive" className="h-8 gap-1"
          disabled={disabled} title={title} onClick={onSellCall}
        >
          <ArrowDown className="h-3.5 w-3.5" /> Sell Call <Kbd>↓</Kbd>
        </Button>
        <Button
          size="sm" className="h-8 gap-1 bg-bullish text-bullish-foreground hover:bg-bullish/90"
          disabled={disabled} title={title} onClick={onBuyCall}
        >
          <ArrowUp className="h-3.5 w-3.5" /> Buy Call <Kbd>↑</Kbd>
        </Button>
      </div>

      <div className="flex-1 flex items-center justify-center gap-1.5 min-w-0">
        <Button
          size="sm"
          variant={awaitingCloseAllConfirm ? "destructive" : "outline"}
          className="h-8 gap-1 text-xs"
          disabled={panicBusy}
          title={panicBusy ? "A panic sweep is already running" : undefined}
          onClick={onCloseAll}
        >
          <XOctagon className="h-3.5 w-3.5" />
          {awaitingCloseAllConfirm ? "Press F6 again to confirm" : "Close All Positions"}
          <Kbd>F6</Kbd>
        </Button>
        <Button
          size="sm" variant="outline" className="h-8 gap-1 text-xs"
          disabled={panicBusy}
          title={panicBusy ? "A panic sweep is already running" : undefined}
          onClick={onCancelAll}
        >
          <Ban className="h-3.5 w-3.5" /> Cancel All Orders <Kbd>F7</Kbd>
        </Button>
        <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={onRefresh} aria-label="Refresh">
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="flex items-center gap-1.5">
        <Button
          size="sm" className="h-8 gap-1 bg-bullish text-bullish-foreground hover:bg-bullish/90"
          disabled={disabled} title={title} onClick={onBuyPut}
        >
          <ArrowRight className="h-3.5 w-3.5" /> Buy Put <Kbd>→</Kbd>
        </Button>
        <Button
          size="sm" variant="destructive" className="h-8 gap-1"
          disabled={disabled} title={title} onClick={onSellPut}
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Sell Put <Kbd>←</Kbd>
        </Button>
      </div>
    </div>
  );
}
