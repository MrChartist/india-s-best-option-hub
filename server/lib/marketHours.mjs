/**
 * Indian market session clock, in IST regardless of where the host runs.
 *
 * The existing client-side check in src/hooks/useMarketData.ts uses the browser's
 * local clock, which is wrong on any non-IST machine — including a VPS in a
 * different region, which is exactly where this proxy is meant to be deployed
 * (Dhan's order APIs need a whitelisted static IP). Session state gates real
 * orders and arms stop-losses, so it is computed here from Asia/Kolkata parts.
 */

const IST_PARTS = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Kolkata",
  weekday: "short",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

const PRE_OPEN_START = 9 * 60;      // 09:00
const REGULAR_START = 9 * 60 + 15;  // 09:15
const REGULAR_END = 15 * 60 + 30;   // 15:30

/** Break a Date into IST calendar parts. */
export function istParts(date = new Date()) {
  const parts = Object.fromEntries(
    IST_PARTS.formatToParts(date).filter((p) => p.type !== "literal").map((p) => [p.type, p.value]),
  );
  return {
    weekday: parts.weekday,
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
    minutesOfDay: Number(parts.hour) * 60 + Number(parts.minute),
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
  };
}

/**
 * Special trading sessions (Muhurat, and any exchange-announced session) cannot
 * be derived from a calendar — NSE announces them, and the window differs each
 * year. Rather than guess, the operator supplies them; an empty list simply
 * means those days behave as closed.
 *
 * Keys are the zero-padded IST date, exactly as istParts().dateKey produces it:
 * "YYYY-MM-DD". "2026-11-8" will silently never match.
 *
 * Shape: { "2026-11-08": { startMinute: 1110, endMinute: 1170, label: "Muhurat" } }
 * (startMinute/endMinute are minutes past IST midnight — 1110 = 18:30.)
 */
let specialSessions = {};

export function setSpecialSessions(sessions) {
  specialSessions = sessions && typeof sessions === "object" ? sessions : {};
}

/** Weekend check in IST. Exchange holidays are NOT covered — see note below. */
function isWeekend(parts) {
  return parts.weekday === "Sat" || parts.weekday === "Sun";
}

/**
 * Current session state.
 *
 * NOTE ON HOLIDAYS: this does not know the NSE trading-holiday calendar, so on a
 * holiday it will report OPEN during regular hours. That is deliberate — a wrong
 * hardcoded holiday list is worse than none. The live guard against acting on a
 * closed market is the tick-freshness check (see requireFreshTick): on a holiday
 * no ticks arrive, so nothing arms and nothing fires.
 *
 * @returns {{ state: "CLOSED"|"PRE_OPEN"|"OPEN"|"SPECIAL", label: string, ist: object }}
 */
export function marketSession(date = new Date()) {
  const ist = istParts(date);

  const special = specialSessions[ist.dateKey];
  if (special) {
    const inWindow = ist.minutesOfDay >= special.startMinute && ist.minutesOfDay < special.endMinute;
    return {
      state: inWindow ? "SPECIAL" : "CLOSED",
      label: inWindow ? (special.label || "Special session") : `${special.label || "Special session"} not open yet`,
      ist,
    };
  }

  if (isWeekend(ist)) return { state: "CLOSED", label: "Weekend", ist };

  if (ist.minutesOfDay >= REGULAR_START && ist.minutesOfDay < REGULAR_END) {
    return { state: "OPEN", label: "Regular session", ist };
  }
  if (ist.minutesOfDay >= PRE_OPEN_START && ist.minutesOfDay < REGULAR_START) {
    return { state: "PRE_OPEN", label: "Pre-open (09:00–09:15) — no orders", ist };
  }
  return { state: "CLOSED", label: "Market closed (09:15–15:30 IST)", ist };
}

/** Can a real order be placed right now? Pre-open is explicitly excluded. */
export function isTradeable(date = new Date()) {
  const { state } = marketSession(date);
  return state === "OPEN" || state === "SPECIAL";
}

/** Minutes until the regular session closes; negative once it has. */
export function minutesToClose(date = new Date()) {
  return REGULAR_END - istParts(date).minutesOfDay;
}

/**
 * Is a tick recent enough, AND from inside today's session, to act on?
 *
 * This is what stops a stop-loss firing at 09:14 against yesterday's close: the
 * cached LTP is real, but its exchange timestamp is from the previous session.
 *
 * @param {number} lttEpochSeconds exchange last-traded time from the feed
 * @param {number} receivedAtMs when the proxy received the tick
 * @param {number} maxAgeMs staleness ceiling (default 5s)
 */
export function requireFreshTick(lttEpochSeconds, receivedAtMs, maxAgeMs = 5000, now = Date.now()) {
  if (!Number.isFinite(receivedAtMs) || now - receivedAtMs > maxAgeMs) {
    return { ok: false, reason: "STALE_FEED" };
  }
  if (!isTradeable(new Date(now))) {
    return { ok: false, reason: "MARKET_CLOSED" };
  }
  if (Number.isFinite(lttEpochSeconds) && lttEpochSeconds > 0) {
    const tickDay = istParts(new Date(lttEpochSeconds * 1000)).dateKey;
    if (tickDay !== istParts(new Date(now)).dateKey) {
      return { ok: false, reason: "TICK_FROM_PREVIOUS_SESSION" };
    }
  }
  return { ok: true, reason: null };
}
