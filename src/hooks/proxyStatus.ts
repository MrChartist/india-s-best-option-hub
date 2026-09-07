/**
 * Shared "is the local proxy reachable" flag, read/written by every query hook
 * in useMarketData.ts and useMarketScanners.ts. Split into its own module (out
 * of useMarketData.ts, which crossed 300 lines) specifically so the state
 * stays a SINGLE module-level singleton shared by both files — duplicating it
 * per-file would let the two hook sets disagree about proxy health.
 */

let proxyStatus: "unknown" | "online" | "offline" = "unknown";
let proxyCheckTime = 0;

export function markProxyOnline() { proxyStatus = "online"; proxyCheckTime = Date.now(); }
export function markProxyOffline() { proxyStatus = "offline"; proxyCheckTime = Date.now(); }
export function shouldTryProxy(): boolean {
  if (proxyStatus === "unknown") return true;
  if (proxyStatus === "online") return true;
  return Date.now() - proxyCheckTime > 30000;
}

export function resetProxyStatus() { proxyStatus = "unknown"; proxyCheckTime = 0; }
