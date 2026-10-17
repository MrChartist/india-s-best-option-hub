import { describe, expect, it } from "vitest";
import { detectBroker, monthlyExpiryOf, parseAngel, parseCsv, parseDateTime, parseDhan, parseInstrument, parseTradebook, parseUpstox, parseZerodha } from "@/lib/journal/parsers";

describe("parseCsv", () => {
  it("handles quotes, escaped quotes, CRLF, BOM and blank lines", () => {
    const rows = parseCsv('\uFEFFa,b,c\r\n"x, y","say ""hi""",3\r\n\r\n4,5,6');
    expect(rows.map((r) => r.cells)).toEqual([
      ["a", "b", "c"],
      ["x, y", 'say "hi"', "3"],
      ["4", "5", "6"],
    ]);
    expect(rows[2].line).toBe(4);
  });
  it("sniffs semicolon and tab delimiters", () => {
    expect(parseCsv("a;b\n1;2")[1].cells).toEqual(["1", "2"]);
    expect(parseCsv("a\tb\n1\t2")[1].cells).toEqual(["1", "2"]);
  });
});

describe("parseInstrument", () => {
  it("reads Zerodha weekly symbols", () => {
    expect(parseInstrument("NIFTY26O0625000CE")).toEqual({ underlying: "NIFTY", expiry: "2026-10-06", strike: 25000, type: "CE" });
    expect(parseInstrument("NIFTY2610625000CE")?.expiry).toBe("2026-01-06");
    expect(parseInstrument("NIFTY26N1724500PE")).toEqual({ underlying: "NIFTY", expiry: "2026-11-17", strike: 24500, type: "PE" });
  });
  it("reads Zerodha monthly symbols and futures, resolving the monthly expiry", () => {
    const exp = monthlyExpiryOf("BANKNIFTY", 2026, 10);
    expect(exp.startsWith("2026-10-")).toBe(true);
    expect(parseInstrument("BANKNIFTY26OCT55000PE")).toEqual({ underlying: "BANKNIFTY", expiry: exp, strike: 55000, type: "PE" });
    expect(parseInstrument("RELIANCE26OCTFUT")?.type).toBe("FUT");
    expect(parseInstrument("M&M26OCT3000CE")?.underlying).toBe("M&M");
  });
  it("reads Angel symbols (day first) when told the style", () => {
    expect(parseInstrument("NIFTY27OCT2625000CE", "angel")).toEqual({ underlying: "NIFTY", expiry: "2026-10-27", strike: 25000, type: "CE" });
    expect(parseInstrument("NIFTY27OCT26FUT", "angel")).toEqual({ underlying: "NIFTY", expiry: "2026-10-27", strike: 0, type: "FUT" });
  });
  it("reads spaced and dashed labels", () => {
    expect(parseInstrument("NIFTY 27 OCT 2026 25000 CALL")).toEqual({ underlying: "NIFTY", expiry: "2026-10-27", strike: 25000, type: "CE" });
    expect(parseInstrument("NIFTY-Oct2026-24500-PE")?.expiry).toBe(monthlyExpiryOf("NIFTY", 2026, 10));
    expect(parseInstrument("BANKNIFTY 27OCT26 55000 PE")).toEqual({ underlying: "BANKNIFTY", expiry: "2026-10-27", strike: 55000, type: "PE" });
    expect(parseInstrument("NIFTY 27 OCT 25000 CE", "auto", "2026-10-14")?.expiry).toBe("2026-10-27");
  });
  it("rejects equity and junk", () => {
    expect(parseInstrument("RELIANCE")).toBeNull();
    expect(parseInstrument("")).toBeNull();
    expect(parseInstrument("NIFTY 27 OCT 2026 CE")).toBeNull();
  });
});

describe("parseDateTime", () => {
  it("reads ISO, d-m-y and 12-hour times in IST", () => {
    const a = parseDateTime("2026-10-14T10:15:22");
    expect(a?.date).toBe("2026-10-14");
    expect(new Date(a!.ts!).toISOString()).toBe("2026-10-14T04:45:22.000Z");
    const b = parseDateTime("14/10/2026", "02:05:11 PM");
    expect(b?.date).toBe("2026-10-14");
    expect(new Date(b!.ts!).toISOString()).toBe("2026-10-14T08:35:11.000Z");
    expect(parseDateTime("14-Oct-2026")).toEqual({ date: "2026-10-14", ts: null });
    expect(parseDateTime("not a date")).toBeNull();
  });
});

const ZERODHA = `symbol,isin,trade_date,exchange,segment,series,trade_type,auction,quantity,price,trade_id,order_id,order_execution_time,expiry_date
NIFTY26O0625000CE,,2026-10-01,NFO,FO,,sell,false,65,120.50,1001,9001,2026-10-01T09:45:10,2026-10-06
NIFTY26O0625000CE,,2026-10-01,NFO,FO,,sell,false,65,120.40,1002,9001,2026-10-01T09:45:10,2026-10-06
NIFTY26O0625000CE,,2026-10-03,NFO,FO,,buy,false,130,60.00,1003,9002,2026-10-03T14:10:00,2026-10-06
RELIANCE,INE002A01018,2026-10-03,NSE,EQ,EQ,buy,false,10,1450,1004,9003,2026-10-03T10:00:00,`;

describe("broker parsers", () => {
  it("Zerodha: reads F&O rows, skips equity, keeps ids and order ids", () => {
    const r = parseZerodha(ZERODHA);
    expect(r.fills).toHaveLength(3);
    expect(r.issues).toHaveLength(1);
    expect(r.fills[0]).toMatchObject({ id: "zerodha:1001", orderId: "9001", side: "SELL", qty: 65, price: 120.5, underlying: "NIFTY", strike: 25000, type: "CE", expiry: "2026-10-06", exchange: "NSE" });
    expect(detectBroker(ZERODHA)).toBe("zerodha");
  });

  it("Dhan: spaced names and separate date and time columns", () => {
    const csv = `Date,Time,Security Name,Buy/Sell,Order Type,Exchange,Segment,Quantity,Trade Price,Trade Value,Order ID,Exchange Trade ID
14-10-2026,10:02:03,NIFTY 20 OCT 2026 24800 PUT,BUY,MARKET,NSE,FNO,65,88.15,5729.75,D1,T1
14-10-2026,13:30:00,NIFTY 20 OCT 2026 24800 PUT,SELL,MARKET,NSE,FNO,65,101.00,6565,D2,T2`;
    expect(detectBroker(csv)).toBe("dhan");
    const r = parseDhan(csv);
    expect(r.issues).toEqual([]);
    expect(r.fills.map((f) => [f.side, f.type, f.strike, f.expiry, f.price])).toEqual([
      ["BUY", "PE", 24800, "2026-10-20", 88.15],
      ["SELL", "PE", 24800, "2026-10-20", 101],
    ]);
    expect(new Date(r.fills[0].ts!).toISOString()).toBe("2026-10-14T04:32:03.000Z");
  });

  it("Upstox: separate strike, expiry and option-type columns", () => {
    const csv = `Date,Company,Amount,Exchange,Segment,Scrip Code,Instrument Type,Strike Price,Option Type,Expiry,Trade Num,Trade Time,Side,Quantity,Price
15-10-2026,BANKNIFTY,9000,NSE,FO,123,OPTIDX,55000,CE,27-10-2026,U1,11:20:00,Buy,30,300
16-10-2026,BANKNIFTY,9600,NSE,FO,123,OPTIDX,55000,CE,27-10-2026,U2,09:31:00,Sell,30,320`;
    expect(detectBroker(csv)).toBe("upstox");
    const r = parseUpstox(csv);
    expect(r.fills).toHaveLength(2);
    expect(r.fills[0]).toMatchObject({ underlying: "BANKNIFTY", strike: 55000, type: "CE", expiry: "2026-10-27", side: "BUY", qty: 30, price: 300 });
  });

  it("Angel One: day-first symbols and B/S codes", () => {
    const csv = `Trade Date,Trade Time,Symbol,Trans Type,Quantity,Trade Price,Exchange,Order No,Trade No
13/10/2026,09:20:00,NIFTY20OCT2625200CE,S,130,64.5,NFO,A1,AT1
13/10/2026,15:10:00,NIFTY20OCT2625200CE,B,130,41.0,NFO,A2,AT2`;
    expect(detectBroker(csv)).toBe("angel");
    const r = parseAngel(csv);
    expect(r.fills.map((f) => [f.side, f.expiry, f.strike, f.qty])).toEqual([
      ["SELL", "2026-10-20", 25200, 130],
      ["BUY", "2026-10-20", 25200, 130],
    ]);
  });

  it("reports a missing header and unreadable rows instead of throwing", () => {
    expect(parseZerodha("hello,world\n1,2").issues[0].message).toMatch(/header/);
    const bad = parseZerodha(`symbol,trade_date,trade_type,quantity,price\nNIFTY26O0625000CE,garbage,buy,65,10\nNIFTY26O0625000CE,2026-10-01,hold,65,10`);
    expect(bad.fills).toHaveLength(0);
    expect(bad.issues.map((i) => i.line)).toEqual([2, 3]);
  });

  it("auto-detects or falls back to the parser that reads the most rows", () => {
    expect(parseTradebook(ZERODHA).broker).toBe("zerodha");
    const generic = `trade date,symbol,buy/sell,qty,price\n2026-10-01,NIFTY26O0625000CE,buy,65,10`;
    expect(parseTradebook(generic).fills).toHaveLength(1);
  });
});
