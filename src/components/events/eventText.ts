/** Plain-text helpers for event labels (kept out of component files for fast refresh). */
import { calendarDaysBetween, formatDateIST, isoWeekday } from "@/lib/options";
import type { MarketEvent } from "@/lib/events";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "Mon, 19 Oct 2026". */
export function dayLabel(date: string): string {
  return `${WEEKDAYS[isoWeekday(date)] ?? ""}, ${formatDateIST(date)}`;
}

/** "Today", "Tomorrow", "In 3 days", "Yesterday", "5 days ago". */
export function relativeDay(date: string, today: string): string {
  const n = calendarDaysBetween(today, date);
  if (!Number.isFinite(n)) return "";
  if (n === 0) return "Today";
  if (n === 1) return "Tomorrow";
  if (n === -1) return "Yesterday";
  return n > 0 ? `In ${n} days` : `${-n} days ago`;
}

/** Short chip label: the stock for company events, the category otherwise. */
export function eventShortLabel(e: MarketEvent): string {
  if ((e.kind === "results" || e.kind === "corporate") && e.symbol) return e.symbol;
  if (e.kind === "expiry") return e.title.replace(/ expiry.*$/i, "").replace(/^NSE monthly F&O$/, "NSE monthly");
  return e.category;
}

/** Provenance words for screen readers and tooltips. */
export function eventProvenance(e: MarketEvent): string[] {
  const out: string[] = [];
  if (e.source === "sample") out.push("Sample date");
  if (e.provisional) out.push("Provisional");
  else if (e.verify) out.push("Verify date");
  return out;
}
