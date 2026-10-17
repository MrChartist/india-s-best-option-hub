/**
 * Relevance ranking for the command palette (Ctrl+K).
 *
 * cmdk's built-in scorer is a loose subsequence matcher and keeps items in
 * group order, so "gex" used to land on Events and "reliance" on OI Analysis.
 * This module ranks every entry (pages, indices, F&O stocks, actions) in one
 * flat list:
 *
 *   exact label / ticker            1000
 *   label prefix                     800  (ticker prefix 700)
 *   whole word in the label          650  (word prefix 500)
 *   exact keyword                    600 − keyword position
 *   label acronym ("oc" → Option Chain) 450
 *   keyword prefix                   400 − keyword position
 *   substring of label / keyword     250 / 200
 *   tight subsequence of the label   ≤ 120, dropped below SUBSEQ_MIN_RATIO
 *
 * Pure: no React, no DOM, so it is unit tested directly.
 */

export type PaletteEntryKind = "route" | "index" | "stock" | "action";

export interface PaletteEntry {
  /** Unique id, also used as the cmdk item value. */
  id: string;
  kind: PaletteEntryKind;
  /** Visible label (navLabel for pages, ticker for symbols). */
  label: string;
  /** Extra searchable text: route title, index long name. */
  alt?: string;
  keywords: readonly string[];
  /** Where Enter goes; undefined for actions handled by the caller. */
  path?: string;
  /** External URL opened in a new tab (actions that leave the app). */
  href?: string;
  /** Group heading shown next to the result. */
  group: string;
}

export interface ScoredEntry {
  entry: PaletteEntry;
  score: number;
}

const SUBSEQ_MIN_RATIO = 0.6;

function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

function words(s: string): string[] {
  return norm(s)
    .split(/[^a-z0-9&]+/)
    .filter(Boolean);
}

function compact(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9&]/g, "");
}

/** Score of `q` as a subsequence of `text`, by tightness (0 when absent or loose). */
function subsequenceScore(text: string, q: string): number {
  if (q.length < 2) return 0;
  let first = -1;
  let j = 0;
  for (let i = 0; i < text.length && j < q.length; i++) {
    if (text[i] === q[j]) {
      if (first < 0) first = i;
      j++;
      if (j === q.length) {
        const ratio = q.length / (i - first + 1);
        return ratio >= SUBSEQ_MIN_RATIO ? Math.round(120 * ratio) : 0;
      }
    }
  }
  return 0;
}

const isSymbol = (e: PaletteEntry) => e.kind === "index" || e.kind === "stock";

/** Score one entry against a single normalised query term (no spaces needed). */
function scoreTerm(entry: PaletteEntry, q: string): number {
  if (!q) return 0;
  const label = norm(entry.label);
  const labelCompact = compact(entry.label);
  const qCompact = compact(q);
  let best = 0;
  const take = (n: number) => {
    if (n > best) best = n;
  };

  if (label === q || (qCompact.length > 0 && labelCompact === qCompact)) take(1000);
  if (label.startsWith(q)) take(isSymbol(entry) ? 700 : 800);
  else if (qCompact.length >= 2 && labelCompact.startsWith(qCompact)) take(isSymbol(entry) ? 680 : 780);

  const labelWords = words(entry.label);
  const altWords = entry.alt ? words(entry.alt) : [];
  if (labelWords.includes(q)) take(650);
  else if (labelWords.some((w) => w.startsWith(q))) take(500);
  if (altWords.includes(q)) take(560);
  else if (altWords.some((w) => w.startsWith(q))) take(420);

  entry.keywords.forEach((kw, i) => {
    const k = norm(kw);
    if (k === q) take(600 - Math.min(i, 50));
    else if (k.startsWith(q)) take(400 - Math.min(i, 50));
    else if (q.length >= 3 && k.includes(q)) take(200 - Math.min(i, 50));
  });

  if (labelWords.length > 1 && q.length >= 2 && labelWords.map((w) => w[0]).join("") === qCompact) take(450);
  if (q.length >= 2 && label.includes(q)) take(250);
  if (entry.alt && q.length >= 3 && norm(entry.alt).includes(q)) take(220);
  take(subsequenceScore(labelCompact, qCompact));
  return best;
}

/** Relevance of an entry for a raw query; 0 means "do not show". */
export function scoreEntry(entry: PaletteEntry, rawQuery: string): number {
  const q = norm(rawQuery);
  if (!q) return 0;
  const whole = scoreTerm(entry, q);
  const terms = q.split(" ").filter(Boolean);
  if (terms.length < 2) return whole;
  // Multi-word query: every term has to match something; the weakest term sets the score.
  const perTerm = terms.map((t) => scoreTerm(entry, t));
  const all = perTerm.every((s) => s > 0) ? Math.round(Math.min(...perTerm) * 0.8) : 0;
  return Math.max(whole, all);
}

const KIND_ORDER: Record<PaletteEntryKind, number> = { route: 0, index: 1, stock: 2, action: 3 };

/** Rank entries for a query, best first. Ties keep pages ahead of symbols, then input order. */
export function rankEntries(entries: readonly PaletteEntry[], query: string, limit = 40): ScoredEntry[] {
  return entries
    .map((entry, i) => ({ entry, score: scoreEntry(entry, query), i }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || KIND_ORDER[a.entry.kind] - KIND_ORDER[b.entry.kind] || a.i - b.i)
    .slice(0, limit)
    .map(({ entry, score }) => ({ entry, score }));
}
