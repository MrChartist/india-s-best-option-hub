import { Link, useParams } from "react-router-dom";
import { ArrowLeft, SearchX } from "lucide-react";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { PageHeader } from "@/components/PageHeader";
import LessonLayout from "@/components/learn/LessonLayout";
import { getLesson, LESSONS } from "@/content/learn/lessons";

export default function LearnLesson() {
  const { slug } = useParams<{ slug: string }>();
  const lesson = getLesson(slug);
  useDocumentTitle(lesson ? `${lesson.title} · Learn` : "Lesson not found · Learn");

  if (!lesson) {
    return (
      <div className="mx-auto w-full max-w-2xl px-1.5 py-8 sm:px-0">
        <PageHeader
          icon={SearchX}
          title="Lesson Not Found"
          description={<>There is no lesson at “{slug}”. It may have been renamed. Try one of these:</>}
        />
        <ul className="mt-4 max-w-md space-y-1">
          {LESSONS.slice(0, 5).map((l) => (
            <li key={l.slug}>
              <Link to={`/learn/${l.slug}`} className="block rounded-tile px-3 py-2 text-body text-foreground hover:bg-accent focus-visible:shadow-focus focus-visible:outline-none">
                {l.title}
              </Link>
            </li>
          ))}
        </ul>
        <Link
          to="/learn"
          className="mt-6 inline-flex items-center gap-1.5 rounded-pill bg-primary px-4 py-2 text-body font-semibold text-primary-foreground hover:bg-primary-hover focus-visible:shadow-focus focus-visible:outline-none"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to the Learn hub
        </Link>
        <p className="mt-8 text-body-sm text-muted-foreground">Data for education and research. Not investment advice.</p>
      </div>
    );
  }

  return <LessonLayout lesson={lesson} />;
}
