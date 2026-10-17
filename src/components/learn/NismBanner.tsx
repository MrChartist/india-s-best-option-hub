import { ArrowUpRight, Award, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

/** Verified 17 Oct 2026: the site lists NISM Series V-A, VIII, XV, X-A and X-B prep. */
const NISM_HOME = "https://nismexams.com";
const NISM_COURSES = "https://nismexams.com/courses";

const UTM = "utm_source=mrchartist-terminal&utm_medium=learn-hub";

function withUtm(url: string, content: string): string {
  return `${url}${url.includes("?") ? "&" : "?"}${UTM}&utm_campaign=${encodeURIComponent(content)}`;
}

/**
 * NISMExams.com partner banner. "full" for the hub, "compact" for lesson sidebars.
 */
export default function NismBanner({ variant = "full", className }: { variant?: "full" | "compact"; className?: string }) {
  if (variant === "compact") {
    return (
      <aside aria-label="NISM certification prep" className={cn("rounded-card border border-product/25 bg-product-wash p-4", className)}>
        <p className="flex items-center gap-1.5 text-label uppercase text-product">
          <Award className="h-3.5 w-3.5" aria-hidden="true" /> NISMExams.com
        </p>
        <p className="mt-1.5 font-display text-lead font-bold text-foreground">Preparing for NISM Series VIII?</p>
        <p className="mt-1 text-body-sm text-muted-foreground">Mock tests, notes and explanations for the Equity Derivatives certification.</p>
        <a
          href={withUtm(NISM_COURSES, "lesson-sidebar")}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-flex items-center gap-1 rounded-pill text-body-sm font-semibold text-product underline-offset-4 hover:underline focus-visible:shadow-ember focus-visible:outline-none"
        >
          Explore Series VIII prep <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
          <span className="sr-only">(opens in a new tab)</span>
        </a>
      </aside>
    );
  }

  return (
    <aside
      aria-label="NISMExams.com partner"
      className={cn("relative overflow-hidden rounded-card border border-product/25 bg-product-wash p-5 shadow-card sm:p-6", className)}
    >
      <div className="pointer-events-none absolute -right-10 -top-12 h-40 w-40 rounded-capsule bg-product/10" aria-hidden="true" />
      <div className="relative grid gap-5 md:grid-cols-[1fr_auto] md:items-center">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-label uppercase text-product">
            <Award className="h-3.5 w-3.5" aria-hidden="true" /> Education partner
          </p>
          <h2 className="mt-1.5 font-display text-title text-foreground">Get certified with NISMExams.com</h2>
          <p className="mt-1.5 max-w-2xl text-body text-muted-foreground">
            NISM Series VIII (Equity Derivatives) is the certification for people dealing in F&O. NISMExams.com offers mock tests, chapter notes, explanations and performance tracking to help you pass.
          </p>
          <ul className="mt-3 grid gap-1.5 text-body-sm text-foreground sm:grid-cols-3">
            {["Full-length mock tests", "Chapter-wise notes", "Explanations for every answer"].map((t) => (
              <li key={t} className="flex items-center gap-1.5">
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-product" aria-hidden="true" /> {t}
              </li>
            ))}
          </ul>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row md:flex-col">
          <a
            href={withUtm(NISM_COURSES, "hub-banner")}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-10 items-center justify-center gap-1.5 rounded-pill bg-primary px-4 text-body font-semibold text-primary-foreground shadow-card transition-colors duration-fast hover:bg-primary-hover focus-visible:shadow-ember focus-visible:outline-none active:scale-[.97]"
          >
            Series VIII prep <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
            <span className="sr-only">(opens NISMExams.com in a new tab)</span>
          </a>
          <a
            href={withUtm(NISM_HOME, "hub-banner-home")}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-10 items-center justify-center gap-1.5 rounded-pill border border-border bg-card px-4 text-body font-semibold text-foreground transition-colors duration-fast hover:bg-accent focus-visible:shadow-ember focus-visible:outline-none"
          >
            Visit NISMExams.com
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        </div>
      </div>
    </aside>
  );
}
