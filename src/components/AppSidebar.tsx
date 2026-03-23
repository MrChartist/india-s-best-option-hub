import { LayoutDashboard, TableProperties, BarChart3, Calculator, Layers, TrendingUp, ScanSearch, Briefcase, CandlestickChart, Activity, Gauge, Users, Zap, Star, Eye } from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { useLocation } from "react-router-dom";
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
  useSidebar,
} from "@/components/ui/sidebar";

const mainItems = [
  { title: "Dashboard", url: "/", icon: LayoutDashboard },
  { title: "Watchlist", url: "/watchlist", icon: Star },
  { title: "Charts", url: "/charts", icon: CandlestickChart },
  { title: "Option Chain", url: "/option-chain", icon: TableProperties },
  { title: "OI Analysis", url: "/oi-analysis", icon: BarChart3 },
  { title: "OI Spurts", url: "/oi-spurts", icon: Zap },
];

const toolItems = [
  { title: "Straddle Charts", url: "/straddle", icon: Activity },
  { title: "IV Surface", url: "/volatility", icon: Gauge },
  { title: "Scanner", url: "/scanner", icon: ScanSearch },
  { title: "Greeks Calc", url: "/greeks", icon: Calculator },
  { title: "Strategy Builder", url: "/strategy", icon: Layers },
  { title: "FII/DII", url: "/fii-dii", icon: Users },
  { title: "Positions", url: "/positions", icon: Briefcase },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b border-border p-4">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-6 w-6 text-primary" />
          {!collapsed && (
            <div>
              <h1 className="text-sm font-bold text-foreground tracking-tight">OptionsDesk</h1>
              <p className="text-[10px] text-muted-foreground">NSE F&O Terminal</p>
            </div>
          )}
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Markets</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {mainItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild>
                    <NavLink
                      to={item.url}
                      end={item.url === "/"}
                      className="hover:bg-accent/50"
                      activeClassName="bg-accent text-primary font-medium"
                    >
                      <item.icon className="mr-2 h-4 w-4" />
                      {!collapsed && <span>{item.title}</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarSeparator />

        <SidebarGroup>
          <SidebarGroupLabel>Analytics & Tools</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {toolItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild>
                    <NavLink
                      to={item.url}
                      className="hover:bg-accent/50"
                      activeClassName="bg-accent text-primary font-medium"
                    >
                      <item.icon className="mr-2 h-4 w-4" />
                      {!collapsed && <span>{item.title}</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
