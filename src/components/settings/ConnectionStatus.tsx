import { Activity, BarChart3, Globe, Radio, Server, TrendingUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useAllIndices, useFnOStocks, useProxyHealth } from "@/hooks/useMarketData";
import { useWebSocketStatus } from "@/hooks/useWebSocket";
import { getDhanCredentials, useBrokerConfig } from "@/lib/brokerConfig";
import { cn } from "@/lib/utils";

type Level = "ok" | "idle" | "down";

/** Live health of every data path. This is the one place the app shows the full picture. */
export function ConnectionStatus() {
  const { data: health } = useProxyHealth();
  const { data: allIndices } = useAllIndices();
  const { data: fno } = useFnOStocks();
  const wsConnected = useWebSocketStatus();
  const { active } = useBrokerConfig();

  const proxyUp = !!health?.reachable;
  const dhanKeys = !!getDhanCredentials(active) || !!health?.sources?.dhan;

  const rows: { name: string; detail: string; level: Level; icon: typeof Server }[] = [
    {
      name: "Local proxy",
      icon: Server,
      level: proxyUp ? "ok" : "down",
      detail: proxyUp ? `Running · up ${Math.floor((health?.uptime || 0) / 60)} min` : "Not reachable — start it with `npm run dev`",
    },
    {
      name: "Dhan feed",
      icon: TrendingUp,
      level: !proxyUp ? "down" : dhanKeys ? "ok" : "idle",
      detail: dhanKeys
        ? health?.sources?.dhan && !getDhanCredentials(active) ? "Using keys from the proxy's .env" : "Your keys are set — use Test on the Dhan card to verify"
        : "No keys yet — option chain falls back to NSE",
    },
    {
      name: "Live ticks (WebSocket)",
      icon: Radio,
      level: wsConnected ? "ok" : "idle",
      detail: wsConnected
        ? `${health?.websocket?.instrumentsSubscribed || 0} instruments · ${health?.websocket?.cachedTicks || 0} cached ticks`
        : "Needs Dhan keys — otherwise data refreshes by polling",
    },
    {
      name: "NSE India",
      icon: Globe,
      level: allIndices?.isLive ? "ok" : proxyUp ? "idle" : "down",
      detail: allIndices?.isLive ? "Indices, VIX, sectors, breadth" : "No response yet (NSE can throttle — retries automatically)",
    },
    {
      name: "F&O stocks (NSE / TradingView)",
      icon: BarChart3,
      level: fno?.isLive ? "ok" : proxyUp ? "idle" : "down",
      detail: fno?.isLive ? `${fno.allStocks.length} stocks · source: ${fno.source}` : "No response yet",
    },
  ];

  const ok = rows.filter((r) => r.level === "ok").length;
  const dot: Record<Level, string> = { ok: "bg-bullish", idle: "bg-warning", down: "bg-bearish" };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Activity className="h-4 w-4 text-primary" /> Connection status
          <span className="num ml-auto rounded-full bg-foreground/[0.08] px-2.5 py-0.5 font-mono text-xs font-semibold">{ok}/{rows.length}</span>
        </CardTitle>
        <CardDescription>Everything runs on your machine — this is what's reachable right now.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-2 sm:grid-cols-2">
        {rows.map((r) => (
          <div key={r.name} className="glass-control flex items-start gap-3 rounded-xl p-3">
            <r.icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 text-sm font-medium">
                {r.name}
                <span className={cn("h-2 w-2 rounded-full", dot[r.level], r.level === "ok" && "animate-pulse")} />
              </p>
              <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{r.detail}</p>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
