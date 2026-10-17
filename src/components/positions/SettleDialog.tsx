/** Settle expired positions at intrinsic value, with a settlement price per underlying. */
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatINR, formatStrike } from "@/lib/options";
import { settlePositions, type TrackedPosition } from "@/lib/positionStore";
import { cn } from "@/lib/utils";
import { signedClass, signedINR } from "./helpers";

export function SettleDialog({
  open,
  onOpenChange,
  expired,
  suggestedSpots,
  now,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  expired: TrackedPosition[];
  suggestedSpots: Record<string, number>;
  now: Date;
  onConfirm: (spots: Record<string, number>) => void;
}) {
  const symbols = useMemo(() => Array.from(new Set(expired.map((p) => p.symbol))).sort(), [expired]);
  const [texts, setTexts] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!open) return;
    const t: Record<string, string> = {};
    for (const s of symbols) t[s] = suggestedSpots[s] > 0 ? suggestedSpots[s].toFixed(2) : "";
    setTexts(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seed the inputs only when the dialog opens
  }, [open]);
  const spots = useMemo(() => {
    const out: Record<string, number> = {};
    for (const s of symbols) {
      const v = Number(texts[s]);
      if (Number.isFinite(v) && v > 0) out[s] = v;
    }
    return out;
  }, [texts, symbols]);
  const preview = useMemo(() => settlePositions(expired, now, spots), [expired, now, spots]);
  const total = preview.settled.reduce((a, c) => a + (c.netPnl ?? 0), 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Settle expired positions</DialogTitle>
          <DialogDescription>
            Options settle at intrinsic value against the final settlement price (the underlying's closing value on expiry day). Check the price below. ITM longs pay STT on exercise.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {symbols.map((s) => (
            <div key={s} className="grid gap-1.5">
              <Label htmlFor={`settle-${s}`}>{s} settlement price</Label>
              <Input id={`settle-${s}`} type="number" inputMode="decimal" step="0.05" min={0} value={texts[s] ?? ""} onChange={(e) => setTexts((t) => ({ ...t, [s]: e.target.value }))} />
            </div>
          ))}
          <ul className="divide-y divide-border rounded-tile border border-border text-body-sm">
            {preview.settled.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-2 px-3 py-2">
                <span>
                  {c.action} {c.symbol} {formatStrike(c.strike)} {c.type} → {formatINR(c.exitPrice)}
                  {c.exerciseStt ? <span className="ml-1 text-warning">(STT {formatINR(c.exerciseStt, { decimals: 0 })})</span> : null}
                </span>
                <span className={cn("font-num tabular-nums", signedClass(c.netPnl ?? 0))}>{signedINR(c.netPnl ?? 0)}</span>
              </li>
            ))}
            {preview.pending.map((p) => (
              <li key={p.id} className="px-3 py-2 text-muted-foreground">
                {p.symbol} {formatStrike(p.strike)} {p.type}: enter a settlement price
              </li>
            ))}
          </ul>
          {preview.settled.length ? (
            <p className="text-body-sm">
              Net result: <span className={cn("font-semibold", signedClass(total))}>{signedINR(total)}</span> after charges.
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={preview.settled.length === 0} onClick={() => onConfirm(spots)}>
            Settle {preview.settled.length || ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
