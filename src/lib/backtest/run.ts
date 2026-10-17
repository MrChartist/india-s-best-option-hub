/** Shared by the worker and the main-thread fallback: resolve the dataset, then step the engine. */
import { backtestSteps } from "./engine";
import { generateSampleDataset } from "./sampleData";
import type { BacktestInput, BacktestOutput, BacktestProgress } from "./types";

export function* runSteps(input: BacktestInput): Generator<BacktestProgress, BacktestOutput, void> {
  yield { phase: "prepare", done: 0, total: 1, trades: 0 };
  const dataset = input.data.kind === "sample" ? generateSampleDataset(input.config.symbol) : input.data.dataset;
  yield { phase: "prepare", done: 1, total: 1, trades: 0 };
  return yield* backtestSteps(input.config, dataset);
}
