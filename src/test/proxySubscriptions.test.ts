import { describe, expect, it } from "vitest";
// @ts-expect-error -- plain ESM module without type declarations
import { SubscriptionRegistry } from "../../proxy-server.mjs";

const inst = (id: number, seg = "NSE_FNO") => ({ ExchangeSegment: seg, SecurityId: String(id) });

describe("SubscriptionRegistry", () => {
  it("reference-counts per socket and releases on close", () => {
    const r = new SubscriptionRegistry({ limit: 10, pinned: [inst(13, "IDX_I")] });
    const a = {}, b = {};
    expect(r.subscribe(a, [inst(1), inst(2)]).added).toHaveLength(2);
    expect(r.subscribe(b, [inst(2), inst(3)]).added).toEqual([inst(3)]);
    expect(r.size).toBe(4);
    expect(r.release(a)).toEqual([inst(1)]);
    expect(r.has("NSE_FNO:2")).toBe(true);
    expect(r.release(b).map((i: { SecurityId: string }) => i.SecurityId).sort()).toEqual(["2", "3"]);
    expect(r.size).toBe(1); // pinned index stays
    expect(r.release(b)).toEqual([]); // idempotent
  });

  it("handles explicit unsubscribe without touching other sockets", () => {
    const r = new SubscriptionRegistry({ limit: 10 });
    const a = {}, b = {};
    r.subscribe(a, [inst(1), inst(2)]);
    r.subscribe(b, [inst(2)]);
    expect(r.unsubscribe(a, [inst(1), inst(2)])).toEqual([inst(1)]);
    expect(r.has("NSE_FNO:2")).toBe(true);
    expect(r.unsubscribe(a, [inst(2)])).toEqual([]);
  });

  it("evicts least recently subscribed instruments instead of failing at the limit", () => {
    const r = new SubscriptionRegistry({ limit: 4, pinned: [inst(13, "IDX_I")] });
    const a = {};
    r.subscribe(a, [inst(1), inst(2), inst(3)]);
    r.subscribe(a, [inst(1)]); // touch 1 so 2 is now the oldest
    const { added, released } = r.subscribe(a, [inst(4)]);
    expect(added).toEqual([inst(4)]);
    expect(released).toEqual([inst(2)]);
    expect(r.size).toBe(4);
    expect(r.has("IDX_I:13")).toBe(true);
    for (let i = 5; i < 50; i++) r.subscribe(a, [inst(i)]);
    expect(r.size).toBe(4);
  });

  it("refuses a single request larger than the unpinned budget", () => {
    const r = new SubscriptionRegistry({ limit: 3, pinned: [inst(13, "IDX_I")] });
    expect(() => r.subscribe({}, [inst(1), inst(2), inst(3)])).toThrow(/limit/);
  });
});
