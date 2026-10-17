import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_RECONNECT_FAILURES, reconnectDelayMs, reconnectHold } from "@/lib/websocketClient";

class FakeSocket {
  static instances: FakeSocket[] = [];
  static OPEN = 1;
  static CONNECTING = 0;
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public url: string) {
    FakeSocket.instances.push(this);
  }
  send() {}
  close() {
    this.readyState = 3;
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  fail() {
    this.readyState = 3;
    this.onclose?.();
  }
}

describe("reconnect policy (pure)", () => {
  it("holds for give-up, offline and hidden in that order", () => {
    expect(reconnectHold({ failures: MAX_RECONNECT_FAILURES, hidden: false, online: true })).toBe("gave-up");
    expect(reconnectHold({ failures: 1, hidden: true, online: false })).toBe("offline");
    expect(reconnectHold({ failures: 1, hidden: true, online: true })).toBe("hidden");
    expect(reconnectHold({ failures: 1, hidden: false, online: true })).toBeNull();
  });
  it("backs off from 1.5 s and caps at 30 s", () => {
    expect(reconnectDelayMs(1)).toBe(1500);
    expect(reconnectDelayMs(2)).toBe(2250);
    expect(reconnectDelayMs(0)).toBe(1500);
    expect(reconnectDelayMs(50)).toBe(30_000);
  });
});

describe("marketWS lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeSocket.instances = [];
    vi.stubGlobal("WebSocket", FakeSocket);
    vi.resetModules();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("opens nothing on import", async () => {
    await import("@/lib/websocketClient");
    vi.advanceTimersByTime(5_000);
    expect(FakeSocket.instances).toHaveLength(0);
  });

  it("gives up after the failure limit and resumes when asked with a reset", async () => {
    const { marketWS } = await import("@/lib/websocketClient");
    marketWS.connect();
    for (let i = 0; i < MAX_RECONNECT_FAILURES; i++) {
      FakeSocket.instances.at(-1)!.fail();
      vi.advanceTimersByTime(31_000);
    }
    expect(marketWS.reconnectHold).toBe("gave-up");
    expect(marketWS.failureCount).toBe(MAX_RECONNECT_FAILURES);
    const count = FakeSocket.instances.length;
    vi.advanceTimersByTime(120_000);
    expect(FakeSocket.instances.length).toBe(count);

    marketWS.resume(); // without reset it stays given up
    expect(FakeSocket.instances.length).toBe(count);
    marketWS.resume(true);
    expect(FakeSocket.instances.length).toBe(count + 1);
    FakeSocket.instances.at(-1)!.open();
    expect(marketWS.failureCount).toBe(0);
    expect(marketWS.reconnectHold).toBeNull();
    marketWS.disconnect();
  });

  it("marks the proxy gate online when the socket opens", async () => {
    const proxy = await import("@/lib/api/proxyClient");
    proxy.setProxyGateEnabled(true);
    proxy.resetProxyGate();
    const { marketWS } = await import("@/lib/websocketClient");
    marketWS.connect();
    FakeSocket.instances.at(-1)!.open();
    expect(proxy.getProxyStatus().status).toBe("online");
    marketWS.disconnect();
  });
});
