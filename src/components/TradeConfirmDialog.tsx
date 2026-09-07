import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, FileText } from "lucide-react";

export interface PendingTrade {
  symbol: string;
  strike: number;
  optionType: "CE" | "PE";
  action: "BUY" | "SELL";
  lots: number;
  price: number;
  lotSize: number;
  // Only present for Dhan-sourced chains — required for a live order, absent means paper-only.
  securityId?: string;
  exchangeSegment?: string;
}

interface Props {
  /** A single trade, or every leg of a multi-leg strategy confirmed in one step. */
  trade: PendingTrade | PendingTrade[] | null;
  mode: "paper" | "live";
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

function legValue(t: PendingTrade): number {
  return t.lots * t.lotSize * t.price;
}

// Shared confirmation step for BOTH paper fills and real orders — deliberately
// the same component so a "live" order never looks/feels less serious than it
// is. Paper-vs-live branching happens entirely in the caller; this dialog only
// changes its own copy/styling based on `mode`.
export function TradeConfirmDialog({ trade, mode, busy, onConfirm, onCancel }: Props) {
  if (!trade) return null;
  const legs = Array.isArray(trade) ? trade : [trade];
  if (legs.length === 0) return null;
  const total = legs.reduce((s, t) => s + legValue(t), 0);
  const isMultiLeg = legs.length > 1;

  return (
    <AlertDialog open={!!trade} onOpenChange={(open) => { if (!open) onCancel(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            {mode === "live" ? <AlertTriangle className="h-4 w-4 text-bearish" /> : <FileText className="h-4 w-4 text-muted-foreground" />}
            {isMultiLeg ? `Confirm ${legs.length}-Leg Strategy` : `Confirm ${legs[0].action === "BUY" ? "Buy" : "Sell"} Order`}
            <Badge variant="outline" className={mode === "live" ? "border-bearish/40 text-bearish" : "border-muted-foreground/40 text-muted-foreground"}>
              {mode === "live" ? "LIVE — REAL MONEY" : "PAPER TRADE"}
            </Badge>
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2 text-sm text-foreground">
              <div className="space-y-1.5">
                {legs.map((t, i) => (
                  <div key={i} className="grid grid-cols-[1fr_auto_auto_auto] gap-x-3 font-mono text-xs items-center px-2 py-1 rounded bg-accent/30">
                    <span>{t.symbol} {t.strike} {t.optionType}</span>
                    <span className={t.action === "BUY" ? "text-bullish" : "text-bearish"}>{t.action}</span>
                    <span className="text-muted-foreground">{t.lots}×{t.lotSize} @ ₹{t.price.toFixed(2)}</span>
                    <span className="font-semibold">₹{legValue(t).toLocaleString("en-IN")}</span>
                  </div>
                ))}
              </div>
              <div className="flex justify-between text-xs font-mono pt-1 border-t border-border/50">
                <span className="text-muted-foreground">Total Value</span>
                <span className="font-semibold">₹{total.toLocaleString("en-IN")}</span>
              </div>
              {mode === "live" ? (
                <p className="text-xs text-bearish">
                  This places {isMultiLeg ? "REAL orders" : "a REAL order"} with your connected broker. Requires a static IP whitelisted with Dhan — if that's not set up, the order will be rejected (you'll see Dhan's exact reason).
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  No real order is placed. This adds {isMultiLeg ? `${legs.length} simulated positions` : "a simulated position"} to Position Tracker at the price{isMultiLeg ? "s" : ""} above.
                </p>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            disabled={busy}
            className={mode === "live" ? "bg-bearish text-bearish-foreground hover:bg-bearish/90" : undefined}
          >
            {busy ? "Placing..." : mode === "live" ? "Place Real Order" : isMultiLeg ? "Add All to Position Tracker" : "Add Paper Position"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
