import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { AlertTriangle, Radio } from "lucide-react";
import { isLiveTradingEnabled, setLiveTradingEnabled } from "@/lib/brokerConfig";
import { toast } from "sonner";

const ACK_KEY = "optionsdesk_live_trading_ack";

// Off by default, always. Real orders move real money and require a static IP
// whitelisted with Dhan — this is the one gate every Buy/Sell action in the
// app checks before it's allowed to place a real order instead of a paper one.
export function LiveTradingToggle() {
  const [enabled, setEnabled] = useState(() => isLiveTradingEnabled());
  const [showAck, setShowAck] = useState(false);
  const [ackChecked, setAckChecked] = useState(false);

  const handleToggle = (next: boolean) => {
    if (!next) {
      setLiveTradingEnabled(false);
      setEnabled(false);
      toast.info("Live Trading disabled — all orders are paper trades again.");
      return;
    }
    const alreadyAcknowledged = localStorage.getItem(ACK_KEY) === "true";
    if (alreadyAcknowledged) {
      setLiveTradingEnabled(true);
      setEnabled(true);
      toast.warning("Live Trading enabled — Buy/Sell now places real orders.");
      return;
    }
    setShowAck(true);
  };

  const confirmAcknowledge = () => {
    localStorage.setItem(ACK_KEY, "true");
    setLiveTradingEnabled(true);
    setEnabled(true);
    setShowAck(false);
    setAckChecked(false);
    toast.warning("Live Trading enabled — Buy/Sell now places real orders.");
  };

  return (
    <Card className={enabled ? "border-bearish/40 bg-bearish/5" : "border-warning/30 bg-warning/5"}>
      <CardContent className="flex items-start gap-3 py-3">
        <AlertTriangle className={`h-5 w-5 shrink-0 mt-0.5 ${enabled ? "text-bearish" : "text-warning"}`} />
        <div className="text-sm flex-1">
          <p className="font-medium text-foreground flex items-center gap-2">
            Live Trading
            {enabled && <span className="inline-flex items-center gap-1 text-xs text-bearish"><Radio className="h-3 w-3 animate-pulse" /> ACTIVE</span>}
          </p>
          <p className="text-muted-foreground text-xs mt-0.5">
            Off by default — Buy/Sell actions add paper positions only. Enabling this places <strong>real orders with real money</strong> via
            your connected Dhan account. Dhan's order APIs require your proxy's IP to be a static IP registered with Dhan — most users running
            this locally on a home connection will have orders rejected until that's set up.
          </p>
        </div>
        <Switch checked={enabled} onCheckedChange={handleToggle} />
      </CardContent>

      <AlertDialog open={showAck} onOpenChange={(open) => { if (!open) { setShowAck(false); setAckChecked(false); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-bearish">
              <AlertTriangle className="h-4 w-4" /> Enable Live Trading?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-sm text-foreground">
                <p>This will make every Buy/Sell action in the app place a <strong>real order</strong> with your connected Dhan account instead of a paper trade.</p>
                <ul className="list-disc list-inside text-xs text-muted-foreground space-y-1">
                  <li>Real money — a mistake here is a real trade, not a simulation.</li>
                  <li>Requires a static IP whitelisted with Dhan for order APIs. If your setup doesn't have one, orders will be rejected (Dhan's exact reason will be shown).</li>
                  <li>You can turn this off again at any time.</li>
                </ul>
                <label className="flex items-center gap-2 text-xs pt-1">
                  <Checkbox checked={ackChecked} onCheckedChange={(c) => setAckChecked(c === true)} />
                  I understand this places real orders with real money.
                </label>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setAckChecked(false)}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={!ackChecked}
              onClick={confirmAcknowledge}
              className="bg-bearish text-bearish-foreground hover:bg-bearish/90"
            >
              Enable Live Trading
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
