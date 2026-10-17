import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { Monitor, Moon, Sun } from "lucide-react";
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
import { useTheme, type ThemeMode } from "@/hooks/useTheme";
import { routesByGroup, type RouteDef } from "@/lib/routes";
import { routeIcon } from "@/lib/routeIcons";
import { cn } from "@/lib/utils";

const NAV_GROUPS = routesByGroup();

const THEME_OPTIONS: { mode: ThemeMode; label: string; icon: typeof Sun }[] = [
  { mode: "light", label: "Light", icon: Sun },
  { mode: "system", label: "System", icon: Monitor },
  { mode: "dark", label: "Dark", icon: Moon },
];

/** "g c" → "G C" for display. */
const shortcutLabel = (s: string) => s.toUpperCase();

function NavItem({ route, collapsed }: { route: RouteDef; collapsed: boolean }) {
  const Icon = routeIcon(route.icon);
  const tooltip = route.shortcut ? `${route.navLabel}  (${shortcutLabel(route.shortcut)})` : route.navLabel;
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild tooltip={collapsed ? tooltip : undefined} className={collapsed ? "!size-9 !p-0" : undefined}>
        <NavLink
          to={route.path}
          end={route.path === "/"}
          aria-label={collapsed ? route.navLabel : undefined}
          className={cn(
            "group relative flex items-center gap-2.5 text-[13px] font-medium transition-colors duration-150",
            collapsed
              ? "!size-9 justify-center rounded-lg p-0 text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              : "h-8 rounded-md px-2.5 text-sidebar-foreground/85 hover:bg-sidebar-accent/70 hover:text-sidebar-accent-foreground",
          )}
          activeClassName={cn(
            "font-semibold",
            collapsed
              ? "bg-primary/15 text-primary-ink shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.25)]"
              : "bg-primary/10 text-primary-ink shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.16)] before:absolute before:left-0 before:top-1/2 before:h-4 before:w-[3px] before:-translate-y-1/2 before:rounded-r-full before:bg-primary",
          )}
        >
          <Icon className="h-[17px] w-[17px] shrink-0" strokeWidth={1.75} aria-hidden="true" />
          {!collapsed && (
            <>
              <span className="min-w-0 flex-1 truncate">{route.navLabel}</span>
              {route.badge && (
                <span
                  className={cn(
                    "rounded px-1 py-px text-micro uppercase leading-none",
                    route.badge === "Beta" ? "bg-warning/15 text-warning" : "bg-primary/10 text-primary-ink",
                  )}
                >
                  {route.badge}
                </span>
              )}
              {route.shortcut && (
                <kbd className="hidden font-mono text-[10px] text-muted-foreground/50 group-hover:text-muted-foreground xl:inline">
                  {shortcutLabel(route.shortcut)}
                </kbd>
              )}
            </>
          )}
        </NavLink>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

function ThemeSwitch({ collapsed }: { collapsed: boolean }) {
  const { mode, setMode, isDark, toggle } = useTheme();
  if (collapsed) {
    return (
      <button
        type="button"
        onClick={toggle}
        className="flex h-9 w-9 items-center justify-center rounded-lg text-sidebar-foreground/75 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        title={isDark ? "Switch to light mode" : "Switch to dark mode"}
        aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      >
        {isDark ? <Sun className="h-[17px] w-[17px]" strokeWidth={1.75} /> : <Moon className="h-[17px] w-[17px]" strokeWidth={1.75} />}
      </button>
    );
  }
  return (
    <div role="radiogroup" aria-label="Colour theme" className="grid grid-cols-3 gap-0.5 rounded-lg border border-sidebar-border bg-sidebar-accent/40 p-0.5">
      {THEME_OPTIONS.map(({ mode: m, label, icon: Icon }) => {
        const active = mode === m;
        return (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => setMode(m)}
            className={cn(
              "flex h-7 items-center justify-center gap-1 rounded-md text-[11px] font-medium transition-colors",
              active ? "bg-card text-foreground shadow-card" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden="true" />
            {label}
          </button>
        );
      })}
    </div>
  );
}

export function AppSidebar() {
  const { state, isMobile, setOpenMobile } = useSidebar();
  const collapsed = state === "collapsed" && !isMobile;
  const { pathname } = useLocation();

  // Close the mobile drawer after navigating.
  useEffect(() => {
    setOpenMobile(false);
  }, [pathname, setOpenMobile]);

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className={cn("shrink-0 border-b border-sidebar-border/80 px-4 py-3.5", collapsed && "items-center px-0 py-3")}>
        <div className={cn("flex items-center gap-3", collapsed && "justify-center gap-0")}>
          <div
            className={cn(
              "relative flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-primary/25 bg-card shadow-card",
            )}
          >
            <div className="absolute inset-0 bg-[linear-gradient(145deg,hsl(var(--primary)/0.18),transparent_72%)]" />
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="relative z-10" aria-hidden="true">
              <path d="M12 2L2 7V17L12 22L22 17V7L12 2Z" stroke="hsl(var(--primary))" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.75" />
              <path d="M6 16V10L9 13L12 9L15 7V16" stroke="hsl(var(--primary))" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              <circle cx="15" cy="7" r="1.8" fill="hsl(var(--primary))" opacity="0.9" />
            </svg>
          </div>
          {!collapsed && (
            <div className="flex min-w-0 flex-col">
              <span className="text-[15px] font-bold leading-none text-foreground">Mr. Chartist</span>
              <span className="mt-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/75">Options Terminal</span>
            </div>
          )}
        </div>
      </SidebarHeader>

      {/*
        SidebarContent is the only scroll container: header and footer are
        shrink-0 flex siblings, so the footer can never sit on top of the nav.
        The bottom padding lets the last item scroll clear of the fade mask,
        and the mask itself hints that more items sit below the fold.
      */}
      <SidebarContent
        className={cn(
          "min-h-0 flex-1 gap-0 overflow-y-auto overscroll-contain px-2 pb-6 pt-2",
          "[mask-image:linear-gradient(to_bottom,black_calc(100%-1.5rem),transparent)]",
          "group-data-[collapsible=icon]:overflow-y-auto",
          collapsed && "items-center px-0 [scrollbar-width:none]",
        )}
      >
        <nav aria-label="Main" className={cn("flex flex-col", collapsed && "items-center")}>
          {NAV_GROUPS.map(({ group, routes }, i) => (
            <SidebarGroup key={group} className={cn("p-0", collapsed ? "items-center" : "py-1")}>
              {collapsed ? (
                i > 0 && <div className="my-1.5 h-px w-6 bg-sidebar-border" aria-hidden="true" />
              ) : (
                <SidebarGroupLabel className="h-6 px-2.5 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">
                  {group}
                </SidebarGroupLabel>
              )}
              <SidebarGroupContent>
                <SidebarMenu className={cn(collapsed ? "items-center gap-1" : "gap-px")}>
                  {routes.map((route) => (
                    <NavItem key={route.path} route={route} collapsed={collapsed} />
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          ))}
        </nav>
      </SidebarContent>

      <SidebarFooter className={cn("shrink-0 gap-2 border-t border-sidebar-border/80 p-2", collapsed && "items-center px-0 py-2.5")}>
        <ThemeSwitch collapsed={collapsed} />
        {/* Keyboard hints are noise on touch screens; hide them on mobile and when collapsed. */}
        {!collapsed && !isMobile && (
          <p className="px-1 text-[10.5px] text-muted-foreground/70">
            Press <kbd className="rounded border border-sidebar-border px-1 font-mono">?</kbd> for shortcuts ·{" "}
            <kbd className="rounded border border-sidebar-border px-1 font-mono">Ctrl K</kbd> to search
          </p>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}
