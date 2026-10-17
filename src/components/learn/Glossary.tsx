import { useId, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { GLOSSARY, glossaryLetter, searchGlossary } from "@/content/learn/glossary";
import { getLesson } from "@/content/learn/lessons";
import { cn } from "@/lib/utils";
import MetricHelp from "./MetricHelp";

const LETTERS = Array.from(new Set(GLOSSARY.map((t) => glossaryLetter(t.term)))).sort();

/** Searchable A–Z glossary of F&O terms with links to metric explainers and lessons. */
export default function Glossary({ className }: { className?: string }) {
  const uid = useId();
  const [query, setQuery] = useState("");
  const [letter, setLetter] = useState<string | null>(null);

  const results = useMemo(() => {
    const found = searchGlossary(query);
    return letter && !query.trim() ? found.filter((t) => glossaryLetter(t.term) === letter) : found;
  }, [query, letter]);

  return (
    <section aria-labelledby={`${uid}-h`} className={cn("rounded-card border border-border bg-card p-4 shadow-card sm:p-5", className)}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id={`${uid}-h`} className="font-display text-title text-foreground">
            Glossary
          </h2>
          <p className="mt-0.5 text-body-sm text-muted-foreground">{GLOSSARY.length} F&O terms in plain English.</p>
        </div>
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <label htmlFor={`${uid}-q`} className="sr-only">
            Search the glossary
          </label>
          <Input
            id={`${uid}-q`}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search: theta, PCR, max pain…"
            className="pl-8 pr-8"
            autoComplete="off"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="absolute right-2 top-1/2 grid h-5 w-5 -translate-y-1/2 place-items-center rounded-capsule text-muted-foreground hover:text-foreground focus-visible:shadow-ember focus-visible:outline-none"
              aria-label="Clear search"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          ) : null}
        </div>
      </div>

      <div role="group" aria-label="Filter by letter" className="mt-3 flex flex-wrap gap-1">
        <button
          type="button"
          aria-pressed={letter === null}
          onClick={() => setLetter(null)}
          className={cn(
            "h-7 rounded-chip px-2 text-body-sm font-semibold focus-visible:shadow-ember focus-visible:outline-none",
            letter === null ? "bg-wash-brand text-primary-ink" : "text-muted-foreground hover:bg-accent hover:text-foreground",
          )}
        >
          All
        </button>
        {LETTERS.map((l) => (
          <button
            key={l}
            type="button"
            aria-pressed={letter === l}
            onClick={() => {
              setLetter(letter === l ? null : l);
              setQuery("");
            }}
            className={cn(
              "h-7 w-7 rounded-chip font-num text-body-sm font-semibold focus-visible:shadow-ember focus-visible:outline-none",
              letter === l ? "bg-wash-brand text-primary-ink" : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            {l}
          </button>
        ))}
      </div>

      <p className="sr-only" aria-live="polite">
        {results.length} term{results.length === 1 ? "" : "s"} found
      </p>

      {results.length === 0 ? (
        <div className="mt-4 rounded-tile border border-dashed border-border bg-surface px-4 py-8 text-center">
          <p className="font-semibold text-foreground">No terms match “{query}”</p>
          <p className="mt-1 text-body-sm text-muted-foreground">Try a shorter word or an abbreviation such as IV, OI or STT.</p>
        </div>
      ) : (
        <dl className="mt-4 grid gap-x-6 gap-y-1 md:grid-cols-2">
          {results.map((t) => {
            const lesson = getLesson(t.lessonSlug);
            return (
              <div key={t.term} className="border-b border-border py-2.5">
                <dt className="flex flex-wrap items-center gap-1.5 font-semibold text-foreground">
                  {t.metric ? <MetricHelp metric={t.metric}>{t.term}</MetricHelp> : t.term}
                  {t.aka?.length ? <span className="text-body-sm font-normal text-muted-foreground">({t.aka.slice(0, 2).join(", ")})</span> : null}
                </dt>
                <dd className="mt-0.5 text-body text-muted-foreground">
                  {t.definition}
                  {lesson ? (
                    <Link
                      to={`/learn/${lesson.slug}`}
                      className="ml-1.5 inline-flex items-center gap-0.5 whitespace-nowrap text-body-sm font-semibold text-primary-ink underline-offset-4 hover:underline focus-visible:shadow-ember focus-visible:outline-none"
                    >
                      Lesson <ArrowRight className="h-3 w-3" aria-hidden="true" />
                      <span className="sr-only">: {lesson.title}</span>
                    </Link>
                  ) : null}
                </dd>
              </div>
            );
          })}
        </dl>
      )}
    </section>
  );
}
