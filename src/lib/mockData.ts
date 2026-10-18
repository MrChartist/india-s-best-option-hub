// Shared market types (index, option chain, expiry, position) and the static F&O stock list.
// Option maths lives in "@/lib/options".

export interface IndexData {
  name: string;
  symbol: string;
  ltp: number;
  change: number;
  changePercent: number;
  high: number;
  low: number;
  open: number;
  prevClose: number;
}

export interface OptionData {
  strikePrice: number;
  ce: OptionLegData;
  pe: OptionLegData;
}

export interface OptionLegData {
  ltp: number;
  oi: number;
  oiChange: number;
  volume: number;
  iv: number;
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  bidPrice: number;
  askPrice: number;
  /** Day change in LTP (rupees). */
  change?: number;
  /** Day change in LTP (percent). */
  pChange?: number;
  prevClose?: number;
  bidQty?: number;
  askQty?: number;
  /** Broker security id (Dhan), when known. */
  securityId?: string;
}

export interface ExpiryDate {
  label: string;
  value: string;
  daysToExpiry: number;
}

// -- Static Data --

// Complete list of NSE F&O stocks (as of 2026)
export const fnoStocks = [
  // Nifty 50 constituents
  "RELIANCE", "TCS", "HDFCBANK", "INFY", "ICICIBANK", "HINDUNILVR",
  "SBIN", "BHARTIARTL", "ITC", "KOTAKBANK", "LT", "AXISBANK",
  "ASIANPAINT", "MARUTI", "TATAMOTORS", "SUNPHARMA", "TITAN",
  "WIPRO", "ULTRACEMCO", "BAJFINANCE", "HCLTECH", "NTPC",
  "POWERGRID", "ONGC", "ADANIENT", "ADANIPORTS", "COALINDIA",
  "DRREDDY", "NESTLEIND", "CIPLA", "BAJAJFINSV", "GRASIM",
  "JSWSTEEL", "TATACONSUM", "BRITANNIA", "TECHM", "INDUSINDBK",
  "HINDALCO", "M&M", "APOLLOHOSP", "EICHERMOT", "DIVISLAB",
  "BPCL", "HEROMOTOCO", "TATASTEEL", "SBILIFE", "HDFCLIFE",
  "SHRIRAMFIN", "TRENT", "BAJAJ-AUTO",
  // Nifty Next 50
  "BANKBARODA", "PNB", "CANBK", "RECLTD", "PFC", "NHPC",
  "IOC", "GAIL", "VEDL", "JINDALSTEL", "SAIL", "NMDC",
  "BHEL", "HAL", "BEL", "IRCTC", "ZOMATO", "PAYTM",
  "NYKAA", "POLICYBZR", "DELHIVERY", "INDUSTOWER",
  "TATAPOWER", "TORNTPHARM", "LUPIN", "AUROPHARMA",
  "BIOCON", "ALKEM", "IPCALAB", "LALPATHLAB", "METROPOLIS",
  "ABBOTINDIA", "SYNGENE", "GLENMARK",
  // Banking & Finance
  "IDFCFIRSTB", "FEDERALBNK", "BANDHANBNK", "RBLBANK", "AUBANK",
  "MANAPPURAM", "MUTHOOTFIN", "CHOLAFIN", "M&MFIN", "L&TFH",
  "LICHSGFIN", "CANFINHOME", "ICICIGI", "ICICIPRULI",
  "HDFCAMC", "SBICARD",
  // IT & Tech
  "LTIM", "MPHASIS", "COFORGE", "PERSISTENT", "LTTS",
  "HAPPSTMNDS", "TATAELXSI",
  // Auto
  "ASHOKLEY", "ESCORTS", "TVSMOTOR", "MRF", "MOTHERSON",
  "EXIDEIND", "BALKRISIND", "BHARATFORG",
  // Metals & Mining
  "NATIONALUM", "MOIL", "APLAPOLLO", "RATNAMANI",
  // Energy & Oil
  "PETRONET", "IGL", "MGL", "PIIND",
  // Infra & Construction
  "ADANIGREEN", "ADANITRANS", "SIEMENS", "ABB", "CUMMINSIND",
  "VOLTAS", "HAVELLS", "CROMPTON", "POLYCAB",
  // Chemicals
  "PIDILITIND", "SRF", "ATUL", "DEEPAKNTR", "CLEAN",
  "FLUOROCHEM", "NAVINFLUOR",
  // Cement
  "AMBUJACEM", "ACC", "RAMCOCEM", "DALMIACEM", "JKCEMENT",
  "SHREECEM",
  // FMCG
  "GODREJCP", "DABUR", "MARICO", "COLPAL", "EMAMILTD",
  "TATACONSUM", "UBL", "MCDOWELL-N",
  // Telecom & Media
  "IDEA",
  // Real Estate
  "DLF", "GODREJPROP", "OBEROIRLTY", "PRESTIGE", "BRIGADE",
  "PHOENIXLTD",
  // Textiles & Apparel
  "PAGEIND",
  // Miscellaneous F&O
  "INDIGO", "CONCOR", "IRFC", "RVNL", "SUZLON",
  "ABCAPITAL", "ASTRAL", "BALRAMCHIN", "BATAINDIA",
  "BERGEPAINT", "BSOFT", "CANFINHOME", "CHAMBLFERT",
  "COROMANDEL", "CUB", "CUMMINSIND", "DELTACORP",
  "DEEPAKNTR", "DIXON", "GNFC", "GRANULES", "GSPL",
  "GUJARATGAS", "HONAUT", "IBULHSGFIN",
  "INTELLECT", "JUBLFOOD", "LAURUSLABS", "MCX",
  "MFSL", "NAM-INDIA", "OFSS", "PEL",
  "PVRINOX", "SUNDARMFIN", "SUNTV", "TATACOMM",
  "UPL", "ZEEL",
];

// -- Position Tracker --

export interface Position {
  id: string;
  symbol: string;
  type: "CE" | "PE";
  action: "BUY" | "SELL";
  strike: number;
  lots: number;
  entryPrice: number;
  currentPrice: number;
  lotSize: number;
  entryDate: string;
  expiry: string;
  pnl: number;
  pnlPercent: number;
  delta: number;
  theta: number;
  iv: number;
}

