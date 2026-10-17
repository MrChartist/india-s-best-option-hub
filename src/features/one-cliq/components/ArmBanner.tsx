import { Radio, ShieldCheck, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { ArmState, ExecMode } from "../types";

interface Props {
  armState: ArmState;
  mode: ExecMode;
  liveEnabled: boolean;
  remainingMs: number;
  onArm: () => void;
  onDisarm: () => void;
}

/**
 * The single most important piece of UI in the terminal: whether a keypress will
 * place an order right now.
 *
 * HOT and SAFE are made to look nothing alike on purpose. The classic failure in
 * one-click terminals is mode confusion — the user believes they are safe and is
 * not — so this is loud, always visible, and states the consequence in words
 * rather than relying on a colour alone.
 */
export function ArmBanner({ armState, mode, liveEnabled, remainingMs, onArm, onDisarm }: Props) {
  const hot = armState === "HOT";
  const seconds = Math.ceil(remainingMs / 1000);

  return (
    <div
      className={`flex items-center gap-2 flex-wrap px-3 py-1.5 rounded-md border text-xs ${
        hot
          ? "border-bearish bg-bearish/10 text-bearish"
          : "border-dashed border-border bg-muted/30 text-muted-foreground"
      }`}
      role="status"
      aria-live="polite"
    >
      {hot ? <Radio className="h-3.5 w-3.5 animate-pulse shrink-0" /> : <ShieldCheck className="h-3.5 w-3.5 shrink-0" />}

      <span className="font-semibold tracking-wide">
        {hot ? "ONE-CLICK ARMED" : "ONE-CLICK: OFF"}
      </span>

      <Badge
        variant="outline"
        className={mode === "LIVE" ? "border-bearish/50 text-bearish h-5" : "border-muted-foreground/40 text-muted-foreground h-5"}
      >
        {mode === "LIVE" ? "LIVE" : "PAPER"}
      </Badge>

      <span className="text-[11px]">
        {hot
          ? `Arrow keys place orders immediately · auto-disarms in ${seconds}s · Esc to disarm`
          : "Arrow keys are inert. Press O to arm."}
      </span>

      {/* Live Trading is the outer gate; arming inside a paper session is
          harmless but the copy must not imply real orders are possible. */}
      {!liveEnabled && (
        <span className="inline-flex items-center gap-1 text-[11px]">
          <TriangleAlert className="h-3 w-3" />
          Live Trading is off — fills are simulated.
        </span>
      )}

      <span className="flex-1" />

      <Button
        size="sm"
        variant={hot ? "destructive" : "outline"}
        className="h-6 text-[11px] px-2"
        onClick={hot ? onDisarm : onArm}
      >
        {hot ? "Disarm" : "Arm (O)"}
      </Button>
    </div>
  );
}
