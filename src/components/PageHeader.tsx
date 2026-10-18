import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { ROUTE_GROUPS } from "@/lib/routes";
import { cn } from "@/lib/utils";

/** Eyebrows that only repeat the sidebar section; the macOS header leaves them out. */
const SECTION_NAMES = new Set<string>([...ROUTE_GROUPS, "Overview", "Tools", "Contract"]);

export interface PageHeaderProps {
  /** Lucide icon shown before the title, in brand ink. Decorative. */
  icon?: LucideIcon;
  /**
   * Small context line above the title. Plain section names ("Markets", "Portfolio") are not
   * shown: the sidebar selection already says where you are. Anything more specific
   * ("Option greeks · Lesson 3") renders as a quiet sentence-case subheadline.
   */
  eyebrow?: string;
  /** Page title in Title Case. Rendered as the page's only <h1>. */
  title: string;
  /** One or two sentences on what the page shows. Capped at max-w-2xl. */
  description?: ReactNode;
  /** Buttons, toggles or selects, right-aligned on wide screens. */
  actions?: ReactNode;
  /** One data-source slot (e.g. a "Sample data" or "Live · 15:29 IST" badge). */
  source?: ReactNode;
  className?: string;
}

/**
 * The standard page header, a quiet macOS "Title 1": icon + h1 at 22px, a one-line
 * description, one source slot, and compact right-aligned actions that wrap below the
 * title on phones. Sits directly on the window surface (never inside a card).
 */
export function PageHeader({ icon: Icon, eyebrow, title, description, actions, source, className }: PageHeaderProps) {
  const context = eyebrow && !SECTION_NAMES.has(eyebrow) ? eyebrow : null;
  return (
    <header
      data-page-header=""
      className={cn("flex min-w-0 flex-col gap-3 pb-1 sm:flex-row sm:items-end sm:justify-between sm:gap-6", className)}
    >
      <div className="min-w-0 flex-1">
        {context ? <p className="mb-0.5 text-body-sm font-medium text-muted-foreground">{context}</p> : null}
        <h1 className="flex min-w-0 items-center gap-2 font-serif text-[28px] font-medium leading-[1.1] tracking-[-0.02em] text-foreground">
          {Icon ? <Icon className="h-5 w-5 shrink-0 text-primary-ink" strokeWidth={2} aria-hidden="true" /> : null}
          <span className="min-w-0 break-words">{title}</span>
        </h1>
        {description ? <div className="mt-0.5 max-w-2xl text-body text-muted-foreground">{description}</div> : null}
        {source ? <div className="mt-1.5 flex flex-wrap items-center gap-2 text-body-sm">{source}</div> : null}
      </div>
      {actions ? (
        <div className="flex min-w-0 shrink-0 flex-wrap items-center gap-2 sm:justify-end">{actions}</div>
      ) : null}
    </header>
  );
}
