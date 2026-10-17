import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

class FakeSocket {
  static OPEN = 1;
  static CONNECTING = 0;
  static CLOSED = 3;
  static instances: FakeSocket[] = [];
  readyState = FakeSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public url: string) {
    FakeSocket.instances.push(this);
  }
  send() {}
  close() {
    this.readyState = FakeSocket.CLOSED;
  }
  open() {
    this.readyState = FakeSocket.OPEN;
    this.onopen?.();
  }
  emit(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) });
  }
}

describe("marketWS", () => {
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

  it("does not replay a cached tick to a listener that unsubscribed before the replay", async () => {
    const { marketWS } = await import("@/lib/websocketClient");
    marketWS.connect();
    const sock = FakeSocket.instances.at(-1)!;
    sock.open();
    sock.emit({ securityId: 1, exchangeSegment: "NSE_FNO", ltp: 100 });
    const cb = vi.fn();
    const unsub = marketWS.subscribe("NSE_FNO:1", cb);
    unsub();
    vi.advanceTimersByTime(10);
    expect(cb).not.toHaveBeenCalled();

    const cb2 = vi.fn();
    marketWS.subscribe("NSE_FNO:1", cb2);
    vi.advanceTimersByTime(10);
    expect(cb2).toHaveBeenCalledTimes(1);
    marketWS.disconnect();
  });

  it("ignores a late close from a socket replaced by disconnect() and connect()", async () => {
    const { marketWS } = await import("@/lib/websocketClient");
    marketWS.connect();
    const first = FakeSocket.instances.at(-1)!;
    first.open();
    const firstOnClose = first.onclose;
    marketWS.disconnect();
    marketWS.connect();
    const second = FakeSocket.instances.at(-1)!;
    expect(second).not.toBe(first);
    second.open();
    expect(marketWS.isConnected).toBe(true);
    firstOnClose?.();
    first.onclose?.();
    expect(marketWS.isConnected).toBe(true);
    marketWS.disconnect();
  });
});
