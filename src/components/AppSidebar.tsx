import { LayoutDashboard, TableProperties, BarChart3, Calculator, Layers, TrendingUp, ScanSearch, Briefcase, CandlestickChart, Activity, Gauge, Users, Zap, Star, Crosshair, Atom, BookOpen } from "lucide-react";
import { NavLink } from "@/components/NavLink";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarSeparator,
  SidebarFooter,
  useSidebar,
} from "@/components/ui/sidebar";
import { useTheme } from "@/hooks/useTheme";
import { Sun, Moon } from "lucide-react";

const mainItems = [
  { title: "Dashboard", url: "/", icon: LayoutDashboard, shortcut: "1" },
  { title: "Watchlist", url: "/watchlist", icon: Star, shortcut: "2" },
  { title: "Charts", url: "/charts", icon: CandlestickChart, shortcut: "3" },
  { title: "Option Chain", url: "/option-chain", icon: TableProperties, shortcut: "4" },
  { title: "OI Analysis", url: "/oi-analysis", icon: BarChart3, shortcut: "5" },
  { title: "OI Spurts", url: "/oi-spurts", icon: Zap },
  { title: "GEX Analysis", url: "/gex", icon: Atom, shortcut: "6" },
  { title: "Skew Dashboard", url: "/skew", icon: TrendingUp },
];

const toolItems = [
  { title: "Straddle Charts", url: "/straddle", icon: Activity },
  { title: "IV Surface", url: "/volatility", icon: Gauge },
  { title: "Scanner", url: "/scanner", icon: ScanSearch },
  { title: "Greeks Calc", url: "/greeks", icon: Calculator },
  { title: "Strategy Builder", url: "/strategy", icon: Layers },
  { title: "Strategy Finder", url: "/strategy-finder", icon: Crosshair },
  { title: "FII/DII", url: "/fii-dii", icon: Users },
  { title: "Positions", url: "/positions", icon: Briefcase },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const { isDark, toggle: toggleTheme } = useTheme();

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b border-sidebar-border px-4 py-3">
        <div className="flex items-center gap-2.5">
          <div className="h-7 w-7 rounded-lg bg-primary flex items-center justify-center shadow-glow-sm">
            <TrendingUp className="h-4 w-4 text-primary-foreground" />
          </div>
          {!collapsed && (
            <div>
              <h1 className="text-sm font-bold text-foreground tracking-tight leading-none">OptionsDesk</h1>
              <p className="text-2xs text-muted-foreground mt-0.5 tracking-[0.15em] uppercase">F&O Terminal</p>
            </div>
          )}
        </div>
      </SidebarHeader>

      <SidebarContent className="px-2 py-2">
        <SidebarGroup>
          <SidebarGroupLabel className="text-2xs uppercase tracking-[0.15em] text-muted-foreground/50 px-2 mb-1 font-medium">Markets</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="space-y-0.5">
              {mainItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild>
                    <NavLink
                      to={item.url}
                      end={item.url === "/"}
                      className="group relative flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] text-sidebar-foreground transition-all duration-150 hover:bg-sidebar-accent hover:text-foreground"
                      activeClassName="bg-primary/10 text-primary font-medium before:absolute before:left-0 before:top-1/2 before:-translate-y-1/2 before:h-4 before:w-[3px] before:rounded-r-full before:bg-primary"
                    >
                      <item.icon className="h-4 w-4 shrink-0" />
                      {!collapsed && (
                        <>
                          <span className="flex-1">{item.title}</span>
                          {item.shortcut && (
                            <kbd className="text-2xs font-mono text-muted-foreground/30 group-hover:text-muted-foreground/50 bg-transparent border-0 px-0">⌘{item.shortcut}</kbd>
                          )}
                        </>
                      )}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarSeparator className="my-2 opacity-30" />

        <SidebarGroup>
          <SidebarGroupLabel className="text-2xs uppercase tracking-[0.15em] text-muted-foreground/50 px-2 mb-1 font-medium">Analytics & Tools</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="space-y-0.5">
              {toolItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild>
                    <NavLink
                      to={item.url}
                      className="group relative flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] text-sidebar-foreground transition-all duration-150 hover:bg-sidebar-accent hover:text-foreground"
                      activeClassName="bg-primary/10 text-primary font-medium before:absolute before:left-0 before:top-1/2 before:-translate-y-1/2 before:h-4 before:w-[3px] before:rounded-r-full before:bg-primary"
                    >
                      <item.icon className="h-4 w-4 shrink-0" />
                      {!collapsed && <span className="flex-1">{item.title}</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border p-2">
        <button
          onClick={toggleTheme}
          className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] text-sidebar-foreground transition-all duration-150 hover:bg-sidebar-accent hover:text-foreground w-full"
        >
          {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          {!collapsed && <span>{isDark ? "Light Mode" : "Dark Mode"}</span>}
        </button>
      </SidebarFooter>
    </Sidebar>
  );
}
