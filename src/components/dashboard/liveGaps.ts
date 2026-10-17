/**
 * What the dashboard still cannot show without live data, after the labelled sample fallbacks.
 * Whole sections with nothing to show move out of the main flow, and every gap (section or
 * single item) is listed once in the compact "Needs live data" strip below the populated sections.
 */
import type { SectionId } from "./dashboardModel";

/** "gift", "pcrPrev", "maxPainPrev", "section:<id>" or "brief:<line>". */
export type GapKey = string;

export interface LiveGap {
  key: GapKey;
  label: string;
  /** Page where the item lives once data arrives. */
  to?: string;
}

export interface GapInputs {
  /** GIFT Nifty quote available. */
  gift: boolean;
  /** A previous-session PCR is recorded locally (for the day-over-day arrow). */
  pcrPrev: boolean;
  /** A previous-session max pain is recorded locally (for the max pain shift). */
  maxPainPrev: boolean;
  /** Sections whose data hooks finished with nothing to show, even after the sample fallback. */
  emptySections?: ReadonlyArray<{ id: SectionId; title: string }>;
}

/** Ordered list of gaps for the strip. Item gaps first, then whole sections. */
export function collectLiveGaps(i: GapInputs): LiveGap[] {
  const gaps: LiveGap[] = [];
  if (!i.gift) gaps.push({ key: "gift", label: "GIFT Nifty" });
  if (!i.pcrPrev) gaps.push({ key: "pcrPrev", label: "PCR vs previous close", to: "/max-pain-pcr?symbol=NIFTY" });
  if (!i.maxPainPrev) gaps.push({ key: "maxPainPrev", label: "Max pain shift", to: "/max-pain-pcr?symbol=NIFTY" });
  for (const s of i.emptySections ?? []) gaps.push({ key: `section:${s.id}`, label: s.title });
  return gaps;
}

/**
 * Split the visible sections into those with something to show (in the saved order) and those
 * that are empty. Empty sections are not rendered as blank cards; the strip names them instead.
 */
export function partitionSections(visible: readonly SectionId[], empty: ReadonlySet<SectionId>): { populated: SectionId[]; empty: SectionId[] } {
  const populated: SectionId[] = [];
  const out: SectionId[] = [];
  for (const id of visible) (empty.has(id) ? out : populated).push(id);
  return { populated, empty: out };
}
