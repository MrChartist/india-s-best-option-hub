import { describe, expect, it } from "vitest";
import { istFileStamp, textPayload, withCharset } from "./download";

describe("download helpers", () => {
  it("adds a UTF-8 charset to text MIME types only", () => {
    expect(withCharset("text/csv")).toBe("text/csv;charset=utf-8");
    expect(withCharset("application/json")).toBe("application/json;charset=utf-8");
    expect(withCharset("text/csv;charset=utf-8")).toBe("text/csv;charset=utf-8");
    expect(withCharset("image/png")).toBe("image/png");
  });

  it("prefixes CSV with a single BOM", () => {
    const once = textPayload("a,₹", "text/csv;charset=utf-8");
    expect(once.charCodeAt(0)).toBe(0xfeff);
    expect(textPayload(once, "text/csv")).toBe(once);
    expect(textPayload("{}", "application/json")).toBe("{}");
  });

  it("stamps filenames in IST, not UTC", () => {
    // 2026-10-17 20:00 UTC is 2026-10-18 01:30 IST.
    expect(istFileStamp(new Date("2026-10-17T20:00:00Z"))).toBe("2026-10-18-0130");
  });
});
