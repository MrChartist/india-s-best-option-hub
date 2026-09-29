import { BellRing, Moon, Sun } from "lucide-react";
import { NavLink } from "@/components/NavLink";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { useTheme } from "@/hooks/useTheme";
import { alertStore, countArmed, useAlertState } from "@/lib/alerts";
import { NAV_MARKETS, NAV_SETTINGS, NAV_TRADING, type NavItem } from "@/lib/navigation";
import { cn } from "@/lib/utils";

const itemBase =
  "group relative flex items-center gap-3 rounded-xl text-sm font-medium text-sidebar-foreground/90 transition-all duration-200 hover:bg-foreground/[0.07] hover:text-foreground";
const itemActive =
  "!bg-primary/15 !text-primary font-semibold shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.22),inset_0_1px_0_hsl(var(--primary)/0.15)]";

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const { isDark, toggle: toggleTheme } = useTheme();
  const { alerts } = useAlertState();
  const armed = countArmed(alerts);

  const renderNav = (items: NavItem[]) =>
    items.map((item) => (
      <SidebarMenuItem key={item.url}>
        <SidebarMenuButton asChild tooltip={collapsed ? item.title : undefined} className={cn("h-10", collapsed && "mx-auto")}>
          <NavLink
            to={item.url}
            end={item.url === "/"}
            className={cn(itemBase, "h-10 px-3", collapsed && "justify-center px-0")}
            activeClassName={itemActive}
          >
            <item.icon className="h-[18px] w-[18px] shrink-0" strokeWidth={1.8} />
            {!collapsed && (
              <>
                <span className="flex-1 truncate">{item.title}</span>
                {item.key && (
                  <kbd className="num hidden rounded-md bg-foreground/[0.06] px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground group-hover:block">
                    {item.key}
                  </kbd>
                )}
              </>
            )}
          </NavLink>
        </SidebarMenuButton>
      </SidebarMenuItem>
    ));

  const group = (label: string, items: NavItem[], extra?: React.ReactNode) => (
    <SidebarGroup className={cn(collapsed && "p-1.5")}>
      {!collapsed && (
        <SidebarGroupLabel className="mb-1 h-6 px-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/80">
          {label}
        </SidebarGroupLabel>
      )}
      <SidebarGroupContent>
        <SidebarMenu className="gap-1">
          {renderNav(items)}
          {extra}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );

  const alertsItem = (
    <SidebarMenuItem>
      <SidebarMenuButton
        tooltip={collapsed ? `Alerts${armed ? ` (${armed})` : ""}` : undefined}
        className={cn(itemBase, "h-10 px-3", collapsed && "mx-auto justify-center px-0")}
        onClick={() => alertStore.setPanelOpen(true)}
      >
        <span className="relative">
          <BellRing className="h-[18px] w-[18px] shrink-0" strokeWidth={1.8} />
          {collapsed && armed > 0 && <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-warning ring-2 ring-sidebar" />}
        </span>
        {!collapsed && (
          <>
            <span className="flex-1 truncate text-left">Alerts</span>
            {armed > 0 && (
              <span className="num rounded-full bg-warning/20 px-2 py-0.5 font-mono text-[11px] font-semibold text-warning">
                {armed}
              </span>
            )}
          </>
        )}
      </SidebarMenuButton>
    </SidebarMenuItem>
  );

  return (
    <Sidebar collapsible="icon" variant="floating">
      <SidebarHeader className={cn("px-4 pb-3 pt-4", collapsed && "items-center px-0")}>
        <div className={cn("flex items-center gap-3", collapsed && "justify-center gap-0")}>
          <div className="relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-[13px] bg-gradient-to-br from-[#5AC8FA] via-[#0A84FF] to-[#5E5CE6] shadow-[inset_0_1px_0_rgba(255,255,255,0.45),0_8px_20px_-8px_rgba(10,132,255,0.8)]">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M5 17V11M10 17V7M15 17v-5M20 17V5" stroke="white" strokeWidth="2.4" strokeLinecap="round" />
            </svg>
          </div>
          {!collapsed && (
            <div className="min-w-0 leading-tight">
              <h1 className="truncate text-[15px] font-semibold text-foreground">Mr. Chartist</h1>
              <p className="mt-0.5 text-[11px] font-medium text-muted-foreground">Options Terminal</p>
            </div>
          )}
        </div>
      </SidebarHeader>

      <SidebarContent className={cn("gap-1 px-2", collapsed && "px-0")}>
        {group("Markets", NAV_MARKETS)}
        {group("Trading Tools", NAV_TRADING, alertsItem)}
        {group("Setup", NAV_SETTINGS)}
      </SidebarContent>

      <SidebarFooter className={cn("gap-2 p-3", collapsed && "items-center p-2")}>
        <button
          onClick={toggleTheme}
          className={cn(itemBase, "h-10 w-full px-3", collapsed && "size-10 justify-center px-0")}
          title={isDark ? "Switch to light mode" : "Switch to dark mode"}
          aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
        >
          {isDark ? <Sun className="h-[18px] w-[18px]" strokeWidth={1.8} /> : <Moon className="h-[18px] w-[18px]" strokeWidth={1.8} />}
          {!collapsed && <span>{isDark ? "Light mode" : "Dark mode"}</span>}
        </button>
        {!collapsed && (
          <p className="px-1 text-center text-[10px] font-medium text-muted-foreground/70">
            Open source · MIT · v1.0.0
          </p>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}
