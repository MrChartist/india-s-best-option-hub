import { describe, expect, it } from "vitest";
import { GLOSSARY, glossaryLetter, searchGlossary } from "./glossary";
import { adjacentLessons, getLesson, LESSONS, lessonsInPath, PATHS } from "./lessons";
import { formatMetricValue, getMetric, isMetricKey, METRIC_KEYS, METRICS, normalizeMetricKey } from "./metrics";
import {
  completionStats,
  EMPTY_PROGRESS,
  loadProgress,
  markComplete,
  markIncomplete,
  nextLessonSlug,
  parseProgress,
  PROGRESS_STORAGE_KEY,
  quizPassed,
  recordQuiz,
  saveProgress,
  setLastLesson,
} from "./progress";

const REQUIRED_METRICS = [
  "iv", "ivr", "ivp", "hv", "vrp", "pop", "p50", "ev", "em", "gex", "flip", "callWall", "putWall", "absGamma", "dex", "vanna", "charm",
  "rr25", "bf25", "maxPain", "pcr", "pcrChg", "span", "elm", "stt", "delta", "gamma", "theta", "vega", "rho", "buildup", "mwpl", "basis",
  "rollover", "straddle",
];

describe("metrics content", () => {
  it("covers every required metric with complete fields", () => {
    expect([...METRIC_KEYS].sort()).toEqual([...REQUIRED_METRICS].sort());
    for (const k of METRIC_KEYS) {
      const m = METRICS[k];
      expect(m.key).toBe(k);
      expect(m.short.length).toBeGreaterThan(0);
      for (const f of [m.title, m.oneLiner, m.formula, m.howToRead, m.indiaExample]) expect(f.trim().length).toBeGreaterThan(3);
      expect(m.pitfalls.length).toBeGreaterThan(0);
    }
  });

  it("links every metric to an existing lesson that lists it", () => {
    for (const k of METRIC_KEYS) {
      const lesson = getLesson(METRICS[k].lessonSlug);
      expect(lesson, `${k} → ${METRICS[k].lessonSlug}`).toBeDefined();
      expect(lesson?.metrics).toContain(k);
    }
  });

  it("computes worked examples without NaN or undefined", () => {
    for (const k of METRIC_KEYS) {
      expect(METRICS[k].indiaExample).not.toMatch(/NaN|undefined|—/);
      expect(METRICS[k].formula).not.toMatch(/NaN|undefined/);
    }
  });

  it("quotes the 2026 STT rate and a sensible straddle example", () => {
    expect(METRICS.stt.indiaExample).toContain("₹9.75");
    const m = METRICS.straddle.indiaExample.match(/= ₹([\d,]+\.\d{2})/);
    expect(m).not.toBeNull();
    const straddle = Number(m?.[1].replace(/,/g, ""));
    // NIFTY 25,000, 12% IV, 7 days: ATM straddle ≈ 0.8 × S × σ × √T ≈ 330
    expect(straddle).toBeGreaterThan(300);
    expect(straddle).toBeLessThan(360);
  });

  it("normalises keys and aliases", () => {
    expect(normalizeMetricKey("IVR")).toBe("ivr");
    expect(normalizeMetricKey("call-wall")).toBe("callWall");
    expect(normalizeMetricKey("Max Pain")).toBe("maxPain");
    expect(normalizeMetricKey("IV Rank")).toBe("ivr");
    expect(normalizeMetricKey("nope")).toBeUndefined();
    expect(normalizeMetricKey("")).toBeUndefined();
    expect(getMetric("pcr_chg")?.key).toBe("pcrChg");
    expect(isMetricKey("gex")).toBe(true);
    expect(isMetricKey("toString")).toBe(false);
  });

  it("formats live values by unit", () => {
    expect(formatMetricValue("ivr", 42.4)).toBe("42");
    expect(formatMetricValue("iv", 13.25)).toBe("13.3%");
    expect(formatMetricValue("pcr", 1.234)).toBe("1.23");
    expect(formatMetricValue("maxPain", 25000)).toBe("25,000");
    expect(formatMetricValue("theta", -8.4)).toBe("−₹8.40");
    expect(formatMetricValue("ivr", "High")).toBe("High");
    expect(formatMetricValue("ivr", NaN)).toBeUndefined();
    expect(formatMetricValue("ivr", undefined)).toBeUndefined();
  });
});

describe("lessons content", () => {
  it("has at least 12 lessons, each with a quiz and unique slug", () => {
    expect(LESSONS.length).toBeGreaterThanOrEqual(12);
    expect(new Set(LESSONS.map((l) => l.slug)).size).toBe(LESSONS.length);
    for (const l of LESSONS) {
      expect(l.quiz.length, l.slug).toBeGreaterThanOrEqual(3);
      expect(l.blocks.length).toBeGreaterThan(2);
      expect(PATHS.some((p) => p.id === l.path)).toBe(true);
    }
  });

  it("has valid quiz answers and unique question ids per lesson", () => {
    for (const l of LESSONS) {
      expect(new Set(l.quiz.map((q) => q.id)).size).toBe(l.quiz.length);
      for (const q of l.quiz) {
        expect(q.answer).toBeGreaterThanOrEqual(0);
        expect(q.answer).toBeLessThan(q.options.length);
        expect(new Set(q.options).size).toBe(q.options.length);
        expect(q.explain.length).toBeGreaterThan(5);
      }
    }
  });

  it("keeps every path non-empty and contiguous in lesson order", () => {
    for (const p of PATHS) expect(lessonsInPath(p.id).length).toBeGreaterThan(0);
    const order = LESSONS.map((l) => l.path);
    const seen = new Set<string>();
    for (let i = 0; i < order.length; i++) {
      if (i > 0 && order[i] !== order[i - 1]) {
        expect(seen.has(order[i])).toBe(false);
      }
      seen.add(order[i]);
    }
  });

  it("lists sims and metrics consistent with its blocks", () => {
    for (const l of LESSONS) {
      const simBlocks = l.blocks.filter((b) => b.kind === "sim").map((b) => (b.kind === "sim" ? b.sim : ""));
      for (const s of simBlocks) expect(l.sims).toContain(s);
      for (const b of l.blocks) if (b.kind === "metrics") for (const m of b.metrics) expect(METRICS[m]).toBeDefined();
    }
  });

  it("includes the risk-disclosure lesson with a SEBI citation", () => {
    const l = getLesson("risk-disclosure");
    expect(l).toBeDefined();
    const sources = l?.blocks.filter((b) => b.kind === "source") ?? [];
    expect(sources.length).toBeGreaterThan(0);
    for (const s of sources) if (s.kind === "source") expect(s.href).toMatch(/^https:\/\/www\.sebi\.gov\.in\//);
  });

  it("navigates between adjacent lessons", () => {
    const first = LESSONS[0].slug;
    expect(adjacentLessons(first).prev).toBeUndefined();
    expect(adjacentLessons(first).next?.slug).toBe(LESSONS[1].slug);
    expect(adjacentLessons(LESSONS[LESSONS.length - 1].slug).next).toBeUndefined();
    expect(adjacentLessons("missing")).toEqual({});
    expect(getLesson(undefined)).toBeUndefined();
  });
});

describe("glossary", () => {
  it("has unique terms whose links resolve", () => {
    expect(GLOSSARY.length).toBeGreaterThanOrEqual(50);
    expect(new Set(GLOSSARY.map((t) => t.term)).size).toBe(GLOSSARY.length);
    for (const t of GLOSSARY) {
      if (t.lessonSlug) expect(getLesson(t.lessonSlug), t.term).toBeDefined();
      if (t.metric) expect(METRICS[t.metric]).toBeDefined();
    }
  });

  it("ranks exact and alias matches first", () => {
    expect(searchGlossary("pcr")[0].term).toBe("Put-call ratio (PCR)");
    expect(searchGlossary("STT")[0].metric).toBe("stt");
    expect(searchGlossary("time decay")[0].term).toBe("Theta");
    expect(searchGlossary("zzzz")).toEqual([]);
    expect(searchGlossary("").length).toBe(GLOSSARY.length);
  });

  it("finds terms through definitions", () => {
    expect(searchGlossary("delivery").map((t) => t.term)).toContain("Physical settlement");
  });

  it("groups by first letter", () => {
    expect(glossaryLetter("theta")).toBe("T");
    expect(glossaryLetter("25-delta")).toBe("#");
  });
});

describe("progress", () => {
  it("parses junk safely", () => {
    expect(parseProgress("not json")).toEqual(EMPTY_PROGRESS);
    expect(parseProgress(null)).toEqual(EMPTY_PROGRESS);
    expect(parseProgress([1, 2])).toEqual(EMPTY_PROGRESS);
    const p = parseProgress({ completed: { a: "2026-01-01", b: 5 }, quiz: { a: { best: 9, total: 3, attempts: 0 }, b: { best: 1, total: 0 } }, lastSlug: "a" });
    expect(p.completed).toEqual({ a: "2026-01-01" });
    expect(p.quiz.a).toEqual({ best: 3, total: 3, attempts: 1, lastAt: "" });
    expect(p.quiz.b).toBeUndefined();
    expect(p.lastSlug).toBe("a");
  });

  it("records quizzes, keeps the best score and completes on a pass", () => {
    let p = recordQuiz(EMPTY_PROGRESS, "x", 1, 3, "t1");
    expect(p.completed.x).toBeUndefined();
    expect(p.quiz.x).toEqual({ best: 1, total: 3, attempts: 1, lastAt: "t1" });
    p = recordQuiz(p, "x", 2, 3, "t2");
    expect(p.completed.x).toBe("t2");
    p = recordQuiz(p, "x", 0, 3, "t3");
    expect(p.quiz.x.best).toBe(2);
    expect(p.quiz.x.attempts).toBe(3);
    expect(p.completed.x).toBe("t2");
    expect(recordQuiz(p, "x", 1, 0)).toBe(p);
    expect(quizPassed(2, 3)).toBe(true);
    expect(quizPassed(1, 3)).toBe(false);
    expect(quizPassed(3, 5)).toBe(true);
    expect(quizPassed(0, 0)).toBe(false);
  });

  it("marks, unmarks and computes stats immutably", () => {
    const a = markComplete(EMPTY_PROGRESS, "a", "t");
    expect(EMPTY_PROGRESS.completed).toEqual({});
    expect(markComplete(a, "a")).toBe(a);
    expect(completionStats(a, ["a", "b"])).toEqual({ done: 1, total: 2, pct: 50 });
    expect(completionStats(a, [])).toEqual({ done: 0, total: 0, pct: 0 });
    const b = markIncomplete(a, "a");
    expect(b.completed).toEqual({});
    expect(markIncomplete(b, "a")).toBe(b);
    expect(setLastLesson(b, "z").lastSlug).toBe("z");
  });

  it("chooses the next lesson to continue", () => {
    const order = ["a", "b", "c"];
    expect(nextLessonSlug(EMPTY_PROGRESS, order)).toBe("a");
    let p = setLastLesson(EMPTY_PROGRESS, "b");
    expect(nextLessonSlug(p, order)).toBe("b");
    p = markComplete(p, "b");
    expect(nextLessonSlug(p, order)).toBe("c");
    p = markComplete(markComplete(p, "c"), "a");
    expect(nextLessonSlug(p, order)).toBeUndefined();
    expect(nextLessonSlug(EMPTY_PROGRESS, [])).toBeUndefined();
  });

  it("round-trips through storage and survives storage errors", () => {
    const mem = new Map<string, string>();
    const storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
    const p = recordQuiz(EMPTY_PROGRESS, "a", 3, 3, "t");
    expect(saveProgress(p, storage)).toBe(true);
    expect(mem.has(PROGRESS_STORAGE_KEY)).toBe(true);
    expect(loadProgress(storage)).toEqual(p);
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("quota");
      },
    };
    expect(loadProgress(broken)).toEqual(EMPTY_PROGRESS);
    expect(saveProgress(p, broken)).toBe(false);
  });
});
