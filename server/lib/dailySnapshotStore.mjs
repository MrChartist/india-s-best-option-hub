/**
 * Generic disk-persisted daily numeric snapshot store — one value per
 * (namespace, key, calendar day). Backs day-over-day deltas (currently:
 * futures OI change) from real accumulated history. Never invents a value
 * for a day we didn't actually record — callers get `null` until a prior
 * day's snapshot genuinely exists.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SNAPSHOT_DIR = resolve(__dirname, "../../.cache/snapshots");

function todayIST() {
  // NSE trading day — anchor to IST so a snapshot taken near UTC midnight still
  // lands on the correct trading date.
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }); // YYYY-MM-DD
}

function filePathFor(namespace, key) {
  const safeKey = key.replace(/[^a-zA-Z0-9_-]/g, "_");
  const dir = join(SNAPSHOT_DIR, namespace);
  try { mkdirSync(dir, { recursive: true }); } catch { /* ignore */ }
  return join(dir, `${safeKey}.json`);
}

function readSeries(namespace, key) {
  try {
    const raw = readFileSync(filePathFor(namespace, key), "utf-8");
    const series = JSON.parse(raw);
    return Array.isArray(series) ? series : [];
  } catch {
    return [];
  }
}

/** Record today's value once — repeated calls the same trading day are a no-op. */
export function recordSnapshot(namespace, key, value) {
  if (!Number.isFinite(value)) return;
  const series = readSeries(namespace, key);
  const today = todayIST();
  if (series.length && series[series.length - 1].date === today) return;
  series.push({ date: today, value });
  const trimmed = series.slice(-400); // ~400 trading days — well past a year, no unbounded growth
  try { writeFileSync(filePathFor(namespace, key), JSON.stringify(trimmed), "utf-8"); } catch { /* best-effort */ }
}

/** Most recently recorded value strictly before today — the "yesterday's close" baseline. */
export function getPreviousValue(namespace, key) {
  const series = readSeries(namespace, key);
  const today = todayIST();
  for (let i = series.length - 1; i >= 0; i--) {
    if (series[i].date !== today) return series[i].value;
  }
  return null;
}

/** Full recorded series, oldest-first — empty array if nothing recorded yet. */
export function getSeries(namespace, key) {
  return readSeries(namespace, key);
}
