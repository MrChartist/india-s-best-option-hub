/**
 * Dhan broker adapter — exports a BrokerAdapter implementation.
 */
import { handleRequest, INDEX_SECURITY_ID_MAP } from "./rest.mjs";
import { openWebSocket } from "./ws.mjs";

/** @type {import("../types.mjs").BrokerAdapter} */
export const dhanAdapter = {
  id: "dhan",
  name: "Dhan",
  capabilities: {
    hasOptionChain: true,
    hasNativeGreeks: true,
    hasNativeIV: true,
    hasNativeOIChange: true,
    hasHistoricalDaily: true,
    hasHistoricalIntraday: true,
    hasWebSocket: true,
    hasInstrumentMaster: true,
    supportedSymbols: ["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "SENSEX", "INDIAVIX"],
  },
  handleRequest,
  openWebSocket,
  resolveSecurityId(symbol) {
    const info = INDEX_SECURITY_ID_MAP[symbol?.toUpperCase()];
    return info?.secId ?? null;
  },
};

export default dhanAdapter;
