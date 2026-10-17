/** Countdown to 15:30 IST, the expiry banner and a session progress rail with the settlement window. */
import { memo } from "react";
import { AlarmClock, CalendarClock, Hourglass } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { dteLabel, formatDateIST, getContractSpec, getMarketSession, istDateString, toISTDate, type MarketSession } from "@/lib/options";
import { cn } from "@/lib/utils";
import { expiryWeekday, settlementWindowState, shiftedFromDate } from "./expiryMath";
import { useNow } from "./useExpirySession";

const SESSION_TEXT: Record<MarketSession, string> = {
  "pre-open": "Pre-open",
  open: "Market open",
  closing: "Closing session",
  closed: "Market closed",
  holiday: "Exchange holiday",
  weekend: "Weekend",
};

function hms(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

function ExpiryCountdownImpl({ symbol, expiry, type }: { symbol: string; expiry: string; type?: "weekly" | "monthly" }) {
  const now = useNow(1000);
  if (!expiry) {
    return (
      <div className="rounded-card border border-border bg-card p-4 text-body-sm text-muted-foreground shadow-card">No upcoming expiry found for {symbol}.</div>
    );
  }
  const exchange = getContractSpec(symbol)?.exchange ?? "NSE";
  const session = getMarketSession(now, exchange);
  const today = istDateString(now) === expiry;
  const closeAt = toISTDate(expiry, "15:30").getTime();
  const left = closeAt - now.getTime();
  const expired = left <= 0;
  const settle = settlementWindowState(now, expiry);

  // Session progress rail for today (09:15 → 15:30).
  const todayIso = istDateString(now);
  const open = toISTDate(todayIso, "09:15").getTime();
  const close = toISTDate(todayIso, "15:30").getTime();
  const progress = Math.min(1, Math.max(0, (now.getTime() - open) / (close - open)));
  const settleStart = (toISTDate(todayIso, "15:00").getTime() - open) / (close - open);
  const inSession = session === "open";
  const kind = type === "monthly" ? "monthly" : "weekly";
  const movedFrom = shiftedFromDate(symbol, expiry);

  return (
    <section
      aria-label="Expiry countdown"
      className={cn(
        "rounded-card border p-4 shadow-card",
        today && !expired ? "border-warning/40 bg-wash-warning" : "border-border bg-card",
      )}
    >
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {today && !expired ? (
              <Badge variant="warning">
                <AlarmClock aria-hidden="true" /> Expiry today
              </Badge>
            ) : (
              <Badge variant="info">
                <CalendarClock aria-hidden="true" /> Next {kind} expiry
              </Badge>
            )}
            <Badge variant={inSession ? "bullish" : "neutral"}>{SESSION_TEXT[session]}</Badge>
            {movedFrom ? (
              <Badge variant="warning" title={`The regular ${expiryWeekday(movedFrom)} expiry falls on an exchange holiday, so the contract expires on the previous trading day.`}>
                Moved from {expiryWeekday(movedFrom).slice(0, 3)} {formatDateIST(movedFrom).replace(/ \d{4}$/, "")} (exchange holiday)
              </Badge>
            ) : null}
          </div>
          <p className="mt-2 font-display text-title">
            {symbol} · {expiryWeekday(expiry)}, {formatDateIST(expiry)}
          </p>
          <p className="mt-0.5 text-body-sm text-muted-foreground">
            {today && !expired
              ? settle === "averaging"
                ? "Settlement averaging window is running (15:00–15:30 IST). The final price is being set now."
                : "Contracts settle at 15:30 IST against the index close, averaged over 15:00–15:30."
              : expired
                ? "This expiry has settled."
                : `${dteLabel(expiry, now)} to go. ${symbol} ${kind} options expire at 15:30 IST.`}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-3">
          <Hourglass className={cn("h-7 w-7", today && !expired ? "text-warning" : "text-muted-foreground")} aria-hidden="true" />
          <div>
            <p className="text-label uppercase text-muted-foreground">{today ? "Time to 15:30 IST" : "Time to expiry"}</p>
            <p role="timer" aria-live="off" aria-label={`Time to expiry ${dteLabel(expiry, now)}`} className="font-num text-num-hero tabular-nums">
              {expired ? "Settled" : today ? hms(left) : dteLabel(expiry, now)}
            </p>
          </div>
        </div>
      </div>

      {session !== "weekend" && session !== "holiday" ? (
        <div className="mt-4">
          <div
            className="relative h-2 w-full overflow-hidden rounded-capsule bg-muted"
            role="progressbar"
            aria-label="Trading session elapsed"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progress * 100)}
          >
            <div className="absolute inset-y-0 left-0 rounded-capsule bg-primary transition-[width] duration-settle ease-expo" style={{ width: `${progress * 100}%` }} />
            <div className="absolute inset-y-0 bg-warning/35" style={{ left: `${settleStart * 100}%`, right: 0 }} aria-hidden="true" />
          </div>
          <div className="mt-1 flex justify-between text-micro uppercase text-muted-foreground">
            <span>09:15</span>
            <span className="hidden sm:inline">12:00</span>
            <span className="text-warning">15:00 settlement window</span>
            <span>15:30</span>
          </div>
        </div>
      ) : null}
    </section>
  );
}

export const ExpiryCountdown = memo(ExpiryCountdownImpl);
