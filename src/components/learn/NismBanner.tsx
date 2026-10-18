import { ArrowUpRight, Award, CheckCircle2 } from "lucide-react";
import { product, withUtm } from "@/lib/brand/links";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Verified 17 Oct 2026: nismexams.com offers notes, mock tests, explanations and performance
 * tracking for Series V-A, VIII, XV, X-A, X-B, XXI-A and XXI-B. URLs and UTM tags come from
 * src/lib/brand/links.ts like every other outbound link.
 */
const NISM_HOME = product("nismExams").url;
const NISM_COURSES = `${NISM_HOME}/courses`;

/**
 * NISMExams.com partner banner. "full" for the hub, "compact" for lesson sidebars.
 */
export default function NismBanner({ variant = "full", className }: { variant?: "full" | "compact"; className?: string }) {
  if (variant === "compact") {
    return (
      <aside aria-label="NISM certification prep" className={cn("rounded-card border border-product/25 bg-product-wash p-4", className)}>
        <p className="flex items-center gap-1.5 text-label text-product">
          <Award className="h-3.5 w-3.5" aria-hidden="true" /> NISMExams.com
        </p>
        <p className="mt-1.5 font-display text-lead font-semibold text-foreground">Preparing for NISM Series VIII?</p>
        <p className="mt-1 text-body-sm text-muted-foreground">Mock tests, notes and explanations for the Equity Derivatives certification.</p>
        <a
          href={withUtm(NISM_COURSES, "learn-lesson-sidebar")}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-flex items-center gap-1 rounded-pill text-body-sm font-semibold text-product underline-offset-4 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
        >
          Explore Series VIII prep <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
          <span className="sr-only">(opens in a new tab)</span>
        </a>
      </aside>
    );
  }

  return (
    <aside
      aria-label="NISMExams.com, from Mr. Chartist"
      className={cn("rounded-card border border-product/25 bg-product-wash p-4 shadow-card sm:p-5", className)}
    >
      <div className="grid gap-4 md:grid-cols-[1fr_auto] md:items-center">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-label text-product">
            <Award className="h-3.5 w-3.5" aria-hidden="true" /> Also from Mr. Chartist
          </p>
          <h2 className="mt-1.5 font-display text-title text-foreground">Get certified with NISMExams.com</h2>
          <p className="mt-1.5 max-w-2xl text-body text-muted-foreground">
            NISM Series VIII (Equity Derivatives) is the certification for people dealing in F&O. NISMExams.com has notes, mock tests, explanations and performance tracking for Series VIII, plus V-A, XV, X-A, X-B, XXI-A and XXI-B.
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
            href={withUtm(NISM_COURSES, "learn-hub-banner")}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonVariants({ size: "lg" })}
          >
            Series VIII prep <ArrowUpRight aria-hidden="true" />
            <span className="sr-only">(opens NISMExams.com in a new tab)</span>
          </a>
          <a
            href={withUtm(NISM_HOME, "learn-hub-banner-home")}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonVariants({ variant: "secondary", size: "lg" })}
          >
            Visit NISMExams.com
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        </div>
      </div>
    </aside>
  );
}
