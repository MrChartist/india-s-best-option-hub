import { describe, expect, it } from "vitest";
import { BROKERS, getBrokerInfo, type BrokerInfo } from "./brokerConfig";
import { EMPTY_FILTER, capabilityLabels, capabilityMatrix, filterBrokers, missingCredentialFields } from "./brokerDirectory";

const get = (id: string) => getBrokerInfo(id) as BrokerInfo;

describe("capabilityMatrix", () => {
  it("derives every column from the adapter's declared capabilities", () => {
    const dhan = capabilityMatrix(get("dhan"));
    expect(dhan.chain).toMatchObject({ level: "yes", label: "Broker Greeks" });
    expect(dhan.quotes.label).toBe("Quotes + depth");
    expect(dhan.feed.level).toBe("yes");
    expect(dhan.portfolio.level).toBe("yes");
    expect(dhan.orders).toMatchObject({ level: "yes", label: "1Cliq (armed)" });

    const zerodha = capabilityMatrix(get("zerodha"));
    expect(zerodha.chain.label).toBe("Computed Greeks");
    expect(zerodha.orders.level).toBe("gated");

    expect(capabilityMatrix(get("motilal")).quotes.label).toBe("Quotes");
    expect(capabilityMatrix(get("kotak")).feed.level).toBe("no");
    const nubra = capabilityMatrix(get("nubra")).portfolio;
    expect(nubra.level).toBe("partial");
    expect(nubra.detail).toMatch(/trade book/);
  });

  it("never claims live orders for an unverified broker", () => {
    for (const b of BROKERS.filter((x) => !x.verified)) expect(capabilityMatrix(b).orders.level, b.id).not.toBe("yes");
  });

  it("handles thin adapters", () => {
    const thin = { capabilities: ["ltp"] as BrokerInfo["capabilities"], greeks: null, verified: false };
    const m = capabilityMatrix(thin);
    expect(m.chain.level).toBe("no");
    expect(m.quotes.level).toBe("partial");
    expect(m.portfolio.level).toBe("no");
    expect(m.orders.level).toBe("no");
    expect(capabilityMatrix({ ...thin, capabilities: [] }).quotes.level).toBe("no");
    expect(capabilityLabels({ capabilities: ["testConnection", "optionChain", "feed"] })).toEqual(["Option chain", "Live feed"]);
  });
});

describe("filterBrokers", () => {
  it("returns all 41 with no filter and narrows by search words", () => {
    expect(filterBrokers(BROKERS, EMPTY_FILTER)).toHaveLength(41);
    expect(filterBrokers(BROKERS, { ...EMPTY_FILTER, query: "kite" }).map((b) => b.id)).toEqual(["zerodha"]);
    expect(filterBrokers(BROKERS, { ...EMPTY_FILTER, query: "  XTS   wisdom " }).map((b) => b.id)).toEqual(["wisdom"]);
    expect(filterBrokers(BROKERS, { ...EMPTY_FILTER, query: "zzzz-nothing" })).toEqual([]);
  });

  it("filters by sign-in method, capability and saved state", () => {
    const session = filterBrokers(BROKERS, { ...EMPTY_FILTER, auth: "sessionLogin" });
    expect(session.length).toBeGreaterThan(5);
    expect(session.every((b) => b.authKind === "sessionLogin")).toBe(true);
    const feed = filterBrokers(BROKERS, { ...EMPTY_FILTER, capability: "feed" });
    expect(feed.map((b) => b.id)).toContain("upstox");
    expect(feed.map((b) => b.id)).not.toContain("kotak");
    expect(filterBrokers(BROKERS, { ...EMPTY_FILTER, capability: "orders" }).map((b) => b.id)).not.toContain("axisdirect");
    expect(filterBrokers(BROKERS, { ...EMPTY_FILTER, capability: "orders" })).toHaveLength(40);
    expect(filterBrokers(BROKERS, { ...EMPTY_FILTER, savedOnly: true }, new Set(["samco"])).map((b) => b.id)).toEqual(["samco"]);
  });
});

describe("missingCredentialFields", () => {
  it("lists missing required fields", () => {
    expect(missingCredentialFields(get("zerodha"), { apiKey: "k" })).toEqual(["API Secret", "Access Token"]);
    expect(missingCredentialFields(get("zerodha"), { apiKey: "k", apiSecret: "s", accessToken: " t " })).toEqual([]);
  });

  it("needs one complete alternative", () => {
    const groww = get("groww");
    expect(missingCredentialFields(groww, {})).toEqual(["Access Token (daily) or API Key + API Secret"]);
    expect(missingCredentialFields(groww, { apiKey: "k" })).toHaveLength(1);
    expect(missingCredentialFields(groww, { apiKey: "k", apiSecret: "s" })).toEqual([]);
    expect(missingCredentialFields(groww, { accessToken: "t" })).toEqual([]);
    expect(missingCredentialFields({ fields: [], alternatives: [["x"]] }, {})).toEqual(["x"]);
  });
});
