/**
 * Delivery channels: in-app toast (done by the caller), browser notifications, a short chime and
 * an optional generic webhook. Browser APIs are guarded so this module is safe in tests and SSR.
 */
import { formatTimeIST } from "@/lib/options";
import type { AlertEvent, AlertTone, ChannelKey, ChannelSettings, RuleChannels } from "./types";

// ── Channel resolution ──

/** Effective channels for one rule: per-rule overrides on top of the global settings. */
export function effectiveChannels(settings: ChannelSettings, override?: RuleChannels): Record<ChannelKey, boolean> {
  return {
    toast: override?.toast ?? settings.toast,
    sound: override?.sound ?? settings.sound,
    desktop: override?.desktop ?? settings.desktop,
    webhook: (override?.webhook ?? settings.webhook) && validateWebhookUrl(settings.webhookUrl).ok,
  };
}

// ── Sound ──

let audioContext: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  try {
    if (typeof window === "undefined") return null;
    if (!audioContext) {
      const Ctor =
        window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      audioContext = new Ctor();
    }
    return audioContext;
  } catch {
    return null;
  }
}

const TONE_FREQUENCIES: Record<AlertTone, number[]> = {
  bullish: [523.25, 659.25, 783.99],
  bearish: [783.99, 659.25, 523.25],
  warning: [880, 698.46, 880],
  info: [659.25, 783.99],
};

/** Play a short chime. Returns false when audio is unavailable or blocked. */
export function playAlertSound(tone: AlertTone = "info", volume = 0.25): boolean {
  const ctx = getAudioContext();
  if (!ctx) return false;
  try {
    if (ctx.state === "suspended") void ctx.resume();
    const noteLength = 0.12;
    TONE_FREQUENCIES[tone].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = "sine";
      osc.frequency.value = freq;
      const t0 = ctx.currentTime + i * noteLength;
      gain.gain.setValueAtTime(Math.max(0.0001, Math.min(1, volume)), t0);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + noteLength + 0.05);
      osc.start(t0);
      osc.stop(t0 + noteLength + 0.06);
    });
    return true;
  } catch {
    return false;
  }
}

// ── Browser notifications ──

export type DesktopPermission = NotificationPermission | "unsupported";

export function desktopPermission(): DesktopPermission {
  try {
    return typeof Notification === "undefined" ? "unsupported" : Notification.permission;
  } catch {
    return "unsupported";
  }
}

export async function requestDesktopPermission(): Promise<DesktopPermission> {
  if (desktopPermission() === "unsupported") return "unsupported";
  try {
    return await Notification.requestPermission();
  } catch {
    return desktopPermission();
  }
}

/** Show a browser notification. Returns the outcome for the trigger log. */
export function showDesktopNotification(
  e: Pick<AlertEvent, "title" | "message" | "ruleId">,
): "sent" | "blocked" | "failed" {
  const p = desktopPermission();
  if (p !== "granted") return "blocked";
  try {
    new Notification(e.title, { body: `${e.message}\nEducational alert, not advice.`, tag: e.ruleId });
    return "sent";
  } catch {
    // Some browsers (Android Chrome) only allow notifications from a service worker.
    return "failed";
  }
}

// ── Webhook ──

export function validateWebhookUrl(raw: string): { ok: true; url: string } | { ok: false; error: string } {
  const s = (raw ?? "").trim();
  if (!s) return { ok: false, error: "Enter a webhook URL." };
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return { ok: false, error: "That is not a valid URL." };
  }
  const local = u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname === "[::1]";
  if (u.protocol !== "https:" && !(u.protocol === "http:" && local))
    return { ok: false, error: "Use an https:// URL (http is allowed only for localhost)." };
  if (u.username || u.password)
    return { ok: false, error: "Put credentials in the URL path or query, not before the host." };
  if (s.length > 2048) return { ok: false, error: "The URL is too long." };
  return { ok: true, url: u.toString() };
}

export interface WebhookPayload {
  source: "mr-chartist-terminal";
  kind: "alert";
  test: boolean;
  ruleId: string;
  ruleType: string;
  symbol: string;
  title: string;
  message: string;
  tone: AlertTone;
  firedAt: string;
  firedAtIST: string;
  /** Plain one-liner for chat tools (Slack, Discord, Google Chat accept a "text" field). */
  text: string;
  snapshot?: AlertEvent["snapshot"];
  disclaimer: string;
}

export function webhookPayload(e: AlertEvent, test = false): WebhookPayload {
  return {
    source: "mr-chartist-terminal",
    kind: "alert",
    test,
    ruleId: e.ruleId,
    ruleType: e.type,
    symbol: e.symbol,
    title: e.title,
    message: e.message,
    tone: e.tone,
    firedAt: new Date(e.ts).toISOString(),
    firedAtIST: formatTimeIST(e.ts, { seconds: true }),
    text: `${test ? "[TEST] " : ""}${e.title}: ${e.message} (${formatTimeIST(e.ts)})`,
    snapshot: e.snapshot,
    disclaimer: "Educational alert from Mr. Chartist Terminal, not investment advice.",
  };
}

/** Sliding-window limiter so a noisy rule set cannot flood an endpoint. */
export function createRateLimiter(max: number, windowMs: number) {
  const hits: number[] = [];
  return (now: number = Date.now()): boolean => {
    while (hits.length && now - hits[0] >= windowMs) hits.shift();
    if (hits.length >= max) return false;
    hits.push(now);
    return true;
  };
}

const webhookAllowed = createRateLimiter(12, 60_000);

/**
 * POST the alert as JSON text. Uses `no-cors` so any endpoint receives it from the browser; the
 * response is opaque, so "sent" means the request left the browser, not that it was accepted.
 */
export async function sendWebhook(
  url: string,
  payload: WebhookPayload,
  fetchImpl: typeof fetch | undefined = typeof fetch === "function" ? fetch : undefined,
): Promise<"sent" | "failed" | "skipped"> {
  const v = validateWebhookUrl(url);
  if (!v.ok || !fetchImpl) return "skipped";
  if (!webhookAllowed()) return "skipped";
  try {
    await fetchImpl(v.url, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
      body: JSON.stringify(payload),
      keepalive: true,
      credentials: "omit",
      referrerPolicy: "no-referrer",
    });
    return "sent";
  } catch {
    return "failed";
  }
}
