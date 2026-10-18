import { describe, expect, it } from "vitest";
import { deflateRawSync, gzipSync } from "node:zlib";
import { BrokerError } from "../brokers/contract.mjs";
import { gunzipCapped, listZipEntries, readBodyCapped, readZipEntry } from "./safeArchive.mjs";
import { unzipFirstEntry } from "../brokers/zebuZip.mjs";

/** One-entry ZIP. `declared` overrides the uncompressed size in the headers; `method` the compression method. */
function zipOf(name, text, { method = 8, declared } = {}) {
  const raw = Buffer.from(text);
  const data = method === 0 ? raw : deflateRawSync(raw);
  const size = declared ?? raw.length;
  const n = Buffer.from(name);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(method, 8);
  local.writeUInt32LE(data.length, 18); local.writeUInt32LE(size, 22); local.writeUInt16LE(n.length, 26);
  const cd = Buffer.alloc(46);
  cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(method, 10);
  cd.writeUInt32LE(data.length, 20); cd.writeUInt32LE(size, 24); cd.writeUInt16LE(n.length, 28); cd.writeUInt32LE(0, 42);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(1, 8); eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(46 + n.length, 12); eocd.writeUInt32LE(30 + n.length + data.length, 16);
  return Buffer.concat([local, n, data, cd, n, eocd]);
}

describe("safeArchive", () => {
  it("reads stored and deflated entries", () => {
    expect(unzipFirstEntry(zipOf("a.txt", "hello"))).toBe("hello");
    expect(unzipFirstEntry(zipOf("a.txt", "plain", { method: 0 }))).toBe("plain");
  });

  it("refuses a zip bomb by declared size and by actual inflated size", () => {
    const bomb = zipOf("bomb.txt", "0".repeat(2_000_000));
    const [entry] = listZipEntries(bomb);
    expect(() => readZipEntry(bomb, entry, { maxBytes: 1_000_000 })).toThrow(/over the 1000000-byte limit/);
    const lying = zipOf("bomb.txt", "0".repeat(2_000_000), { declared: 10 });
    const [e2] = listZipEntries(lying);
    expect(() => readZipEntry(lying, e2, { maxBytes: 1_000_000 })).toThrow(BrokerError);
    expect(() => gunzipCapped(gzipSync(Buffer.alloc(2_000_000)), { maxBytes: 1_000_000 })).toThrow(BrokerError);
  });

  it("accepts only stored/deflate and turns corrupt offsets into BrokerError", () => {
    expect(() => unzipFirstEntry(zipOf("a.txt", "x", { method: 12 }))).toThrow(/unsupported ZIP compression method 12/);
    const z = zipOf("a.txt", "hello");
    z.writeUInt32LE(0x7fffffff, z.length - 22 + 16); // central directory offset far past the end
    expect(() => unzipFirstEntry(z)).toThrow(BrokerError);
    expect(() => unzipFirstEntry(Buffer.from("not a zip at all, definitely not"))).toThrow(BrokerError);
  });

  it("caps downloads by Content-Length and by streamed bytes", async () => {
    await expect(readBodyCapped(new Response("x".repeat(50), { headers: { "content-length": "50" } }), { maxBytes: 10 })).rejects.toThrow(/over the 10-byte limit/);
    await expect(readBodyCapped(new Response("x".repeat(50)), { maxBytes: 10 })).rejects.toThrow(BrokerError);
    expect((await readBodyCapped(new Response("abc"), { maxBytes: 10 })).toString()).toBe("abc");
  });
});
