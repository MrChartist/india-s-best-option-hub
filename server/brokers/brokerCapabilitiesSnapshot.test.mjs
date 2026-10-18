/** The generated frontend capability table must match what the adapters declare today. */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildBrokerCapabilityMeta, renderBrokerCapabilityModule } from "./brokerCapabilityMeta.mjs";

describe("src/lib/brokerCapabilities.generated.ts", () => {
  it("is up to date (run: node scripts/generate-broker-capabilities.mjs)", () => {
    const onDisk = readFileSync(new URL("../../src/lib/brokerCapabilities.generated.ts", import.meta.url), "utf-8");
    expect(onDisk).toBe(renderBrokerCapabilityModule(buildBrokerCapabilityMeta()));
  });

  it("covers all 41 adapters and never lists a secret field as saveable", () => {
    const meta = buildBrokerCapabilityMeta();
    expect(Object.keys(meta)).toHaveLength(41);
    for (const [id, m] of Object.entries(meta)) {
      expect(m.credentialFields.filter((f) => /(pass(word)?|mpin|\bpin\b|totp|otp)/i.test(f)), id).toEqual([]);
      expect(m.capabilities, id).toEqual(expect.arrayContaining(["optionChain", "expiries", "ltp"]));
      if (m.authKind === "sessionLogin") expect(m.loginFields.some((f) => f.key === "totpCode"), id).toBe(true);
    }
  });
});
