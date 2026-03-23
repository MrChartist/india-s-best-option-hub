import { useState, useEffect } from "react";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { Outlet } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CommandPalette } from "@/components/CommandPalette";
import { AlertSystem } from "@/components/AlertSystem";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { indicesData, marketStats } from "@/lib/mockData";
import { Search, Bell, Keyboard, Timer, RefreshCw } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

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

  // Auto-refresh countdown
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => {
      setRefreshCountdown(prev => {
        if (prev <= 1) return 30; // Reset countdown
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [autoRefresh]);

  // Calculate time to nearest expiry
  useEffect(() => {
    const updateTimer = () => {
      const now = new Date();
      // Next Thursday 15:30
      const target = new Date(now);
      target.setHours(15, 30, 0, 0);
      const dayOfWeek = now.getDay();
      const daysUntilThursday = ((4 - dayOfWeek) + 7) % 7 || 7;
      if (dayOfWeek === 4 && now < target) {
        // It's Thursday before 15:30
      } else {
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
      <div className="min-h-screen flex w-full">
        <AppSidebar />
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Global Control Bar */}
          <header className="h-10 flex items-center border-b border-border px-3 shrink-0 bg-card/50 backdrop-blur-sm">
            <SidebarTrigger className="mr-2" />

            {/* Mini Ticker */}
            <div className="flex items-center gap-3 overflow-hidden flex-1">
              {indicesData.slice(0, 3).map((idx) => {
                const pos = idx.change >= 0;
                return (
                  <div key={idx.symbol} className="flex items-center gap-1.5 shrink-0">
                    <span className="text-[10px] text-muted-foreground">{idx.symbol}</span>
                    <span className="text-[11px] font-mono font-medium">{idx.ltp.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</span>
                    <span className={`text-[10px] font-mono ${pos ? "text-bullish" : "text-bearish"}`}>
                      {pos ? "+" : ""}{idx.changePercent.toFixed(2)}%
                    </span>
                  </div>
                );
              })}
              <div className="flex items-center gap-1.5 shrink-0">
                <span className="text-[10px] text-muted-foreground">VIX</span>
                <span className="text-[11px] font-mono font-medium">{marketStats.indiaVix}</span>
              </div>
            </div>

            {/* Right Controls */}
            <div className="flex items-center gap-1.5 shrink-0">
              {/* Time to Expiry */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex items-center gap-1 px-2 py-0.5 rounded bg-accent/50 mr-1">
                    <Timer className="h-3 w-3 text-warning" />
                    <span className="text-[10px] font-mono text-warning">{timeToExpiry}</span>
                  </div>
                </TooltipTrigger>
                <TooltipContent>Time to nearest weekly expiry</TooltipContent>
              </Tooltip>

              {/* Search */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setSearchOpen(true)}>
                    <Search className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Search <span className="font-mono text-muted-foreground ml-1">/</span></TooltipContent>
              </Tooltip>

              {/* Alerts */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-7 w-7 relative" onClick={() => setAlertsOpen(true)}>
                    <Bell className="h-3.5 w-3.5" />
                    <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-primary" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Alerts <span className="font-mono text-muted-foreground ml-1">Alt+A</span></TooltipContent>
              </Tooltip>

              {/* Shortcuts hint */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-7 w-7">
                    <Keyboard className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent className="text-[10px]">
                  <div className="space-y-0.5">
                    <p><span className="font-mono">/</span> Search</p>
                    <p><span className="font-mono">Ctrl+1-5</span> Navigate</p>
                    <p><span className="font-mono">G</span> Toggle Greeks</p>
                    <p><span className="font-mono">Alt+A</span> Alerts</p>
                  </div>
                </TooltipContent>
              </Tooltip>

              {/* Market Status */}
              <div className="flex items-center gap-1.5 ml-1">
                <span className={`h-1.5 w-1.5 rounded-full ${isOpen ? "bg-bullish animate-pulse-glow" : "bg-muted-foreground"}`} />
                <span className="text-[10px] text-muted-foreground font-mono">{isOpen ? "LIVE" : "CLOSED"}</span>
              </div>
              <span className="text-[10px] text-muted-foreground font-mono">
                {now.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
              </span>
            </div>
          </header>

          <main className="flex-1 overflow-auto p-3 lg:p-5">
            <Outlet />
          </main>
        </div>
      </div>

      <CommandPalette open={searchOpen} onOpenChange={setSearchOpen} />
      <AlertSystem open={alertsOpen} onOpenChange={setAlertsOpen} />
    </SidebarProvider>
  );
}
