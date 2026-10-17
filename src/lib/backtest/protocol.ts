/** Messages between the backtest client and its module Web Worker. */
import type { BacktestInput, BacktestOutput, BacktestProgress } from "./types";

export type WorkerInMessage = { type: "run"; id: number; input: BacktestInput };

export type WorkerOutMessage =
  | { type: "progress"; id: number; progress: BacktestProgress }
  | { type: "result"; id: number; output: BacktestOutput }
  | { type: "error"; id: number; message: string };
