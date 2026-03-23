import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { Outlet } from "react-router-dom";
import { indicesData, marketStats } from "@/lib/mockData";

export default function DashboardLayout() {
  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full">
        <AppSidebar />
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Top Header Bar */}
          <header className="h-10 flex items-center border-b border-border px-3 shrink-0 bg-card/50 backdrop-blur-sm">
            <SidebarTrigger className="mr-3" />
            
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

            <div className="flex items-center gap-2 shrink-0">
              <div className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-bullish animate-pulse-glow" />
                <span className="text-[10px] text-muted-foreground font-mono">LIVE</span>
              </div>
              <span className="text-[10px] text-muted-foreground font-mono">
                {new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
              </span>
            </div>
          </header>

          <main className="flex-1 overflow-auto p-3 lg:p-5">
            <Outlet />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
