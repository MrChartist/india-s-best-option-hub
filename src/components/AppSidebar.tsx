import { LayoutDashboard, TableProperties, BarChart3, Calculator, Layers, TrendingUp, ScanSearch, Briefcase, CandlestickChart, Activity, Gauge, Users, Zap, Star, Crosshair } from "lucide-react";
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
          <div className="h-7 w-7 rounded-md bg-primary flex items-center justify-center">
            <TrendingUp className="h-4 w-4 text-primary-foreground" />
          </div>
          {!collapsed && (
            <div>
              <h1 className="text-sm font-bold text-foreground tracking-tight leading-none">OptionsDesk</h1>
              <p className="text-[9px] text-muted-foreground mt-0.5 tracking-wider uppercase">F&O Terminal</p>
            </div>
          )}
        </div>
      </SidebarHeader>

      <SidebarContent className="px-2 py-2">
        <SidebarGroup>
          <SidebarGroupLabel className="text-[9px] uppercase tracking-widest text-muted-foreground/60 px-2 mb-1">Markets</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="space-y-0.5">
              {mainItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild>
                    <NavLink
                      to={item.url}
                      end={item.url === "/"}
                      className="group relative flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
                      activeClassName="bg-primary/10 text-primary font-medium before:absolute before:left-0 before:top-1/2 before:-translate-y-1/2 before:h-4 before:w-[3px] before:rounded-r before:bg-primary"
                    >
                      <item.icon className="h-4 w-4 shrink-0" />
                      {!collapsed && (
                        <>
                          <span className="flex-1">{item.title}</span>
                          {item.shortcut && (
                            <span className="text-[9px] font-mono text-muted-foreground/40 group-hover:text-muted-foreground/60">⌘{item.shortcut}</span>
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

        <SidebarSeparator className="my-2 opacity-50" />

        <SidebarGroup>
          <SidebarGroupLabel className="text-[9px] uppercase tracking-widest text-muted-foreground/60 px-2 mb-1">Analytics & Tools</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="space-y-0.5">
              {toolItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild>
                    <NavLink
                      to={item.url}
                      className="group relative flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
                      activeClassName="bg-primary/10 text-primary font-medium before:absolute before:left-0 before:top-1/2 before:-translate-y-1/2 before:h-4 before:w-[3px] before:rounded-r before:bg-primary"
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
          className="flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground w-full"
        >
          {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          {!collapsed && <span>{isDark ? "Light Mode" : "Dark Mode"}</span>}
        </button>
      </SidebarFooter>
    </Sidebar>
  );
}
