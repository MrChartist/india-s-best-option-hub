/**
 * Service-worker registration with an update prompt (vite-plugin-pwa, registerType "prompt").
 *
 * The Workbox service worker precaches the app shell only; /api/* is NetworkOnly, so a cached quote
 * can never be shown as live. When a new build is deployed, the new worker waits; the user sees an
 * "Update available" toast and the page reloads only when they accept. Workbox's generated worker
 * listens for { type: "SKIP_WAITING" }.
 *
 * Framework-free so it can be unit tested with a fake navigator.serviceWorker.
 */

export interface UpdatePrompt {
  /** Show the prompt; call `apply` when the user accepts. */
  onUpdateReady: (apply: () => void) => void;
  /** Optional: the app shell is now cached and works offline (first install only). */
  onOfflineReady?: () => void;
}

type SWContainer = Pick<ServiceWorkerContainer, "register" | "addEventListener" | "controller">;

/** How often an open tab asks the server for a newer worker (traders keep the terminal open all day). */
export const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

function promptWhenInstalled(worker: ServiceWorker, hadController: boolean, prompt: UpdatePrompt, apply: (w: ServiceWorker) => () => void): void {
  worker.addEventListener("statechange", () => {
    if (worker.state !== "installed") return;
    if (hadController) prompt.onUpdateReady(apply(worker));
    else prompt.onOfflineReady?.();
  });
}

/**
 * Register `swUrl` and wire the update prompt. Resolves to the registration, or null when service
 * workers are unavailable or registration failed (the app works the same without one).
 */
export async function registerServiceWorker(
  prompt: UpdatePrompt,
  opts: { swUrl?: string; container?: SWContainer | null; reload?: () => void; setIntervalFn?: typeof setInterval } = {},
): Promise<ServiceWorkerRegistration | null> {
  const container: SWContainer | null =
    opts.container !== undefined ? opts.container : typeof navigator !== "undefined" && "serviceWorker" in navigator ? navigator.serviceWorker : null;
  if (!container) return null;
  const reload = opts.reload ?? (() => window.location.reload());
  let reloading = false;
  container.addEventListener("controllerchange", () => {
    if (reloading) return;
    reloading = true;
    reload();
  });
  const apply = (w: ServiceWorker) => () => w.postMessage({ type: "SKIP_WAITING" });

  let reg: ServiceWorkerRegistration | undefined;
  try {
    reg = await container.register(opts.swUrl ?? "/sw.js", { scope: "/" });
  } catch {
    return null;
  }
  // Some privacy modes and automation browsers stub register() and resolve with nothing.
  if (!reg) return null;
  const hadController = Boolean(container.controller);
  // A worker may already be waiting from an earlier visit.
  if (reg.waiting && hadController) prompt.onUpdateReady(apply(reg.waiting));
  if (reg.installing) promptWhenInstalled(reg.installing, hadController, prompt, apply);
  reg.addEventListener("updatefound", () => {
    if (reg.installing) promptWhenInstalled(reg.installing, Boolean(container.controller), prompt, apply);
  });
  (opts.setIntervalFn ?? setInterval)(() => {
    void reg.update().catch(() => undefined);
  }, UPDATE_CHECK_INTERVAL_MS);
  return reg;
}
