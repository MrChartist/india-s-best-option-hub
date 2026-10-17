/**
 * Visual vocabulary for event kinds: icon plus semantic-token tones (chip, dot, text).
 * Text for the chart-4/chart-5 kinds uses the --chart-4-ink/--chart-5-ink tokens: a darker
 * ink of the same hue in light mode so it keeps 4.5:1 on its 10% wash (the raw chart colours
 * sit near 4:1), and the chart colour itself in dark mode.
 */
import { BarChart3, Briefcase, CalendarOff, Globe, Hourglass, Landmark, type LucideIcon } from "lucide-react";
import type { EventKind } from "@/lib/events";

export interface EventKindStyle {
  icon: LucideIcon;
  /** Chip background + text. */
  chip: string;
  /** Solid dot / bar fill. */
  dot: string;
  /** Text colour for icons on neutral surfaces. */
  text: string;
}

export const EVENT_KIND_STYLE: Record<EventKind, EventKindStyle> = {
  results: { icon: BarChart3, chip: "bg-wash-brand text-primary-ink", dot: "bg-primary", text: "text-primary-ink" },
  "india-macro": { icon: Landmark, chip: "bg-chart-5/10 text-chart-5-ink", dot: "bg-chart-5", text: "text-chart-5-ink" },
  "global-macro": { icon: Globe, chip: "bg-wash-info text-info", dot: "bg-info", text: "text-info" },
  expiry: { icon: Hourglass, chip: "bg-wash-warning text-warning", dot: "bg-warning", text: "text-warning" },
  corporate: { icon: Briefcase, chip: "bg-chart-4/10 text-chart-4-ink", dot: "bg-chart-4", text: "text-chart-4-ink" },
  holiday: { icon: CalendarOff, chip: "bg-muted text-muted-foreground", dot: "bg-muted-foreground", text: "text-muted-foreground" },
};
