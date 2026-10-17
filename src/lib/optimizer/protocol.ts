import type { OptimizerInput, OptimizerOutput, OptimizerProgress } from "./types";

export type WorkerInMessage = { type: "run"; id: number; input: OptimizerInput };

export type WorkerOutMessage =
  | { type: "progress"; id: number; progress: OptimizerProgress }
  | { type: "result"; id: number; output: OptimizerOutput }
  | { type: "error"; id: number; message: string };
