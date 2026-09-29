import { BarChart3, Briefcase, LayoutDashboard, Layers, Settings, Star, TableProperties, type LucideIcon } from "lucide-react";

export interface NavItem {
  title: string;
  url: string;
  icon: LucideIcon;
  /** Single-key shortcut (no modifier) */
  key?: string;
}

export const NAV_MARKETS: NavItem[] = [
  { title: "Dashboard", url: "/", icon: LayoutDashboard, key: "1" },
  { title: "Option Chain", url: "/option-chain", icon: TableProperties, key: "2" },
  { title: "OI Analysis", url: "/oi-analysis", icon: BarChart3, key: "3" },
  { title: "Watchlist", url: "/watchlist", icon: Star, key: "4" },
];

export const NAV_TRADING: NavItem[] = [
  { title: "Strategy Builder", url: "/strategy-builder", icon: Layers, key: "5" },
  { title: "Position Tracker", url: "/position-tracker", icon: Briefcase, key: "6" },
];

export const NAV_SETTINGS: NavItem[] = [
  { title: "Brokers & Data", url: "/broker-settings", icon: Settings, key: "7" },
];

export const NAV_ALL: NavItem[] = [...NAV_MARKETS, ...NAV_TRADING, ...NAV_SETTINGS];
