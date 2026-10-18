/**
 * One-line, dismissible context notice: IST session and the next change, the next weekly
 * expiries (NIFTY Tuesday, SENSEX Thursday) and the India VIX regime.
 */
import { useMemo } from "react";
import { Link } from "react-router-dom";
import { CalendarClock, Info, X } from "lucide-react";
import { useAllIndices } from "@/hooks/useMarketData";
import { dteLabel, formatDateIST, formatNumberIN, getExpiries, getMarketSession, nextSessionChange, type MarketSession } from "@/lib/options";
import { TONE_TEXT, vixRegime } from "./dashboardModel";
import { useNow } from "./useNow";

const SESSION_TEXT: Record<MarketSession, string> = {
  "pre-open": "Pre-open session",
  open: "Market open",
  closing: "Closing session",
  closed: "Market closed",
  holiday: "Exchange holiday",
  weekend: "Weekend",
};

interface Props {
  onDismiss: () => void;
}

export function WelcomeBanner({ onDismiss }: Props) {
  const now = useNow(60_000);
  const { data } = useAllIndices();
  const vix = data?.vix?.value ?? null;
  const regime = vixRegime(vix);

  const ctx = useMemo(() => {
    const session = getMarketSession(now);
    const next = nextSessionChange(now);
    const nifty = getExpiries("NIFTY", now, 1)[0];
    const sensex = getExpiries("SENSEX", now, 1)[0];
    return { session, next, nifty, sensex };
  }, [now]);

  const open = ctx.session === "open";

  return (
    <div
      role="region"
      aria-label="Market context"
      className="flex items-start gap-2 rounded-tile border border-separator bg-card px-3 py-1.5 text-body-sm shadow-card sm:items-center"
    >
      <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary-ink sm:mt-0" aria-hidden="true" />
      <p className="min-w-0 flex-1 leading-snug text-muted-foreground">
        <span className={open ? "font-semibold text-bullish" : "font-semibold text-foreground"}>{SESSION_TEXT[ctx.session]}</span>
        {ctx.next.label !== "—" ? <span> · {ctx.next.label}</span> : null}
        {ctx.nifty ? (
          <>
            <span aria-hidden="true"> · </span>
            <CalendarClock className="mb-0.5 inline h-3.5 w-3.5 text-warning" aria-hidden="true" />{" "}
            <Link to="/expiry-day" className="rounded-sm font-medium text-foreground hover:underline focus-visible:shadow-focus focus-visible:outline-none">
              NIFTY weekly {formatDateIST(ctx.nifty.date).replace(/ \d{4}$/, "")}
            </Link>{" "}
            <span className="font-num tabular-nums">({dteLabel(ctx.nifty.date, now)})</span>
          </>
        ) : null}
        {ctx.sensex ? (
          <span className="hidden md:inline">
            {" "}· SENSEX {formatDateIST(ctx.sensex.date).replace(/ \d{4}$/, "")} <span className="font-num tabular-nums">({dteLabel(ctx.sensex.date, now)})</span>
          </span>
        ) : null}
        {regime && vix !== null ? (
          <span>
            {" "}· VIX <span className="font-num font-semibold tabular-nums text-foreground">{formatNumberIN(vix, 2)}</span>{" "}
            <span className={TONE_TEXT[regime.tone]}>{regime.label.toLowerCase()}</span>
          </span>
        ) : null}
      </p>
      <button
        type="button"
        onClick={onDismiss}
        className="-m-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-pill text-muted-foreground hover:bg-control-track hover:text-foreground focus-visible:shadow-focus focus-visible:outline-none"
        aria-label="Dismiss market context line"
      >
        <X className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </div>
  );
}
