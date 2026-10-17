/**
 * Five-step getting-started tour shown on the dashboard until the reader finishes or skips it.
 * Inline (not a modal), so it never blocks the page; it can be restarted from Customise.
 */
import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, ArrowRight, BookOpen, Compass, Layers, Map as MapIcon, TableProperties, Wallet, X, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MrChartistMark } from "@/components/brand/MrChartistLogo";
import { cn } from "@/lib/utils";
import { TOUR_STEPS, type TourAction, type TourState, type TourStep } from "./onboarding";

const ICON: Record<TourStep["id"], LucideIcon> = { welcome: Compass, chain: TableProperties, builder: Layers, paper: Wallet, learn: BookOpen };

interface Props {
  state: TourState;
  dispatch: (a: TourAction) => void;
}

export function OnboardingTour({ state, dispatch }: Props) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  const moved = useRef(false);
  const step = TOUR_STEPS[state.step] ?? TOUR_STEPS[0];
  const last = state.step >= TOUR_STEPS.length - 1;
  const Icon = ICON[step.id];

  useEffect(() => {
    if (moved.current) titleRef.current?.focus();
    moved.current = false;
  }, [state.step]);

  const go = (a: TourAction) => {
    moved.current = true;
    dispatch(a);
  };

  return (
    <section aria-labelledby="tour-title" aria-roledescription="tour" className="relative overflow-hidden rounded-card border border-primary/30 bg-wash-brand/40 p-3 shadow-card sm:p-4">
      <div className="flex items-start gap-3">
        <span className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-tile bg-card text-primary-ink shadow-card sm:inline-flex" aria-hidden="true">
          {step.id === "welcome" ? <MrChartistMark size={20} decorative className="text-foreground" /> : <Icon className="h-4 w-4" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-label uppercase text-muted-foreground">
            <MapIcon className="h-3.5 w-3.5" aria-hidden="true" />
            Getting started · Step {state.step + 1} of {TOUR_STEPS.length}
          </p>
          <h2 id="tour-title" ref={titleRef} tabIndex={-1} className="mt-0.5 font-display text-lead font-bold focus-visible:outline-none">
            {step.title}
          </h2>
          <p className="mt-1 max-w-3xl text-body text-muted-foreground">{step.body}</p>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <ol className="mr-1 flex items-center gap-1" aria-label="Tour steps">
              {TOUR_STEPS.map((s, i) => (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => go({ type: "goto", step: i })}
                    aria-label={`Step ${i + 1}: ${s.title}`}
                    aria-current={i === state.step ? "step" : undefined}
                    className="flex h-6 w-6 items-center justify-center rounded-capsule focus-visible:shadow-ember focus-visible:outline-none"
                  >
                    <span className={cn("block h-2 rounded-capsule transition-all duration-200", i === state.step ? "w-5 bg-primary" : i < state.step ? "w-2 bg-primary/50" : "w-2 bg-muted-foreground/30")} />
                  </button>
                </li>
              ))}
            </ol>
            {state.step > 0 ? (
              <Button type="button" variant="ghost" size="sm" className="h-8 gap-1" onClick={() => go({ type: "back" })}>
                <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" /> Back
              </Button>
            ) : null}
            {step.to && step.cta ? (
              <Button asChild variant="outline" size="sm" className="h-8">
                <Link to={step.to} onClick={() => dispatch(last ? { type: "dismiss" } : { type: "next" })}>
                  {step.cta}
                </Link>
              </Button>
            ) : null}
            <Button type="button" size="sm" className="h-8 gap-1" onClick={() => go(last ? { type: "dismiss" } : { type: "next" })}>
              {last ? "Finish" : state.step === 0 ? "Show me around" : "Next"}
              {!last ? <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" /> : null}
            </Button>
          </div>
        </div>
        <button
          type="button"
          onClick={() => dispatch({ type: "dismiss" })}
          className="-m-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:shadow-ember focus-visible:outline-none"
          aria-label="Skip the tour"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </section>
  );
}

export default OnboardingTour;
