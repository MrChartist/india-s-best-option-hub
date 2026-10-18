import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Settings2, Keyboard } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getActiveBroker, getBrokerInfo } from "@/lib/brokerConfig";

/** Broker name plus a masked client id, so the trader can see which account the terminal uses. */
function brokerLabel(brokerId: string, values: Record<string, string>): string {
  const name = getBrokerInfo(brokerId)?.name ?? brokerId;
  const id = values.clientId || values.userId || "";
  if (!id) return name;
  return `${name} (${id.length > 4 ? `${id.slice(0, 2)}****${id.slice(-2)}` : id})`;
}

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
      <span className="text-body-sm text-muted-foreground">Broker:</span>

      {broker ? (
        <Badge variant="outline" className="h-6 font-normal">
          {brokerLabel(broker.brokerId, broker.values)}
        </Badge>
      ) : (
        <Badge variant="outline" className="h-6 font-normal border-warning/40 text-warning">
          No broker connected
        </Badge>
      )}

      <Button asChild variant="ghost" size="icon" className="h-6 w-6">
        <Link to="/broker-settings" aria-label="Broker settings">
          <Settings2 />
        </Link>
      </Button>

      <Badge
        variant="outline"
        className={`h-6 font-normal gap-1.5 ${feedConnected ? "border-bullish/40 text-bullish" : "border-muted-foreground/40 text-muted-foreground"}`}
      >
        <span className={`h-1.5 w-1.5 rounded-capsule ${feedConnected ? "bg-bullish animate-pulse" : "bg-muted-foreground"}`} />
        {feedConnected ? "Live feed" : "Feed offline"}
      </Badge>

      <span className="flex-1" />

      <Button variant="ghost" size="sm" className="h-6 text-[11px]" onClick={onShowHelp}>
        <Keyboard /> Shortcuts <kbd className="font-mono">?</kbd>
      </Button>

      <span className="text-body-sm font-mono tabular-nums text-muted-foreground">{clock}</span>
    </div>
  );
}
