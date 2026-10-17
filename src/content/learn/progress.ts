/**
 * Learn progress model, persisted in localStorage under "mc_learn_v1".
 * Pure reducers plus guarded storage helpers (every access is wrapped in try/catch).
 */

export const PROGRESS_STORAGE_KEY = "mc_learn_v1";
/** Share of quiz questions needed to pass and auto-complete a lesson. */
export const PASS_RATIO = 0.6;

export interface QuizRecord {
  best: number;
  total: number;
  attempts: number;
  lastAt: string;
}

export interface LearnProgress {
  v: 1;
  /** slug → ISO timestamp when completed */
  completed: Record<string, string>;
  quiz: Record<string, QuizRecord>;
  lastSlug?: string;
}

export const EMPTY_PROGRESS: LearnProgress = { v: 1, completed: {}, quiz: {} };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Parse untrusted JSON (or an object) into a valid progress object; never throws. */
export function parseProgress(raw: unknown): LearnProgress {
  let data: unknown = raw;
  if (typeof raw === "string") {
    try {
      data = JSON.parse(raw);
    } catch {
      return { ...EMPTY_PROGRESS, completed: {}, quiz: {} };
    }
  }
  if (!isRecord(data)) return { ...EMPTY_PROGRESS, completed: {}, quiz: {} };
  const completed: Record<string, string> = {};
  if (isRecord(data.completed)) {
    for (const [k, v] of Object.entries(data.completed)) if (typeof v === "string" && k) completed[k] = v;
  }
  const quiz: Record<string, QuizRecord> = {};
  if (isRecord(data.quiz)) {
    for (const [k, v] of Object.entries(data.quiz)) {
      if (!isRecord(v)) continue;
      const best = Number(v.best);
      const total = Number(v.total);
      const attempts = Number(v.attempts);
      if (!Number.isFinite(best) || !Number.isFinite(total) || total <= 0) continue;
      quiz[k] = {
        best: Math.max(0, Math.min(best, total)),
        total,
        attempts: Number.isFinite(attempts) && attempts > 0 ? Math.floor(attempts) : 1,
        lastAt: typeof v.lastAt === "string" ? v.lastAt : "",
      };
    }
  }
  const out: LearnProgress = { v: 1, completed, quiz };
  if (typeof data.lastSlug === "string" && data.lastSlug) out.lastSlug = data.lastSlug;
  return out;
}

export function quizPassed(score: number, total: number): boolean {
  return total > 0 && score / total >= PASS_RATIO - 1e-9;
}

export function markComplete(p: LearnProgress, slug: string, at: string = new Date().toISOString()): LearnProgress {
  if (p.completed[slug]) return p;
  return { ...p, completed: { ...p.completed, [slug]: at } };
}

export function markIncomplete(p: LearnProgress, slug: string): LearnProgress {
  if (!p.completed[slug]) return p;
  const completed = { ...p.completed };
  delete completed[slug];
  return { ...p, completed };
}

export function setLastLesson(p: LearnProgress, slug: string): LearnProgress {
  return p.lastSlug === slug ? p : { ...p, lastSlug: slug };
}

/** Record a quiz attempt; keeps the best score and auto-completes the lesson on a pass. */
export function recordQuiz(p: LearnProgress, slug: string, score: number, total: number, at: string = new Date().toISOString()): LearnProgress {
  if (!(total > 0) || !Number.isFinite(score)) return p;
  const s = Math.max(0, Math.min(Math.round(score), total));
  const prev = p.quiz[slug];
  const rec: QuizRecord = { best: Math.max(prev?.best ?? 0, s), total, attempts: (prev?.attempts ?? 0) + 1, lastAt: at };
  const next: LearnProgress = { ...p, quiz: { ...p.quiz, [slug]: rec } };
  return quizPassed(s, total) ? markComplete(next, slug, at) : next;
}

export function completionStats(p: LearnProgress, slugs: string[]): { done: number; total: number; pct: number } {
  const total = slugs.length;
  const done = slugs.filter((s) => !!p.completed[s]).length;
  return { done, total, pct: total ? Math.round((done / total) * 100) : 0 };
}

/** Where "Continue learning" should go: the first incomplete lesson after the last one opened, else the first incomplete. */
export function nextLessonSlug(p: LearnProgress, orderedSlugs: string[]): string | undefined {
  if (orderedSlugs.length === 0) return undefined;
  const start = p.lastSlug ? orderedSlugs.indexOf(p.lastSlug) : -1;
  if (start >= 0 && !p.completed[orderedSlugs[start]]) return orderedSlugs[start];
  for (let i = 1; i <= orderedSlugs.length; i++) {
    const s = orderedSlugs[(Math.max(start, -1) + i + orderedSlugs.length) % orderedSlugs.length];
    if (!p.completed[s]) return s;
  }
  return undefined;
}

export function loadProgress(storage: Pick<Storage, "getItem"> | undefined = safeStorage()): LearnProgress {
  try {
    const raw = storage?.getItem(PROGRESS_STORAGE_KEY);
    return raw ? parseProgress(raw) : parseProgress(null);
  } catch {
    return parseProgress(null);
  }
}

export function saveProgress(p: LearnProgress, storage: Pick<Storage, "setItem"> | undefined = safeStorage()): boolean {
  try {
    if (!storage) return false;
    storage.setItem(PROGRESS_STORAGE_KEY, JSON.stringify(p));
    return true;
  } catch {
    return false;
  }
}

function safeStorage(): Storage | undefined {
  try {
    return typeof window !== "undefined" ? window.localStorage : undefined;
  } catch {
    return undefined;
  }
}
