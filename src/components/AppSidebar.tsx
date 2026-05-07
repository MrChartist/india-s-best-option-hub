import { LayoutDashboard, TableProperties, BarChart3, Star, Settings, Layers, Briefcase } from "lucide-react";
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
import { Sun, Moon, TrendingUp } from "lucide-react";

const mainItems = [
  { title: "Dashboard", url: "/", icon: LayoutDashboard, shortcut: "1" },
  { title: "Option Chain", url: "/option-chain", icon: TableProperties, shortcut: "2" },
  { title: "OI Analysis", url: "/oi-analysis", icon: BarChart3, shortcut: "3" },
  { title: "Watchlist", url: "/watchlist", icon: Star, shortcut: "4" },
];

const tradingItems = [
  { title: "Strategy Builder", url: "/strategy-builder", icon: Layers, shortcut: "5" },
  { title: "Position Tracker", url: "/position-tracker", icon: Briefcase, shortcut: "6" },
];

const settingItems = [
  { title: "Broker API Keys", url: "/broker-settings", icon: Settings },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const { isDark, toggle: toggleTheme } = useTheme();

  const renderNavItems = (items: { title: string; url: string; icon: typeof LayoutDashboard; shortcut?: string }[]) =>
    items.map((item) => (
      <SidebarMenuItem key={item.title}>
        <SidebarMenuButton asChild>
          <NavLink
            to={item.url}
            end={item.url === "/"}
            className="group relative flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] text-sidebar-foreground transition-all duration-150 hover:bg-sidebar-accent hover:text-foreground"
            activeClassName="bg-primary/5 text-primary font-medium shadow-[inset_0_0_10px_hsl(var(--primary)/0.15)] before:absolute before:left-0 before:top-1/2 before:-translate-y-1/2 before:h-4 before:w-[3px] before:rounded-r-full before:bg-primary before:shadow-[0_0_8px_hsl(var(--primary)/0.8)]"
          >
            <item.icon className="h-4 w-4 shrink-0" />
            {!collapsed && (
              <>
                <span className="flex-1">{item.title}</span>
                {"shortcut" in item && item.shortcut && (
                  <kbd className="text-2xs font-mono text-muted-foreground/30 group-hover:text-muted-foreground/50 bg-transparent border-0 px-0">⌘{item.shortcut}</kbd>
                )}
              </>
            )}
          </NavLink>
        </SidebarMenuButton>
      </SidebarMenuItem>
    ));

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b border-sidebar-border px-4 py-4">
        <div className="flex items-center gap-3">
          <div className="relative h-9 w-9 rounded-xl bg-[#0a0d14] flex items-center justify-center shadow-[0_0_20px_-3px_hsl(var(--primary)/0.6)] border border-primary/30 overflow-hidden group">
            {/* Animated neon background effect */}
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_120%,hsl(var(--primary)/0.4),transparent_70%)] opacity-80 group-hover:opacity-100 transition-opacity duration-500" />
            <div className="absolute inset-0 bg-[linear-gradient(135deg,transparent_0%,rgba(255,255,255,0.15)_50%,transparent_100%)] translate-x-[-100%] group-hover:animate-[shimmer_1.5s_infinite]" />
            
            {/* New custom Mr. Chartist Logo (Stylized 'M' and Candlestick) */}
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="relative z-10 drop-shadow-[0_0_5px_hsl(var(--primary)/0.8)]">
              {/* Outer hexagon/frame */}
              <path d="M12 2L2 7V17L12 22L22 17V7L12 2Z" stroke="hsl(var(--primary))" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="opacity-80" />
              {/* Internal stylized 'M' chart */}
              <path d="M6 16V10L9 13L15 7V16" stroke="hsl(var(--primary))" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              {/* Glow dot / Node */}
              <circle cx="15" cy="7" r="2" fill="hsl(var(--primary))" className="animate-pulse" />
            </svg>
          </div>
          {!collapsed && (
            <div className="flex flex-col">
              <h1 className="text-[15px] font-bold text-foreground tracking-tight leading-none drop-shadow-sm">Mr. Chartist</h1>
              <p className="text-[10px] text-muted-foreground mt-0.5 tracking-[0.2em] font-semibold uppercase bg-clip-text text-transparent bg-gradient-to-r from-muted-foreground to-muted-foreground/50">Options Terminal</p>
            </div>
          )}
        </div>
      </SidebarHeader>

      <SidebarContent className="px-2 py-2">
        <SidebarGroup>
          <SidebarGroupLabel className="text-2xs uppercase tracking-[0.15em] text-muted-foreground/50 px-2 mb-1 font-medium">Markets</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="space-y-0.5">{renderNavItems(mainItems)}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarSeparator className="my-2 opacity-30" />

        <SidebarGroup>
          <SidebarGroupLabel className="text-2xs uppercase tracking-[0.15em] text-muted-foreground/50 px-2 mb-1 font-medium">Trading Tools</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="space-y-0.5">{renderNavItems(tradingItems)}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarSeparator className="my-2 opacity-30" />

        <SidebarGroup>
          <SidebarGroupLabel className="text-2xs uppercase tracking-[0.15em] text-muted-foreground/50 px-2 mb-1 font-medium">Settings</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="space-y-0.5">{renderNavItems(settingItems)}</SidebarMenu>
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
