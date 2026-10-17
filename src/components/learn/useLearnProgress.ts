import { useCallback, useMemo, useSyncExternalStore } from "react";
import {
  EMPTY_PROGRESS,
  loadProgress,
  markComplete,
  markIncomplete,
  PROGRESS_STORAGE_KEY,
  recordQuiz,
  saveProgress,
  setLastLesson,
  type LearnProgress,
} from "@/content/learn/progress";

// Module-level store so every component on the page (hub cards, tracker, quiz) stays in sync,
// and other tabs update through the storage event.
let cache: LearnProgress | null = null;
const listeners = new Set<() => void>();

function snapshot(): LearnProgress {
  if (!cache) cache = loadProgress();
  return cache;
}

function emit() {
  for (const l of listeners) l();
}

function update(fn: (p: LearnProgress) => LearnProgress) {
  const prev = snapshot();
  const next = fn(prev);
  if (next === prev) return;
  cache = next;
  saveProgress(next);
  emit();
}

function onStorage(e: StorageEvent) {
  if (e.key !== null && e.key !== PROGRESS_STORAGE_KEY) return;
  cache = loadProgress();
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1 && typeof window !== "undefined") window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && typeof window !== "undefined") window.removeEventListener("storage", onStorage);
  };
}

const serverSnapshot = (): LearnProgress => EMPTY_PROGRESS;

/** Learn progress persisted in localStorage "mc_learn_v1" (falls back to memory when storage is blocked). */
export function useLearnProgress() {
  const progress = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const complete = useCallback((slug: string) => update((p) => markComplete(p, slug)), []);
  const uncomplete = useCallback((slug: string) => update((p) => markIncomplete(p, slug)), []);
  const visit = useCallback((slug: string) => update((p) => setLastLesson(p, slug)), []);
  const saveQuiz = useCallback((slug: string, score: number, total: number) => update((p) => recordQuiz(p, slug, score, total)), []);
  const reset = useCallback(() => update(() => ({ v: 1, completed: {}, quiz: {} })), []);
  return useMemo(() => ({ progress, complete, uncomplete, visit, saveQuiz, reset }), [progress, complete, uncomplete, visit, saveQuiz, reset]);
}

export type LearnProgressApi = ReturnType<typeof useLearnProgress>;
