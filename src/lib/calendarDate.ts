/**
 * Calendar-widget date helpers. Day pickers work in the browser's local time; the app works in
 * ISO calendar dates ("2026-10-20", IST). These convert between the two without any UTC shift.
 */

/** "2026-10-20" → local-midnight Date for a calendar widget; null when invalid. */
export function isoToCalendarDate(iso: string | undefined | null): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? "");
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.getFullYear() === Number(m[1]) && d.getMonth() === Number(m[2]) - 1 && d.getDate() === Number(m[3]) ? d : null;
}

/** Local calendar Date → "2026-10-20" (the calendar date the user picked). */
export function calendarDateToIso(d: Date | undefined | null): string {
  if (!d || !Number.isFinite(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
