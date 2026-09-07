/**
 * The terminal's instrument + execution settings (the two control rows).
 *
 * Persisted, because a scalper's product type, protection band and preferred lot
 * count do not change between sessions and re-entering them daily is friction.
 * Deliberately NOT persisted: anything to do with arming — see liveArm.ts.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { getLotSize, getStepSize } from "@/lib/positionStore";
import type { TerminalConfig } from "../types";

const STORAGE_KEY = "optionsdesk_onecliq_config";

/** Lot presets bound to keys 1-5. */
export const LOT_PRESETS = [1, 2, 5, 10, 20];

const DEFAULTS: TerminalConfig = {
  exchange: "NSE",
  segment: "OPTIONS",
  symbol: "BANKNIFTY",
  expiry: "",
  callStrike: 0,
  putStrike: 0,
  lots: 1,
  productType: "INTRADAY",
  orderVariant: "MARKET_PROTECT",
  protectionPct: 10,
  slEnabled: false,
  slValue: 50,
  // Points on the UNDERLYING, not premium — the reference product's headline
  // feature, and the more natural unit for a directional scalp.
  slUnit: "SPOT_PTS",
  targetEnabled: false,
  targetValue: 80,
  targetUnit: "SPOT_PTS",
};

function load(): TerminalConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<TerminalConfig>;
    // Merge over defaults so a config saved by an older build never yields
    // undefined fields that later render as NaN.
    return { ...DEFAULTS, ...parsed };
  } catch {
    return DEFAULTS;
  }
}

export function useTerminalConfig() {
  const [config, setConfig] = useState<TerminalConfig>(load);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(config)); } catch { /* quota / private mode */ }
  }, [config]);

  const stepSize = useMemo(() => getStepSize(config.symbol), [config.symbol]);
  const lotSize = useMemo(() => getLotSize(config.symbol), [config.symbol]);

  const update = useCallback(<K extends keyof TerminalConfig>(key: K, value: TerminalConfig[K]) => {
    setConfig((prev) => ({ ...prev, [key]: value }));
  }, []);

  /** Seed both strikes to ATM. Only fills strikes that are still unset. */
  const seedStrikes = useCallback((spot: number) => {
    if (!Number.isFinite(spot) || spot <= 0) return;
    setConfig((prev) => {
      if (prev.callStrike > 0 && prev.putStrike > 0) return prev;
      const step = getStepSize(prev.symbol);
      const atm = Math.round(spot / step) * step;
      return {
        ...prev,
        callStrike: prev.callStrike > 0 ? prev.callStrike : atm,
        putStrike: prev.putStrike > 0 ? prev.putStrike : atm,
      };
    });
  }, []);

  const stepStrike = useCallback((leg: "CE" | "PE", direction: 1 | -1) => {
    setConfig((prev) => {
      const step = getStepSize(prev.symbol);
      const key = leg === "CE" ? "callStrike" : "putStrike";
      const next = Math.max(step, (prev[key] || 0) + direction * step);
      return { ...prev, [key]: next };
    });
  }, []);

  const stepLots = useCallback((direction: 1 | -1) => {
    setConfig((prev) => ({ ...prev, lots: Math.max(1, prev.lots + direction) }));
  }, []);

  const setLotPreset = useCallback((index: number) => {
    const lots = LOT_PRESETS[index];
    if (lots) setConfig((prev) => ({ ...prev, lots }));
  }, []);

  /** Changing symbol invalidates strikes — they belong to the old underlying. */
  const setSymbol = useCallback((symbol: string) => {
    setConfig((prev) => (prev.symbol === symbol
      ? prev
      : { ...prev, symbol, callStrike: 0, putStrike: 0, expiry: "" }));
  }, []);

  return { config, setConfig, update, stepSize, lotSize, seedStrikes, stepStrike, stepLots, setLotPreset, setSymbol };
}
