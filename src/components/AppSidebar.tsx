import { BarChart3, Briefcase, LayoutDashboard, Layers, Moon, Settings, Star, Sun, TableProperties } from "lucide-react";
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
import { cn } from "@/lib/utils";

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
        <SidebarMenuButton asChild tooltip={collapsed ? item.title : undefined} className={collapsed ? "!size-10 !p-0 rounded-xl" : undefined}>
          <NavLink
            to={item.url}
            end={item.url === "/"}
            title={collapsed ? item.title : undefined}
            className={cn(
              "group relative flex items-center gap-1.5 text-sm font-medium transition-all duration-200",
              collapsed
                ? "!size-10 justify-center rounded-xl p-0 text-white/70 hover:bg-white/10 hover:text-white hover:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]"
                : "h-9 rounded-lg px-2.5 text-sidebar-foreground/85 hover:bg-sidebar-accent/70 hover:text-sidebar-accent-foreground",
            )}
            activeClassName={cn(
              "font-semibold",
              collapsed
                ? "bg-primary text-primary-foreground shadow-[0_16px_28px_-18px_hsl(var(--primary)/0.95),inset_0_1px_0_hsl(0_0%_100%/0.22)] before:absolute before:left-[-10px] before:top-1/2 before:h-8 before:w-[3px] before:-translate-y-1/2 before:rounded-full before:bg-primary"
                : "bg-primary/10 text-primary shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.16)] before:absolute before:left-0 before:top-1/2 before:h-5 before:w-[3px] before:-translate-y-1/2 before:rounded-r-full before:bg-primary",
            )}
          >
            <item.icon className="h-[18px] w-[18px] shrink-0" strokeWidth={1.75} />
            {!collapsed && (
              <>
                <span className="flex-1">{item.title}</span>
                {"shortcut" in item && item.shortcut && (
                  <kbd className="text-2xs font-mono text-muted-foreground/40 group-hover:text-muted-foreground/60 bg-transparent border-0 px-0">⌘{item.shortcut}</kbd>
                )}
              </>
            )}
          </NavLink>
        </SidebarMenuButton>
      </SidebarMenuItem>
    ));

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className={cn("border-b border-sidebar-border/80 px-4 py-4", collapsed && "items-center border-white/10 px-0 py-3")}>
        <div className={cn("flex items-center gap-3", collapsed && "justify-center gap-0")}>
          <div className={cn("group relative flex h-9 w-9 items-center justify-center overflow-hidden rounded-lg border border-primary/25 bg-[#071018]", collapsed && "h-10 w-10 rounded-xl border-primary/30")}>
            <div className="absolute inset-0 bg-[linear-gradient(145deg,hsl(var(--primary)/0.2),transparent_72%)] opacity-95 transition-opacity duration-500" />
            
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="relative z-10" aria-hidden="true">
              <path d="M12 2L2 7V17L12 22L22 17V7L12 2Z" stroke="hsl(var(--primary))" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.75" />
              <path d="M6 16V10L9 13L12 9L15 7V16" stroke="hsl(var(--primary))" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              <circle cx="15" cy="7" r="1.8" fill="hsl(var(--primary))" opacity="0.9">
              </circle>
            </svg>
          </div>
          {!collapsed && (
            <div className="flex flex-col">
              <h1 className="text-base font-semibold text-foreground leading-none">Mr. Chartist</h1>
              <p className="text-xs text-muted-foreground/75 mt-1 tracking-[0.14em] font-semibold uppercase">Options Terminal</p>
            </div>
          )}
        </div>
        {collapsed && (
          <div className="mt-1 text-center leading-none">
            <p className="text-[9px] font-semibold uppercase tracking-[0.2em] text-primary">MR</p>
            <p className="mt-1 text-[6px] font-semibold uppercase tracking-[0.1em] text-white/38">Chartist</p>
          </div>
        )}
      </SidebarHeader>

      <SidebarContent className={cn("px-2 py-2.5", collapsed && "px-0 py-3")}>
        {collapsed ? (
          <div className="flex h-full flex-col items-center">
            <SidebarMenu className="items-center gap-2">{renderNavItems(mainItems)}</SidebarMenu>
            <div className="my-3 h-px w-8 bg-white/10" />
            <SidebarMenu className="items-center gap-2">{renderNavItems(tradingItems)}</SidebarMenu>
            <div className="my-3 h-px w-8 bg-white/10" />
            <SidebarMenu className="items-center gap-2">{renderNavItems(settingItems)}</SidebarMenu>
          </div>
        ) : (
          <>
            <SidebarGroup>
              <SidebarGroupLabel className="mb-1.5 px-2.5 text-xs font-semibold uppercase tracking-[0.15em] text-muted-foreground/60">Markets</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu className="space-y-0.5">{renderNavItems(mainItems)}</SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>

            <SidebarSeparator className="my-2 opacity-35" />

            <SidebarGroup>
              <SidebarGroupLabel className="mb-1.5 px-2.5 text-xs font-semibold uppercase tracking-[0.15em] text-muted-foreground/60">Trading Tools</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu className="space-y-0.5">{renderNavItems(tradingItems)}</SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>

            <SidebarSeparator className="my-2 opacity-35" />

            <SidebarGroup>
              <SidebarGroupLabel className="mb-1.5 px-2.5 text-xs font-semibold uppercase tracking-[0.15em] text-muted-foreground/60">Settings</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu className="space-y-0.5">{renderNavItems(settingItems)}</SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </>
        )}
      </SidebarContent>

      <SidebarFooter className={cn("space-y-1 border-t border-sidebar-border/80 p-2", collapsed && "items-center border-white/10 p-0 py-3")}>
        <button
          onClick={toggleTheme}
          className={cn(
            "group flex w-full items-center gap-1.5 rounded-lg px-2.5 py-2 text-sm font-medium text-sidebar-foreground/85 transition-all duration-200 hover:bg-sidebar-accent/70 hover:text-sidebar-accent-foreground",
            collapsed && "h-10 w-10 justify-center rounded-xl px-0 py-0 text-white/65 hover:bg-white/10 hover:text-white",
          )}
          title={collapsed ? (isDark ? "Light Mode" : "Dark Mode") : undefined}
        >
          {isDark ? <Sun className="h-[18px] w-[18px] group-hover:text-warning transition-colors" strokeWidth={1.75} /> : <Moon className="h-[18px] w-[18px] group-hover:text-primary transition-colors" strokeWidth={1.75} />}
          {!collapsed && <span>{isDark ? "Light Mode" : "Dark Mode"}</span>}
        </button>
        {collapsed && <span className="font-mono text-[8px] font-semibold text-white/28">v1</span>}
        {!collapsed && (
          <div className="mx-1 mt-2 flex items-center justify-between rounded-md border border-primary/15 bg-primary/5 px-3 py-2">
             <span className="text-xs font-semibold text-primary tracking-wider">PRO</span>
             <span className="text-xs text-primary/65 uppercase tracking-widest font-mono">v1.0.0</span>
          </div>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}
