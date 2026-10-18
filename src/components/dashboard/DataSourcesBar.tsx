/**
 * Data source health in one compact control: a "Sources n/6" button that opens a list with
 * the status and detail of each feed. Replaces the old always-visible row of pulsing chips.
 */
import type { ReactNode } from "react";
import { Activity, BarChart3, Globe, Radio, TrendingUp, Zap } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useAllIndices, useFnOStocks, useLiveOptionChain, useProxyHealth } from "@/hooks/useMarketData";
import { useWebSocketStatus, useWebSocketVix } from "@/hooks/useWebSocket";
import { formatNumberIN } from "@/lib/options";
import { cn } from "@/lib/utils";

type FeedState = "live" | "degraded" | "offline";

interface SourceStatus {
  name: string;
  icon: ReactNode;
  status: FeedState;
  detail: string;
}

const DOT: Record<FeedState, string> = { live: "bg-bullish", degraded: "bg-warning", offline: "bg-bearish" };
const TEXT: Record<FeedState, string> = { live: "text-bullish", degraded: "text-warning", offline: "text-bearish" };
const LABEL: Record<FeedState, string> = { live: "Connected", degraded: "Partial", offline: "Offline" };

export function DataSourcesBar() {
  const { data: health } = useProxyHealth();
  const { data: allIndices } = useAllIndices();
  const { data: fnoData } = useFnOStocks();
  const { data: niftyOC } = useLiveOptionChain("NIFTY");
  const wsConnected = useWebSocketStatus();
  const { vix: wsVix } = useWebSocketVix();

  const dhanConfigured = health?.sources?.dhan === true;
  const dhanWS = health?.websocket?.dhanConnected === true;
  const fnoSource = fnoData?.source ?? "none";
  const ocSource = niftyOC?.source ?? "none";
  const nStocks = fnoData?.allStocks?.length ?? 0;

  const sources: SourceStatus[] = [
    {
      name: "Dhan API",
      icon: <TrendingUp className="h-3.5 w-3.5" aria-hidden="true" />,
      status: dhanConfigured ? (ocSource === "dhan" ? "live" : dhanWS ? "degraded" : "offline") : "offline",
      detail: !dhanConfigured ? "No credentials configured on the proxy" : ocSource === "dhan" ? "Primary option chain source" : dhanWS ? "WebSocket only" : "Configured but not responding",
    },
    {
      name: "Dhan WebSocket",
      icon: <Zap className="h-3.5 w-3.5" aria-hidden="true" />,
      status: dhanWS ? "live" : "offline",
      detail: dhanWS
        ? `${formatNumberIN(health?.websocket?.instrumentsSubscribed ?? 0)} instruments · ${formatNumberIN(health?.websocket?.cachedTicks ?? 0)} cached ticks`
        : dhanConfigured
          ? "Disconnected"
          : "Needs Dhan credentials",
    },
    {
      name: "Browser feed",
      icon: <Radio className="h-3.5 w-3.5" aria-hidden="true" />,
      status: wsConnected ? "live" : "offline",
      detail: wsConnected ? `Connected · ${formatNumberIN(health?.websocket?.browserClients ?? 0)} client(s)` : "Not connected to the proxy relay",
    },
    {
      name: "NSE",
      icon: <Globe className="h-3.5 w-3.5" aria-hidden="true" />,
      status: allIndices?.isLive || ocSource === "nse" ? "live" : "offline",
      detail: allIndices?.isLive ? `Indices and sectors${ocSource === "nse" ? " · option chain fallback" : ""}` : ocSource === "nse" ? "Option chain (Dhan unavailable)" : "No response",
    },
    {
      name: "TradingView",
      icon: <BarChart3 className="h-3.5 w-3.5" aria-hidden="true" />,
      status: fnoSource === "tradingview" ? "live" : fnoData?.isLive ? "degraded" : "offline",
      detail: fnoSource === "tradingview" ? `${formatNumberIN(nStocks)} F&O stocks (no OI)` : fnoData?.isLive ? `Standby · NSE serving ${formatNumberIN(nStocks)} stocks` : "Standby",
    },
    {
      name: "India VIX",
      icon: <Activity className="h-3.5 w-3.5" aria-hidden="true" />,
      status: wsVix ? "live" : allIndices?.vix ? "degraded" : "offline",
      detail: wsVix ? `Dhan stream · ${formatNumberIN(wsVix.value, 2)}` : allIndices?.vix ? `NSE poll · ${formatNumberIN(allIndices.vix.value, 2)}` : "No data",
    },
  ];

  const live = sources.filter((s) => s.status === "live").length;
  const overall: FeedState = live >= 4 ? "live" : live >= 2 ? "degraded" : "offline";

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          title="Data sources"
          className={cn(buttonVariants({ variant: "outline" }), "px-2.5")}
        >
          <span className={cn("h-2 w-2 rounded-full", DOT[overall])} aria-hidden="true" />
          <span className="font-num tabular-nums">
            {live}/{sources.length}
          </span>
          <span>sources</span>
          <span className="sr-only">connected. Show details</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[300px] p-2">
        <p className="px-2 pb-1 pt-1 text-label text-muted-foreground">Data sources</p>
        <ul className="space-y-0.5">
          {sources.map((s) => (
            <li key={s.name} className="flex items-start gap-2 rounded-md px-2 py-1.5">
              <span className={cn("mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full", DOT[s.status])} aria-hidden="true" />
              <span className="mt-0.5 text-muted-foreground">{s.icon}</span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-2">
                  <span className="text-body font-medium">{s.name}</span>
                  <span className={cn("text-body-sm font-medium", TEXT[s.status])}>{LABEL[s.status]}</span>
                </span>
                <span className="block text-body-sm leading-snug text-muted-foreground">{s.detail}</span>
              </span>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
