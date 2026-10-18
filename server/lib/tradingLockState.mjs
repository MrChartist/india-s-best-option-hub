/**
 * tradingLockState — the "am I even allowed to open a new position right
 * now" gate (1CLIQ-TRADE-SPEC.md §5), independent of the panic layer that
 * gets you OUT of positions.
 *
 * Five states: unlocked, locked-by-user, locked-by-mtm-loss,
 * locked-by-daily-loss-limit, locked-by-engine-fault. The two loss-triggered
 * states are deliberately hard to clear — spec: "the friction is the
 * product" — via requestUnlock()'s 10-minute cooling timer plus typing the
 * realised loss figure back. requestUnlock() is a PURE function: it takes
 * the elapsed cooling time and the typed/actual figures as plain arguments
 * and returns ok/false with a reason. It does not own a clock or a timer —
 * the caller (proxy-server.mjs, ultimately a UI countdown) is responsible
 * for actually measuring elapsed time and calling this once the trader
 * submits the unlock form.
 *
 * PERSISTENCE FAILS CLOSED. A lock you can clear with F5 is not a lock (spec
 * §5), so getLockState() treats a missing file, an unreadable file, corrupt
 * JSON, or a file that parses but names a state this module doesn't
 * recognise, ALL the same way: locked-by-engine-fault. This is deliberately
 * the strictest possible default — even a brand-new deployment with no lock
 * file yet reads as locked-by-engine-fault, not unlocked, until something
 * explicitly calls setLockState(). An engine that cannot even prove it isn't
 * mid-failure has no business defaulting to "go ahead, trade" (1CLIQ-TRADE
 * -SPEC.md §13 failure mode #6, "silent stale feed / dead engine while the
 * user believes they're armed").
 *
 * Panic controls (panicLayer.mjs's closeAll/cancelAll) intentionally never
 * import or check this module — a lock must never block getting OUT of
 * positions, only getting into new ones. That is enforced by omission: this
 * file has no notion of "block an exit", only of the lock's own state.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_LOCK_FILE = resolve(__dirname, "../../.cache/trading-lock.json");

// The one piece of module-level mutable state: which file reads/writes
// target. Tests redirect this to a scratch file so they never touch (or need
// to clean up) the real .cache/trading-lock.json.
let lockFilePath = DEFAULT_LOCK_FILE;

/** Test seam — redirect all reads/writes to a throwaway file. */
export function setLockFilePathForTests(path) {
  lockFilePath = path;
}

/** Test seam — restore the real .cache/trading-lock.json path. */
export function resetLockFilePathForTests() {
  lockFilePath = DEFAULT_LOCK_FILE;
}

export const LOCK_STATES = Object.freeze({
  UNLOCKED: "unlocked",
  LOCKED_BY_USER: "locked-by-user",
  LOCKED_BY_MTM_LOSS: "locked-by-mtm-loss",
  LOCKED_BY_DAILY_LOSS_LIMIT: "locked-by-daily-loss-limit",
  LOCKED_BY_ENGINE_FAULT: "locked-by-engine-fault",
});

const VALID_STATES = new Set(Object.values(LOCK_STATES));
const LOSS_TRIGGERED_STATES = new Set([LOCK_STATES.LOCKED_BY_MTM_LOSS, LOCK_STATES.LOCKED_BY_DAILY_LOSS_LIMIT]);

/** Loss-triggered locks need 10 minutes to cool off before they can even be attempted. */
export const COOLING_PERIOD_MS = 10 * 60 * 1000;

function failClosed(reason) {
  return { state: LOCK_STATES.LOCKED_BY_ENGINE_FAULT, since: null, meta: null, reason };
}

/**
 * Current lock state, read from disk. See the file header for why this
 * fails closed on anything short of a clean, recognised record.
 */
export function getLockState() {
  let raw;
  try {
    raw = readFileSync(lockFilePath, "utf-8");
  } catch {
    return failClosed("Lock file missing or unreadable.");
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return failClosed("Lock file is corrupt JSON.");
  }

  if (!parsed || typeof parsed !== "object" || !VALID_STATES.has(parsed.state)) {
    return failClosed("Lock file does not contain a recognised state.");
  }

  return {
    state: parsed.state,
    since: Number.isFinite(parsed.since) ? parsed.since : null,
    meta: parsed.meta === undefined ? null : parsed.meta,
  };
}

/**
 * Persist a new lock state. Throws on an unrecognised state name rather than
 * writing it — a bad write here is exactly what getLockState()'s fail-closed
 * read is guarding against, so this side must never produce one.
 */
export function setLockState(state, meta = null, now = Date.now()) {
  if (!VALID_STATES.has(state)) throw new Error(`Unknown trading lock state: ${state}`);
  const record = { state, since: now, meta };
  mkdirSync(dirname(lockFilePath), { recursive: true });
  writeFileSync(lockFilePath, JSON.stringify(record), "utf-8");
  return record;
}

/** Strip currency symbols/commas/whitespace and parse to a rupee figure, rounded to paise. */
function normaliseFigure(value) {
  if (typeof value === "number") return Number.isFinite(value) ? Math.round(value * 100) / 100 : null;
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/[₹,\s]/g, "");
  if (!cleaned || !/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  return Math.round(parseFloat(cleaned) * 100) / 100;
}

/**
 * Pure eligibility check for clearing a lock — no timer, no disk I/O. The
 * caller measures `coolingElapsedMs` itself (time since the lock was set)
 * and passes it in; this function only judges whether that is enough,
 * together with the typed-figure match, per spec §5.
 *
 * `unlocked` and `locked-by-user` clear with no friction — the cooling
 * timer + typed-figure ritual is specifically for the two LOSS-triggered
 * states (spec: "the friction is the product"). `locked-by-engine-fault`
 * cannot be cleared through this path at all: it means the engine itself
 * couldn't prove its own state, which needs an operator fix (and a fresh
 * setLockState() call), not a trader ritual.
 *
 * @returns {{ok:true}|{ok:false, reason:string}}
 */
export function requestUnlock(currentState, typedFigure, actualRealisedLoss, coolingElapsedMs, requiredCoolingMs = COOLING_PERIOD_MS) {
  if (currentState === LOCK_STATES.UNLOCKED || currentState === LOCK_STATES.LOCKED_BY_USER) {
    return { ok: true };
  }
  if (!LOSS_TRIGGERED_STATES.has(currentState)) {
    return { ok: false, reason: `${currentState} cannot be cleared with requestUnlock — it needs operator intervention.` };
  }

  const elapsed = Number.isFinite(coolingElapsedMs) ? coolingElapsedMs : 0;
  if (elapsed < requiredCoolingMs) {
    const remainingMs = requiredCoolingMs - elapsed;
    return { ok: false, reason: `Cooling period not elapsed — ${Math.ceil(remainingMs / 1000)}s remaining.` };
  }

  const typed = normaliseFigure(typedFigure);
  const actual = normaliseFigure(actualRealisedLoss);
  if (typed === null || actual === null || typed !== actual) {
    return { ok: false, reason: "Typed figure does not match the realised loss — unlock refused." };
  }

  return { ok: true };
}
