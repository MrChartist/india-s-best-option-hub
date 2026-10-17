import { useEffect, useState } from "react";
import { CircleAlert, CircleCheck } from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import type { BasketPreview } from "@/lib/basketApi";

interface Props {
  /** Non-null while the preview dialog should be open. */
  preview: BasketPreview | null;
  defaultName: string;
  busy: boolean;
  onConfirm: (name: string) => void;
  onCancel: () => void;
}

/**
 * "Save as Basket" preview/confirm step (1CLIQ-TRADE-SPEC.md §9's
 * StrategyBuilder seam). Shows exactly what basket-deploy resolved — which
 * legs would deploy live vs. paper-only — BEFORE anything is written to
 * local storage. This step never places an order; basket-deploy is a
 * resolve-and-report call only (see basketApi.ts).
 */
export function SaveBasketDialog({ preview, defaultName, busy, onConfirm, onCancel }: Props) {
  const [name, setName] = useState(defaultName);

  useEffect(() => {
    if (preview) setName(defaultName);
  }, [preview, defaultName]);

  if (!preview) return null;

  return (
    <Dialog open={!!preview} onOpenChange={(open) => { if (!open) onCancel(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Save as Basket
            {preview.blockedForLive ? (
              <Badge variant="outline" className="border-warning/40 text-warning gap-1">
                <CircleAlert className="h-3 w-3" /> {preview.blockedLegIds.length} leg(s) paper-only
              </Badge>
            ) : (
              <Badge variant="outline" className="border-bullish/40 text-bullish gap-1">
                <CircleCheck className="h-3 w-3" /> All legs live-deployable
              </Badge>
            )}
          </DialogTitle>
          <DialogDescription asChild>
            <div className="space-y-2 text-sm text-foreground">
              <p className="text-xs text-muted-foreground">
                Preview only — resolved against the live {preview.symbol} chain (spot {preview.spot ?? "—"}). Nothing is
                ordered here; strikes/expiries are re-resolved again at deploy time, never reused from this save.
              </p>
              <div className="space-y-1">
                {preview.legs.map((leg) => (
                  <div key={leg.legId} className="grid grid-cols-[1fr_auto] gap-2 font-mono text-xs items-start px-2 py-1 rounded bg-accent/30">
                    <span>
                      {leg.action} {leg.optionType} {leg.strike ?? "?"} · {leg.expiry ?? "no expiry resolved"} · {leg.lots}L
                    </span>
                    {leg.blocked ? (
                      <span className="text-warning text-right max-w-[220px]" title={leg.blockedReason ?? undefined}>
                        Paper-only: {leg.blockedReason}
                      </span>
                    ) : (
                      <span className="text-bullish text-right">Live-ready</span>
                    )}
                  </div>
                ))}
              </div>
              <div className="pt-1">
                <Label htmlFor="basket-name" className="text-xs">Basket name</Label>
                <Input
                  id="basket-name"
                  className="h-8 text-sm mt-1"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoFocus
                />
              </div>
            </div>
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onCancel}>Cancel</Button>
          <Button disabled={busy} onClick={() => onConfirm(name)}>
            {busy ? "Saving..." : "Save Basket"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
