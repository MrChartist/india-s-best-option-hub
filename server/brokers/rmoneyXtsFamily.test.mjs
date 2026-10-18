/**
 * Pure-function tests for rmoneyXtsFamily.mjs (the rmoney / wisdom / iifl XTS engine), using the official
 * sample rows and payloads from https://ttblaze.iifl.com/doc/apimarketdata/ and /doc/interactive/.
 */
import { describe, expect, it } from "vitest";
import { BrokerInputError } from "./contract.mjs";
import {
  buildModifyBody, buildPlaceBody, canonicalIndex, cashTokenFromUnderlying, isoExpiry, istStamp, orderStatusOf,
  parseCandles, parseIndexEntries, parseMasterFo, pinnedConnectionString, readListQuotes, rowToInstrument, touchlineOf, xtsTime,
} from "./rmoneyXtsFamily.mjs";

// Official master samples (Options / Futures rows).
const OPT_ROW = "NSEFO|48225|2|NIFTY|NIFTY2621725700PE|OPTIDX|NIFTY-OPTIDX|2604800048225|588|114.5|1801|0.05|65|1|-1|Nifty 50|2026-02-17T14:30:00|25700|4|NIFTY 17FEB2026 PE 25700|1|1|NIFTY2621725700PE";
const FUT_ROW = "NSEFO|49229|1|NIFTY|NIFTY26JANFUT|FUTIDX|NIFTY-FUTIDX|2602700049229|28369.8|23211.8|1801|0.1|65|1|-1|Nifty 50|2026-01-27T14:30:00|NIFTY 27JAN2026|1|1|NIFTY26JANFUT";

describe("instrument master", () => {
  it("parses the official option and future sample rows", () => {
    const [o, f] = parseMasterFo(`${OPT_ROW}\n${FUT_ROW}\n`);
    expect(o).toMatchObject({ seg: "NSEFO", token: "48225", name: "NIFTY", index: true, lot: 65, tick: 0.05, expiry: "2026-02-17", strike: 25700, opt: "PE" });
    expect(f).toMatchObject({ token: "49229", name: "NIFTY", index: true, expiry: "2026-01-27", strike: null, opt: null });
    expect(rowToInstrument(o)).toMatchObject({ exchange: "NFO", instrumentType: "OPTIDX", underlying: "NIFTY", optionType: "PE" });
    expect(rowToInstrument(f)).toMatchObject({ instrumentType: "FUTIDX", strike: null });
  });

  it("falls back to UnderlyingIndexName when Name is not the canonical index", () => {
    expect(canonicalIndex("INIFTY", "Nifty 50")).toBe("NIFTY");
    expect(canonicalIndex("X", "Nifty Fin Service")).toBe("FINNIFTY");
    expect(canonicalIndex("X", "S&P BSE SENSEX")).toBe("SENSEX");
    expect(canonicalIndex("RELIANCE", "")).toBeNull();
    const [row] = parseMasterFo(OPT_ROW.replace("|NIFTY|NIFTY26", "|INIFTY|NIFTY26"));
    expect(row.name).toBe("NIFTY");
  });

  it("drops index derivatives outside the canonical list", () => {
    const [row] = parseMasterFo(OPT_ROW.replace(/\|NIFTY\|/, "|NIFTYNXT50|").replace("Nifty 50", "Nifty Next 50"));
    expect(rowToInstrument(row)).toBeNull();
  });

  it("parses expiries and index entries", () => {
    expect(isoExpiry("2026-10-20T14:30:00")).toBe("2026-10-20");
    expect(isoExpiry("20-Oct-2026")).toBe("2026-10-20");
    expect(isoExpiry("garbage")).toBeNull();
    expect(parseIndexEntries(["NIFTY 50_26000", "NIFTY  BANK_26001", "bad"])).toEqual([{ name: "NIFTY 50", token: "26000" }, { name: "NIFTY BANK", token: "26001" }]);
    expect(cashTokenFromUnderlying("1100100002885")).toBe("2885");
    expect(cashTokenFromUnderlying("-1")).toBeNull();
  });
});

describe("quotes", () => {
  const q = { ExchangeSegment: 1, ExchangeInstrumentID: 2885, Touchline: { LastTradedPrice: 900.05 } };
  it("reads every documented listQuotes form", () => {
    expect(readListQuotes({ listQuotes: [JSON.stringify(q)] })).toEqual([q]);
    expect(readListQuotes({ listQuotes: [q] })).toEqual([q]);
    expect(readListQuotes({ listQuotes: q })).toEqual([q]);
    expect(readListQuotes({ listQuotes: ["{not json", JSON.stringify(q)] })).toEqual([q]);
    expect(readListQuotes({})).toEqual([]);
  });
  it("reads nested (1502) and flat (1501) touchlines", () => {
    expect(touchlineOf(q).LastTradedPrice).toBe(900.05);
    expect(touchlineOf({ LastTradedPrice: 1723 }).LastTradedPrice).toBe(1723);
  });
});

describe("historical", () => {
  it("turns the official daily sample into the IST-midnight epoch", () => {
    const [c] = parseCandles("1737331200|1316|1316|1300.25|1305.45|14040244|0|", "1d");
    expect(c).toEqual({ time: Date.parse("2025-01-20T00:00:00+05:30") / 1000, open: 1316, high: 1316, low: 1300.25, close: 1305.45, volume: 14040244, oi: 0 });
  });
  it("shifts intraday IST-as-UTC stamps to true epoch seconds", () => {
    const [c] = parseCandles(`${Date.UTC(2026, 9, 19, 9, 15) / 1000}|1|2|0.5|1.5|10|`, "1m");
    expect(c.time).toBe(Date.parse("2026-10-19T09:15:00+05:30") / 1000);
  });
  it("formats the official OHLC time", () => {
    expect(xtsTime(Date.parse("2025-01-27T09:00:00+05:30"))).toBe("Jan 27 2025 090000");
  });
});

describe("orders", () => {
  const base = { exchange: "NFO", token: "40003", transactionType: "SELL", orderType: "SL", product: "INTRADAY", lots: 3, price: 99.5, triggerPrice: 100 };
  it("builds the place body from master lot size and official enums", () => {
    expect(buildPlaceBody(base, 75)).toMatchObject({ exchangeSegment: "NSEFO", exchangeInstrumentID: 40003, productType: "MIS", orderType: "StopLimit", orderSide: "SELL", orderQuantity: 225, limitPrice: 99.5, stopPrice: 100 });
    expect(buildPlaceBody({ ...base, orderType: "MARKET", price: undefined, triggerPrice: undefined }, 75)).toMatchObject({ orderType: "Market", limitPrice: 0, stopPrice: 0 });
  });
  it("refuses bad input", () => {
    expect(() => buildPlaceBody(base, undefined)).toThrow(BrokerInputError);
    expect(() => buildPlaceBody({ ...base, lots: 1.5 }, 75)).toThrow(BrokerInputError);
    expect(() => buildPlaceBody({ ...base, product: "CO" }, 75)).toThrow(BrokerInputError);
    expect(() => buildPlaceBody({ ...base, triggerPrice: 0 }, 75)).toThrow(BrokerInputError);
    expect(() => buildPlaceBody({ ...base, exchange: "XYZ" }, 75)).toThrow(BrokerInputError);
  });
  it("keeps long order ids exact in the modify body", () => {
    expect(buildModifyBody("2190766863", { orderType: "LIMIT", product: "MARGIN", quantity: 75, price: 10 }).appOrderID).toBe(2190766863);
    expect(buildModifyBody("10001253450000041478", { orderType: "LIMIT", product: "MARGIN", quantity: 75, price: 10 }).appOrderID).toBe("10001253450000041478");
    expect(() => buildModifyBody("12; DROP", { orderType: "LIMIT", product: "MARGIN", quantity: 75, price: 10 })).toThrow(BrokerInputError);
  });
  it("maps every official order status", () => {
    const map = Object.fromEntries(["New", "PendingNew", "Replaced", "PendingReplace", "PendingCancel", "PartiallyFilled", "Filled", "Cancelled", "Rejected", "Weird"].map((s) => [s, orderStatusOf(s, "Limit")]));
    expect(map).toEqual({ New: "OPEN", PendingNew: "OPEN", Replaced: "OPEN", PendingReplace: "OPEN", PendingCancel: "OPEN", PartiallyFilled: "PARTIALLY_FILLED", Filled: "COMPLETE", Cancelled: "CANCELLED", Rejected: "REJECTED", Weird: "UNKNOWN" });
    expect(orderStatusOf("New", "StopMarket")).toBe("TRIGGER_PENDING");
    expect(istStamp("01-01-1980 00:00:00")).toBeNull();
  });
});

describe("host-lookup pinning", () => {
  const host = "https://ttblaze.iifl.com";
  it("accepts only an https connectionString on the broker's own host", () => {
    expect(pinnedConnectionString("https://ttblaze.iifl.com/1interactive", host)).toBe("https://ttblaze.iifl.com/1interactive");
    expect(pinnedConnectionString("https://ttblaze.iifl.com/interactive/", host)).toBe("https://ttblaze.iifl.com/interactive");
    expect(pinnedConnectionString("http://ttblaze.iifl.com/1interactive", host)).toBeNull();
    expect(pinnedConnectionString("https://ttblaze.iifl.com.evil.io/1interactive", host)).toBeNull();
    expect(pinnedConnectionString("https://user:pw@ttblaze.iifl.com/1interactive", host)).toBeNull();
    expect(pinnedConnectionString("https://ttblaze.iifl.com/other", host)).toBeNull();
    expect(pinnedConnectionString("10.0.0.5:3000", host)).toBeNull();
  });
});
