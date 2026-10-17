/**
 * Pure state for the global data-provenance banner (src/components/SampleBanner.tsx).
 *
 * One thin bar under the top bar tells the user, on every page, when numbers are not live:
 *  - "sample":  the proxy is offline, so pages fall back to clearly labelled sample data;
 *  - "demo":    VITE_DATA_MODE=sample, the proxy is never contacted;
 *  - "cached":  the device itself is offline (PWA), so only the cached app shell and whatever was
 *               last fetched are on screen, shown with the time of the last live answer.
 * Hidden while the proxy is reachable or still being checked for the first time.
 */
import { formatTimeIST } from "@/lib/options";
import type { ProxyGateSnapshot } from "@/lib/api/proxyClient";

export type BannerKind = "sample" | "demo" | "cached";

export interface BannerState {
  kind: BannerKind;
  /** Short badge text ("Sample data", "Cached"). */
  badge: string;
  /** Main message. */
  message: string;
  /** Secondary detail for wider screens ("Next check in 45 s"), or null. */
  detail: string | null;
  /** Offer the "Start proxy" help and retry action. */
  showStartProxy: boolean;
}

/** "45 s", "2 min", "5 min": a compact, rounded countdown. */
export function formatCountdown(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  if (s < 60) return `${s} s`;
  return `${Math.round(s / 60)} min`;
}

export function bannerState(
  gate: Pick<ProxyGateSnapshot, "status" | "nextRetryAt" | "lastOnlineAt" | "probing" | "sampleMode">,
  deviceOnline: boolean,
  now: number = Date.now(),
): BannerState | null {
  if (!deviceOnline) {
    return {
      kind: "cached",
      badge: "Cached",
      message: "You're offline",
      detail: gate.lastOnlineAt
        ? `Last live data ${formatTimeIST(gate.lastOnlineAt)}`
        : "No live data this session",
      showStartProxy: false,
    };
  }
  if (gate.sampleMode) {
    return {
      kind: "demo",
      badge: "Sample data",
      message: "Demo mode · proxy disabled",
      detail: "VITE_DATA_MODE=sample",
      showStartProxy: false,
    };
  }
  if (gate.status !== "offline") return null;
  let detail: string | null = null;
  if (gate.probing) detail = "Checking…";
  else if (gate.nextRetryAt !== null) detail = gate.nextRetryAt > now ? `Next check in ${formatCountdown(gate.nextRetryAt - now)}` : "Checking soon";
  return { kind: "sample", badge: "Sample data", message: "Proxy offline", detail, showStartProxy: true };
}
