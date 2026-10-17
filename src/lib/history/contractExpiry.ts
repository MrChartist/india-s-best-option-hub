/**
 * Validate a /contract link's expiry against the symbol's expiry calendar (SEBI weekday rules with
 * the NSE holiday shift), so the page never fabricates live quotes for a date that was never listed
 * or has already settled.
 */
import { getContractSpec, isMonthlyExpiry, isTradingDay, isValidIsoDate, isWeeklyExpiry, toISTDate, tradingDayOnOrBefore } from "@/lib/options";

export type ContractExpiryCheck =
  /** A listed expiry that has not settled yet. */
  | { kind: "listed" }
  /** Settled: 15:30 IST on the expiry date has passed. */
  | { kind: "expired" }
  /** The date is a holiday or weekend and the contract expires on `to` instead. */
  | { kind: "shifted"; to: string }
  /** Not an expiry date for this symbol. */
  | { kind: "unlisted" };

const isExpiryDate = (symbol: string, iso: string) => isWeeklyExpiry(symbol, iso) || isMonthlyExpiry(symbol, iso);

/**
 * Classify `expiry` for `symbol` at `now`. Symbols without a contract spec (the calendar cannot
 * know their rules) are treated as listed unless the date has passed, so the live chain decides.
 */
export function checkContractExpiry(symbol: string, expiry: string, now: Date = new Date()): ContractExpiryCheck {
  if (!isValidIsoDate(expiry)) return { kind: "unlisted" };
  const known = !!getContractSpec(symbol);
  if (known && !isTradingDay(expiry)) {
    const to = tradingDayOnOrBefore(expiry);
    if (to && to !== expiry && isExpiryDate(symbol, to)) {
      return toISTDate(to, "15:30").getTime() <= now.getTime() ? { kind: "expired" } : { kind: "shifted", to };
    }
    return { kind: "unlisted" };
  }
  if (toISTDate(expiry, "15:30").getTime() <= now.getTime()) return { kind: "expired" };
  if (known && !isExpiryDate(symbol, expiry)) return { kind: "unlisted" };
  return { kind: "listed" };
}
