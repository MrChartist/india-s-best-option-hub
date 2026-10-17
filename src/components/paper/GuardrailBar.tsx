/** Guardrail status strip: beginner mode, today's P&L against the daily cap, and the kill switch. */
import { useState } from "react";
import { OctagonX, ShieldCheck, ShieldOff } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { formatDateIST, formatINR, formatTimeIST, istDateString } from "@/lib/options";
import type { Guardrails, KillSwitch } from "@/lib/paperTrading";
import { cn } from "@/lib/utils";
import { signedClass, signedINR } from "@/components/positions/helpers";

export function GuardrailBar({
  guardrails,
  todayPnl,
  killSwitch,
  killActive,
  openPositions,
  onKill,
  onRelease,
}: {
  guardrails: Guardrails;
  todayPnl: number;
  killSwitch?: KillSwitch;
  killActive: boolean;
  openPositions: number;
  onKill: (squareOff: boolean) => void;
  onRelease: () => void;
}) {
  const [squareOff, setSquareOff] = useState(true);
  const cap = guardrails.dailyLossCap;
  const used = cap ? Math.min(100, Math.max(0, (-todayPnl / cap) * 100)) : 0;
  const untilLabel = killSwitch ? `${formatDateIST(istDateString(new Date(killSwitch.until)))} ${formatTimeIST(killSwitch.until)}` : "";

  return (
    <div
      role="region"
      aria-label="Guardrails"
      className={cn("flex flex-col gap-3 rounded-tile border px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between", killActive ? "border-bearish/40 bg-wash-loss" : "border-border bg-card shadow-card")}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2 text-body-sm">
        {killActive ? (
          <span className="flex items-center gap-1.5 font-semibold text-bearish">
            <OctagonX className="h-4 w-4" aria-hidden="true" /> Kill switch on until {untilLabel}. Only exits are allowed.
          </span>
        ) : (
          <Badge variant={guardrails.beginnerMode ? "bullish" : "neutral"} title={guardrails.beginnerMode ? "Naked option selling is hidden and blocked." : "Naked option selling is allowed with a stop-loss."}>
            {guardrails.beginnerMode ? <ShieldCheck aria-hidden="true" /> : <ShieldOff aria-hidden="true" />}
            Beginner mode {guardrails.beginnerMode ? "on" : "off"}
          </Badge>
        )}
        <span className="text-muted-foreground">
          Max loss per trade <span className="font-num font-semibold text-foreground">{guardrails.maxRiskPct}%</span>
        </span>
        <span className="flex min-w-[200px] items-center gap-2">
          <span className="text-muted-foreground">Today</span>
          <span className={cn("font-num font-semibold tabular-nums", signedClass(todayPnl))}>{signedINR(todayPnl)}</span>
          {cap ? (
            <>
              <Progress value={used} className={cn("h-1.5 w-20", used >= 80 && "[&>div]:bg-bearish")} aria-label={`Daily loss cap used: ${Math.round(used)}%`} />
              <span className="text-micro text-muted-foreground">cap {formatINR(cap, { decimals: 0 })}</span>
            </>
          ) : (
            <span className="text-micro text-muted-foreground">no daily cap</span>
          )}
        </span>
      </div>
      {killActive ? (
        <Button variant="outline" size="sm" onClick={onRelease} className="shrink-0">
          Release kill switch
        </Button>
      ) : (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button size="sm" className="shrink-0 bg-bearish text-bearish-foreground hover:bg-bearish/90">
              <OctagonX aria-hidden="true" /> Kill switch
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Stop trading for today?</AlertDialogTitle>
              <AlertDialogDescription>Open orders are cancelled and new orders are blocked until the next session opens (09:15 IST). Exits stay available. You can release it early from here.</AlertDialogDescription>
            </AlertDialogHeader>
            {openPositions > 0 ? (
              <div className="flex items-center gap-2">
                <Checkbox id="kill-square-off" checked={squareOff} onCheckedChange={(v) => setSquareOff(v === true)} />
                <Label htmlFor="kill-square-off" className="font-normal">
                  Also square off all {openPositions} open position{openPositions === 1 ? "" : "s"} at market
                </Label>
              </div>
            ) : null}
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => onKill(openPositions > 0 && squareOff)}>Turn on kill switch</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  );
}
