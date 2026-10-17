/**
 * Journal persistence in this browser ("mc_journal_v1"): imported fills plus tags and notes per round
 * trip. Every read and write is guarded (private mode or a full quota never throws).
 */
import { isValidIsoDate } from "@/lib/options";
import type { Annotation, JournalFill, JournalSource } from "./types";

export const JOURNAL_KEY = "mc_journal_v1";

export interface JournalState {
  version: 1;
  /** Imported broker fills (paper fills are read live from the paper account, not stored here). */
  fills: JournalFill[];
  /** Tags and notes keyed by round-trip id. */
  annotations: Record<string, Annotation>;
  /** Which feed the page shows. */
  view: "imported" | "paper" | "sample";
  assumeExpiredWorthless: boolean;
  updatedAt: number;
}

export function emptyJournal(): JournalState {
  return { version: 1, fills: [], annotations: {}, view: "sample", assumeExpiredWorthless: true, updatedAt: 0 };
}

const SOURCES: JournalSource[] = ["zerodha", "dhan", "upstox", "angel", "paper", "sample"];
const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

export function validFill(x: unknown): x is JournalFill {
  if (!x || typeof x !== "object") return false;
  const f = x as Record<string, unknown>;
  return (
    typeof f.id === "string" &&
    SOURCES.includes(f.source as JournalSource) &&
    typeof f.underlying === "string" &&
    typeof f.expiry === "string" &&
    isValidIsoDate(f.expiry) &&
    isNum(f.strike) &&
    (f.type === "CE" || f.type === "PE" || f.type === "FUT") &&
    (f.side === "BUY" || f.side === "SELL") &&
    isNum(f.qty) &&
    f.qty > 0 &&
    isNum(f.price) &&
    typeof f.date === "string" &&
    isValidIsoDate(f.date) &&
    (f.ts === null || isNum(f.ts))
  );
}

export function parseJournal(raw: string | null): JournalState {
  if (!raw) return emptyJournal();
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    if (!o || o.version !== 1) return emptyJournal();
    const ann: Record<string, Annotation> = {};
    if (o.annotations && typeof o.annotations === "object") {
      for (const [k, v] of Object.entries(o.annotations as Record<string, unknown>)) {
        const a = v as Record<string, unknown> | null;
        if (!a) continue;
        const tags = Array.isArray(a.tags) ? a.tags.filter((t): t is string => typeof t === "string").map((t) => t.trim()).filter(Boolean).slice(0, 12) : [];
        const note = typeof a.note === "string" ? a.note.slice(0, 2000) : "";
        if (tags.length || note) ann[k] = { tags, note };
      }
    }
    return {
      version: 1,
      fills: Array.isArray(o.fills) ? o.fills.filter(validFill) : [],
      annotations: ann,
      view: o.view === "imported" || o.view === "paper" || o.view === "sample" ? o.view : "sample",
      assumeExpiredWorthless: o.assumeExpiredWorthless !== false,
      updatedAt: isNum(o.updatedAt) ? o.updatedAt : 0,
    };
  } catch {
    return emptyJournal();
  }
}

export function loadJournal(): JournalState {
  try {
    return parseJournal(localStorage.getItem(JOURNAL_KEY));
  } catch {
    return emptyJournal();
  }
}

export function saveJournal(s: JournalState): boolean {
  try {
    localStorage.setItem(JOURNAL_KEY, JSON.stringify(s));
    return true;
  } catch {
    return false;
  }
}

/** Merge new fills into existing ones, skipping ids already present. */
export function mergeFills(current: JournalFill[], incoming: JournalFill[]): { fills: JournalFill[]; added: number; duplicates: number } {
  const ids = new Set(current.map((f) => f.id));
  const out = [...current];
  let added = 0;
  let duplicates = 0;
  for (const f of incoming) {
    if (ids.has(f.id)) duplicates++;
    else {
      ids.add(f.id);
      out.push(f);
      added++;
    }
  }
  return { fills: out, added, duplicates };
}

/** Normalise a free-text tag list ("expiry, scalp , revenge") into unique tags. */
export function parseTags(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of text.split(/[,#\n]/)) {
    const v = t.trim().replace(/\s+/g, " ").slice(0, 32);
    const k = v.toLowerCase();
    if (v && !seen.has(k)) {
      seen.add(k);
      out.push(v);
    }
  }
  return out.slice(0, 12);
}
