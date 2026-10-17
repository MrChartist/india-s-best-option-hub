/**
 * Module Web Worker for the Strategy Optimizer.
 * Created with: new Worker(new URL("./worker.ts", import.meta.url), { type: "module" })
 */
import { optimizeSteps } from "./engine";
import type { WorkerInMessage, WorkerOutMessage } from "./protocol";

interface WorkerScope {
  postMessage(message: WorkerOutMessage): void;
  addEventListener(type: "message", listener: (e: MessageEvent<WorkerInMessage>) => void): void;
}

const scope = self as unknown as WorkerScope;

scope.addEventListener("message", (e) => {
  const msg = e.data;
  if (!msg || msg.type !== "run") return;
  try {
    const it = optimizeSteps(msg.input);
    let last = 0;
    for (;;) {
      const step = it.next();
      if (step.done) {
        scope.postMessage({ type: "result", id: msg.id, output: step.value });
        return;
      }
      const t = Date.now();
      if (t - last > 60 || step.value.done === step.value.total) {
        last = t;
        scope.postMessage({ type: "progress", id: msg.id, progress: step.value });
      }
    }
  } catch (err) {
    scope.postMessage({ type: "error", id: msg.id, message: err instanceof Error ? err.message : "Optimizer failed" });
  }
});
