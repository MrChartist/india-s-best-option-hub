/**
 * Run the optimizer in a module Web Worker, falling back to a chunked main-thread run when workers
 * are unavailable (tests, old browsers, CSP) or the worker fails to start.
 */
import { optimizeSteps } from "./engine";
import type { WorkerInMessage, WorkerOutMessage } from "./protocol";
import type { OptimizerInput, OptimizerOutput, OptimizerProgress } from "./types";

export interface RunOptions {
  onProgress?: (p: OptimizerProgress) => void;
  signal?: AbortSignal;
  /** Force the main-thread path. */
  noWorker?: boolean;
}

export type RunMode = "worker" | "main-thread";

export class OptimizerAbortError extends Error {
  constructor() {
    super("Optimizer run cancelled");
    this.name = "AbortError";
  }
}

let seq = 0;

function abortable(signal?: AbortSignal): void {
  if (signal?.aborted) throw new OptimizerAbortError();
}

/** Chunked main-thread run: yields to the event loop every ~12 ms so the page stays responsive. */
export async function runOnMainThread(input: OptimizerInput, o: RunOptions = {}): Promise<OptimizerOutput> {
  const it = optimizeSteps(input);
  let sliceStart = Date.now();
  for (;;) {
    abortable(o.signal);
    const step = it.next();
    if (step.done) return step.value;
    o.onProgress?.(step.value);
    if (Date.now() - sliceStart > 12) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      sliceStart = Date.now();
    }
  }
}

function createWorker(): Worker | null {
  if (typeof Worker === "undefined") return null;
  try {
    return new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
  } catch {
    return null;
  }
}

function runInWorker(input: OptimizerInput, o: RunOptions): Promise<OptimizerOutput> {
  return new Promise<OptimizerOutput>((resolve, reject) => {
    const worker = createWorker();
    if (!worker) {
      reject(new Error("worker-unavailable"));
      return;
    }
    const id = ++seq;
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      worker.terminate();
      o.signal?.removeEventListener("abort", onAbort);
      fn();
    };
    const onAbort = () => finish(() => reject(new OptimizerAbortError()));
    o.signal?.addEventListener("abort", onAbort);
    worker.onmessage = (e: MessageEvent<WorkerOutMessage>) => {
      const msg = e.data;
      if (!msg || msg.id !== id) return;
      if (msg.type === "progress") o.onProgress?.(msg.progress);
      else if (msg.type === "result") finish(() => resolve(msg.output));
      else finish(() => reject(new Error(msg.message)));
    };
    worker.onerror = (e) => {
      e.preventDefault();
      finish(() => reject(new Error("worker-unavailable")));
    };
    const message: WorkerInMessage = { type: "run", id, input };
    try {
      worker.postMessage(message);
    } catch {
      finish(() => reject(new Error("worker-unavailable")));
    }
  });
}

/** Run the optimizer; resolves with the output and which path ran it. */
export async function runOptimizer(input: OptimizerInput, o: RunOptions = {}): Promise<{ output: OptimizerOutput; mode: RunMode }> {
  abortable(o.signal);
  if (!o.noWorker) {
    try {
      return { output: await runInWorker(input, o), mode: "worker" };
    } catch (err) {
      if (err instanceof OptimizerAbortError) throw err;
      // Worker failed to start or crashed: fall through to the main thread.
    }
  }
  return { output: await runOnMainThread(input, o), mode: "main-thread" };
}

export function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}
