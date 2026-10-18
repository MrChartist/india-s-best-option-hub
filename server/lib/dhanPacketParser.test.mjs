import { describe, it, expect } from "vitest";
import { parseDhanFrame, tickKey } from "./dhanPacketParser.mjs";

/**
 * Build one Dhan feed packet.
 * Header: [0]=responseCode, [1..2]=messageLength (incl. header), [3]=segment, [4..7]=securityId
 */
function packet({ code, segment, securityId, length, body = {} }) {
  const size = length ?? sizeFor(code);
  const buf = Buffer.alloc(size);
  buf.writeUInt8(code, 0);
  buf.writeUInt16LE(size, 1);
  buf.writeUInt8(segment, 3);
  buf.writeUInt32LE(securityId, 4);
  if (body.ltp !== undefined) buf.writeInt32LE(Math.round(body.ltp * 100), 8);
  if (code === 2 && body.ltt !== undefined) buf.writeUInt32LE(body.ltt, 12);
  if ((code === 4 || code === 8) && body.ltt !== undefined) buf.writeUInt32LE(body.ltt, 14);
  if ((code === 4 || code === 8) && body.high !== undefined) buf.writeInt32LE(Math.round(body.high * 100), 42);
  if ((code === 4 || code === 8) && body.low !== undefined) buf.writeInt32LE(Math.round(body.low * 100), 46);
  if (code === 8 && body.oi !== undefined) buf.writeUInt32LE(body.oi, 50);
  return buf;
}

function sizeFor(code) {
  return { 2: 16, 4: 50, 5: 12, 6: 16, 8: 62, 50: 10 }[code] ?? 16;
}

describe("tickKey", () => {
  it("namespaces securityId by segment so ids cannot collide across segments", () => {
    expect(tickKey("IDX_I", 13)).toBe("IDX_I:13");
    expect(tickKey("NSE_FNO", 13)).not.toBe(tickKey("IDX_I", 13));
  });
});

describe("parseDhanFrame — single packet", () => {
  it("parses a ticker packet", () => {
    const [p] = parseDhanFrame(packet({ code: 2, segment: 0, securityId: 25, body: { ltp: 58090.6, ltt: 1000 } }));
    expect(p.type).toBe("ticker");
    expect(p.ltp).toBeCloseTo(58090.6, 2);
    expect(p.exchangeSegment).toBe("IDX_I");
    expect(p.symbol).toBe("BANKNIFTY");
    expect(p.key).toBe("IDX_I:25");
  });

  it("does NOT apply the index symbol table to non-index segments", () => {
    // securityId 25 is BANKNIFTY only in IDX_I. In NSE_FNO it is some contract,
    // and mislabelling it would put a wrong name on a real position.
    const [p] = parseDhanFrame(packet({ code: 2, segment: 2, securityId: 25, body: { ltp: 590.25 } }));
    expect(p.exchangeSegment).toBe("NSE_FNO");
    expect(p.symbol).toBe("ID_25");
    expect(p.key).toBe("NSE_FNO:25");
  });

  it("parses a full packet including OI and the day range", () => {
    const [p] = parseDhanFrame(packet({
      code: 8, segment: 2, securityId: 44321,
      body: { ltp: 590.25, high: 1084.9, low: 300, oi: 123456 },
    }));
    expect(p.type).toBe("full");
    expect(p.ltp).toBeCloseTo(590.25, 2);
    expect(p.high).toBeCloseTo(1084.9, 2);
    expect(p.low).toBeCloseTo(300, 2);
    expect(p.oi).toBe(123456);
  });

  it("returns an empty array for a runt buffer instead of throwing", () => {
    expect(parseDhanFrame(Buffer.alloc(3))).toEqual([]);
    expect(parseDhanFrame(null)).toEqual([]);
  });

  it("drops a packet whose body is truncated rather than reading garbage", () => {
    // Declares a full packet but only carries a ticker's worth of bytes.
    const buf = packet({ code: 8, segment: 2, securityId: 99, length: 16 });
    expect(parseDhanFrame(buf)).toEqual([]);
  });
});

describe("parseDhanFrame — multi-packet frames (the dropped-tick bug)", () => {
  it("parses EVERY packet in a frame, not just the first", () => {
    const frame = Buffer.concat([
      packet({ code: 2, segment: 0, securityId: 13, body: { ltp: 26000.5 } }),
      packet({ code: 2, segment: 0, securityId: 25, body: { ltp: 58090.6 } }),
      packet({ code: 8, segment: 2, securityId: 44321, body: { ltp: 590.25, oi: 500 } }),
    ]);
    const packets = parseDhanFrame(frame);
    expect(packets).toHaveLength(3);
    expect(packets.map((p) => p.key)).toEqual(["IDX_I:13", "IDX_I:25", "NSE_FNO:44321"]);
  });

  it("handles a frame of 40 option packets — the option-chain subscription case", () => {
    const frame = Buffer.concat(
      Array.from({ length: 40 }, (_, i) =>
        packet({ code: 8, segment: 2, securityId: 40000 + i, body: { ltp: 100 + i, oi: i } })),
    );
    const packets = parseDhanFrame(frame);
    expect(packets).toHaveLength(40);
    expect(new Set(packets.map((p) => p.key)).size).toBe(40);
  });

  it("stops cleanly on a corrupt length field, keeping what it already parsed", () => {
    const good = packet({ code: 2, segment: 0, securityId: 13, body: { ltp: 26000 } });
    const bad = packet({ code: 2, segment: 0, securityId: 25, body: { ltp: 58000 } });
    bad.writeUInt16LE(0, 1); // zero length would otherwise loop forever
    const packets = parseDhanFrame(Buffer.concat([good, bad]));
    expect(packets.length).toBeGreaterThanOrEqual(1);
    expect(packets[0].key).toBe("IDX_I:13");
  });

  it("does not loop forever on an absurd length field", () => {
    const buf = packet({ code: 2, segment: 0, securityId: 13, body: { ltp: 26000 } });
    buf.writeUInt16LE(60000, 1);
    const packets = parseDhanFrame(buf);
    expect(packets).toHaveLength(1);
  });

  it("surfaces a disconnect packet rather than silently swallowing it", () => {
    const buf = packet({ code: 50, segment: 0, securityId: 0 });
    buf.writeUInt16LE(805, 8);
    const [p] = parseDhanFrame(buf);
    expect(p.type).toBe("disconnect");
    expect(p.disconnectCode).toBe(805);
  });
});
