/**
 * Strategy Optimizer engine: enumerate → filter → score. Written as a generator so the same code
 * runs inside the Web Worker (posting progress) and on the main thread in small chunks.
 */
import { istDateString } from "@/lib/options";
import { buildQuoteBook, enumerateCandidates } from "./candidates";
import { buildScoreContext, contextSummary, scoreCandidate } from "./score";
import type { OptimizerInput, OptimizerOutput, OptimizerProgress, ScoredCandidate } from "./types";

/** Candidates scored between progress reports. */
export const PROGRESS_EVERY = 120;

export function* optimizeSteps(input: OptimizerInput): Generator<OptimizerProgress, OptimizerOutput, void> {
  const started = Date.now();
  const now = new Date(input.nowMs);
  const today = istDateString(now);
  const ctx = buildScoreContext(input, today);
  yield { done: 0, total: 1, phase: "enumerate" };

  const front = buildQuoteBook(input.front.expiry, input.front.chain);
  const back = input.back && input.back.chain.length > 0 ? buildQuoteBook(input.back.expiry, input.back.chain) : null;
  const en = enumerateCandidates({
    front,
    back,
    spot: input.spot,
    strikesAroundAtm: input.strikesAroundAtm,
    definedRiskOnly: input.definedRiskOnly,
    kinds: input.kinds,
    rules: { minOiPct: input.minOiPct, maxSpreadPct: input.maxSpreadPct, minPremium: input.minPremium, pricing: input.pricing },
  });

  const results: ScoredCandidate[] = [];
  let overBudget = 0;
  let unprofitable = 0;
  const total = en.candidates.length;
  yield { done: 0, total, phase: "score" };
  for (let i = 0; i < total; i++) {
    const out = scoreCandidate(en.candidates[i], ctx);
    if (out.ok) results.push(out.result);
    else if (out.reason === "over_budget") overBudget++;
    else unprofitable++;
    if ((i + 1) % PROGRESS_EVERY === 0) yield { done: i + 1, total, phase: "score" };
  }
  yield { done: total, total, phase: "score" };

  return {
    results,
    stats: {
      enumerated: en.enumerated,
      liquidityRejected: en.liquidityRejected,
      riskSkipped: en.riskSkipped,
      overBudget,
      unprofitable,
      feasible: results.length,
      durationMs: Date.now() - started,
      multiExpirySkipped: en.multiExpirySkipped,
    },
    context: contextSummary(ctx),
  };
}

/** Synchronous run (tests, worker). */
export function optimize(input: OptimizerInput, onProgress?: (p: OptimizerProgress) => void): OptimizerOutput {
  const it = optimizeSteps(input);
  for (;;) {
    const step = it.next();
    if (step.done) return step.value;
    onProgress?.(step.value);
  }
}
