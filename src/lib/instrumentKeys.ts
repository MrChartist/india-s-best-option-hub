/**
 * Instrument identity for the market feed.
 *
 * securityId is only unique WITHIN an exchange segment. IDX_I 25 is the NIFTY
 * BANK index; NSE_FNO 25 is an unrelated contract. Keying tick caches by
 * securityId alone let one overwrite the other, and the index spot price is
 * exactly what a spot-referenced stop-loss reads.
 *
 * Pure module (no browser APIs). The key format and the index ids are shared
 * with websocketClient.ts and proxy-server.mjs (`SEGMENT:securityId`, Dhan
 * IDX_I ids verified against the Dhan scrip master); keep the three in step.
 */

/** Dhan v2 exchange segments, spelled exactly as proxy-server.mjs accepts them. */
export type ExchangeSegment =
  | "IDX_I" | "NSE_EQ" | "NSE_FNO" | "NSE_CURRENCY"
  | "BSE_EQ" | "BSE_FNO" | "BSE_CURRENCY" | "MCX_COMM";

export interface InstrumentRef {
  exchangeSegment: ExchangeSegment;
  securityId: string | number;
}

/** The canonical cache/subscription key. Must match the server's key. */
export function tickKey(exchangeSegment: string, securityId: string | number): string {
  return `${exchangeSegment}:${securityId}`;
}

/** Index ids, which always live in IDX_I (Dhan scrip master). */
export const SYMBOL_TO_SECURITY_ID: Record<string, number> = {
  NIFTY: 13,
  BANKNIFTY: 25,
  FINNIFTY: 27,
  MIDCPNIFTY: 442,
  INDIAVIX: 21,
  SENSEX: 51,
  BANKEX: 69,
};

export const SECURITY_ID_TO_SYMBOL: Record<number, string> = Object.fromEntries(
  Object.entries(SYMBOL_TO_SECURITY_ID).map(([sym, id]) => [id, sym]),
);

/** Tick key for an index symbol, or null for anything that is not a known index. */
export function indexKey(symbol: string): string | null {
  const id = SYMBOL_TO_SECURITY_ID[symbol.toUpperCase()];
  return id ? tickKey("IDX_I", id) : null;
}

/** The proxy's wire format for a subscribe/unsubscribe message. */
export function toWireInstrument(ref: InstrumentRef) {
  return { ExchangeSegment: ref.exchangeSegment, SecurityId: String(ref.securityId) };
}
