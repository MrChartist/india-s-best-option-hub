/**
 * Append-only audit trail for live-trading intents and their events.
 *
 * This is the server-side half of the audit log described in
 * 1CLIQ-TRADE-SPEC.md §7: every keypress mints an intentId, and "what
 * happened at 14:32" = filter by timestamp, group by intentId, read the
 * chain from keypress to fill. That reconstruction only works if the
 * underlying file is a true append log — no line already on disk may ever
 * move or be rewritten once another line has followed it.
 *
 * server/lib/dailySnapshotStore.mjs looks similar at a glance (also
 * disk-persisted, also keyed by IST calendar day) but its recordSnapshot()
 * reads the WHOLE series, pushes one value, and calls writeFileSync on the
 * WHOLE array. That is correct for "one number per day" and wrong for an
 * event log: a whole-file rewrite is a window where a crash mid-write loses
 * every prior event, not just the new one. This module is a sibling with
 * different semantics, not a reuse of it — every call here is exactly one
 * fs.appendFileSync of one line, and nothing already on disk is read back in
 * before writing.
 *
 * The in-app viewer this feeds is meant to also keep an IndexedDB mirror on
 * the client for instant, offline-tolerant reads. That mirror is a
 * browser-side concern for a later UI-integration stage — there is no
 * client-side code in this file. This module only owns the authoritative,
 * server-side copy on disk.
 */

import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_AUDIT_DIR = resolve(__dirname, "../../.cache/audit");

// The one piece of module-level mutable state: which directory reads/writes
// target. Defaults to the real .cache/audit; tests redirect it to a scratch
// temp directory so they never touch (or need to clean up) the real log.
let auditDir = DEFAULT_AUDIT_DIR;

/** Test seam — redirect all reads/writes to a throwaway directory. */
export function setAuditDirForTests(dir) {
  auditDir = dir;
}

/** Test seam — restore the real .cache/audit path. */
export function resetAuditDirForTests() {
  auditDir = DEFAULT_AUDIT_DIR;
}

// "en-CA" formats as YYYY-MM-DD directly — the same trick dailySnapshotStore
// uses via toLocaleDateString. Building it once and reusing the formatter is
// just an allocation saving; the function below is still pure in its output.
const IST_DAY_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Kolkata",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * A timestamp's IST (UTC+5:30) calendar day, as "YYYY-MM-DD".
 *
 * IST has no DST and a fixed +5:30 offset, so the one subtlety is that IST
 * midnight falls at 18:30 UTC on the *previous* UTC calendar date — a trade
 * at 23:45 UTC is already tomorrow in IST, and a trade at 18:29 UTC is still
 * "today". Delegating to Intl's Asia/Kolkata rules (rather than hand-rolling
 * a +5.5h shift with Date math, which is exactly the kind of arithmetic that
 * grows an off-by-one at a boundary like this) keeps that boundary correct.
 */
export function istDayKey(date = new Date()) {
  return IST_DAY_FORMATTER.format(date);
}

function auditFilePath(dayKey) {
  return join(auditDir, `${dayKey}.ndjson`);
}

/**
 * Append one event to the current IST day's NDJSON file, creating the
 * directory and file on first use. This only ever grows the file from the
 * end (fs.appendFileSync) — prior lines are never read, reformatted, or
 * rewritten.
 *
 * `event` carries at minimum {ts, intentId, type, payload} (1CLIQ-TRADE-SPEC
 * §7): intentId is what lets a later viewer group "keypress -> validate ->
 * submit -> fill" into one chain, and ts (defaulting to now if omitted) is
 * what buckets the line into the correct IST day. `payload` defaults to
 * null so every line has a stable shape even for payload-less events (e.g.
 * a disarm).
 */
export function appendAuditEvent(event) {
  if (!event || typeof event !== "object") {
    throw new Error("appendAuditEvent requires an event object");
  }
  if (!event.intentId) throw new Error("appendAuditEvent requires event.intentId");
  if (!event.type) throw new Error("appendAuditEvent requires event.type");

  const ts = Number.isFinite(event.ts) ? event.ts : Date.now();
  const record = { ...event, ts, payload: event.payload === undefined ? null : event.payload };

  mkdirSync(auditDir, { recursive: true });
  appendFileSync(auditFilePath(istDayKey(new Date(ts))), `${JSON.stringify(record)}\n`, "utf-8");
}

/**
 * Parsed events for one IST calendar day ("YYYY-MM-DD"), oldest first —
 * feeds the in-app audit viewer. Returns [] when that day has no file yet
 * (the common case: nothing happened, or the process never ran that day)
 * rather than throwing. Any other read failure (permissions, a corrupted
 * line) is a real problem for an authoritative log and is allowed to throw
 * rather than being silently reported as "no events".
 */
export function readAuditEventsForDay(isoDate) {
  let raw;
  try {
    raw = readFileSync(auditFilePath(isoDate), "utf-8");
  } catch (e) {
    if (e && e.code === "ENOENT") return [];
    throw e;
  }
  return raw
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line));
}
