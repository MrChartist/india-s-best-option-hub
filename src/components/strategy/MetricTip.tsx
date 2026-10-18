import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { HelpCircle } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * Local fallback for <MetricHelp> (src/components/learn/MetricHelp is owned by the Learn stream).
 * A small, keyboard-focusable "?" that explains a metric in plain words, optionally linking to a Learn lesson.
 */
export function MetricTip({ label, children, className, href, hrefLabel = "Read the lesson" }: { label: string; children: ReactNode; className?: string; href?: string; hrefLabel?: string }) {
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={`What is ${label}?`}
            className={cn(
              "inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:shadow-focus",
              className,
            )}
          >
            <HelpCircle className="h-3 w-3" aria-hidden="true" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-[260px] text-body-sm leading-relaxed">
          <p className="mb-0.5 font-semibold">{label}</p>
          <div className="text-muted-foreground">{children}</div>
          {href && (
            <Link to={href} className="mt-1 inline-block font-medium text-primary-ink underline underline-offset-2">
              {hrefLabel} →
            </Link>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
