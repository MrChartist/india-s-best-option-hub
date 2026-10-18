import { Link } from "react-router-dom";
import { CheckCircle2, ChevronRight, Circle, Clock, FlaskConical, ListChecks } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { Lesson } from "@/content/learn/types";
import type { QuizRecord } from "@/content/learn/progress";
import { cn } from "@/lib/utils";

const LEVEL_VARIANT = { Beginner: "bullish", Intermediate: "info", Advanced: "warning" } as const;

export default function LessonCard({ lesson, index, done, quiz, className }: { lesson: Lesson; index?: number; done: boolean; quiz?: QuizRecord; className?: string }) {
  return (
    // A disclosure row in a grouped list (Learn wraps rows in one group box). Stretched link: the
    // title's ::after covers the row, so the whole row is clickable while the link's accessible
    // name is exactly the visible title.
    <li className={cn("group relative flex items-start gap-3 px-3 py-2.5 transition-colors duration-fast hover:bg-control-track focus-within:shadow-[inset_0_0_0_3px_hsl(var(--primary)/0.5)]", className)}>
      <span className="mt-0.5 shrink-0" aria-hidden="true">
        {done ? <CheckCircle2 className="h-4 w-4 text-bullish" /> : <Circle className="h-4 w-4 text-muted-foreground-subtle" />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-num text-body-sm text-muted-foreground">{index !== undefined ? `Lesson ${index + 1}` : lesson.level}</span>
          <h3 className="min-w-0 text-headline text-foreground">
            <Link to={`/learn/${lesson.slug}`} className="after:absolute after:inset-0 after:content-[''] focus-visible:outline-none">
              {lesson.title}
              {done ? <span className="sr-only"> (completed)</span> : null}
            </Link>
          </h3>
        </div>
        <p className="mt-0.5 line-clamp-2 text-body-sm text-muted-foreground">{lesson.summary}</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-body-sm text-muted-foreground">
          <Badge variant={LEVEL_VARIANT[lesson.level]}>{lesson.level}</Badge>
          <span className="inline-flex items-center gap-1">
            <Clock className="h-3 w-3" aria-hidden="true" /> {lesson.minutes} min
          </span>
          {lesson.sims.length > 0 ? (
            <span className="inline-flex items-center gap-1">
              <FlaskConical className="h-3 w-3" aria-hidden="true" /> Interactive
            </span>
          ) : null}
          <span className="inline-flex items-center gap-1">
            <ListChecks className="h-3 w-3" aria-hidden="true" />
            {quiz ? `Best ${quiz.best}/${quiz.total}` : `${lesson.quiz.length}-question quiz`}
          </span>
        </div>
      </div>
      <ChevronRight className="mt-1 h-3.5 w-3.5 shrink-0 text-muted-foreground-subtle" aria-hidden="true" />
    </li>
  );
}
