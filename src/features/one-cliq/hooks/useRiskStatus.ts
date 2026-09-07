/**
 * Polls the server's dead-man's switch (1CLIQ-TRADE-SPEC.md §4).
 *
 * This is the ONLY source for any "is a leg actually being managed" badge in
 * the terminal — never optimistic client state, per spec: "the armed badge
 * in the UI renders only from server-confirmed status". A component that
 * wants to show "N legs armed" reads `armedCount` from here, not from
 * whatever it thinks it just armed.
 */

import { useEffect, useRef, useState } from "react";
import { fetchRiskStatus, type RiskStatus } from "../lib/riskApi";

const POLL_MS = 2000;

const UNKNOWN_STATUS: RiskStatus = { alive: false, lastTickAgeMs: null, armedCount: 0, dhanConnected: false };

export function useRiskStatus() {
  const [status, setStatus] = useState<RiskStatus>(UNKNOWN_STATUS);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    let timer: ReturnType<typeof setTimeout>;

    const poll = async () => {
      const next = await fetchRiskStatus(); // never throws — see riskApi.ts
      if (mountedRef.current) setStatus(next);
      timer = setTimeout(poll, POLL_MS);
    };
    poll();

    return () => {
      mountedRef.current = false;
      clearTimeout(timer);
    };
  }, []);

  return status;
}
