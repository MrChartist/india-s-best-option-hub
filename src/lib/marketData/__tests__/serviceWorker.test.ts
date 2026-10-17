import { describe, expect, it, vi } from "vitest";
import { UPDATE_CHECK_INTERVAL_MS, registerServiceWorker } from "@/lib/marketData/serviceWorker";

type Listener = () => void;

class FakeTarget {
  private listeners = new Map<string, Listener[]>();
  addEventListener(type: string, cb: Listener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), cb]);
  }
  fire(type: string) {
    for (const cb of this.listeners.get(type) ?? []) cb();
  }
}

class FakeWorker extends FakeTarget {
  state = "installing";
  postMessage = vi.fn();
  install() {
    this.state = "installed";
    this.fire("statechange");
  }
}

function setup(opts: { controller?: boolean; waiting?: FakeWorker | null; installing?: FakeWorker | null; fail?: boolean } = {}) {
  const reg = Object.assign(new FakeTarget(), {
    waiting: opts.waiting ?? null,
    installing: opts.installing ?? null,
    update: vi.fn(async () => undefined),
  });
  const container = Object.assign(new FakeTarget(), {
    controller: opts.controller ? ({} as ServiceWorker) : null,
    register: vi.fn(async () => {
      if (opts.fail) throw new Error("blocked");
      return reg as unknown as ServiceWorkerRegistration;
    }),
  });
  const prompt = { onUpdateReady: vi.fn(), onOfflineReady: vi.fn() };
  const reload = vi.fn();
  const setIntervalFn = vi.fn() as unknown as typeof setInterval;
  return { reg, container, prompt, reload, setIntervalFn };
}

describe("registerServiceWorker", () => {
  it("returns null without service-worker support or when registration fails", async () => {
    expect(await registerServiceWorker({ onUpdateReady: vi.fn() }, { container: null })).toBeNull();
    const s = setup({ fail: true });
    expect(await registerServiceWorker(s.prompt, { container: s.container as never, setIntervalFn: s.setIntervalFn })).toBeNull();
  });

  it("returns null when register() resolves without a registration", async () => {
    const s = setup();
    s.container.register.mockResolvedValueOnce(undefined as unknown as ServiceWorkerRegistration);
    expect(await registerServiceWorker(s.prompt, { container: s.container as never, setIntervalFn: s.setIntervalFn })).toBeNull();
    expect(s.setIntervalFn).not.toHaveBeenCalled();
  });

  it("prompts for a worker already waiting and applies it with SKIP_WAITING", async () => {
    const waiting = new FakeWorker();
    const s = setup({ controller: true, waiting });
    await registerServiceWorker(s.prompt, { container: s.container as never, reload: s.reload, setIntervalFn: s.setIntervalFn });
    expect(s.prompt.onUpdateReady).toHaveBeenCalledTimes(1);
    s.prompt.onUpdateReady.mock.calls[0][0]();
    expect(waiting.postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" });
    s.container.fire("controllerchange");
    s.container.fire("controllerchange");
    expect(s.reload).toHaveBeenCalledTimes(1);
  });

  it("prompts when an update installs, but reports offline-ready on the first install", async () => {
    const s = setup({ controller: true });
    await registerServiceWorker(s.prompt, { container: s.container as never, setIntervalFn: s.setIntervalFn });
    const next = new FakeWorker();
    s.reg.installing = next;
    s.reg.fire("updatefound");
    next.install();
    expect(s.prompt.onUpdateReady).toHaveBeenCalledTimes(1);

    const first = new FakeWorker();
    const f = setup({ controller: false, installing: first });
    await registerServiceWorker(f.prompt, { container: f.container as never, setIntervalFn: f.setIntervalFn });
    first.install();
    expect(f.prompt.onOfflineReady).toHaveBeenCalledTimes(1);
    expect(f.prompt.onUpdateReady).not.toHaveBeenCalled();
  });

  it("checks for updates hourly", async () => {
    const s = setup();
    await registerServiceWorker(s.prompt, { container: s.container as never, setIntervalFn: s.setIntervalFn });
    const fn = s.setIntervalFn as unknown as ReturnType<typeof vi.fn>;
    expect(fn).toHaveBeenCalledWith(expect.any(Function), UPDATE_CHECK_INTERVAL_MS);
    fn.mock.calls[0][0]();
    expect(s.reg.update).toHaveBeenCalled();
  });
});
