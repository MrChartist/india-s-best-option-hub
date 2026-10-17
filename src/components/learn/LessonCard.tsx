import { Link } from "react-router-dom";
import { CheckCircle2, Circle, Clock, FlaskConical, ListChecks } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { Lesson } from "@/content/learn/types";
import type { QuizRecord } from "@/content/learn/progress";
import { cn } from "@/lib/utils";

const LEVEL_VARIANT = { Beginner: "bullish", Intermediate: "info", Advanced: "warning" } as const;

export default function LessonCard({ lesson, index, done, quiz, className }: { lesson: Lesson; index?: number; done: boolean; quiz?: QuizRecord; className?: string }) {
  return (
    <Link
      to={`/learn/${lesson.slug}`}
      className={cn(
        "group flex h-full flex-col rounded-card border border-border bg-card p-4 shadow-card transition-[box-shadow,transform,border-color] duration-hover ease-expo hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-card-hover focus-visible:shadow-ember focus-visible:outline-none motion-reduce:transform-none",
        done && "border-bullish/30",
        className,
      )}
      aria-label={`${lesson.title}${done ? " (completed)" : ""}`}
    >
      <div className="flex items-start justify-between gap-3">
        <span className="font-num text-label uppercase text-muted-foreground">{index !== undefined ? `Lesson ${index + 1}` : lesson.level}</span>
        {done ? <CheckCircle2 className="h-4 w-4 shrink-0 text-bullish" aria-hidden="true" /> : <Circle className="h-4 w-4 shrink-0 text-muted-foreground/50" aria-hidden="true" />}
      </div>
      <h3 className="mt-1.5 font-display text-lead font-bold leading-snug text-foreground group-hover:text-primary-ink">{lesson.title}</h3>
      <p className="mt-1 line-clamp-2 flex-1 text-body-sm text-muted-foreground">{lesson.summary}</p>
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <Badge variant={LEVEL_VARIANT[lesson.level]}>{lesson.level}</Badge>
        <span className="inline-flex items-center gap-1 text-body-sm text-muted-foreground">
          <Clock className="h-3 w-3" aria-hidden="true" /> {lesson.minutes} min
        </span>
        {lesson.sims.length > 0 ? (
          <span className="inline-flex items-center gap-1 text-body-sm text-muted-foreground">
            <FlaskConical className="h-3 w-3" aria-hidden="true" /> Interactive
          </span>
        ) : null}
        <span className="inline-flex items-center gap-1 text-body-sm text-muted-foreground">
          <ListChecks className="h-3 w-3" aria-hidden="true" />
          {quiz ? `Best ${quiz.best}/${quiz.total}` : `${lesson.quiz.length}-question quiz`}
        </span>
      </div>
    </Link>
  );
}
