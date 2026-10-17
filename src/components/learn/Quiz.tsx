import { useId, useState } from "react";
import { CheckCircle2, ListChecks, RotateCcw, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PASS_RATIO, quizPassed, type QuizRecord } from "@/content/learn/progress";
import type { QuizQuestion } from "@/content/learn/types";
import { cn } from "@/lib/utils";

/**
 * Multiple-choice quiz. Answers are checked together on submit; passing (60% or more)
 * marks the lesson complete through onSubmit.
 */
export default function Quiz({ questions, best, onSubmit, className }: { questions: QuizQuestion[]; best?: QuizRecord; onSubmit: (score: number, total: number) => void; className?: string }) {
  const uid = useId();
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [submitted, setSubmitted] = useState(false);
  const total = questions.length;
  const answered = questions.filter((q) => answers[q.id] !== undefined).length;
  const score = questions.filter((q) => answers[q.id] === q.answer).length;
  const passed = quizPassed(score, total);

  if (total === 0) return null;

  const submit = () => {
    setSubmitted(true);
    onSubmit(score, total);
  };
  const retry = () => {
    setAnswers({});
    setSubmitted(false);
  };

  return (
    <section aria-labelledby={`${uid}-title`} className={cn("rounded-card border border-border bg-card p-4 shadow-card sm:p-5", className)}>
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={`${uid}-title`} className="flex items-center gap-2 font-display text-title text-foreground">
          <ListChecks className="h-5 w-5 text-primary-ink" aria-hidden="true" /> Check your understanding
        </h2>
        {best ? (
          <span className="text-body-sm text-muted-foreground">
            Best score {best.best}/{best.total} · {best.attempts} attempt{best.attempts === 1 ? "" : "s"}
          </span>
        ) : (
          <span className="text-body-sm text-muted-foreground">Score {Math.ceil(PASS_RATIO * total)}/{total} or more to complete the lesson</span>
        )}
      </header>

      <ol className="mt-4 space-y-5">
        {questions.map((q, qi) => {
          const chosen = answers[q.id];
          const correct = chosen === q.answer;
          return (
            <li key={q.id}>
              <fieldset disabled={submitted} aria-describedby={submitted ? `${uid}-${q.id}-ex` : undefined}>
                <legend className="text-lead text-foreground">
                  <span className="mr-1.5 font-num text-muted-foreground">{qi + 1}.</span>
                  {q.prompt}
                </legend>
                <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
                  {q.options.map((opt, oi) => {
                    const isChosen = chosen === oi;
                    const isAnswer = q.answer === oi;
                    return (
                      <label
                        key={oi}
                        className={cn(
                          "flex cursor-pointer items-start gap-2 rounded-tile border px-3 py-2 text-body transition-colors duration-fast focus-within:shadow-ember",
                          !submitted && (isChosen ? "border-primary/60 bg-wash-brand" : "border-border bg-surface hover:bg-accent"),
                          submitted && isAnswer && "border-bullish/50 bg-wash-profit",
                          submitted && isChosen && !isAnswer && "border-bearish/50 bg-wash-loss",
                          submitted && !isAnswer && !isChosen && "border-border bg-surface opacity-70",
                          submitted && "cursor-default",
                        )}
                      >
                        <input
                          type="radio"
                          name={`${uid}-${q.id}`}
                          value={oi}
                          checked={isChosen}
                          onChange={() => setAnswers((a) => ({ ...a, [q.id]: oi }))}
                          className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
                        />
                        <span className="min-w-0 flex-1">{opt}</span>
                        {submitted && isAnswer ? <CheckCircle2 className="h-4 w-4 shrink-0 text-bullish" aria-label="Correct answer" /> : null}
                        {submitted && isChosen && !isAnswer ? <XCircle className="h-4 w-4 shrink-0 text-bearish" aria-label="Your answer, incorrect" /> : null}
                      </label>
                    );
                  })}
                </div>
                {submitted ? (
                  <p id={`${uid}-${q.id}-ex`} className={cn("mt-2 text-body-sm", correct ? "text-bullish" : "text-foreground")}>
                    <span className="font-semibold">{correct ? "Correct. " : chosen === undefined ? "Not answered. " : "Not quite. "}</span>
                    <span className="text-muted-foreground">{q.explain}</span>
                  </p>
                ) : null}
              </fieldset>
            </li>
          );
        })}
      </ol>

      <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-border pt-4" aria-live="polite">
        {submitted ? (
          <>
            <p className={cn("font-display text-lead font-bold", passed ? "text-bullish" : "text-warning")}>
              {passed ? "Passed" : "Keep going"}: {score}/{total}
            </p>
            <span className="text-body-sm text-muted-foreground">{passed ? "Lesson marked complete." : "Review the explanations and try again."}</span>
            <Button type="button" variant="outline" size="sm" onClick={retry} className="ml-auto">
              <RotateCcw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Try again
            </Button>
          </>
        ) : (
          <>
            <Button type="button" onClick={submit} disabled={answered === 0}>
              Check answers
            </Button>
            <span className="text-body-sm text-muted-foreground">
              {answered}/{total} answered
            </span>
          </>
        )}
      </div>
    </section>
  );
}
