/**
 * Instrument identity for the market feed.
 *
 * securityId is only unique WITHIN an exchange segment. IDX_I 25 is the NIFTY
 * BANK index; NSE_FNO 25 is an unrelated contract. Keying tick caches by
 * securityId alone let one overwrite the other — and the index spot price is
 * exactly what a spot-referenced stop-loss reads.
 *
 * Mirrors server/lib/dhanPacketParser.mjs; the two must agree on key format.
 */

export type ExchangeSegment =
  | "IDX_I" | "NSE_EQ" | "NSE_FNO" | "NSE_CUR"
  | "BSE_EQ" | "BSE_FNO" | "BSE_CUR" | "MCX_COMM";

export interface InstrumentRef {
  exchangeSegment: ExchangeSegment;
  securityId: string | number;
}

/** The canonical cache/subscription key. Must match the server's tickKey(). */
export function tickKey(exchangeSegment: string, securityId: string | number): string {
  return `${exchangeSegment}:${securityId}`;
}

/** Convenience for the index set, which always lives in IDX_I. */
export const SYMBOL_TO_SECURITY_ID: Record<string, number> = {
  NIFTY: 13,
  BANKNIFTY: 25,
  FINNIFTY: 27,
  MIDCPNIFTY: 442,
  INDIAVIX: 26,
  SENSEX: 1,
};

export const SECURITY_ID_TO_SYMBOL: Record<number, string> = Object.fromEntries(
  Object.entries(SYMBOL_TO_SECURITY_ID).map(([sym, id]) => [id, sym]),
);

/** Key for a named index. */
export function indexKey(symbol: string): string | null {
  const id = SYMBOL_TO_SECURITY_ID[symbol];
  return id ? tickKey("IDX_I", id) : null;
}

/** Wire shape the proxy and Dhan both expect for subscribe/unsubscribe. */
export function toWireInstrument(ref: InstrumentRef) {
  return { ExchangeSegment: ref.exchangeSegment, SecurityId: String(ref.securityId) };
}
