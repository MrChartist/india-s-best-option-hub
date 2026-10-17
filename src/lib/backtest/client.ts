/**
 * Run the backtester in a module Web Worker, falling back to a chunked main-thread run when workers
 * are unavailable (tests, old browsers, CSP) or the worker fails to start. Cancel with an AbortSignal:
 * the worker is terminated at once.
 */
import type { WorkerInMessage, WorkerOutMessage } from "./protocol";
import { runSteps } from "./run";
import type { BacktestInput, BacktestOutput, BacktestProgress } from "./types";

export interface RunOptions {
  onProgress?: (p: BacktestProgress) => void;
  signal?: AbortSignal;
  /** Force the main-thread path. */
  noWorker?: boolean;
}

export type RunMode = "worker" | "main-thread";

export class BacktestAbortError extends Error {
  constructor() {
    super("Backtest cancelled");
    this.name = "AbortError";
  }
}

let seq = 0;

function abortable(signal?: AbortSignal): void {
  if (signal?.aborted) throw new BacktestAbortError();
}

/** Chunked main-thread run: yields to the event loop every ~12 ms so the page stays responsive. */
export async function runOnMainThread(input: BacktestInput, o: RunOptions = {}): Promise<BacktestOutput> {
  const it = runSteps(input);
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

function runInWorker(input: BacktestInput, o: RunOptions): Promise<BacktestOutput> {
  return new Promise<BacktestOutput>((resolve, reject) => {
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
    const onAbort = () => finish(() => reject(new BacktestAbortError()));
    o.signal?.addEventListener("abort", onAbort);
    worker.onmessage = (e: MessageEvent<WorkerOutMessage>) => {
      const msg = e.data;
      if (!msg || msg.id !== id) return;
      if (msg.type === "progress") o.onProgress?.(msg.progress);
      else if (msg.type === "result") finish(() => resolve(msg.output));
      else finish(() => reject(new BacktestEngineError(msg.message)));
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

/** An error raised by the engine itself (bad template, bad data): do not retry on the main thread. */
export class BacktestEngineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BacktestEngineError";
  }
}

/** Run a backtest; resolves with the output and which path ran it. */
export async function runBacktest(input: BacktestInput, o: RunOptions = {}): Promise<{ output: BacktestOutput; mode: RunMode }> {
  abortable(o.signal);
  if (!o.noWorker) {
    try {
      return { output: await runInWorker(input, o), mode: "worker" };
    } catch (err) {
      if (err instanceof BacktestAbortError || err instanceof BacktestEngineError) throw err;
      // Worker failed to start or crashed: fall through to the main thread.
    }
  }
  return { output: await runOnMainThread(input, o), mode: "main-thread" };
}

export function isAbortError(err: unknown): boolean {
  return (err instanceof Error || (typeof DOMException !== "undefined" && err instanceof DOMException)) && (err as Error).name === "AbortError";
}
