import { useState, useEffect } from "react";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { Outlet } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { CommandPalette } from "@/components/CommandPalette";
import { AlertSystem } from "@/components/AlertSystem";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { indicesData, marketStats } from "@/lib/mockData";
import { Search, Bell, Timer, RefreshCw } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";

export default function DashboardLayout() {
  const [searchOpen, setSearchOpen] = useState(false);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [timeToExpiry, setTimeToExpiry] = useState("");
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [refreshCountdown, setRefreshCountdown] = useState(30);

  useKeyboardShortcuts({
    onToggleSearch: () => setSearchOpen(true),
    onToggleAlerts: () => setAlertsOpen(true),
  });

  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => {
      setRefreshCountdown(prev => (prev <= 1 ? 30 : prev - 1));
    }, 1000);
    return () => clearInterval(interval);
  }, [autoRefresh]);

  useEffect(() => {
    const updateTimer = () => {
      const now = new Date();
      const target = new Date(now);
      target.setHours(15, 30, 0, 0);
      const dayOfWeek = now.getDay();
      const daysUntilThursday = ((4 - dayOfWeek) + 7) % 7 || 7;
      if (!(dayOfWeek === 4 && now < target)) {
        target.setDate(target.getDate() + daysUntilThursday);
      }
      const diff = target.getTime() - now.getTime();
      const days = Math.floor(diff / (1000 * 60 * 60 * 24));
      const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      setTimeToExpiry(`${days}d ${hours}h ${mins}m`);
    };
    updateTimer();
    const interval = setInterval(updateTimer, 60000);
    return () => clearInterval(interval);
  }, []);

  const now = new Date();
  const hours = now.getHours();
  const isOpen = (hours >= 9 && hours < 15) || (hours === 15 && now.getMinutes() <= 30);

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-background">
        <AppSidebar />
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Top Bar — refined with glass effect */}
          <header className="h-9 flex items-center border-b border-border px-2 sm:px-3 shrink-0 bg-card/60 glass">
            <SidebarTrigger className="mr-2 h-6 w-6" />

            {/* Live Ticker */}
            <div className="flex items-center gap-4 overflow-hidden flex-1 mr-2">
              {indicesData.slice(0, 3).map((idx) => {
                const pos = idx.change >= 0;
                return (
                  <div key={idx.symbol} className="flex items-center gap-1.5 shrink-0">
                    <span className="text-2xs text-muted-foreground font-medium uppercase tracking-wider">{idx.symbol}</span>
                    <span className="text-[11px] font-mono font-semibold tabular-nums">{idx.ltp.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</span>
                    <span className={`text-2xs font-mono font-medium tabular-nums ${pos ? "text-bullish" : "text-bearish"}`}>
                      {pos ? "+" : ""}{idx.changePercent.toFixed(2)}%
                    </span>
                  </div>
                );
              })}
              <div className="flex items-center gap-1.5 shrink-0">
                <span className="text-2xs text-muted-foreground font-medium uppercase tracking-wider">VIX</span>
                <span className={`text-[11px] font-mono font-semibold tabular-nums ${marketStats.vixChange >= 0 ? "text-bearish" : "text-bullish"}`}>
                  {marketStats.indiaVix}
                </span>
              </div>
            </div>

            {/* Controls */}
            <div className="flex items-center gap-1 shrink-0">
              {/* Auto Refresh */}
              <button
                className={`flex items-center gap-1 px-1.5 py-0.5 rounded-md text-2xs font-mono transition-all ${autoRefresh ? "text-primary bg-primary/5" : "text-muted-foreground hover:text-foreground"}`}
                onClick={() => setAutoRefresh(!autoRefresh)}
              >
                <RefreshCw className={`h-2.5 w-2.5 ${autoRefresh ? "animate-spin" : ""}`} style={autoRefresh ? { animationDuration: "3s" } : {}} />
                {autoRefresh ? `${refreshCountdown}s` : "OFF"}
              </button>

              <div className="w-px h-4 bg-border mx-0.5" />

              {/* Expiry Timer */}
              <div className="flex items-center gap-1 px-1.5">
                <Timer className="h-2.5 w-2.5 text-warning" />
                <span className="text-2xs font-mono text-warning tabular-nums">{timeToExpiry}</span>
              </div>

              <div className="w-px h-4 bg-border mx-0.5" />

              {/* Search */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-6 w-6 hover:bg-primary/5" onClick={() => setSearchOpen(true)}>
                    <Search className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">Search <kbd className="ml-1 text-2xs font-mono bg-muted px-1 rounded">/</kbd></TooltipContent>
              </Tooltip>

              {/* Alerts */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-6 w-6 relative hover:bg-primary/5" onClick={() => setAlertsOpen(true)}>
                    <Bell className="h-3.5 w-3.5" />
                    <span className="absolute top-0.5 right-0.5 h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">Alerts</TooltipContent>
              </Tooltip>

              <div className="w-px h-4 bg-border mx-0.5" />

              {/* Market Status */}
              <div className="flex items-center gap-1.5">
                <div className="relative">
                  <span className={`block h-1.5 w-1.5 rounded-full ${isOpen ? "bg-bullish" : "bg-muted-foreground/50"}`} />
                  {isOpen && <span className="absolute inset-0 h-1.5 w-1.5 rounded-full bg-bullish animate-ping opacity-50" />}
                </div>
                <span className="text-2xs text-muted-foreground font-medium tracking-wide">{isOpen ? "LIVE" : "CLOSED"}</span>
              </div>
              <span className="text-2xs text-muted-foreground font-mono tabular-nums ml-1">
                {now.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
              </span>
            </div>
          </header>

          <main className="flex-1 overflow-auto p-2.5 sm:p-3 lg:p-4">
            <Outlet />
          </main>
        </div>
      </div>

      <CommandPalette open={searchOpen} onOpenChange={setSearchOpen} />
      <AlertSystem open={alertsOpen} onOpenChange={setAlertsOpen} />
    </SidebarProvider>
  );
}
