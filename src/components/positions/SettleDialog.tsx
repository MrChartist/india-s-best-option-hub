/** Settle expired positions at intrinsic value, with a settlement price per underlying and expiry. */
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatDateIST, formatINR, formatStrike } from "@/lib/options";
import { positionExpiryIso, positionSettlementKey, settlePositions, type TrackedPosition } from "@/lib/positionStore";
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
  /** Settlement prices keyed by positionSettlementKey (symbol|expiry). */
  onConfirm: (spots: Record<string, number>) => void;
}) {
  // One price per underlying and expiry: two lapsed NIFTY weeklies settle at their own closes.
  const groups = useMemo(() => {
    const m = new Map<string, { key: string; symbol: string; expiry: string }>();
    for (const p of expired) {
      const key = positionSettlementKey(p);
      if (!m.has(key)) m.set(key, { key, symbol: p.symbol, expiry: positionExpiryIso(p) });
    }
    return [...m.values()].sort((a, b) => (a.symbol === b.symbol ? (a.expiry < b.expiry ? 1 : -1) : a.symbol < b.symbol ? -1 : 1));
  }, [expired]);
  const [texts, setTexts] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!open) return;
    // The current spot is only a sensible default for the most recent expiry of each underlying;
    // older lapsed expiries need their own expiry-day close.
    const t: Record<string, string> = {};
    const seeded = new Set<string>();
    for (const g of groups) {
      const spot = suggestedSpots[g.symbol];
      t[g.key] = !seeded.has(g.symbol) && spot > 0 ? spot.toFixed(2) : "";
      seeded.add(g.symbol);
    }
    setTexts(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seed the inputs only when the dialog opens
  }, [open]);
  const spots = useMemo(() => {
    const out: Record<string, number> = {};
    for (const g of groups) {
      const v = Number(texts[g.key]);
      if (Number.isFinite(v) && v > 0) out[g.key] = v;
    }
    return out;
  }, [texts, groups]);
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
          {groups.map((g, i) => (
            <div key={g.key} className="grid gap-1.5">
              <Label htmlFor={`settle-${i}`}>
                {g.symbol} settlement price <span className="text-muted-foreground">(expiry {formatDateIST(g.expiry)})</span>
              </Label>
              <Input id={`settle-${i}`} type="number" inputMode="decimal" step="0.05" min={0} value={texts[g.key] ?? ""} onChange={(e) => setTexts((t) => ({ ...t, [g.key]: e.target.value }))} />
            </div>
          ))}
          <ul className="divide-y divide-separator rounded-tile border border-separator text-body-sm">
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
                {p.symbol} {formatStrike(p.strike)} {p.type} ({formatDateIST(positionExpiryIso(p))}): enter a settlement price
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
