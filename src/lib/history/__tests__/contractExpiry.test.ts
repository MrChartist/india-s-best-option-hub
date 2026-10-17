import { describe, expect, it } from "vitest";
import { toISTDate } from "@/lib/options";
import { checkContractExpiry } from "../contractExpiry";

const NOW = toISTDate("2026-10-17", "11:00");

describe("checkContractExpiry", () => {
  it("redirects a holiday expiry to the shifted trading day", () => {
    // 20 Oct 2026 (Tue) is Dussehra: the NIFTY weekly moves to Mon 19 Oct.
    expect(checkContractExpiry("NIFTY", "2026-10-20", NOW)).toEqual({ kind: "shifted", to: "2026-10-19" });
  });

  it("flags past expiries as expired", () => {
    expect(checkContractExpiry("NIFTY", "2020-01-01", NOW).kind).toBe("expired");
  });

  it("accepts listed expiries and rejects non-expiry dates", () => {
    expect(checkContractExpiry("NIFTY", "2026-10-27", NOW).kind).toBe("listed");
    expect(checkContractExpiry("NIFTY", "2026-10-28", NOW).kind).toBe("unlisted");
    expect(checkContractExpiry("NIFTY", "2026-13-40", NOW).kind).toBe("unlisted");
  });

  it("leaves symbols without a spec to the live chain", () => {
    expect(checkContractExpiry("ZZUNKNOWN", "2026-10-28", NOW).kind).toBe("listed");
  });
});
