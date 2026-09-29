import { useEffect, useRef } from "react";
import { toast } from "sonner";
import {
  alertStore,
  alertMetricKey,
  describeAlert,
  formatMetricValue,
  shouldFire,
  toneFor,
  useAlertMetrics,
  useAlertState,
  type AlertTone,
  type PriceAlert,
} from "@/lib/alerts";

// ── Sound ──
let audioContext: AudioContext | null = null;

function getAudioContext(): AudioContext {
  if (!audioContext) {
    audioContext = new AudioContext();
  }
  return audioContext;
}

const toneFrequencies: Record<AlertTone, number[]> = {
  bullish: [523.25, 659.25, 783.99], // C5 E5 G5 — rising
  bearish: [783.99, 659.25, 523.25], // falling
  warning: [880, 698.46, 880], // A5 F5 A5 — attention
  info: [659.25, 783.99],
};

export function playAlertSound(tone: AlertTone = "info", volume: number = 0.25) {
  try {
    const ctx = getAudioContext();
    if (ctx.state === "suspended") ctx.resume();

    const noteLength = 0.13;
    toneFrequencies[tone].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      const start = ctx.currentTime + i * noteLength;
      osc.type = "sine";
      osc.frequency.value = freq;
      // Soft attack/decay so the chime doesn't click
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(volume, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + noteLength + 0.12);
      osc.start(start);
      osc.stop(start + noteLength + 0.14);
    });
  } catch (e) {
    console.warn("Audio playback failed:", e);
  }
}

// ── Desktop notifications ──
export function notificationsSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

export async function requestDesktopNotifications(): Promise<boolean> {
  if (!notificationsSupported()) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  return (await Notification.requestPermission()) === "granted";
}

function fireSideEffects(alert: PriceAlert, actual: number) {
  const { prefs } = alertStore.getState();
  const tone = toneFor(alert);
  const title = describeAlert(alert);
  const description = `Now ${formatMetricValue(alert.metric, actual)} · ${new Date().toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })}${alert.note ? ` · ${alert.note}` : ""}`;

  toast(`🔔 ${title}`, { description, duration: 10000 });

  if (prefs.sound && alert.sound) playAlertSound(tone);

  if (prefs.browserNotify && notificationsSupported() && Notification.permission === "granted") {
    try {
      new Notification("Mr. Chartist Alert", { body: `${title}\n${description}`, tag: alert.id });
    } catch {
      /* some browsers only allow notifications from a service worker */
    }
  }
}

/**
 * Runs every alert against the latest live readings. Mounted once (see AlertEngine),
 * so alerts fire whether or not the alerts panel is open.
 */
export function useAlertEngine() {
  const { alerts } = useAlertState();
  const metrics = useAlertMetrics();
  const prevValues = useRef<Map<string, number>>(new Map());
  const wasMet = useRef<Map<string, boolean>>(new Map());

  useEffect(() => {
    const now = Date.now();
    const seenKeys = new Set<string>();

    for (const alert of alerts) {
      const key = alertMetricKey(alert);
      const current = metrics[key];
      if (current === undefined) continue;

      const prev = prevValues.current.get(key);
      const tracked = wasMet.current.get(alert.id);
      const { fire, met } = shouldFire(alert, current, prev, tracked, now);
      wasMet.current.set(alert.id, met);

      // Track state for paused / finished alerts too, so re-arming never replays an old hit.
      if (fire && alert.active) {
        alertStore.recordTrigger(alert, current);
        fireSideEffects(alert, current);
      }
      seenKeys.add(key);
    }

    seenKeys.forEach((key) => prevValues.current.set(key, metrics[key]));
  }, [alerts, metrics]);
}
