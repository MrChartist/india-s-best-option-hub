/**
 * React.lazy with chunk-load resilience.
 *
 * After a deploy, an open tab may still reference old hashed chunks that no
 * longer exist, so `import()` rejects. We retry once (covers flaky networks),
 * then reload the page once to pick up the new build. A sessionStorage flag
 * makes sure we never reload in a loop; it is cleared after any successful
 * chunk load.
 */
import { lazy, type ComponentType, type LazyExoticComponent } from "react";
import { log } from "@/lib/log";

export const CHUNK_RELOAD_KEY = "mc:chunk-reload-at";
/** A second reload is allowed only after this long (a later deploy, not a loop). */
export const CHUNK_RELOAD_COOLDOWN_MS = 60_000;

const CHUNK_ERROR_PATTERNS = [
  /failed to fetch dynamically imported module/i,
  /error loading dynamically imported module/i,
  /importing a module script failed/i,
  /loading (css )?chunk [\w-]+ failed/i,
  /unable to preload css/i,
  /'text\/html' is not a valid javascript mime type/i,
];

/** True for errors thrown when a lazily imported chunk cannot be fetched. */
export function isChunkLoadError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const { name, message } = error as { name?: unknown; message?: unknown };
  if (name === "ChunkLoadError") return true;
  return typeof message === "string" && CHUNK_ERROR_PATTERNS.some((re) => re.test(message));
}

function getSessionStorage(): Storage | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}

export interface ReloadOptions {
  storage?: Storage | null;
  reload?: () => void;
  now?: () => number;
}

/**
 * Reload the page once for a chunk error. Returns true if a reload was
 * triggered, false if we already reloaded recently (the caller should then
 * show the error instead).
 */
export function reloadOnceForChunkError({
  storage = getSessionStorage(),
  reload = () => window.location.reload(),
  now = Date.now,
}: ReloadOptions = {}): boolean {
  try {
    const last = Number(storage?.getItem(CHUNK_RELOAD_KEY) ?? 0);
    if (last && now() - last < CHUNK_RELOAD_COOLDOWN_MS) return false;
    storage?.setItem(CHUNK_RELOAD_KEY, String(now()));
  } catch {
    // Storage blocked (private mode): reloading without a guard could loop.
    return false;
  }
  log.warn("Chunk failed to load; reloading once to fetch the latest build.");
  reload();
  return true;
}

/** Forget the reload guard (called after a chunk loads successfully). */
export function clearChunkReloadFlag(storage: Storage | null = getSessionStorage()): void {
  try {
    storage?.removeItem(CHUNK_RELOAD_KEY);
  } catch {
    // ignore
  }
}

export interface RetryOptions extends ReloadOptions {
  /** Extra attempts before giving up (default 1). */
  retries?: number;
  /** Delay before each retry in ms (default 400). */
  delayMs?: number;
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Run an import factory with retries. On a final chunk error it reloads once
 * and returns a promise that never settles (the page is going away). Any other
 * error, or a chunk error after we already reloaded, is rethrown so an error
 * boundary can show it.
 */
export async function importWithRetry<M>(factory: () => Promise<M>, options: RetryOptions = {}): Promise<M> {
  const { retries = 1, delayMs = 400, storage = getSessionStorage() } = options;
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const mod = await factory();
      clearChunkReloadFlag(storage);
      return mod;
    } catch (error) {
      lastError = error;
      if (attempt < retries) await wait(delayMs * (attempt + 1));
    }
  }
  if (isChunkLoadError(lastError) && reloadOnceForChunkError({ ...options, storage })) {
    return new Promise<M>(() => {});
  }
  throw lastError;
}

/** Drop-in replacement for React.lazy: one retry, then a guarded reload. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- mirrors React.lazy's own constraint
export function lazyWithRetry<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>,
  options?: RetryOptions,
): LazyExoticComponent<T> {
  return lazy(() => importWithRetry(factory, options));
}
