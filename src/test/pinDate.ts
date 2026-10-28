/**
 * Test setup: tests whose recorded data has dated option expiries (the broker adapter fixtures, the paper-trading
 * chain) run with Date pinned to Monday 19 Oct 2026 09:30 IST, the week they were recorded, so they keep passing once
 * those expiries are in the past. Time still moves forward from there. Every other test uses the real clock.
 */
import { afterAll, beforeAll, expect, vi } from "vitest";

export const PINNED_NOW = Date.UTC(2026, 9, 19, 4, 0, 0);
const PINNED_FILES = /server\/brokers\/[^/]+\.test\.mjs$|src\/components\/paper\/PaperTrading\.test\.tsx$/;

let pinned = false;
beforeAll(() => {
  const path = String(expect.getState().testPath ?? "").replace(/\\/g, "/");
  if (!PINNED_FILES.test(path)) return;
  vi.useFakeTimers({ toFake: ["Date"], now: PINNED_NOW, shouldAdvanceTime: true });
  pinned = true;
});
afterAll(() => {
  if (pinned) vi.useRealTimers();
});
