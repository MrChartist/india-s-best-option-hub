import { Loader2, RotateCcw, ShieldCheck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { RiskCellStatus } from "../hooks/useLegRiskArm";

interface Props {
  value: number | null;
  level: number | null;
  status: RiskCellStatus;
  hitAt: number | null;
  failureReason: string | null;
  /** false while pending/live — must disarm before editing a live trigger. */
  editable: boolean;
  onChange: (points: number) => void;
  onArm: () => void;
  onDisarm: () => void;
  armDisabledReason?: string;
}

/**
 * One Set-SL / Set-Target cell (1CLIQ-TRADE-SPEC.md §10): idle / pending
 * (optimistic) / live / hit / failed.
 *
 * Unit is fixed to spot points, not the ₹/Δ/% selector the spec sketches —
 * the server risk engine (riskMath.mjs) only ever evaluates spot-referenced
 * points, so offering ₹ or % here would be a control with no backing
 * capability (spec §8's rule: "the UI never offers a control the capability
 * object doesn't declare").
 */
export function RiskTriggerCell({
  value, level, status, hitAt, failureReason, editable, onChange, onArm, onDisarm, armDisabledReason,
}: Props) {
  const levelLabel = level != null ? `≈ spot ${level.toFixed(0)}` : undefined;

  if (status === "pending") {
    return (
      <div className="flex items-center gap-1 italic text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
        <span className="font-mono tabular-nums">{value ?? "—"} pts</span>
      </div>
    );
  }

  if (status === "live") {
    return (
      <div className="flex flex-col items-end gap-0.5">
        <div className="flex items-center gap-1 text-bullish">
          <ShieldCheck className="h-3 w-3" />
          <span className="font-mono tabular-nums">{value} pts</span>
          <Button size="sm" variant="ghost" className="h-5 w-5 p-0" onClick={onDisarm} aria-label="Disarm">
            <X className="h-3 w-3" />
          </Button>
        </div>
        {levelLabel && <span className="text-[10px] text-muted-foreground">{levelLabel}</span>}
      </div>
    );
  }

  if (status === "hit") {
    return (
      <div className="flex flex-col items-end gap-0.5 text-muted-foreground">
        <span className="font-mono tabular-nums line-through">{value} pts</span>
        {hitAt && <span className="text-[10px]">hit {new Date(hitAt).toLocaleTimeString("en-IN", { hour12: false })}</span>}
      </div>
    );
  }

  if (status === "failed") {
    return (
      <div className="flex flex-col items-end gap-0.5">
        <div className="flex items-center gap-1 text-bearish">
          <span className="font-mono tabular-nums">{value ?? "—"} pts</span>
          <Button size="sm" variant="ghost" className="h-5 w-5 p-0" onClick={onArm} aria-label="Retry">
            <RotateCcw className="h-3 w-3" />
          </Button>
        </div>
        <span className="text-[10px] text-bearish max-w-[140px] truncate" title={failureReason ?? undefined}>
          {failureReason || "Rejected"}
        </span>
      </div>
    );
  }

  // idle — fully controlled by the parent's draft state, same pattern as
  // ExecutionParamsBar's SL/Target inputs, so a value typed into either the
  // SL or Target cell is already committed before Arm can be clicked (Arm
  // reads both cells' latest values from the parent, never from a local
  // "not yet flushed" string).
  return (
    <div className="flex items-center gap-1 justify-end">
      <Input
        className="h-6 w-16 text-xs font-mono tabular-nums text-right"
        value={value ?? ""}
        disabled={!editable}
        inputMode="decimal"
        onChange={(e) => onChange(Number(e.target.value) || 0)}
      />
      <span className="text-[10px] text-muted-foreground">pts</span>
      <Button
        size="sm" variant="ghost" className="h-5 w-5 p-0"
        disabled={!editable || !!armDisabledReason}
        title={armDisabledReason}
        onClick={onArm}
        aria-label="Arm"
      >
        <ShieldCheck className="h-3 w-3" />
      </Button>
    </div>
  );
}
