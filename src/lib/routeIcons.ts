/**
 * lucide-react icons for every icon name used in the route registry.
 * An explicit map (instead of `import * as icons`) keeps the bundle small.
 */
import {
  Activity,
  ArrowRight,
  BookOpen,
  Briefcase,
  Calculator,
  ChartColumn,
  GraduationCap,
  Landmark,
  Layers,
  LayoutDashboard,
  Magnet,
  ScanSearch,
  Settings,
  Star,
  TableProperties,
  Target,
  Wallet,
  WandSparkles,
  Waves,
  Zap,
  BellRing,
  Blocks,
  BookOpenCheck,
  CalendarDays,
  ChartCandlestick,
  ChartSpline,
  History,
  type LucideIcon,
} from "lucide-react";

export const ROUTE_ICONS: Record<string, LucideIcon> = {
  Activity,
  BookOpen,
  Briefcase,
  Calculator,
  ChartColumn,
  GraduationCap,
  Landmark,
  Layers,
  LayoutDashboard,
  Magnet,
  ScanSearch,
  Settings,
  Star,
  TableProperties,
  Target,
  Wallet,
  WandSparkles,
  Waves,
  Zap,
  BellRing,
  Blocks,
  BookOpenCheck,
  CalendarDays,
  ChartCandlestick,
  ChartSpline,
  History,
};

/** Icon component for a registry icon name; falls back to an arrow for unknown names. */
export function routeIcon(name: string): LucideIcon {
  return ROUTE_ICONS[name] ?? ArrowRight;
}
