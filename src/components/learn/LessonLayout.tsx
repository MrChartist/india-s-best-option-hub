import { useEffect } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, ArrowRight, CheckCircle2, ChevronRight, Clock, FlaskConical, GraduationCap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/PageHeader";
import { adjacentLessons, getPath, lessonsInPath } from "@/content/learn/lessons";
import type { Lesson } from "@/content/learn/types";
import LessonBlocks from "./LessonBlocks";
import NismBanner from "./NismBanner";
import ProgressTracker from "./ProgressTracker";
import Quiz from "./Quiz";
import SimSpotProvider from "./SimSpotProvider";
import { useLearnProgress } from "./useLearnProgress";

const LEVEL_VARIANT = { Beginner: "bullish", Intermediate: "info", Advanced: "warning" } as const;

/** Full lesson page body: breadcrumb, content blocks, quiz, prev/next and the path sidebar. */
export default function LessonLayout({ lesson }: { lesson: Lesson }) {
  const { progress, complete, uncomplete, visit, saveQuiz } = useLearnProgress();
  const path = getPath(lesson.path);
  const inPath = lessonsInPath(lesson.path);
  const position = inPath.findIndex((l) => l.slug === lesson.slug);
  const { prev, next } = adjacentLessons(lesson.slug);
  const done = !!progress.completed[lesson.slug];

  useEffect(() => {
    visit(lesson.slug);
  }, [lesson.slug, visit]);

  return (
    <SimSpotProvider>
      <div className="mx-auto w-full max-w-[1040px] px-1.5 py-1 sm:px-0">
        <nav aria-label="Breadcrumb" className="mb-3 flex flex-wrap items-center gap-1 text-body-sm text-muted-foreground">
          <Link to="/learn" className="inline-flex items-center gap-1 rounded-chip hover:text-foreground focus-visible:shadow-focus focus-visible:outline-none">
            <GraduationCap className="h-3.5 w-3.5" aria-hidden="true" /> Learn
          </Link>
          <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
          <Link to={`/learn#path-${lesson.path}`} className="rounded-chip hover:text-foreground focus-visible:shadow-focus focus-visible:outline-none">
            {path?.title}
          </Link>
          <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
          <span aria-current="page" className="text-foreground">
            Lesson {position + 1} of {inPath.length}
          </span>
        </nav>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
          <article className="min-w-0">
            <PageHeader
              eyebrow={path ? `${path.title} · Lesson ${position + 1}` : undefined}
              title={lesson.title}
              description={<p>{lesson.summary}</p>}
              source={
                <>
                  <Badge variant={LEVEL_VARIANT[lesson.level]}>{lesson.level}</Badge>
                  <span className="inline-flex items-center gap-1 text-body-sm text-muted-foreground">
                    <Clock className="h-3.5 w-3.5" aria-hidden="true" /> {lesson.minutes} min read
                  </span>
                  {lesson.sims.length > 0 ? (
                    <span className="inline-flex items-center gap-1 text-body-sm text-muted-foreground">
                      <FlaskConical className="h-3.5 w-3.5" aria-hidden="true" /> Interactive
                    </span>
                  ) : null}
                  {done ? (
                    <Badge variant="bullish">
                      <CheckCircle2 aria-hidden="true" /> Completed
                    </Badge>
                  ) : null}
                </>
              }
              className="hairline-b pb-4"
            />

            <div className="mt-2 px-1 sm:px-2">
              <LessonBlocks blocks={lesson.blocks} />
            </div>

            <Quiz key={lesson.slug} questions={lesson.quiz} best={progress.quiz[lesson.slug]} onSubmit={(s, t) => saveQuiz(lesson.slug, s, t)} className="mt-8" />

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <Button type="button" variant={done ? "outline" : "secondary"} size="sm" onClick={() => (done ? uncomplete(lesson.slug) : complete(lesson.slug))} aria-pressed={done}>
                <CheckCircle2 aria-hidden="true" />
                {done ? "Completed · undo" : "Mark as complete"}
              </Button>
            </div>

            <nav aria-label="Lesson navigation" className="mt-6 grid gap-3 sm:grid-cols-2">
              {prev ? (
                <Link
                  to={`/learn/${prev.slug}`}
                  className="group rounded-card border border-separator bg-card px-4 py-3 shadow-card transition-colors duration-fast hover:bg-control-track focus-visible:shadow-focus focus-visible:outline-none"
                >
                  <span className="flex items-center gap-1 text-label text-muted-foreground">
                    <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" /> Previous
                  </span>
                  <span className="mt-1 block text-headline text-foreground">{prev.title}</span>
                </Link>
              ) : (
                <span className="hidden sm:block" />
              )}
              {next ? (
                <Link
                  to={`/learn/${next.slug}`}
                  className="group rounded-card border border-separator bg-card px-4 py-3 text-right shadow-card transition-colors duration-fast hover:bg-control-track focus-visible:shadow-focus focus-visible:outline-none"
                >
                  <span className="flex items-center justify-end gap-1 text-label text-muted-foreground">
                    Next <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                  </span>
                  <span className="mt-1 block text-headline text-foreground">{next.title}</span>
                </Link>
              ) : (
                <Link
                  to="/learn"
                  className="group rounded-card border border-separator bg-card px-4 py-3 text-right shadow-card transition-colors duration-fast hover:bg-control-track focus-visible:shadow-focus focus-visible:outline-none"
                >
                  <span className="text-label text-muted-foreground">All done</span>
                  <span className="mt-1 block text-headline text-foreground">Back to the Learn hub</span>
                </Link>
              )}
            </nav>
          </article>

          <aside className="space-y-4 lg:sticky lg:top-4 lg:self-start">
            <ProgressTracker progress={progress} variant="path" pathId={lesson.path} currentSlug={lesson.slug} />
            <NismBanner variant="compact" />
          </aside>
        </div>

        <footer className="hairline-t mt-8 space-y-1 pt-3 text-body-sm text-muted-foreground">
          <p>Data for education and research. Not investment advice. Simulator prices come from a model; lot sizes, charge rates and expiry rules come from dated tables marked for verification.</p>
          <p>Educational content in partnership with NISMExams.com.</p>
        </footer>
      </div>
    </SimSpotProvider>
  );
}
