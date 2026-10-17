/**
 * F&O screener universe.
 *
 * The live list comes from NSE "SECURITIES IN F&O" (useFnOStocks / fetchLiveFnOStocks).
 * When that is unavailable we fall back to a curated static list kept here. The static
 * list is deduplicated, carries the current NSE symbols for renamed companies
 * (ZOMATO → ETERNAL, ADANITRANS → ADANIENSOL, …) and drops names that left the F&O
 * segment or were delisted. It is a fallback only: verify against the NSE F&O list.
 */
import type { FnOStockData } from "@/lib/marketApi";

export type InstrumentKind = "STOCK" | "INDEX";

export interface UniverseRow {
  symbol: string;
  kind: InstrumentKind;
  sector: string;
  ltp: number;
  prevClose: number;
  changePct: number;
  /** Underlying traded volume (shares) for the day; 0 when unknown. */
  volume: number;
}

/** Old NSE symbol → current NSE symbol. Applied to live and static lists alike. */
export const RENAMED_SYMBOLS: Readonly<Record<string, string>> = {
  ZOMATO: "ETERNAL",
  ADANITRANS: "ADANIENSOL",
  "MCDOWELL-N": "UNITDSPR",
  "L&TFH": "LTF",
  LTI: "LTIM",
  IBULHSGFIN: "SAMMAANCAP",
  TATAMOTORS: "TMPV",
  CADILAHC: "ZYDUSLIFE",
  MOTHERSUMI: "MOTHERSON",
  PVR: "PVRINOX",
};

/** Index underlyings with NSE F&O contracts. */
export const FNO_INDICES: readonly string[] = ["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY"];

/** Curated fallback list grouped by sector (verify against the NSE F&O list). */
const STATIC_BY_SECTOR: Readonly<Record<string, readonly string[]>> = {
  Banks: [
    "HDFCBANK", "ICICIBANK", "SBIN", "KOTAKBANK", "AXISBANK", "INDUSINDBK", "BANKBARODA", "PNB", "CANBK",
    "IDFCFIRSTB", "FEDERALBNK", "BANDHANBNK", "AUBANK", "RBLBANK", "UNIONBANK", "INDIANB", "YESBANK", "BANKINDIA",
  ],
  "Financial services": [
    "BAJFINANCE", "BAJAJFINSV", "SHRIRAMFIN", "CHOLAFIN", "MUTHOOTFIN", "MANAPPURAM", "LICHSGFIN", "PFC", "RECLTD",
    "IRFC", "LTF", "SAMMAANCAP", "ABCAPITAL", "SBICARD", "HDFCLIFE", "SBILIFE", "ICICIGI", "ICICIPRULI", "LICI",
    "HDFCAMC", "MFSL", "JIOFIN", "BSE", "CDSL", "MCX", "ANGELONE", "CAMS", "KFINTECH", "PAYTM", "POLICYBZR", "IIFL", "NUVAMA", "360ONE", "PNBHOUSING",
  ],
  IT: [
    "TCS", "INFY", "HCLTECH", "WIPRO", "TECHM", "LTIM", "MPHASIS", "COFORGE", "PERSISTENT", "OFSS", "KPITTECH", "TATAELXSI", "CYIENT", "TATATECH",
  ],
  "Oil, gas and power": [
    "RELIANCE", "ONGC", "BPCL", "IOC", "HINDPETRO", "GAIL", "PETRONET", "IGL", "OIL", "NTPC", "POWERGRID", "TATAPOWER",
    "ADANIGREEN", "ADANIENSOL", "NHPC", "JSWENERGY", "TORNTPOWER", "SUZLON", "INOXWIND", "IREDA", "COALINDIA",
  ],
  Auto: [
    "MARUTI", "M&M", "TMPV", "BAJAJ-AUTO", "HEROMOTOCO", "EICHERMOT", "TVSMOTOR", "ASHOKLEY", "MOTHERSON", "BOSCHLTD",
    "BHARATFORG", "EXIDEIND", "SONACOMS", "TIINDIA", "UNOMINDA",
  ],
  "Metals and mining": [
    "TATASTEEL", "JSWSTEEL", "HINDALCO", "VEDL", "JINDALSTEL", "SAIL", "NMDC", "NATIONALUM", "HINDZINC", "APLAPOLLO",
  ],
  Pharma: [
    "SUNPHARMA", "DRREDDY", "CIPLA", "DIVISLAB", "LUPIN", "AUROPHARMA", "BIOCON", "ALKEM", "TORNTPHARM", "ZYDUSLIFE",
    "GLENMARK", "LAURUSLABS", "MANKIND", "APOLLOHOSP", "MAXHEALTH", "FORTIS", "SYNGENE", "LALPATHLAB", "PPLPHARMA",
  ],
  FMCG: [
    "HINDUNILVR", "ITC", "NESTLEIND", "BRITANNIA", "TATACONSUM", "DABUR", "MARICO", "GODREJCP", "COLPAL", "UNITDSPR", "VBL", "PATANJALI",
  ],
  "Capital goods": [
    "LT", "SIEMENS", "ABB", "BHEL", "HAL", "BEL", "CUMMINSIND", "POLYCAB", "KEI", "HAVELLS", "CGPOWER", "BDL", "MAZDOCK", "SOLARINDS", "RVNL", "SUPREMEIND", "ASTRAL",
  ],
  "Cement and materials": [
    "ULTRACEMCO", "GRASIM", "SHREECEM", "AMBUJACEM", "DALBHARAT", "ASIANPAINT", "PIDILITIND", "SRF", "UPL", "PIIND", "COROMANDEL", "CHAMBLFERT",
  ],
  "Consumer and retail": [
    "TITAN", "TRENT", "DMART", "ETERNAL", "SWIGGY", "NYKAA", "JUBLFOOD", "PAGEIND", "VOLTAS", "BLUESTARCO", "DIXON", "KALYANKJIL", "INDHOTEL", "IRCTC", "INDIGO",
  ],
  "Telecom and media": ["BHARTIARTL", "IDEA", "INDUSTOWER", "TATACOMM"],
  Realty: ["DLF", "GODREJPROP", "OBEROIRLTY", "PRESTIGE", "LODHA", "PHOENIXLTD"],
  "Logistics and infra": ["ADANIENT", "ADANIPORTS", "CONCOR", "DELHIVERY", "GMRAIRPORT", "NBCC", "HUDCO"],
};

export const STATIC_SECTOR_OF: Readonly<Record<string, string>> = (() => {
  const out: Record<string, string> = {};
  for (const [sector, list] of Object.entries(STATIC_BY_SECTOR)) {
    for (const s of list) if (!out[s]) out[s] = sector;
  }
  return out;
})();

/** Deduplicated, sorted static fallback list of F&O stocks. */
export const STATIC_FNO_STOCKS: readonly string[] = Object.keys(STATIC_SECTOR_OF).sort();

/** Apply the rename map and normalise case/whitespace. */
export function canonicalFnoSymbol(raw: string): string {
  const s = String(raw ?? "").trim().toUpperCase();
  return RENAMED_SYMBOLS[s] ?? s;
}

/** Deduplicate a symbol list after renames, keeping the first occurrence. */
export function dedupeSymbols(list: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    const s = canonicalFnoSymbol(raw);
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

const finite = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

/** Sector for a symbol: the live industry tag, else the static map, else "Other". */
export function sectorOf(symbol: string, liveSector?: string): string {
  if (liveSector && liveSector.trim()) return liveSector.trim();
  if (FNO_INDICES.includes(symbol)) return "Index";
  return STATIC_SECTOR_OF[symbol] ?? "Other";
}

/** Build the stock universe from the live F&O list (renames applied, duplicates and junk rows dropped). */
export function universeFromLive(stocks: readonly FnOStockData[]): UniverseRow[] {
  const out: UniverseRow[] = [];
  const seen = new Set<string>();
  for (const s of stocks) {
    const symbol = canonicalFnoSymbol(s?.symbol ?? "");
    if (!symbol || seen.has(symbol) || symbol.includes(" ")) continue;
    if (!finite(s.ltp) || s.ltp <= 0) continue;
    seen.add(symbol);
    const prevClose = finite(s.previousClose) && s.previousClose > 0 ? s.previousClose : s.ltp - (finite(s.change) ? s.change : 0);
    const changePct = finite(s.changePercent) ? s.changePercent : prevClose > 0 ? ((s.ltp - prevClose) / prevClose) * 100 : 0;
    const volume = finite(s.totalTradedVolume) && s.totalTradedVolume > 0 ? s.totalTradedVolume : finite(s.volume) ? s.volume : 0;
    out.push({ symbol, kind: "STOCK", sector: sectorOf(symbol, s.sector), ltp: s.ltp, prevClose, changePct, volume });
  }
  return out;
}

/** Index rows from the live indices feed (NIFTY, BANKNIFTY, FINNIFTY, MIDCPNIFTY). */
const INDEX_NAMES: Readonly<Record<string, string>> = {
  NIFTY: "NIFTY 50",
  BANKNIFTY: "NIFTY BANK",
  FINNIFTY: "NIFTY FINANCIAL SERVICES",
  MIDCPNIFTY: "NIFTY MIDCAP SELECT",
};

export function universeFromIndices(indices: ReadonlyArray<{ symbol: string; name?: string; ltp: number; changePercent: number; prevClose?: number }>): UniverseRow[] {
  const out: UniverseRow[] = [];
  for (const sym of FNO_INDICES) {
    const ix = indices.find((i) => String(i.symbol).toUpperCase() === sym || String(i.name ?? "").toUpperCase() === INDEX_NAMES[sym] || String(i.symbol).toUpperCase() === INDEX_NAMES[sym]);
    if (!ix || !finite(ix.ltp) || ix.ltp <= 0) continue;
    const pct = finite(ix.changePercent) ? ix.changePercent : 0;
    const prevClose = finite(ix.prevClose) && (ix.prevClose ?? 0) > 0 ? (ix.prevClose as number) : ix.ltp / (1 + pct / 100);
    out.push({ symbol: sym, kind: "INDEX", sector: "Index", ltp: ix.ltp, prevClose, changePct: pct, volume: 0 });
  }
  return out;
}
