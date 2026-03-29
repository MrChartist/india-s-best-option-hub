import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useProxyHealth, useAllIndices, useFnOStocks, useLiveOptionChain } from "@/hooks/useMarketData";
import { useWebSocketStatus, useWebSocketVix } from "@/hooks/useWebSocket";
import { Globe, BarChart3, Activity, Server, Zap, Radio, Database, TrendingUp } from "lucide-react";

interface SourceStatus {
  name: string;
  icon: React.ReactNode;
  status: "live" | "degraded" | "offline";
  detail?: string;
  primary?: boolean;
}

export function DataSourcesBar() {
  const { data: health } = useProxyHealth();
  const { data: allIndices } = useAllIndices();
  const { data: fnoData } = useFnOStocks();
  const { data: niftyOC } = useLiveOptionChain("NIFTY");
  const wsConnected = useWebSocketStatus();
  const { vix: wsVix } = useWebSocketVix();

  const dhanConfigured = health?.sources?.dhan === true;
  const dhanWSConnected = health?.websocket?.dhanConnected === true;
  const fnoSource = (fnoData as any)?.source || "none";
  const ocSource = niftyOC?.source || "offline";

  const sources: SourceStatus[] = [
    // ── DHAN (Primary — always first) ──
    {
      name: "Dhan API",
      icon: <TrendingUp className="h-3 w-3" />,
      status: dhanConfigured
        ? (ocSource === "dhan" ? "live" : dhanWSConnected ? "degraded" : "offline")
        : "offline",
      detail: !dhanConfigured
        ? "No credentials in .env"
        : ocSource === "dhan"
        ? "Primary · Option Chain"
        : dhanWSConnected
        ? "WebSocket only"
        : "Configured but no response",
      primary: true,
    },
    // ── Dhan WebSocket ──
    {
      name: "Dhan WS",
      icon: <Zap className="h-3 w-3" />,
      status: dhanWSConnected ? "live" : dhanConfigured ? "offline" : "offline",
      detail: dhanWSConnected
        ? `Live ticks · ${health?.websocket?.cachedTicks || 0} cached · ${health?.websocket?.instrumentsSubscribed || 0} instruments`
        : dhanConfigured
        ? "Disconnected"
        : "Requires Dhan credentials",
    },
    // ── Browser WebSocket (relay) ──
    {
      name: "Live Feed",
      icon: <Radio className="h-3 w-3" />,
      status: wsConnected ? "live" : "offline",
      detail: wsConnected
        ? `Browser connected · ${health?.websocket?.browserClients || 0} clients`
        : "Browser WS disconnected",
    },
    // ── NSE India ──
    {
      name: "NSE",
      icon: <Globe className="h-3 w-3" />,
      status: allIndices?.isLive
        ? "live"
        : ocSource === "nse"
        ? "live"
        : "offline",
      detail: allIndices?.isLive
        ? `Indices${ocSource === "nse" ? " + Option Chain (fallback)" : " + Sectors"}`
        : ocSource === "nse"
        ? "Option Chain (Dhan unavailable)"
        : "No data",
    },
    // ── TradingView Scanner ──
    {
      name: "TradingView",
      icon: <BarChart3 className="h-3 w-3" />,
      status: fnoSource === "tradingview"
        ? "live"
        : fnoData?.isLive
        ? "degraded"
        : "offline",
      detail: fnoSource === "tradingview"
        ? `${fnoData?.allStocks?.length || 0} F&O stocks (no OI)`
        : fnoData?.isLive
        ? `NSE primary · ${fnoData.allStocks?.length || 0} stocks`
        : "Standby",
    },
    // ── VIX (composite) ──
    {
      name: "VIX",
      icon: <Activity className="h-3 w-3" />,
      status: wsVix ? "live" : allIndices?.vix ? "degraded" : "offline",
      detail: wsVix
        ? `Dhan WS: ${wsVix.value?.toFixed(2)}`
        : allIndices?.vix
        ? `NSE Poll: ${allIndices.vix.value?.toFixed(2)}`
        : "No data",
    },
  ];

  const liveCount = sources.filter(s => s.status === "live").length;
  const totalCount = sources.length;

  const statusColor = (s: SourceStatus["status"]) => {
    switch (s) {
      case "live": return "bg-emerald-500";
      case "degraded": return "bg-amber-500";
      case "offline": return "bg-red-500";
    }
  };

  const statusTextColor = (s: SourceStatus["status"]) => {
    switch (s) {
      case "live": return "text-emerald-400";
      case "degraded": return "text-amber-400";
      case "offline": return "text-red-400";
    }
  };

  const statusLabel = (s: SourceStatus["status"]) => {
    switch (s) {
      case "live": return "Connected";
      case "degraded": return "Partial";
      case "offline": return "Offline";
    }
  };

  return (
    <div className="flex items-center gap-1 px-2 py-1.5 rounded-lg bg-card/60 border border-border/50 backdrop-blur-sm overflow-x-auto">
      {/* Overall status indicator */}
      <div className="flex items-center gap-1.5 mr-2 pr-2 border-r border-border/30 shrink-0">
        <div className={`h-2 w-2 rounded-full ${liveCount >= 4 ? "bg-emerald-500 animate-pulse" : liveCount >= 2 ? "bg-amber-500 animate-pulse" : "bg-red-500"}`} />
        <span className="text-[10px] font-semibold text-muted-foreground whitespace-nowrap">
          {liveCount}/{totalCount} Sources
        </span>
      </div>

      {/* Individual sources */}
      {sources.map((src) => (
        <Tooltip key={src.name}>
          <TooltipTrigger asChild>
            <div className={`flex items-center gap-1 px-2 py-0.5 rounded-md text-[9px] font-medium cursor-default transition-all duration-200 shrink-0 ${
              src.primary 
                ? src.status === "live"
                  ? "bg-emerald-500/10 border border-emerald-500/20 text-emerald-400"
                  : src.status === "degraded"
                  ? "bg-amber-500/10 border border-amber-500/20 text-amber-400"
                  : "bg-red-500/5 border border-red-500/10 text-red-400"
                : `${statusTextColor(src.status)} hover:bg-accent/30`
            }`}>
              <div className={`h-1.5 w-1.5 rounded-full shrink-0 ${statusColor(src.status)} ${src.status === "live" ? "animate-pulse" : ""}`} />
              {src.icon}
              <span className="hidden sm:inline whitespace-nowrap">{src.name}</span>
            </div>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs max-w-[280px]">
            <div className="space-y-1">
              <div className="flex items-center gap-1.5">
                <div className={`h-2 w-2 rounded-full shrink-0 ${statusColor(src.status)}`} />
                <span className="font-semibold">{src.name}</span>
                <Badge variant="outline" className={`text-[8px] h-4 px-1 ${statusTextColor(src.status)}`}>
                  {statusLabel(src.status)}
                </Badge>
              </div>
              <p className="text-muted-foreground text-[11px] leading-snug">{src.detail}</p>
            </div>
          </TooltipContent>
        </Tooltip>
      ))}
    </div>
  );
}
