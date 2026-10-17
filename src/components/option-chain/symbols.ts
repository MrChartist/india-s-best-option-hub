/**
 * F&O symbol catalogue for the chain's symbol picker.
 * Delisted or renamed contracts are removed (ADANITRANS → ADANIENSOL, ZOMATO → ETERNAL,
 * TATAMOTORS → TMPV after the 2025 demerger). Check the NSE F&O list after each quarterly review.
 */
export interface SymbolOption {
  label: string;
  value: string;
}

export interface SymbolCategory {
  label: string;
  symbols: SymbolOption[];
}

const plain = (xs: string[]): SymbolOption[] => xs.map((s) => ({ label: s, value: s }));

export const SYMBOL_CATEGORIES: SymbolCategory[] = [
  {
    label: "NSE indices",
    symbols: [
      { label: "NIFTY 50", value: "NIFTY" },
      { label: "BANK NIFTY", value: "BANKNIFTY" },
      { label: "FIN NIFTY", value: "FINNIFTY" },
      { label: "MIDCAP NIFTY", value: "MIDCPNIFTY" },
      { label: "NIFTY NEXT 50", value: "NIFTYNXT50" },
    ],
  },
  {
    label: "BSE indices",
    symbols: [
      { label: "SENSEX", value: "SENSEX" },
      { label: "BANKEX", value: "BANKEX" },
    ],
  },
  {
    label: "Nifty 50 stocks",
    symbols: plain([
      "RELIANCE", "TCS", "HDFCBANK", "INFY", "ICICIBANK", "HINDUNILVR", "SBIN", "BHARTIARTL", "ITC", "KOTAKBANK",
      "LT", "AXISBANK", "ASIANPAINT", "MARUTI", "TMPV", "SUNPHARMA", "TITAN", "WIPRO", "ULTRACEMCO", "BAJFINANCE",
      "HCLTECH", "NTPC", "POWERGRID", "ONGC", "ADANIENT", "ADANIPORTS", "COALINDIA", "DRREDDY", "NESTLEIND", "CIPLA",
      "BAJAJFINSV", "GRASIM", "JSWSTEEL", "BRITANNIA", "TECHM", "INDUSINDBK", "HINDALCO", "M&M", "APOLLOHOSP",
      "EICHERMOT", "BPCL", "HEROMOTOCO", "TATASTEEL", "SBILIFE", "HDFCLIFE", "SHRIRAMFIN", "TRENT", "BAJAJ-AUTO",
      "TATACONSUM", "JIOFIN", "ETERNAL", "BEL",
    ]),
  },
  {
    label: "Banking & finance",
    symbols: plain([
      "BANKBARODA", "PNB", "CANBK", "IDFCFIRSTB", "FEDERALBNK", "BANDHANBNK", "RBLBANK", "AUBANK", "MANAPPURAM",
      "MUTHOOTFIN", "CHOLAFIN", "LICHSGFIN", "ICICIGI", "ICICIPRULI", "HDFCAMC", "SBICARD", "RECLTD", "PFC",
    ]),
  },
  { label: "IT & technology", symbols: plain(["LTIM", "MPHASIS", "COFORGE", "PERSISTENT", "LTTS", "TATAELXSI", "DIXON"]) },
  {
    label: "Pharma & healthcare",
    symbols: plain(["DIVISLAB", "TORNTPHARM", "LUPIN", "AUROPHARMA", "BIOCON", "ALKEM", "GLENMARK", "SYNGENE"]),
  },
  {
    label: "Auto & ancillary",
    symbols: plain(["ASHOKLEY", "TVSMOTOR", "MRF", "MOTHERSON", "EXIDEIND", "BALKRISIND", "BHARATFORG"]),
  },
  { label: "Metals & mining", symbols: plain(["VEDL", "JINDALSTEL", "SAIL", "NMDC", "NATIONALUM"]) },
  { label: "Energy & oil", symbols: plain(["IOC", "GAIL", "PETRONET", "IGL", "NHPC", "TATAPOWER", "ADANIGREEN", "ADANIENSOL"]) },
  { label: "Defence & PSU", symbols: plain(["HAL", "BHEL", "IRCTC", "IRFC", "RVNL", "CONCOR", "SUZLON"]) },
  { label: "Infra & capital goods", symbols: plain(["SIEMENS", "ABB", "CUMMINSIND", "VOLTAS", "HAVELLS", "CROMPTON", "POLYCAB"]) },
  { label: "FMCG & consumer", symbols: plain(["GODREJCP", "DABUR", "MARICO", "COLPAL", "PAGEIND", "JUBLFOOD", "PIDILITIND", "DMART"]) },
  { label: "Real estate", symbols: plain(["DLF", "GODREJPROP", "OBEROIRLTY", "PRESTIGE", "PHOENIXLTD"]) },
  { label: "New age & others", symbols: plain(["PAYTM", "NYKAA", "POLICYBZR", "DELHIVERY", "INDIGO", "MCX", "SUNTV", "IDEA", "PIIND"]) },
];

export const ALL_SYMBOLS: SymbolOption[] = (() => {
  const seen = new Set<string>();
  const out: SymbolOption[] = [];
  for (const c of SYMBOL_CATEGORIES) for (const s of c.symbols) if (!seen.has(s.value)) { seen.add(s.value); out.push(s); }
  return out;
})();

/** Accepts old or renamed tickers from links ("ZOMATO" → "ETERNAL"). */
const RENAMES: Record<string, string> = { ZOMATO: "ETERNAL", ADANITRANS: "ADANIENSOL", TATAMOTORS: "TMPV" };

export function canonicalSymbol(input: string | null | undefined): string {
  const up = (input ?? "").trim().toUpperCase();
  if (!up) return "NIFTY";
  return RENAMES[up] ?? up;
}

export function filterSymbols(query: string): SymbolCategory[] {
  if (!query) return SYMBOL_CATEGORIES;
  const q = query.trim().toUpperCase();
  return SYMBOL_CATEGORIES.map((c) => ({
    ...c,
    symbols: c.symbols.filter((s) => s.value.includes(q) || s.label.toUpperCase().includes(q)),
  })).filter((c) => c.symbols.length > 0);
}
