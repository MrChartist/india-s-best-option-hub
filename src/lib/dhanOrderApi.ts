/**
 * Order placement (Dhan only — real money, requires a static IP whitelisted
 * with Dhan for order-mutating calls; see server/lib/dhanOrders.mjs).
 *
 * Split out of marketApi.ts, which crossed 300 lines once this section (and
 * the futures/FII-DII/global-cues additions alongside it) was added.
 * Re-exported from marketApi.ts so every existing
 * `import { placeOrder, fetchOrders, cancelOrder } from "@/lib/marketApi"`
 * keeps working unchanged.
 *
 * PROXY_BASE/dhanCredHeaders are redefined here rather than imported from
 * marketApi.ts (module-private there) — the same duplication precedent
 * dhanProxyClient.ts already established elsewhere in this build.
 */

import { getActiveBroker } from "./brokerConfig";
import { tokenSessionId, type LiveArmToken } from "./liveArm";

const PROXY_BASE = import.meta.env.VITE_PROXY_URL || "http://localhost:4002";

function dhanCredHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  const activeBroker = getActiveBroker();
  if (activeBroker?.brokerId === "dhan" && activeBroker.values.clientId && activeBroker.values.accessToken) {
    headers["x-dhan-client-id"] = activeBroker.values.clientId;
    headers["x-dhan-access-token"] = activeBroker.values.accessToken;
  }
  return headers;
}

export interface PlaceOrderParams {
  transactionType: "BUY" | "SELL";
  exchangeSegment?: string;
  productType?: "CNC" | "INTRADAY" | "MARGIN" | "MTF" | "CO" | "BO";
  orderType: "LIMIT" | "MARKET" | "STOP_LOSS" | "STOP_LOSS_MARKET";
  validity?: "DAY" | "IOC";
  securityId: string;
  /**
   * Quantity in LOTS. There is deliberately no `lotSize` field: the server
   * resolves it from the exchange instrument master and rejects the order if it
   * cannot. The app's hardcoded LOT_SIZE_MAP had drifted from NSE's actual lot
   * sizes, and since quantity = lots × lotSize, sending it from here meant a
   * stale constant silently traded the wrong size.
   */
  lots: number;
  price: number;
  triggerPrice?: number;
  correlationId?: string;
  /** Per-user caps. The server takes the stricter of these and its own. */
  limits?: Record<string, number>;
}

export interface DhanOrderResult {
  orderId: string;
  orderStatus: "TRANSIT" | "PENDING" | "REJECTED" | "CANCELLED" | "TRADED" | "EXPIRED";
  /** Echoed back by the server so the UI reports the size that was actually sent. */
  resolvedLotSize?: number;
  quantity?: number;
  warnings?: string[];
}

/**
 * Places a REAL order.
 *
 * The `token` parameter is the point: a LiveArmToken can only be produced by
 * armLive() in liveArm.ts, so this function is unreachable without passing the
 * live-trading gate. Adding a new caller cannot accidentally skip the check —
 * it will not compile. The server re-validates everything regardless.
 */
export async function placeOrder(order: PlaceOrderParams, token: LiveArmToken): Promise<DhanOrderResult> {
  const res = await fetch(`${PROXY_BASE}/api/dhan-proxy?endpoint=place-order`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-arm-session": tokenSessionId(token),
      ...dhanCredHeaders(),
    },
    // liveArmed is asserted here because we hold a token; the server still runs
    // its own ladder before anything reaches the exchange.
    body: JSON.stringify({ ...order, liveArmed: true }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.message || data?.errorMessage || data?.error || `Order failed [${res.status}]`);
  return data;
}

export async function fetchOrders(): Promise<DhanOrderResult[]> {
  const res = await fetch(`${PROXY_BASE}/api/dhan-proxy?endpoint=orders`, { headers: dhanCredHeaders() });
  if (!res.ok) throw new Error(`Fetching orders failed: ${res.status}`);
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

export async function cancelOrder(orderId: string): Promise<DhanOrderResult> {
  const res = await fetch(`${PROXY_BASE}/api/dhan-proxy?endpoint=cancel-order`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...dhanCredHeaders() },
    body: JSON.stringify({ orderId }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.message || data?.errorMessage || `Cancel failed [${res.status}]`);
  return data;
}
