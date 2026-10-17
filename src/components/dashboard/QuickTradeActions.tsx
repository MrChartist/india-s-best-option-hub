import { Link } from "react-router-dom";
import { BarChart3, CalendarClock, Filter, Layers, Star, TableProperties, type LucideIcon } from "lucide-react";

const actions: ReadonlyArray<{ label: string; to: string; icon: LucideIcon }> = [
  { label: "Option chain", to: "/option-chain", icon: TableProperties },
  { label: "OI analysis", to: "/oi-analysis", icon: BarChart3 },
  { label: "Strategy builder", to: "/strategy-builder", icon: Layers },
  { label: "Expiry day", to: "/expiry-day", icon: CalendarClock },
  { label: "Screener", to: "/screener", icon: Filter },
  { label: "Watchlist", to: "/watchlist", icon: Star },
];

/** Shortcut chips to the most used tools. */
export function QuickTradeActions() {
  return (
    <nav aria-label="Quick links" className="-mx-1 overflow-x-auto px-1 pb-0.5 scrollbar-hide">
      <ul className="flex w-max gap-1.5">
        {actions.map((a) => (
          <li key={a.to}>
            <Link
              to={a.to}
              className="inline-flex h-7 items-center gap-1.5 rounded-capsule border border-border bg-card px-3 text-body-sm font-medium text-foreground transition-colors duration-150 hover:border-primary/40 hover:bg-wash-brand/50 focus-visible:shadow-ember focus-visible:outline-none"
            >
              <a.icon className="h-3.5 w-3.5 text-primary-ink" aria-hidden="true" />
              {a.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export default QuickTradeActions;
