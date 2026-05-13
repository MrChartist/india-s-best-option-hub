/**
 * Broker adapter registry. Routes broker-id strings to adapter implementations.
 * To add a new broker: implement BrokerAdapter (see types.mjs), import it, and
 * add it to the ADAPTERS map.
 */
import { dhanAdapter } from "./dhan/index.mjs";
import { kiteAdapter } from "./kite/index.mjs";

const ADAPTERS = {
  [dhanAdapter.id]: dhanAdapter,
  [kiteAdapter.id]: kiteAdapter,
};

export function getAdapter(brokerId) {
  if (!brokerId) throw new Error("brokerId is required");
  const adapter = ADAPTERS[brokerId.toLowerCase()];
  if (!adapter) {
    throw new Error(`Unknown broker: ${brokerId}. Registered: ${Object.keys(ADAPTERS).join(", ")}`);
  }
  return adapter;
}

export function listAdapters() {
  return Object.values(ADAPTERS).map((a) => ({
    id: a.id,
    name: a.name,
    capabilities: a.capabilities,
  }));
}

export function hasAdapter(brokerId) {
  return !!brokerId && !!ADAPTERS[brokerId.toLowerCase()];
}

/**
 * Decode broker credentials from request headers.
 * Convention: x-broker-id, x-broker-credentials (base64 JSON).
 * Falls back to legacy Dhan headers for backward compatibility during migration.
 */
export function extractCredentials(headers) {
  const brokerId = (headers["x-broker-id"] || "").toString().toLowerCase();
  const credsHeader = headers["x-broker-credentials"];

  let credentials = {};
  if (credsHeader) {
    try {
      credentials = JSON.parse(Buffer.from(credsHeader.toString(), "base64").toString("utf-8"));
    } catch {
      console.warn("  ⚠️ Failed to decode x-broker-credentials header");
    }
  }

  // Legacy Dhan headers (kept so older client builds still work)
  if (!credentials.clientId && headers["x-dhan-client-id"]) {
    credentials.clientId = headers["x-dhan-client-id"].toString();
  }
  if (!credentials.accessToken && headers["x-dhan-access-token"]) {
    credentials.accessToken = headers["x-dhan-access-token"].toString();
  }

  return { brokerId: brokerId || "dhan", credentials };
}
