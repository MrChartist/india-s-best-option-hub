import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_CHANNELS,
  createRateLimiter,
  effectiveChannels,
  sendWebhook,
  validateWebhookUrl,
  webhookPayload,
  type AlertEvent,
} from "@/lib/alerts";

const event: AlertEvent = {
  id: "e1",
  ruleId: "r1",
  type: "price_level",
  symbol: "NIFTY",
  ts: Date.UTC(2026, 9, 16, 5, 0, 0),
  title: "NIFTY crossed above 25,000",
  message: "Last 25,010.",
  tone: "bullish",
};

describe("webhook", () => {
  it("validates URLs: https anywhere, http only on localhost", () => {
    expect(validateWebhookUrl("https://hooks.example.com/x").ok).toBe(true);
    expect(validateWebhookUrl("http://localhost:8080/hook").ok).toBe(true);
    expect(validateWebhookUrl("http://example.com/hook").ok).toBe(false);
    expect(validateWebhookUrl("ftp://example.com").ok).toBe(false);
    expect(validateWebhookUrl("https://user:pw@example.com").ok).toBe(false);
    expect(validateWebhookUrl("not a url").ok).toBe(false);
    expect(validateWebhookUrl("  ").ok).toBe(false);
  });

  it("builds a payload with an IST time and a chat-friendly text", () => {
    const p = webhookPayload(event, true);
    expect(p).toMatchObject({
      source: "mr-chartist-terminal",
      test: true,
      ruleId: "r1",
      symbol: "NIFTY",
      firedAt: "2026-10-16T05:00:00.000Z",
    });
    expect(p.firedAtIST).toBe("10:30:00 IST");
    expect(p.text).toMatch(/^\[TEST\] NIFTY crossed above/);
    expect(p.disclaimer).toMatch(/not investment advice/);
  });

  it("posts JSON text without credentials and reports the outcome", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({}) as unknown as typeof fetch;
    expect(await sendWebhook("https://hooks.example.com/x", webhookPayload(event), fetchImpl)).toBe("sent");
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("https://hooks.example.com/x");
    expect(init).toMatchObject({ method: "POST", mode: "no-cors", credentials: "omit" });
    expect(JSON.parse(init.body).title).toBe(event.title);
    const failing = vi.fn().mockRejectedValue(new Error("offline")) as unknown as typeof fetch;
    expect(await sendWebhook("https://hooks.example.com/x", webhookPayload(event), failing)).toBe("failed");
    expect(await sendWebhook("http://example.com", webhookPayload(event), fetchImpl)).toBe("skipped");
  });

  it("rate-limits within a sliding window", () => {
    const allow = createRateLimiter(2, 1000);
    expect([allow(0), allow(10), allow(20), allow(1001), allow(1011)]).toEqual([true, true, false, true, true]);
  });
});

describe("effectiveChannels", () => {
  it("applies per-rule overrides and needs a valid URL for the webhook", () => {
    const s = { ...DEFAULT_CHANNELS, webhook: true, webhookUrl: "" };
    expect(effectiveChannels(s)).toEqual({ toast: true, sound: true, desktop: false, webhook: false });
    const withUrl = { ...s, webhookUrl: "https://x.example/h" };
    expect(effectiveChannels(withUrl, { sound: false, desktop: true }).sound).toBe(false);
    expect(effectiveChannels(withUrl, { sound: false, desktop: true }).desktop).toBe(true);
    expect(effectiveChannels(withUrl).webhook).toBe(true);
    expect(effectiveChannels(withUrl, { webhook: false }).webhook).toBe(false);
  });
});
