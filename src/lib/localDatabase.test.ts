// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDBFactory, IDBKeyRange, forceCloseDatabase } from "fake-indexeddb";
import { DB_BLOCKED_TIMEOUT_MS, DB_NAME, closeMarketDB, countInstruments, openMarketDB, saveInstruments, type Instrument } from "@/lib/localDatabase";

const inst = (id: string): Instrument => ({ securityId: id, symbol: "NIFTY", tradingSymbol: "NIFTY", exchangeSegment: "IDX_I", instrumentType: "INDEX", lotSize: 65 });

/** Resolve with "pending" if the promise has not settled within `ms` (the bug was a promise that never settles). */
function settleWithin<T>(p: Promise<T>, ms: number): Promise<{ ok: true; value: T } | { ok: false; error: unknown } | "pending"> {
  return Promise.race([
    p.then((value) => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error })),
    new Promise<"pending">((r) => setTimeout(() => r("pending"), ms)),
  ]);
}

describe("local database transactions and connection lifecycle", () => {
  beforeEach(() => {
    vi.stubGlobal("indexedDB", new IDBFactory());
    vi.stubGlobal("IDBKeyRange", IDBKeyRange);
    closeMarketDB();
  });
  afterEach(() => {
    closeMarketDB();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("rejects when the transaction aborts at commit (quota) instead of hanging", async () => {
    const db = await openMarketDB();
    const realTx = db.transaction.bind(db);
    // Every request succeeds, then the commit fails: only an 'abort' event fires, as with QuotaExceededError.
    vi.spyOn(db as unknown as { transaction: IDBDatabase["transaction"] }, "transaction").mockImplementation(((...args: Parameters<IDBDatabase["transaction"]>) => {
      const tx = realTx(...args);
      const store = tx.objectStore.bind(tx);
      tx.objectStore = (name: string) => {
        const s = store(name);
        const put = s.put.bind(s);
        s.put = (value: unknown, key?: IDBValidKey) => {
          const req = put(value, key);
          req.addEventListener("success", () => queueMicrotask(() => tx.abort()));
          return req;
        };
        return s;
      };
      return tx;
    }) as IDBDatabase["transaction"]);
    const out = await settleWithin(saveInstruments([inst("1")]), 2000);
    expect(out).not.toBe("pending");
    expect(out !== "pending" && out.ok).toBe(false);
  });

  it("gives up on an open blocked by another tab instead of waiting forever", async () => {
    // Another tab holds an older schema open and never closes it on versionchange.
    const old = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 2);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const out = await settleWithin(countInstruments(), DB_BLOCKED_TIMEOUT_MS + 2000);
      expect(out).not.toBe("pending");
      expect(out !== "pending" && out.ok).toBe(false);
    } finally {
      old.close();
    }
  }, DB_BLOCKED_TIMEOUT_MS + 6000);

  it("reopens after the browser closes the connection", async () => {
    const db = await openMarketDB();
    await saveInstruments([inst("1")]);
    forceCloseDatabase(db as unknown as Parameters<typeof forceCloseDatabase>[0]);
    const out = await settleWithin(countInstruments(), 2000);
    expect(out).toEqual({ ok: true, value: 1 });
  });
});
