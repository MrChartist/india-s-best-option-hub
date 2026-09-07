import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Settings2, Keyboard } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getActiveBroker } from "@/lib/brokerConfig";

interface Props {
  feedConnected: boolean;
  onShowHelp: () => void;
}

/** IST clock, matching the reference terminal's header timestamp. */
function useIstClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return now.toLocaleString("en-GB", {
    timeZone: "Asia/Kolkata",
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  });
}

export function TerminalHeaderBar({ feedConnected, onShowHelp }: Props) {
  const clock = useIstClock();
  const broker = getActiveBroker();

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-xs text-muted-foreground">Broker:</span>

      {broker ? (
        <Badge variant="outline" className="h-6 font-normal">
          {/* label already carries a masked client id — see brokerConfig */}
          {broker.label || broker.brokerId}
        </Badge>
      ) : (
        <Badge variant="outline" className="h-6 font-normal border-warning/40 text-warning">
          No broker connected
        </Badge>
      )}

      <Button asChild variant="ghost" size="icon" className="h-6 w-6">
        <Link to="/broker-settings" aria-label="Broker settings">
          <Settings2 className="h-3.5 w-3.5" />
        </Link>
      </Button>

      <Badge
        variant="outline"
        className={`h-6 font-normal gap-1.5 ${feedConnected ? "border-bullish/40 text-bullish" : "border-muted-foreground/40 text-muted-foreground"}`}
      >
        <span className={`h-1.5 w-1.5 rounded-full ${feedConnected ? "bg-bullish animate-pulse" : "bg-muted-foreground"}`} />
        {feedConnected ? "Live feed" : "Feed offline"}
      </Badge>

      <span className="flex-1" />

      <Button variant="ghost" size="sm" className="h-6 gap-1 text-[11px]" onClick={onShowHelp}>
        <Keyboard className="h-3.5 w-3.5" /> Shortcuts <kbd className="font-mono">?</kbd>
      </Button>

      <span className="text-xs font-mono tabular-nums text-muted-foreground">{clock}</span>
    </div>
  );
}
