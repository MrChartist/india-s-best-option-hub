import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export interface PageHeaderProps {
  /** Lucide icon shown before the title, in brand ink. Decorative. */
  icon?: LucideIcon;
  /** Small uppercase line above the title, e.g. the nav group ("Analytics"). */
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
 * The standard page header. Sits directly on the page background (never inside a
 * card): optional eyebrow, icon + h1 in the display size, description, one source
 * slot, and right-aligned actions that wrap below the title on phones.
 */
export function PageHeader({ icon: Icon, eyebrow, title, description, actions, source, className }: PageHeaderProps) {
  return (
    <header
      data-page-header=""
      className={cn("flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6", className)}
    >
      <div className="min-w-0 flex-1">
        {eyebrow ? <p className="mb-1 text-label uppercase text-muted-foreground">{eyebrow}</p> : null}
        <h1 className="flex min-w-0 items-center gap-2 font-display text-display text-foreground">
          {Icon ? <Icon className="h-6 w-6 shrink-0 text-primary-ink" aria-hidden="true" /> : null}
          <span className="min-w-0 break-words">{title}</span>
        </h1>
        {description ? <div className="mt-1.5 max-w-2xl text-body text-muted-foreground">{description}</div> : null}
        {source ? <div className="mt-2 flex flex-wrap items-center gap-2 text-body-sm">{source}</div> : null}
      </div>
      {actions ? (
        <div className="flex min-w-0 shrink-0 flex-wrap items-center gap-2 sm:justify-end">{actions}</div>
      ) : null}
    </header>
  );
}

export default PageHeader;
