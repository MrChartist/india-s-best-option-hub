import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  Activity,
  ArrowRight,
  BarChart3,
  BookOpen,
  Clock3,
  FlaskConical,
  GraduationCap,
  Layers,
  Magnet,
  Receipt,
  Search,
  ShieldAlert,
  Sigma,
  Target,
  type LucideIcon,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/PageHeader";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import Glossary from "@/components/learn/Glossary";
import LessonCard from "@/components/learn/LessonCard";
import { buttonVariants } from "@/components/ui/button";
import MetricHelp from "@/components/learn/MetricHelp";
import NismBanner from "@/components/learn/NismBanner";
import { BrandCrossLink } from "@/components/brand/ProductCrossLink";
import { ECOSYSTEM_PAGES } from "@/lib/brand/links";
import ProgressTracker from "@/components/learn/ProgressTracker";
import { useLearnProgress } from "@/components/learn/useLearnProgress";
import { GLOSSARY } from "@/content/learn/glossary";
import { LESSONS, lessonsInPath, PATHS, SEBI_STUDY_2024_URL, TOTAL_MINUTES } from "@/content/learn/lessons";
import { METRIC_KEYS, METRICS } from "@/content/learn/metrics";
import { nextLessonSlug } from "@/content/learn/progress";
import type { LearningPath, SimId } from "@/content/learn/types";

const PATH_ICON: Record<LearningPath["icon"], LucideIcon> = { BookOpen, Sigma, Activity, Layers, ShieldAlert, BarChart3, Magnet };

const SIM_CARDS: Array<{ sim: SimId; title: string; blurb: string; icon: LucideIcon }> = [
  { sim: "ivStraddle", title: "Drag IV, watch the straddle", blurb: "See premiums and the expected move respond to volatility and time.", icon: Activity },
  { sim: "payoff", title: "Build a payoff", blurb: "Click strikes to assemble spreads, straddles and condors.", icon: Layers },
  { sim: "thetaDecay", title: "Expiry-day theta", blurb: "Slide the clock from 09:15 to 15:30 and watch time value melt.", icon: Clock3 },
  { sim: "greeks", title: "Greeks explorer", blurb: "Delta and gamma curves across strikes, days and IV.", icon: Sigma },
  { sim: "pop", title: "Probability of profit", blurb: "POP vs expected value for strangles and condors.", icon: Target },
  { sim: "charges", title: "Charges and STT", blurb: "Every rupee between gross and net, plus the exercise trap.", icon: Receipt },
];

function firstLessonWithSim(sim: SimId): string {
  return LESSONS.find((l) => l.sims.includes(sim))?.slug ?? LESSONS[0].slug;
}

export default function Learn() {
  useDocumentTitle("Learn options with NISMExams.com");
  const { progress, reset } = useLearnProgress();
  const location = useLocation();
  const [filter, setFilter] = useState("");

  const ordered = useMemo(() => LESSONS.map((l) => l.slug), []);
  const nextSlug = nextLessonSlug(progress, ordered);
  const nextLesson = LESSONS.find((l) => l.slug === nextSlug);
  const started = Object.keys(progress.completed).length > 0 || !!progress.lastSlug;
  const allDone = !nextSlug;

  const q = filter.trim().toLowerCase();
  const matches = (title: string, summary: string) => !q || title.toLowerCase().includes(q) || summary.toLowerCase().includes(q);
  const visiblePaths = PATHS.map((p) => ({ path: p, lessons: lessonsInPath(p.id).filter((l) => matches(l.title, l.summary) || matches(p.title, "")) })).filter((x) => x.lessons.length > 0);

  useEffect(() => {
    if (!location.hash) return;
    const el = document.getElementById(decodeURIComponent(location.hash.slice(1)));
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [location.hash]);

  return (
    <div className="mx-auto w-full max-w-[1400px] space-y-6 px-1.5 py-1 sm:px-0">
      <PageHeader
        icon={GraduationCap}
        eyebrow="Free course · In partnership"
        title="Learn options with NISMExams.com"
        description="Plain-English lessons on Indian F&O, from calls and puts to GEX, with interactive simulators that use the same maths as the terminal. Every lesson ends with a short quiz."
        actions={
          <div className="flex w-full flex-col items-stretch gap-1.5 sm:w-auto sm:items-end">
            <Link
              to={`/learn/${nextLesson?.slug ?? LESSONS[0].slug}`}
              className={buttonVariants({ size: "lg" })}
            >
              {allDone ? "Review from the start" : started ? "Continue learning" : "Start with Options 101"}
              <ArrowRight aria-hidden="true" />
            </Link>
            {nextLesson && started ? <span className="text-center text-body-sm text-muted-foreground sm:max-w-[16rem] sm:text-right">Next up: {nextLesson.title}</span> : null}
          </div>
        }
      />

      {/* At a glance: one quiet orange radial (6%) instead of decorative circles */}
      <section
        aria-label="Course at a glance"
        className="relative overflow-hidden rounded-card border border-separator bg-card bg-[radial-gradient(80%_140%_at_100%_0%,hsl(var(--primary)/0.06),transparent_65%)] p-4 shadow-card sm:p-5"
      >
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <p className="max-w-xl font-display text-title font-semibold text-foreground">
            From your first call option to reading dealer gamma, <span className="font-display font-medium italic text-primary-ink">built for Indian markets.</span>
          </p>
          <ul className="grid grid-cols-2 gap-x-6 gap-y-2 text-body-sm sm:flex sm:flex-wrap" aria-label="What is inside">
            {[
              [String(LESSONS.length), "lessons"],
              [`${TOTAL_MINUTES} min`, "total reading"],
              [String(SIM_CARDS.length), "simulators"],
              [String(GLOSSARY.length), "glossary terms"],
            ].map(([v, k]) => (
              <li key={k} className="flex flex-col sm:flex-row sm:items-baseline sm:gap-1.5">
                <span className="whitespace-nowrap font-num text-title tabular-nums text-foreground">{v}</span>
                <span className="text-muted-foreground">{k}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <aside role="note" aria-label="Risk notice" className="flex gap-3 rounded-card border border-separator bg-card px-4 py-3 shadow-card">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-bearish" aria-hidden="true" />
        <p className="text-body text-foreground">
          <span className="font-semibold">Know the odds first.</span> SEBI found that about 9 in 10 individual F&O traders lost money between FY22 and FY24.{" "}
          <a href={SEBI_STUDY_2024_URL} target="_blank" rel="noopener noreferrer" className="font-semibold text-foreground underline decoration-bearish/60 underline-offset-4 hover:decoration-bearish focus-visible:shadow-focus focus-visible:outline-none">
            Read the SEBI study<span className="sr-only"> (PDF, opens in a new tab)</span>
          </a>{" "}
          or start with the{" "}
          <Link to="/learn/risk-disclosure" className="font-semibold text-foreground underline decoration-bearish/60 underline-offset-4 hover:decoration-bearish focus-visible:shadow-focus focus-visible:outline-none">
            risk disclosure lesson
          </Link>
          .
        </p>
      </aside>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        {/* Learning paths */}
        <section aria-labelledby="paths-h" className="min-w-0 space-y-6">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 id="paths-h" className="font-display text-title text-foreground">
                Learning paths
              </h2>
              <p className="mt-0.5 text-body-sm text-muted-foreground">Work through them in order, or jump to what you need.</p>
            </div>
            <div className="relative w-full sm:w-64">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <label htmlFor="lesson-filter" className="sr-only">
                Filter lessons
              </label>
              <Input id="lesson-filter" type="search" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter lessons" className="pl-8" autoComplete="off" />
            </div>
          </div>

          {visiblePaths.length === 0 ? (
            <div className="rounded-card bg-control-track px-4 py-10 text-center">
              <p className="font-semibold text-foreground">No lessons match “{filter}”</p>
              <p className="mt-1 text-body-sm text-muted-foreground">Try the glossary below for single terms.</p>
            </div>
          ) : (
            visiblePaths.map(({ path, lessons }) => {
              const Icon = PATH_ICON[path.icon];
              const all = lessonsInPath(path.id);
              return (
                <div key={path.id} id={`path-${path.id}`} className="scroll-mt-20">
                  <div className="mb-2 flex items-start gap-2.5 px-1">
                    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-pill bg-primary text-primary-foreground" aria-hidden="true">
                      <Icon className="h-3.5 w-3.5" />
                    </span>
                    <div className="min-w-0">
                      <h3 className="font-display text-lead font-semibold text-foreground">{path.title}</h3>
                      <p className="text-body-sm text-muted-foreground">{path.blurb}</p>
                    </div>
                  </div>
                  <ul aria-label={`${path.title} lessons`} className="divide-y divide-separator overflow-hidden rounded-tile border border-separator bg-card shadow-card">
                    {lessons.map((l) => (
                      <LessonCard key={l.slug} lesson={l} index={all.indexOf(l)} done={!!progress.completed[l.slug]} quiz={progress.quiz[l.slug]} />
                    ))}
                  </ul>
                </div>
              );
            })
          )}
        </section>

        <div className="space-y-4 lg:sticky lg:top-4 lg:self-start">
          <ProgressTracker progress={progress} onReset={reset} />
          <NismBanner variant="compact" />
        </div>
      </div>

      <NismBanner />
      <BrandCrossLink
        name="Learn options on mrchartist.com"
        url={ECOSYSTEM_PAGES.learnOptions}
        campaign="learn-hub"
        tag="learn-options"
        lead="More lessons from Mr. Chartist:"
        className="-mt-3"
      />

      {/* Simulators */}
      <section aria-labelledby="sims-h">
        <h2 id="sims-h" className="flex items-center gap-2 font-display text-title text-foreground">
          <FlaskConical className="h-5 w-5 text-primary-ink" aria-hidden="true" /> Try the simulators
        </h2>
        <p className="mt-0.5 text-body-sm text-muted-foreground">Each one lives inside a lesson, priced with the terminal's Black-Scholes core on a live or sample NIFTY level.</p>
        <div className="mt-3 grid overflow-hidden rounded-tile border border-separator bg-card shadow-card sm:grid-cols-2 lg:grid-cols-3 [&>*]:shadow-[0_0_0_var(--hairline)_hsl(var(--separator))]">
          {SIM_CARDS.map((s) => (
            <Link
              key={s.sim}
              to={`/learn/${firstLessonWithSim(s.sim)}`}
              className="group flex items-start gap-3 bg-card px-3 py-2.5 transition-colors duration-fast hover:bg-control-track focus-visible:shadow-[inset_0_0_0_3px_hsl(var(--primary)/0.5)] focus-visible:outline-none"
            >
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-pill bg-product text-primary-foreground" aria-hidden="true">
                <s.icon className="h-3.5 w-3.5" />
              </span>
              <span className="min-w-0">
                <span className="block text-headline text-foreground">{s.title}</span>
                <span className="mt-0.5 block text-body-sm text-muted-foreground">{s.blurb}</span>
              </span>
            </Link>
          ))}
        </div>
      </section>

      {/* Metric explainers */}
      <section aria-labelledby="metrics-h">
        <h2 id="metrics-h" className="font-display text-title text-foreground">
          Every metric, explained
        </h2>
        <p className="mt-0.5 text-body-sm text-muted-foreground">The same explainers appear next to numbers across the terminal. Hover, focus or tap the info icon.</p>
        <ul className="mt-3 grid overflow-hidden rounded-tile border border-separator bg-card shadow-card sm:grid-cols-2 lg:grid-cols-4 [&>*]:shadow-[0_0_0_var(--hairline)_hsl(var(--separator))]">
          {METRIC_KEYS.map((k) => (
            <li key={k} className="flex min-w-0 items-start justify-between gap-2 bg-card px-3 py-2.5">
              <span className="min-w-0">
                <MetricHelp metric={k} className="font-semibold text-foreground">
                  <span className="truncate">{METRICS[k].title}</span>
                </MetricHelp>
                <span className="mt-0.5 line-clamp-2 block text-body-sm text-muted-foreground">{METRICS[k].oneLiner}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>

      <div id="glossary" className="scroll-mt-20">
        <Glossary />
      </div>

      <footer className="hairline-t space-y-1 pt-3 text-body-sm text-muted-foreground">
        <p>Data for education and research. Not investment advice. Examples and simulators are illustrative; lot sizes, charge rates and expiry rules come from dated tables marked for verification against NSE, BSE and SEBI circulars.</p>
        <p>Educational content in partnership with NISMExams.com. Progress is stored only in this browser.</p>
      </footer>
    </div>
  );
}
