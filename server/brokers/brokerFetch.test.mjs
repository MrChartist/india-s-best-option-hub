/**
 * brokerFetch: the one way adapters reach a broker host. Proves the time limit, the redirect policy and the
 * error mapping with a stubbed fetch, and scans every adapter source so a bare fetch( cannot creep back in.
 * No network.
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BrokerError, UPSTREAM_TIMEOUT_MS, brokerFetch } from "./contract.mjs";

const here = dirname(fileURLToPath(import.meta.url));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** A fetch stub that never answers until its signal aborts, like a hung broker host. */
function hangingFetch() {
  return vi.fn((_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener("abort", () => reject(init.signal.reason));
  }));
}

describe("brokerFetch", () => {
  it("passes a signal and redirect: 'error' by default", async () => {
    const stub = vi.fn(async () => new Response("{}"));
    vi.stubGlobal("fetch", stub);
    await brokerFetch("https://api.example.test/x", { method: "POST", headers: { "x-api-key": "k" } });
    const init = stub.mock.calls[0][1];
    expect(init.redirect).toBe("error");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "x-api-key": "k" });
  });

  it("keeps an explicit redirect: 'follow' for anonymous file downloads", async () => {
    const stub = vi.fn(async () => new Response("a,b"));
    vi.stubGlobal("fetch", stub);
    await brokerFetch("https://files.example.test/master.csv", { redirect: "follow" }, { kind: "master" });
    expect(stub.mock.calls[0][1].redirect).toBe("follow");
  });

  it("maps a hung host to BrokerError 502 UPSTREAM_TIMEOUT", async () => {
    vi.stubGlobal("fetch", hangingFetch());
    const err = await brokerFetch("https://api.example.test/slow", {}, { timeoutMs: 20, label: "Test broker" }).catch((e) => e);
    expect(err).toBeInstanceOf(BrokerError);
    expect(err.code).toBe("UPSTREAM_TIMEOUT");
    expect(err.statusCode).toBe(502);
    expect(err.message).toMatch(/^Test broker did not respond/);
  });

  it("still honours a caller's own abort signal", async () => {
    vi.stubGlobal("fetch", hangingFetch());
    const ctl = new AbortController();
    const pending = brokerFetch("https://api.example.test/x", { signal: ctl.signal }).catch((e) => e);
    ctl.abort(new Error("caller cancelled"));
    const err = await pending;
    expect(err.message).toBe("caller cancelled");
    expect(err.code).toBeUndefined();
  });

  it("maps a refused redirect to UPSTREAM_REDIRECT_REFUSED", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("fetch failed", { cause: new Error("unexpected redirect") });
    }));
    const err = await brokerFetch("https://api.example.test/x").catch((e) => e);
    expect(err).toBeInstanceOf(BrokerError);
    expect(err.code).toBe("UPSTREAM_REDIRECT_REFUSED");
  });

  it("uses a shorter limit for reads than for writes and logins", () => {
    expect(UPSTREAM_TIMEOUT_MS.read).toBeLessThan(UPSTREAM_TIMEOUT_MS.write);
    expect(UPSTREAM_TIMEOUT_MS.login).toBeGreaterThanOrEqual(UPSTREAM_TIMEOUT_MS.read);
  });
});

describe("adapter sources", () => {
  const sources = readdirSync(here).filter((f) => f.endsWith(".mjs") && !f.endsWith(".test.mjs") && f !== "contract.mjs");

  it("never call a bare fetch(); everything goes through brokerFetch", () => {
    const offenders = [];
    for (const file of sources) {
      const lines = readFileSync(join(here, file), "utf8").split("\n");
      lines.forEach((line, i) => {
        const code = line.trim();
        if (code.startsWith("*") || code.startsWith("//") || code.startsWith("/*")) return;
        if (/(?<![\w.$])fetch\(/.test(code) || /globalThis\.fetch\(/.test(code)) offenders.push(`${file}:${i + 1}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});
