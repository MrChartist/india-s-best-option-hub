import { useEffect, useState } from "react";
import { Activity, Clock, Code2, Terminal } from "lucide-react";
import { useLiveIndices, useMarketStatus } from "../hooks/useMarketData";

export const StatusFooter = () => {
  const { data: indicesResult } = useLiveIndices();
  const { data: marketResult } = useMarketStatus();
  const isConnected = indicesResult?.isLive || false;
  const isLive = marketResult?.isOpen || false;
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <footer className="fixed bottom-0 left-0 right-0 z-50 flex h-9 items-center justify-between gap-2 overflow-hidden border-t border-border/80 bg-background/95 px-3 text-xs font-mono text-muted-foreground backdrop-blur-md sm:px-4">
      <div className="flex min-w-0 items-center gap-2 sm:gap-4">
        <div className="flex shrink-0 items-center gap-1.5 text-primary">
          <Terminal size={12} />
          <span>v1.0.0</span>
        </div>

        <div className="flex min-w-0 items-center gap-1.5">
          <div className={`h-1.5 w-1.5 shrink-0 rounded-full ${isConnected ? "bg-bullish" : "bg-muted"}`} />
          <span className="truncate">
            <span className="hidden sm:inline">DHAN API: </span>
            {isConnected ? "CONNECTED" : "OFFLINE"}
          </span>
        </div>

        <div className="hidden items-center gap-1.5 sm:flex">
          <Activity size={12} className={isLive ? "text-warning" : "text-muted-foreground"} />
          <span>NSE: {isLive ? "LIVE" : "CLOSED"}</span>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2 sm:gap-6">
        <div className="hidden items-center gap-3 md:flex">
          <span className="flex items-center gap-1">
            <kbd className="rounded bg-muted px-1.5 py-0.5 text-xs">Ctrl K</kbd> Search
          </span>
          <span className="flex items-center gap-1">
            <kbd className="rounded bg-muted px-1.5 py-0.5 text-xs">R</kbd> Refresh
          </span>
          <span className="flex items-center gap-1">
            <kbd className="rounded bg-muted px-1.5 py-0.5 text-xs">1-6</kbd> Navigate
          </span>
        </div>

        <div className="flex items-center gap-1.5 sm:border-l sm:border-border sm:pl-4">
          <Clock size={12} />
          <span>{time.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</span>
        </div>

        <a
          href="https://github.com/MrChartist/india-s-best-option-hub"
          target="_blank"
          rel="noopener noreferrer"
          className="hidden items-center gap-1.5 border-l border-border pl-4 transition-colors hover:text-primary sm:flex"
        >
          <Code2 size={12} />
          <span>Star on GitHub</span>
        </a>
      </div>
    </footer>
  );
};
