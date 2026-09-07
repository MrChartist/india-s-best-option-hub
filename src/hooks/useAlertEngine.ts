import { useEffect, useRef, useCallback } from "react";

// Audio context for alert sounds
let audioContext: AudioContext | null = null;

function getAudioContext(): AudioContext {
  if (!audioContext) {
    audioContext = new AudioContext();
  }
  return audioContext;
}

export type AlertTone = "bullish" | "bearish" | "warning" | "info";

const toneFrequencies: Record<AlertTone, number[]> = {
  bullish: [523.25, 659.25, 783.99],  // C5, E5, G5 — ascending major chord
  bearish: [783.99, 659.25, 523.25],  // descending
  warning: [880, 880, 880],            // A5 repeated
  info: [659.25, 783.99],             // E5, G5
};

export function playAlertSound(tone: AlertTone = "info", volume: number = 0.3) {
  try {
    const ctx = getAudioContext();
    if (ctx.state === "suspended") ctx.resume();

    const freqs = toneFrequencies[tone];
    const noteLength = 0.12;

    freqs.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.type = tone === "warning" ? "square" : "sine";
      osc.frequency.value = freq;
      gain.gain.value = volume;
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + (i + 1) * noteLength + 0.05);

      osc.start(ctx.currentTime + i * noteLength);
      osc.stop(ctx.currentTime + (i + 1) * noteLength + 0.05);
    });
  } catch (e) {
    console.warn("Audio playback failed:", e);
  }
}

export interface AlertCondition {
  id: string;
  symbol: string;
  type: "price" | "oi_spike" | "iv_spike" | "pcr" | "vix";
  condition: "above" | "below";
  value: number;
  active: boolean;
  triggered: boolean;
  triggeredAt?: number;
  tone: AlertTone;
}

interface AlertCheckData {
  // Per-symbol live LTP — a "price" alert on BANKNIFTY must check BANKNIFTY's
  // own price, not whatever single spot value happens to be in scope.
  spotBySymbol?: Record<string, number>;
  vix?: number;
  pcr?: number;
  atmIV?: number;
  maxOIChange?: number;
}

export function checkAlerts(
  alerts: AlertCondition[],
  data: AlertCheckData
): AlertCondition[] {
  const now = Date.now();
  const cooldown = 60000; // 1 minute cooldown between re-triggers

  return alerts.map(alert => {
    if (!alert.active || (alert.triggered && alert.triggeredAt && now - alert.triggeredAt < cooldown)) {
      return alert;
    }

    let currentValue: number | undefined;
    switch (alert.type) {
      case "price": currentValue = data.spotBySymbol?.[alert.symbol]; break;
      case "vix": currentValue = data.vix; break;
      case "pcr": currentValue = data.pcr; break;
      case "iv_spike": currentValue = data.atmIV; break;
      case "oi_spike": currentValue = data.maxOIChange; break;
    }

    if (currentValue === undefined) return alert;

    const shouldTrigger =
      (alert.condition === "above" && currentValue > alert.value) ||
      (alert.condition === "below" && currentValue < alert.value);

    if (shouldTrigger && !alert.triggered) {
      return { ...alert, triggered: true, triggeredAt: now };
    }

    // Reset if condition no longer met
    if (!shouldTrigger && alert.triggered) {
      return { ...alert, triggered: false, triggeredAt: undefined };
    }

    return alert;
  });
}

// Hook that runs alert checks on an interval
export function useAlertEngine(
  alerts: AlertCondition[],
  data: AlertCheckData,
  onTriggered: (alert: AlertCondition) => void,
  enabled: boolean = true,
) {
  const prevTriggered = useRef<Set<string>>(new Set());

  const check = useCallback(() => {
    if (!enabled) return;

    const updated = checkAlerts(alerts, data);
    updated.forEach(alert => {
      if (alert.triggered && !prevTriggered.current.has(alert.id)) {
        prevTriggered.current.add(alert.id);
        onTriggered(alert);
        playAlertSound(alert.tone);
      }
      if (!alert.triggered && prevTriggered.current.has(alert.id)) {
        prevTriggered.current.delete(alert.id);
      }
    });
  }, [alerts, data, onTriggered, enabled]);

  useEffect(() => {
    if (!enabled) return;
    const interval = setInterval(check, 5000); // Check every 5 seconds
    check(); // Immediate check
    return () => clearInterval(interval);
  }, [check, enabled]);
}
