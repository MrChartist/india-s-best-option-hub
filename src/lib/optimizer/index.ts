/**
 * Strategy Optimizer (OptionStrat-style "Optimize" for NSE).
 *
 * Enter a target price and date, a budget and a return-vs-chance preference; the engine enumerates
 * liquid NSE structures around ATM, sizes each to the budget with the SPAN-style margin estimate,
 * scores it with "@/lib/options" and ranks it by utility = w · ROI_norm + (1 − w) · POP.
 */
export * from "./types";
export * from "./candidates";
export * from "./score";
export * from "./engine";
export * from "./preview";
export { runOptimizer, runOnMainThread, isAbortError, OptimizerAbortError, type RunMode, type RunOptions } from "./client";
