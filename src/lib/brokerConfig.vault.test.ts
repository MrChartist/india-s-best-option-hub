// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  enableEncryptedMode,
  encryptJSON,
  getSavedBrokers,
  isVaultLocked,
  saveBrokerCredentials,
  unlockVault,
  wipeAllCredentials,
} from "@/lib/brokerConfig";

const VAULT_KEY = "mc_broker_vault_v1";
const MODE_KEY = "mc_broker_storage_mode";
const dhan = (clientId: string) => ({ brokerId: "dhan", values: { clientId, accessToken: `tok_${clientId}_${"x".repeat(24)}` }, addedAt: "2026-10-18T00:00:00.000Z" });

/** What another tab does: session mode wipes the vault, then encrypting writes a new one with a fresh salt. */
async function rekeyInAnotherTab(passphrase: string, clientId: string) {
  const blob = await encryptJSON([{ ...dhan(clientId), isActive: true }], passphrase);
  localStorage.setItem(VAULT_KEY, JSON.stringify(blob));
  localStorage.setItem(MODE_KEY, "encrypted");
}

describe("encrypted vault re-keyed in another tab", () => {
  beforeEach(() => {
    wipeAllCredentials();
    localStorage.clear();
    sessionStorage.clear();
  });

  it("a stale tab does not overwrite the new vault with its old key", async () => {
    await enableEncryptedMode("oldpass123");
    await saveBrokerCredentials(dhan("AAA111"));
    await rekeyInAnotherTab("newpass123", "BBB222");

    // The stale tab no longer shows or sends its old in-memory credentials...
    expect(getSavedBrokers()).toEqual([]);
    expect(isVaultLocked()).toBe(true);
    // ...and cannot save over the new vault.
    await expect(saveBrokerCredentials(dhan("CCC333"))).rejects.toThrow(/Unlock|locked/);
    // The new passphrase still opens the vault, with the other tab's keys intact.
    expect(await unlockVault("newpass123")).toBe(true);
    expect(getSavedBrokers().map((b) => b.values.clientId)).toEqual(["BBB222"]);
  }, 30000);

  it("locks this tab when a storage event says the vault was re-keyed", async () => {
    await enableEncryptedMode("oldpass123");
    await saveBrokerCredentials(dhan("AAA111"));
    await rekeyInAnotherTab("newpass123", "BBB222");
    window.dispatchEvent(new StorageEvent("storage", { key: VAULT_KEY }));
    expect(isVaultLocked()).toBe(true);
    expect(await unlockVault("oldpass123")).toBe(false);
  }, 30000);
});
