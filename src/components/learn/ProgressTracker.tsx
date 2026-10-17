import { Link } from "react-router-dom";
import { CheckCircle2, Circle, CircleDot } from "lucide-react";
import { LESSONS, lessonsInPath, PATHS } from "@/content/learn/lessons";
import { completionStats, type LearnProgress } from "@/content/learn/progress";
import type { PathId } from "@/content/learn/types";
import { cn } from "@/lib/utils";

function Ring({ pct, size = 64 }: { pct: number; size?: number }) {
  const stroke = 6;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" className="shrink-0 -rotate-90">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className="stroke-muted" />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - Math.max(0, Math.min(100, pct)) / 100)}
        className="stroke-primary transition-[stroke-dashoffset] duration-settle ease-expo"
      />
    </svg>
  );
}

function Bar({ pct, label }: { pct: number; label: string }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-capsule bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={label}>
      <div className="h-full rounded-capsule bg-primary transition-[width] duration-settle ease-expo" style={{ width: `${pct}%` }} />
    </div>
  );
}

/**
 * "overview": overall ring plus a bar per learning path (hub).
 * "path": the lessons of one path with the current one highlighted (lesson sidebar).
 */
export default function ProgressTracker({
  progress,
  variant = "overview",
  pathId,
  currentSlug,
  onReset,
  className,
}: {
  progress: LearnProgress;
  variant?: "overview" | "path";
  pathId?: PathId;
  currentSlug?: string;
  onReset?: () => void;
  className?: string;
}) {
  if (variant === "path" && pathId) {
    const lessons = lessonsInPath(pathId);
    const stats = completionStats(progress, lessons.map((l) => l.slug));
    const path = PATHS.find((p) => p.id === pathId);
    return (
      <nav aria-label={`${path?.title ?? "Path"} lessons`} className={cn("rounded-card border border-border bg-card p-4 shadow-card", className)}>
        <div className="flex items-baseline justify-between gap-2">
          <p className="font-display text-body font-bold text-foreground">{path?.title}</p>
          <span className="font-num text-body-sm tabular-nums text-muted-foreground">
            {stats.done}/{stats.total}
          </span>
        </div>
        <div className="mt-2">
          <Bar pct={stats.pct} label={`${path?.title ?? "Path"} progress`} />
        </div>
        <ol className="mt-3 space-y-0.5">
          {lessons.map((l) => {
            const done = !!progress.completed[l.slug];
            const current = l.slug === currentSlug;
            const Icon = done ? CheckCircle2 : current ? CircleDot : Circle;
            return (
              <li key={l.slug}>
                <Link
                  to={`/learn/${l.slug}`}
                  aria-current={current ? "page" : undefined}
                  className={cn(
                    "flex items-start gap-2 rounded-tab px-2 py-1.5 text-body-sm transition-colors duration-fast focus-visible:shadow-ember focus-visible:outline-none",
                    current ? "bg-wash-brand font-semibold text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground",
                  )}
                >
                  <Icon className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", done ? "text-bullish" : current ? "text-primary-ink" : "text-muted-foreground/60")} aria-hidden="true" />
                  <span className="min-w-0">{l.title}</span>
                  {done ? <span className="sr-only">(completed)</span> : null}
                </Link>
              </li>
            );
          })}
        </ol>
      </nav>
    );
  }

  const overall = completionStats(progress, LESSONS.map((l) => l.slug));
  return (
    <section aria-label="Your progress" className={cn("rounded-card border border-border bg-card p-4 shadow-card sm:p-5", className)}>
      <div className="flex items-center gap-4">
        <div className="relative grid place-items-center">
          <Ring pct={overall.pct} />
          <span className="absolute font-num text-body font-bold tabular-nums text-foreground">{overall.pct}%</span>
        </div>
        <div className="min-w-0">
          <p className="font-display text-lead font-bold text-foreground">Your progress</p>
          <p className="text-body-sm text-muted-foreground">
            {overall.done} of {overall.total} lessons complete. Saved in this browser only.
          </p>
        </div>
      </div>
      <ul className="mt-4 space-y-2.5">
        {PATHS.map((p) => {
          const s = completionStats(progress, lessonsInPath(p.id).map((l) => l.slug));
          return (
            <li key={p.id}>
              <div className="mb-1 flex items-baseline justify-between gap-2 text-body-sm">
                <a href={`#path-${p.id}`} className="truncate text-foreground hover:text-primary-ink focus-visible:shadow-ember focus-visible:outline-none">
                  {p.title}
                </a>
                <span className="font-num tabular-nums text-muted-foreground">
                  {s.done}/{s.total}
                </span>
              </div>
              <Bar pct={s.pct} label={`${p.title} progress`} />
            </li>
          );
        })}
      </ul>
      {onReset && overall.done + Object.keys(progress.quiz).length > 0 ? (
        <button
          type="button"
          onClick={() => {
            if (typeof window === "undefined" || window.confirm("Clear all Learn progress and quiz scores in this browser?")) onReset();
          }}
          className="mt-4 text-body-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:shadow-ember focus-visible:outline-none"
        >
          Reset progress
        </button>
      ) : null}
    </section>
  );
}
