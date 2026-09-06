import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Wifi, WifiOff, Clock } from "lucide-react";

interface Props {
  isLive: boolean;
  isOpen: boolean;
  marketStatus: string;
}

export function MarketHeader({ isLive, isOpen, marketStatus }: Props) {
  // `now` used to be computed once per render — since this component only
  // re-renders when props change (market status polls every 15-60s), the
  // displayed IST clock could sit frozen for up to a minute, reading as a
  // stale/hung widget. Tick it independently with its own interval instead.
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Market Dashboard</h1>
        <p className="text-xs text-muted-foreground">
          {now.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "short", year: "numeric" })}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Badge variant="outline" className={`gap-1.5 text-2xs ${isLive ? "border-bullish/40 text-bullish" : "border-bearish/30 text-bearish"}`}>
          {isLive ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
          {isLive ? "LIVE" : "OFFLINE"}
        </Badge>
        <Badge variant={isOpen ? "default" : "secondary"} className={`gap-1.5 text-2xs ${isOpen ? "bg-bullish text-bullish-foreground" : ""}`}>
          <Clock className="h-3 w-3" />
          {marketStatus}
        </Badge>
        <span className="text-2xs text-muted-foreground font-mono tabular-nums">
          {now.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })} IST
        </span>
      </div>
    </div>
  );
}
