/**
 * In-memory record of which rule last showed an alert, and where. The Option Chain page evaluates
 * strike rules on its own polls while the background runner evaluates the same rules; each checks
 * here first so one crossing produces one toast, whichever surface sees it first.
 */
const delivered = new Map<string, { at: number; by: string }>();

/** Window inside which a second surface treats the alert as already shown. */
export const DELIVERY_DEDUPE_MS = 2 * 60_000;

export function markDelivered(ruleId: string, by: string, at: number = Date.now()): void {
  delivered.set(ruleId, { at, by });
  if (delivered.size > 500) {
    const oldest = [...delivered.entries()].sort((a, b) => a[1].at - b[1].at).slice(0, 100);
    for (const [k] of oldest) delivered.delete(k);
  }
}

/** The surface that showed this rule within the window, or null. */
export function deliveredBy(
  ruleId: string,
  now: number = Date.now(),
  windowMs: number = DELIVERY_DEDUPE_MS,
): string | null {
  const d = delivered.get(ruleId);
  return d && now - d.at < windowMs ? d.by : null;
}

export function resetDeliveryRegistry(): void {
  delivered.clear();
}
