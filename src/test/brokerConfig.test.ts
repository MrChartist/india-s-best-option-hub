import { describe, it, expect, beforeEach } from "vitest";
import {
  getSavedBrokers, saveBrokerCredentials, getActiveBroker, getAccount,
  getAccountsForBroker, setActiveAccount, setActiveBroker,
  removeBrokerAccount, removeBrokerCredentials,
} from "@/lib/brokerConfig";

const STORAGE_KEY = "optionsdesk_broker_keys";

beforeEach(() => localStorage.clear());

describe("multi-account support (two accounts at one broker)", () => {
  it("keeps both Dhan accounts instead of the second overwriting the first", () => {
    saveBrokerCredentials({ brokerId: "dhan", values: { clientId: "1000000042" }, addedAt: "", isActive: true });
    saveBrokerCredentials({ brokerId: "dhan", values: { clientId: "1000000099" }, addedAt: "", isActive: false });

    const all = getSavedBrokers();
    expect(all).toHaveLength(2);
    expect(getAccountsForBroker("dhan")).toHaveLength(2);
    expect(new Set(all.map((a) => a.accountId)).size).toBe(2);
  });

  it("updates in place when the accountId is supplied", () => {
    const saved = saveBrokerCredentials({ brokerId: "dhan", values: { clientId: "1" }, addedAt: "", isActive: true });
    saveBrokerCredentials({ ...saved, values: { clientId: "1", accessToken: "tok" } });

    const all = getSavedBrokers();
    expect(all).toHaveLength(1);
    expect(all[0].values.accessToken).toBe("tok");
  });

  it("labels accounts with a masked client id so they are tellable apart", () => {
    const a = saveBrokerCredentials({ brokerId: "dhan", values: { clientId: "1000000042" }, addedAt: "", isActive: true });
    expect(a.label).toContain("10****42");
  });

  it("respects an explicit label", () => {
    const a = saveBrokerCredentials({ brokerId: "dhan", label: "HUF account", values: {}, addedAt: "", isActive: false });
    expect(a.label).toBe("HUF account");
  });
});

describe("exactly one active account", () => {
  it("deactivates the others when a new active account is saved", () => {
    const a = saveBrokerCredentials({ brokerId: "dhan", values: { clientId: "1" }, addedAt: "", isActive: true });
    saveBrokerCredentials({ brokerId: "dhan", values: { clientId: "2" }, addedAt: "", isActive: true });

    const active = getSavedBrokers().filter((b) => b.isActive);
    expect(active).toHaveLength(1);
    expect(active[0].accountId).not.toBe(a.accountId);
  });

  it("switches the active account by id", () => {
    const a = saveBrokerCredentials({ brokerId: "dhan", values: { clientId: "1" }, addedAt: "", isActive: true });
    const b = saveBrokerCredentials({ brokerId: "dhan", values: { clientId: "2" }, addedAt: "", isActive: false });
    setActiveAccount(b.accountId);
    expect(getActiveBroker()?.accountId).toBe(b.accountId);
    expect(getAccount(a.accountId)?.isActive).toBe(false);
  });

  it("setActiveBroker still works by broker id, picking that broker's first account", () => {
    saveBrokerCredentials({ brokerId: "dhan", values: { clientId: "1" }, addedAt: "", isActive: true });
    const f = saveBrokerCredentials({ brokerId: "fyers", values: { clientId: "F1" }, addedAt: "", isActive: false });
    setActiveBroker("fyers");
    expect(getActiveBroker()?.accountId).toBe(f.accountId);
  });

  it("falls back to the first account when none is flagged active", () => {
    saveBrokerCredentials({ brokerId: "dhan", values: { clientId: "1" }, addedAt: "", isActive: false });
    expect(getActiveBroker()).not.toBeNull();
  });
});

describe("removal", () => {
  it("removes one account without touching its sibling", () => {
    const a = saveBrokerCredentials({ brokerId: "dhan", values: { clientId: "1" }, addedAt: "", isActive: true });
    saveBrokerCredentials({ brokerId: "dhan", values: { clientId: "2" }, addedAt: "", isActive: false });
    removeBrokerAccount(a.accountId);
    expect(getSavedBrokers()).toHaveLength(1);
  });

  it("removes every account for a broker", () => {
    saveBrokerCredentials({ brokerId: "dhan", values: { clientId: "1" }, addedAt: "", isActive: true });
    saveBrokerCredentials({ brokerId: "dhan", values: { clientId: "2" }, addedAt: "", isActive: false });
    saveBrokerCredentials({ brokerId: "fyers", values: { clientId: "F" }, addedAt: "", isActive: false });
    removeBrokerCredentials("dhan");
    expect(getSavedBrokers().map((b) => b.brokerId)).toEqual(["fyers"]);
  });
});

describe("migration from the old brokerId-keyed format", () => {
  it("gives existing records an accountId and a label without losing credentials", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([
      { brokerId: "dhan", values: { clientId: "1000000042", accessToken: "tok" }, addedAt: "2026-01-01", isActive: true },
    ]));

    const [rec] = getSavedBrokers();
    expect(rec.accountId).toMatch(/^acc_/);
    expect(rec.label).toContain("10****42");
    expect(rec.values.accessToken).toBe("tok");
    expect(rec.isActive).toBe(true);
  });

  it("persists the migration so ids stay stable across reads", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([
      { brokerId: "dhan", values: { clientId: "1" }, addedAt: "", isActive: true },
    ]));
    const first = getSavedBrokers()[0].accountId;
    expect(getSavedBrokers()[0].accountId).toBe(first);
  });

  it("drops malformed records rather than surfacing a broker-less account", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([{ values: {} }, { brokerId: "dhan", values: {} }]));
    expect(getSavedBrokers()).toHaveLength(1);
  });

  it("returns an empty list for corrupt storage instead of throwing", () => {
    localStorage.setItem(STORAGE_KEY, "{not json");
    expect(getSavedBrokers()).toEqual([]);
  });
});
