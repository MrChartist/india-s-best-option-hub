/**
 * Zerodha Kite Connect v3 adapter.
 *
 * Status: SCAFFOLDED. Real implementation lands in brokers/kite/rest.mjs and
 * brokers/kite/ws.mjs (loaded lazily so an unused stub doesn't import network code).
 */
import { handleRequest } from "./rest.mjs";
import { openWebSocket } from "./ws.mjs";
import { resolveInstrumentToken } from "./instruments.mjs";

/** @type {import("../types.mjs").BrokerAdapter} */
export const kiteAdapter = {
  id: "kite",
  name: "Zerodha (Kite)",
  capabilities: {
    hasOptionChain: true,        // composed from instruments + /quote
    hasNativeGreeks: false,      // computed via BSM in proxy
    hasNativeIV: false,          // computed via BSM in proxy
    hasNativeOIChange: false,    // derived from prev-day OI snapshot
    hasHistoricalDaily: true,
    hasHistoricalIntraday: true,
    hasWebSocket: true,
    hasInstrumentMaster: true,
    supportedSymbols: ["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "SENSEX", "INDIAVIX"],
  },
  handleRequest,
  openWebSocket,
  resolveSecurityId(symbol) {
    return resolveInstrumentToken(symbol);
  },
};

export default kiteAdapter;
