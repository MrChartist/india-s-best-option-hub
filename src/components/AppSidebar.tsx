import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Blocks, ChevronRight, Monitor, Moon, Sun } from "lucide-react";
import { MrChartistLogo, MrChartistMark } from "@/components/brand/MrChartistLogo";
import { OutboundLink } from "@/components/brand/OutboundLink";
import { SocialIcon } from "@/components/brand/SocialIcon";
import { BRAND, SOCIALS, type SocialId } from "@/lib/brand/links";
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
import { PaletteToggle } from "@/components/PaletteToggle";

const NAV_GROUPS = routesByGroup();

const THEME_OPTIONS: { mode: ThemeMode; label: string; icon: typeof Sun }[] = [
  { mode: "light", label: "Light", icon: Sun },
  { mode: "system", label: "System", icon: Monitor },
  { mode: "dark", label: "Dark", icon: Moon },
];

/**
 * "New" badges expire once the user has opened the page, so the badge keeps
 * meaning "you have not looked at this yet" instead of decorating most of the
 * nav. "Beta" badges are a status, not novelty, and never expire.
 */
const SEEN_KEY = "mc-nav-seen-v1";

function readSeen(): Set<string> {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    const arr = raw ? (JSON.parse(raw) as unknown) : [];
    return new Set(Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

function writeSeen(seen: Set<string>) {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify([...seen]));
  } catch {
    /* storage blocked: badges simply stay visible */
  }
}

/** "g c" → "G C" for display. */
const shortcutLabel = (s: string) => s.toUpperCase();

function NavItem({ route, collapsed, seen }: { route: RouteDef; collapsed: boolean; seen: boolean }) {
  const badge = route.badge === "New" && seen ? undefined : route.badge;
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
              ? "!size-9 justify-center rounded-lg p-0 text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              : "h-8 rounded-md px-2.5 text-sidebar-foreground hover:bg-sidebar-accent/70 hover:text-sidebar-accent-foreground",
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
              {badge && (
                <span
                  className={cn(
                    "rounded px-1 py-px text-micro uppercase leading-none",
                    badge === "Beta" ? "bg-wash-warning text-warning" : "bg-primary/10 text-primary-ink",
                  )}
                >
                  {badge}
                </span>
              )}
              {route.shortcut && (
                <kbd className="hidden font-mono text-[10px] text-muted-foreground-subtle group-hover:text-muted-foreground xl:inline">
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

/** Socials shown in the expanded sidebar footer (the rest are on the ecosystem page). */
const SIDEBAR_SOCIALS: readonly SocialId[] = ["x", "youtube", "telegram", "instagram", "linkedin", "github"];

/** Compact "More from Mr. Chartist" link to /ecosystem, plus social icons when expanded. */
function EcosystemLink({ collapsed }: { collapsed: boolean }) {
  if (collapsed) {
    return (
      <NavLink
        to="/ecosystem"
        aria-label="More from Mr. Chartist"
        title="More from Mr. Chartist"
        className="flex h-9 w-9 items-center justify-center rounded-lg text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        activeClassName="bg-primary/15 text-primary-ink"
      >
        <Blocks className="h-[17px] w-[17px]" strokeWidth={1.75} aria-hidden="true" />
      </NavLink>
    );
  }
  const socials = SIDEBAR_SOCIALS.map((id) => SOCIALS.find((s) => s.id === id)).filter((s): s is (typeof SOCIALS)[number] => Boolean(s));
  return (
    <div className="space-y-1.5">
      <NavLink
        to="/ecosystem"
        className="group flex h-8 items-center gap-2 rounded-md px-2 text-[12.5px] font-medium text-sidebar-foreground transition-colors hover:bg-sidebar-accent/70 hover:text-sidebar-accent-foreground"
        activeClassName="bg-primary/10 font-semibold text-primary-ink"
      >
        <MrChartistMark size={16} decorative />
        <span className="min-w-0 flex-1 truncate">More from Mr. Chartist</span>
        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
      </NavLink>
      <ul className="flex items-center justify-between px-1" aria-label="Mr. Chartist on social media">
        {socials.map((s) => (
          <li key={s.id}>
            <OutboundLink
              url={s.url}
              campaign="sidebar"
              label={`Mr. Chartist on ${s.label}`}
              title={s.label}
              className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground focus-visible:shadow-ember focus-visible:outline-none"
            >
              <SocialIcon id={s.id} className="h-3.5 w-3.5" />
            </OutboundLink>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ThemeSwitch({ collapsed }: { collapsed: boolean }) {
  const { mode, setMode, isDark, toggle } = useTheme();
  if (collapsed) {
    return (
      <button
        type="button"
        onClick={toggle}
        className="flex h-9 w-9 items-center justify-center rounded-lg text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
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

  // Mark the current section as seen so its "New" badge expires.
  const [seen, setSeen] = useState<Set<string>>(readSeen);
  useEffect(() => {
    const match = NAV_GROUPS.flatMap((g) => g.routes).find((r) =>
      r.path === "/" ? pathname === "/" : pathname === r.path || pathname.startsWith(`${r.path}/`),
    );
    if (!match) return;
    setSeen((prev) => {
      if (prev.has(match.path)) return prev;
      const next = new Set(prev).add(match.path);
      writeSeen(next);
      return next;
    });
  }, [pathname]);

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className={cn("shrink-0 border-b border-sidebar-border/80 px-4 py-3.5", collapsed && "items-center px-0 py-3")}>
        <Link
          to="/"
          aria-label={`${BRAND.productFull}: dashboard`}
          title={collapsed ? BRAND.productFull : undefined}
          className={cn(
            "flex min-w-0 items-center rounded-md text-foreground focus-visible:shadow-ember focus-visible:outline-none",
            collapsed ? "h-9 w-9 justify-center" : "-mx-1 px-1 py-0.5",
          )}
        >
          {collapsed ? <MrChartistMark size={24} decorative /> : <MrChartistLogo size={30} />}
        </Link>
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
                <SidebarGroupLabel className="h-6 px-2.5 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  {group}
                </SidebarGroupLabel>
              )}
              <SidebarGroupContent>
                <SidebarMenu className={cn(collapsed ? "items-center gap-1" : "gap-px")}>
                  {routes.map((route) => (
                    <NavItem key={route.path} route={route} collapsed={collapsed} seen={seen.has(route.path)} />
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          ))}
        </nav>
      </SidebarContent>

      <SidebarFooter className={cn("shrink-0 gap-2 border-t border-sidebar-border/80 p-2", collapsed && "items-center px-0 py-2.5")}>
        <EcosystemLink collapsed={collapsed} />
        <ThemeSwitch collapsed={collapsed} />
        <PaletteToggle collapsed={collapsed} />
        {/* Keyboard hints are noise on touch screens; hide them on mobile and when collapsed. */}
        {!collapsed && !isMobile && (
          <p className="px-1 text-[10.5px] text-muted-foreground">
            Press <kbd className="rounded border border-sidebar-border px-1 font-mono">?</kbd> for shortcuts ·{" "}
            <kbd className="rounded border border-sidebar-border px-1 font-mono">Ctrl K</kbd> to search
          </p>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}
