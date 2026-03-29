// Mock data for the options trading dashboard

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
}

export interface ExpiryDate {
  label: string;
  value: string;
  daysToExpiry: number;
}

export interface IntradayPoint {
  time: string;
  price: number;
  volume: number;
}

export interface FuturesData {
  symbol: string;
  spotPrice: number;
  futuresPrice: number;
  premium: number;
  premiumPercent: number;
  oi: number;
  oiChange: number;
  volume: number;
  expiry: string;
}

export interface MostActiveFnO {
  symbol: string;
  ltp: number;
  change: number;
  changePercent: number;
  volume: number;
  oi: number;
  oiChange: number;
  oiInterpretation: "Long Buildup" | "Short Buildup" | "Long Unwinding" | "Short Covering";
}

export interface SectorData {
  name: string;
  change: number;
  stocks: { symbol: string; change: number }[];
}

export interface PCRHistoryPoint {
  time: string;
  pcr: number;
  spotPrice: number;
}

// ── Static Data ──

export const indicesData: IndexData[] = [
  { name: "NIFTY 50", symbol: "NIFTY", ltp: 24250.75, change: 125.30, changePercent: 0.52, high: 24310.00, low: 24100.50, open: 24125.45, prevClose: 24125.45 },
  { name: "BANK NIFTY", symbol: "BANKNIFTY", ltp: 51850.40, change: -180.60, changePercent: -0.35, high: 52100.00, low: 51700.25, open: 52031.00, prevClose: 52031.00 },
  { name: "FIN NIFTY", symbol: "FINNIFTY", ltp: 23180.55, change: 45.20, changePercent: 0.20, high: 23250.00, low: 23100.00, open: 23135.35, prevClose: 23135.35 },
  { name: "MIDCAP NIFTY", symbol: "MIDCPNIFTY", ltp: 12850.30, change: 92.15, changePercent: 0.72, high: 12900.00, low: 12740.00, open: 12758.15, prevClose: 12758.15 },
];

export const marketStats = {
  indiaVix: 13.45,
  vixChange: -0.82,
  niftyPCR: 1.24,
  bankNiftyPCR: 0.89,
  advanceDecline: { advances: 1245, declines: 890, unchanged: 65 },
  marketSentiment: "Moderately Bullish" as const,
  fiiData: { buy: 4520.5, sell: 3890.2, net: 630.3 },
  diiData: { buy: 3200.8, sell: 3450.1, net: -249.3 },
  marketCap: { bse: 425.6, nse: 412.3 }, // in lakh crore
  totalFnOTurnover: 98450.2, // crore
};

export const expiryDates: ExpiryDate[] = [
  { label: "27 Mar 2026", value: "2026-03-27", daysToExpiry: 4 },
  { label: "03 Apr 2026", value: "2026-04-03", daysToExpiry: 11 },
  { label: "10 Apr 2026", value: "2026-04-10", daysToExpiry: 18 },
  { label: "17 Apr 2026", value: "2026-04-17", daysToExpiry: 25 },
  { label: "24 Apr 2026", value: "2026-04-24", daysToExpiry: 32 },
  { label: "29 May 2026", value: "2026-05-29", daysToExpiry: 67 },
  { label: "25 Jun 2026", value: "2026-06-25", daysToExpiry: 94 },
];

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

// ── Intraday Data Generator ──

export function generateIntradayData(basePrice: number, volatility: number = 0.3): IntradayPoint[] {
  const points: IntradayPoint[] = [];
  let price = basePrice * (1 - volatility / 100);
  const times = [];
  for (let h = 9; h <= 15; h++) {
    for (let m = h === 9 ? 15 : 0; m < 60; m += 5) {
      if (h === 15 && m > 30) break;
      times.push(`${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`);
    }
  }
  for (const time of times) {
    price += (Math.random() - 0.48) * basePrice * volatility / 1000;
    points.push({
      time,
      price: Math.round(price * 100) / 100,
      volume: Math.round(Math.random() * 500000 + 100000),
    });
  }
  return points;
}

// ── Futures Data ──

export const futuresData: FuturesData[] = [
  { symbol: "NIFTY", spotPrice: 24250.75, futuresPrice: 24285.50, premium: 34.75, premiumPercent: 0.14, oi: 12450000, oiChange: 325000, volume: 890000, expiry: "27 Mar" },
  { symbol: "BANKNIFTY", spotPrice: 51850.40, futuresPrice: 51920.15, premium: 69.75, premiumPercent: 0.13, oi: 4560000, oiChange: -125000, volume: 450000, expiry: "27 Mar" },
  { symbol: "FINNIFTY", spotPrice: 23180.55, futuresPrice: 23210.80, premium: 30.25, premiumPercent: 0.13, oi: 1890000, oiChange: 85000, volume: 120000, expiry: "27 Mar" },
  { symbol: "NIFTY", spotPrice: 24250.75, futuresPrice: 24350.25, premium: 99.50, premiumPercent: 0.41, oi: 8900000, oiChange: 450000, volume: 320000, expiry: "24 Apr" },
];

// ── Top Gainers & Losers ──

export interface TopMoverData {
  symbol: string;
  ltp: number;
  change: number;
  changePercent: number;
  volume: number;
  sector: string;
}

export const topGainers: TopMoverData[] = [
  { symbol: "DLF", ltp: 885.60, change: 27.85, changePercent: 3.25, volume: 9200000, sector: "Realty" },
  { symbol: "TATASTEEL", ltp: 168.45, change: 4.85, changePercent: 2.96, volume: 18500000, sector: "Metal" },
  { symbol: "BAJFINANCE", ltp: 7280.25, change: 145.80, changePercent: 2.04, volume: 4200000, sector: "NBFC" },
  { symbol: "SUNPHARMA", ltp: 1680.30, change: 30.10, changePercent: 1.82, volume: 3800000, sector: "Pharma" },
  { symbol: "HINDALCO", ltp: 625.70, change: 11.15, changePercent: 1.82, volume: 7600000, sector: "Metal" },
  { symbol: "HDFCBANK", ltp: 1685.40, change: 22.60, changePercent: 1.36, volume: 7200000, sector: "Banking" },
  { symbol: "RELIANCE", ltp: 2945.50, change: 38.20, changePercent: 1.31, volume: 8500000, sector: "Energy" },
  { symbol: "ITC", ltp: 468.35, change: 5.80, changePercent: 1.25, volume: 11200000, sector: "FMCG" },
];

export const topLosers: TopMoverData[] = [
  { symbol: "TATAMOTORS", ltp: 985.30, change: -18.45, changePercent: -1.84, volume: 12300000, sector: "Auto" },
  { symbol: "SBIN", ltp: 825.75, change: -12.30, changePercent: -1.47, volume: 9800000, sector: "Banking" },
  { symbol: "MARUTI", ltp: 12450.60, change: -185.40, changePercent: -1.47, volume: 1800000, sector: "Auto" },
  { symbol: "WIPRO", ltp: 485.20, change: -5.85, changePercent: -1.19, volume: 6100000, sector: "IT" },
  { symbol: "ICICIBANK", ltp: 1245.60, change: -8.90, changePercent: -0.71, volume: 5800000, sector: "Banking" },
  { symbol: "TCS", ltp: 3850.70, change: -25.30, changePercent: -0.65, volume: 3900000, sector: "IT" },
  { symbol: "HINDUNILVR", ltp: 2650.40, change: -13.80, changePercent: -0.52, volume: 2100000, sector: "FMCG" },
  { symbol: "ONGC", ltp: 265.80, change: -1.20, changePercent: -0.45, volume: 8900000, sector: "Energy" },
];

// ── Most Active F&O ──

function getOIInterpretation(priceChange: number, oiChange: number): MostActiveFnO["oiInterpretation"] {
  if (priceChange > 0 && oiChange > 0) return "Long Buildup";
  if (priceChange < 0 && oiChange > 0) return "Short Buildup";
  if (priceChange < 0 && oiChange < 0) return "Long Unwinding";
  return "Short Covering";
}

export const mostActiveFnO: MostActiveFnO[] = [
  { symbol: "RELIANCE", ltp: 2945.50, change: 38.20, changePercent: 1.31, volume: 8500000, oi: 45200000, oiChange: 2400000, oiInterpretation: "Long Buildup" },
  { symbol: "TATAMOTORS", ltp: 985.30, change: -18.45, changePercent: -1.84, volume: 12300000, oi: 38900000, oiChange: 3200000, oiInterpretation: "Short Buildup" },
  { symbol: "SBIN", ltp: 825.75, change: -12.30, changePercent: -1.47, volume: 9800000, oi: 52100000, oiChange: -4500000, oiInterpretation: "Long Unwinding" },
  { symbol: "HDFCBANK", ltp: 1685.40, change: 22.60, changePercent: 1.36, volume: 7200000, oi: 28700000, oiChange: -1800000, oiInterpretation: "Short Covering" },
  { symbol: "INFY", ltp: 1520.85, change: 15.40, changePercent: 1.02, volume: 6500000, oi: 32400000, oiChange: 1900000, oiInterpretation: "Long Buildup" },
  { symbol: "ICICIBANK", ltp: 1245.60, change: -8.90, changePercent: -0.71, volume: 5800000, oi: 41500000, oiChange: 2800000, oiInterpretation: "Short Buildup" },
  { symbol: "BAJFINANCE", ltp: 7280.25, change: 145.80, changePercent: 2.04, volume: 4200000, oi: 18900000, oiChange: -1200000, oiInterpretation: "Short Covering" },
  { symbol: "TCS", ltp: 3850.70, change: -25.30, changePercent: -0.65, volume: 3900000, oi: 15600000, oiChange: -980000, oiInterpretation: "Long Unwinding" },
  { symbol: "ITC", ltp: 468.35, change: 5.80, changePercent: 1.25, volume: 11200000, oi: 62300000, oiChange: 3800000, oiInterpretation: "Long Buildup" },
  { symbol: "MARUTI", ltp: 12450.60, change: -185.40, changePercent: -1.47, volume: 1800000, oi: 8200000, oiChange: 950000, oiInterpretation: "Short Buildup" },
];

// ── Sector Data ──

export const sectorData: SectorData[] = [
  { name: "IT", change: 0.85, stocks: [{ symbol: "TCS", change: -0.65 }, { symbol: "INFY", change: 1.02 }, { symbol: "WIPRO", change: 1.45 }, { symbol: "HCLTECH", change: 0.92 }] },
  { name: "Banking", change: -0.25, stocks: [{ symbol: "HDFCBANK", change: 1.36 }, { symbol: "ICICIBANK", change: -0.71 }, { symbol: "SBIN", change: -1.47 }, { symbol: "KOTAKBANK", change: 0.38 }] },
  { name: "Auto", change: -0.92, stocks: [{ symbol: "TATAMOTORS", change: -1.84 }, { symbol: "MARUTI", change: -1.47 }, { symbol: "M&M", change: 0.62 }, { symbol: "BAJAJ-AUTO", change: -0.85 }] },
  { name: "Pharma", change: 1.15, stocks: [{ symbol: "SUNPHARMA", change: 1.82 }, { symbol: "DRREDDY", change: 0.95 }, { symbol: "CIPLA", change: 0.68 }, { symbol: "DIVISLAB", change: 1.22 }] },
  { name: "Metal", change: 1.45, stocks: [{ symbol: "TATASTEEL", change: 2.15 }, { symbol: "HINDALCO", change: 1.82 }, { symbol: "JSWSTEEL", change: 0.95 }, { symbol: "VEDL", change: 1.58 }] },
  { name: "Energy", change: 0.62, stocks: [{ symbol: "RELIANCE", change: 1.31 }, { symbol: "ONGC", change: -0.45 }, { symbol: "NTPC", change: 0.72 }, { symbol: "POWERGRID", change: 0.38 }] },
  { name: "FMCG", change: -0.18, stocks: [{ symbol: "HINDUNILVR", change: -0.52 }, { symbol: "ITC", change: 1.25 }, { symbol: "NESTLEIND", change: -0.38 }, { symbol: "BRITANNIA", change: -0.68 }] },
  { name: "Realty", change: 2.35, stocks: [{ symbol: "DLF", change: 3.15 }, { symbol: "GODREJPROP", change: 2.82 }, { symbol: "OBEROIRLTY", change: 1.95 }, { symbol: "PRESTIGE", change: 1.48 }] },
];

// ── PCR History (Intraday) ──

export function generatePCRHistory(): PCRHistoryPoint[] {
  const points: PCRHistoryPoint[] = [];
  let pcr = 1.1;
  let spot = 24125;
  const times = [];
  for (let h = 9; h <= 15; h++) {
    for (let m = h === 9 ? 15 : 0; m < 60; m += 15) {
      if (h === 15 && m > 30) break;
      times.push(`${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`);
    }
  }
  for (const time of times) {
    pcr += (Math.random() - 0.48) * 0.08;
    pcr = Math.max(0.5, Math.min(2.0, pcr));
    spot += (Math.random() - 0.48) * 30;
    points.push({ time, pcr: Math.round(pcr * 100) / 100, spotPrice: Math.round(spot * 100) / 100 });
  }
  return points;
}

// ── VIX History ──

export function generateVIXHistory(): { time: string; vix: number }[] {
  const points: { time: string; vix: number }[] = [];
  let vix = 14.2;
  for (let d = 30; d >= 0; d--) {
    vix += (Math.random() - 0.5) * 1.2;
    vix = Math.max(9, Math.min(25, vix));
    const date = new Date();
    date.setDate(date.getDate() - d);
    points.push({ time: `${date.getDate()}/${date.getMonth() + 1}`, vix: Math.round(vix * 100) / 100 });
  }
  return points;
}

// ── Option Chain Generator (deterministic with seed) ──

function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function generateOptionChain(spotPrice: number, stepSize: number, numStrikes: number = 15): OptionData[] {
  const rand = seededRandom(Math.round(spotPrice * 100));
  const atmStrike = Math.round(spotPrice / stepSize) * stepSize;
  const strikes: OptionData[] = [];

  for (let i = -numStrikes; i <= numStrikes; i++) {
    const strike = atmStrike + i * stepSize;
    const moneyness = (spotPrice - strike) / spotPrice;
    const isITMCall = strike < spotPrice;
    const isITMPut = strike > spotPrice;
    const distFromATM = Math.abs(i);

    // Realistic IV smile
    const baseIV = 13.5 + Math.pow(Math.abs(moneyness) * 12, 1.5) + (moneyness < 0 ? 1.5 : 0);
    const ceOI = Math.round((isITMCall ? 1500 : 6000 + distFromATM * 200) * (1 + rand() * 0.6) * 75);
    const peOI = Math.round((isITMPut ? 1500 : 6000 + distFromATM * 200) * (1 + rand() * 0.6) * 75);

    // More realistic pricing
    const timeValue = 40 * Math.exp(-distFromATM * 0.15);
    const ceLTP = Math.max(0.05, isITMCall
      ? spotPrice - strike + timeValue * (0.8 + rand() * 0.4)
      : timeValue * Math.exp(-distFromATM * 0.2) * (0.6 + rand() * 0.8));
    const peLTP = Math.max(0.05, isITMPut
      ? strike - spotPrice + timeValue * (0.8 + rand() * 0.4)
      : timeValue * Math.exp(-distFromATM * 0.2) * (0.6 + rand() * 0.8));

    const ceVol = Math.round((30000 + (distFromATM < 5 ? 50000 : 10000)) * rand());
    const peVol = Math.round((30000 + (distFromATM < 5 ? 50000 : 10000)) * rand());

    strikes.push({
      strikePrice: strike,
      ce: {
        ltp: Math.round(ceLTP * 100) / 100,
        oi: ceOI,
        oiChange: Math.round((rand() - 0.4) * ceOI * 0.08),
        volume: ceVol,
        iv: Math.round(baseIV * 100) / 100,
        delta: Math.round((isITMCall ? 0.55 + (1 - distFromATM * 0.03) * 0.4 : 0.5 * Math.exp(-distFromATM * 0.15)) * 1000) / 1000,
        gamma: Math.round((0.004 * Math.exp(-distFromATM * 0.2)) * 10000) / 10000,
        theta: -Math.round((8 + rand() * 6) * Math.exp(-distFromATM * 0.1) * 100) / 100,
        vega: Math.round((10 * Math.exp(-distFromATM * 0.12)) * 100) / 100,
        bidPrice: Math.max(0, Math.round((ceLTP - 0.5 - rand() * 1.5) * 100) / 100),
        askPrice: Math.round((ceLTP + 0.5 + rand() * 1.5) * 100) / 100,
      },
      pe: {
        ltp: Math.round(peLTP * 100) / 100,
        oi: peOI,
        oiChange: Math.round((rand() - 0.4) * peOI * 0.08),
        volume: peVol,
        iv: Math.round((baseIV + 0.3 + rand() * 0.5) * 100) / 100,
        delta: -Math.round((isITMPut ? 0.55 + (1 - distFromATM * 0.03) * 0.4 : 0.5 * Math.exp(-distFromATM * 0.15)) * 1000) / 1000,
        gamma: Math.round((0.004 * Math.exp(-distFromATM * 0.2)) * 10000) / 10000,
        theta: -Math.round((8 + rand() * 6) * Math.exp(-distFromATM * 0.1) * 100) / 100,
        vega: Math.round((10 * Math.exp(-distFromATM * 0.12)) * 100) / 100,
        bidPrice: Math.max(0, Math.round((peLTP - 0.5 - rand() * 1.5) * 100) / 100),
        askPrice: Math.round((peLTP + 0.5 + rand() * 1.5) * 100) / 100,
      },
    });
  }

  return strikes;
}

export function getOptionChain(symbol: string): { data: OptionData[]; spotPrice: number; lotSize: number; stepSize: number } {
  switch (symbol) {
    case "NIFTY":
      return { data: generateOptionChain(24250.75, 50), spotPrice: 24250.75, lotSize: 25, stepSize: 50 };
    case "BANKNIFTY":
      return { data: generateOptionChain(51850.40, 100), spotPrice: 51850.40, lotSize: 15, stepSize: 100 };
    case "FINNIFTY":
      return { data: generateOptionChain(23180.55, 50), spotPrice: 23180.55, lotSize: 25, stepSize: 50 };
    case "MIDCPNIFTY":
      return { data: generateOptionChain(12850.30, 25), spotPrice: 12850.30, lotSize: 50, stepSize: 25 };
    default:
      return { data: generateOptionChain(2500, 25, 10), spotPrice: 2500, lotSize: 500, stepSize: 25 };
  }
}

export function getMaxPain(chain: OptionData[]): number {
  let minPain = Infinity;
  let maxPainStrike = chain[0]?.strikePrice || 0;

  for (const option of chain) {
    let totalPain = 0;
    for (const other of chain) {
      if (other.strikePrice < option.strikePrice) {
        totalPain += other.ce.oi * (option.strikePrice - other.strikePrice);
      } else if (other.strikePrice > option.strikePrice) {
        totalPain += other.pe.oi * (other.strikePrice - option.strikePrice);
      }
    }
    if (totalPain < minPain) {
      minPain = totalPain;
      maxPainStrike = option.strikePrice;
    }
  }

  return maxPainStrike;
}

// ── Black-Scholes Greeks Calculator ──

function normalCDF(x: number): number {
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429;
  const p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x) / Math.sqrt(2);
  const t = 1.0 / (1.0 + p * x);
  const y = 1.0 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return 0.5 * (1.0 + sign * y);
}

function normalPDF(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

export interface GreeksResult {
  callPrice: number;
  putPrice: number;
  delta: { call: number; put: number };
  gamma: number;
  theta: { call: number; put: number };
  vega: number;
  rho: { call: number; put: number };
}

export function calculateGreeks(
  spot: number, strike: number, timeToExpiry: number,
  iv: number, riskFreeRate: number
): GreeksResult {
  const S = spot, K = strike, T = Math.max(timeToExpiry / 365, 0.001);
  const sigma = iv / 100, r = riskFreeRate / 100;

  const d1 = (Math.log(S / K) + (r + sigma * sigma / 2) * T) / (sigma * Math.sqrt(T));
  const d2 = d1 - sigma * Math.sqrt(T);

  const callPrice = S * normalCDF(d1) - K * Math.exp(-r * T) * normalCDF(d2);
  const putPrice = K * Math.exp(-r * T) * normalCDF(-d2) - S * normalCDF(-d1);

  return {
    callPrice: Math.round(callPrice * 100) / 100,
    putPrice: Math.round(putPrice * 100) / 100,
    delta: {
      call: Math.round(normalCDF(d1) * 1000) / 1000,
      put: Math.round((normalCDF(d1) - 1) * 1000) / 1000,
    },
    gamma: Math.round((normalPDF(d1) / (S * sigma * Math.sqrt(T))) * 10000) / 10000,
    theta: {
      call: Math.round(((-S * normalPDF(d1) * sigma / (2 * Math.sqrt(T))) - r * K * Math.exp(-r * T) * normalCDF(d2)) / 365 * 100) / 100,
      put: Math.round(((-S * normalPDF(d1) * sigma / (2 * Math.sqrt(T))) + r * K * Math.exp(-r * T) * normalCDF(-d2)) / 365 * 100) / 100,
    },
    vega: Math.round((S * normalPDF(d1) * Math.sqrt(T) / 100) * 100) / 100,
    rho: {
      call: Math.round((K * T * Math.exp(-r * T) * normalCDF(d2) / 100) * 100) / 100,
      put: Math.round((-K * T * Math.exp(-r * T) * normalCDF(-d2) / 100) * 100) / 100,
    },
  };
}

// Generate sensitivity data for Greeks charts
export function generateGreeksSensitivity(
  strike: number, daysToExpiry: number, iv: number, riskFreeRate: number,
  spotCenter: number, range: number = 500, step: number = 10
): { spot: number; callDelta: number; putDelta: number; gamma: number; callTheta: number; putTheta: number; vega: number }[] {
  const points: any[] = [];
  for (let s = spotCenter - range; s <= spotCenter + range; s += step) {
    const g = calculateGreeks(s, strike, daysToExpiry, iv, riskFreeRate);
    points.push({
      spot: s,
      callDelta: g.delta.call,
      putDelta: g.delta.put,
      gamma: g.gamma,
      callTheta: g.theta.call,
      putTheta: g.theta.put,
      vega: g.vega,
    });
  }
  return points;
}

// ── Strategy Definitions ──

export interface StrategyLeg {
  type: "CE" | "PE";
  action: "BUY" | "SELL";
  strike: number;
  lots: number;
  premium: number;
}

export interface Strategy {
  name: string;
  legs: StrategyLeg[];
  description: string;
  outlook: "Bullish" | "Bearish" | "Neutral" | "Volatile";
  riskLevel: "Low" | "Medium" | "High" | "Unlimited";
}

export function getPresetStrategies(spotPrice: number, stepSize: number): Strategy[] {
  const atm = Math.round(spotPrice / stepSize) * stepSize;
  return [
    {
      name: "Long Straddle", outlook: "Volatile", riskLevel: "Medium",
      description: "Buy ATM Call + ATM Put. Profit from large moves in either direction. Best before earnings/events.",
      legs: [
        { type: "CE", action: "BUY", strike: atm, lots: 1, premium: 150 },
        { type: "PE", action: "BUY", strike: atm, lots: 1, premium: 140 },
      ],
    },
    {
      name: "Short Straddle", outlook: "Neutral", riskLevel: "Unlimited",
      description: "Sell ATM Call + ATM Put. Profit from low volatility / range-bound market. High margin requirement.",
      legs: [
        { type: "CE", action: "SELL", strike: atm, lots: 1, premium: 150 },
        { type: "PE", action: "SELL", strike: atm, lots: 1, premium: 140 },
      ],
    },
    {
      name: "Long Strangle", outlook: "Volatile", riskLevel: "Medium",
      description: "Buy OTM Call + OTM Put. Cheaper than straddle, needs bigger move to profit.",
      legs: [
        { type: "CE", action: "BUY", strike: atm + stepSize * 2, lots: 1, premium: 60 },
        { type: "PE", action: "BUY", strike: atm - stepSize * 2, lots: 1, premium: 55 },
      ],
    },
    {
      name: "Bull Call Spread", outlook: "Bullish", riskLevel: "Low",
      description: "Buy lower strike Call, Sell higher strike Call. Limited risk bullish bet with capped profit.",
      legs: [
        { type: "CE", action: "BUY", strike: atm, lots: 1, premium: 150 },
        { type: "CE", action: "SELL", strike: atm + stepSize * 3, lots: 1, premium: 50 },
      ],
    },
    {
      name: "Bear Put Spread", outlook: "Bearish", riskLevel: "Low",
      description: "Buy higher strike Put, Sell lower strike Put. Limited risk bearish bet with capped profit.",
      legs: [
        { type: "PE", action: "BUY", strike: atm, lots: 1, premium: 140 },
        { type: "PE", action: "SELL", strike: atm - stepSize * 3, lots: 1, premium: 45 },
      ],
    },
    {
      name: "Iron Condor", outlook: "Neutral", riskLevel: "Low",
      description: "Sell OTM Call + Put spreads. Most popular income strategy. Profit from range-bound market.",
      legs: [
        { type: "PE", action: "BUY", strike: atm - stepSize * 4, lots: 1, premium: 25 },
        { type: "PE", action: "SELL", strike: atm - stepSize * 2, lots: 1, premium: 55 },
        { type: "CE", action: "SELL", strike: atm + stepSize * 2, lots: 1, premium: 60 },
        { type: "CE", action: "BUY", strike: atm + stepSize * 4, lots: 1, premium: 20 },
      ],
    },
    {
      name: "Iron Butterfly", outlook: "Neutral", riskLevel: "Low",
      description: "Sell ATM straddle + buy OTM strangle. Tighter range than Iron Condor, higher premium.",
      legs: [
        { type: "PE", action: "BUY", strike: atm - stepSize * 3, lots: 1, premium: 30 },
        { type: "PE", action: "SELL", strike: atm, lots: 1, premium: 140 },
        { type: "CE", action: "SELL", strike: atm, lots: 1, premium: 150 },
        { type: "CE", action: "BUY", strike: atm + stepSize * 3, lots: 1, premium: 35 },
      ],
    },
    {
      name: "Long Call Butterfly", outlook: "Neutral", riskLevel: "Low",
      description: "Buy 1 ITM Call, Sell 2 ATM Calls, Buy 1 OTM Call. Low cost, max profit at ATM at expiry.",
      legs: [
        { type: "CE", action: "BUY", strike: atm - stepSize * 2, lots: 1, premium: 220 },
        { type: "CE", action: "SELL", strike: atm, lots: 2, premium: 150 },
        { type: "CE", action: "BUY", strike: atm + stepSize * 2, lots: 1, premium: 60 },
      ],
    },
    {
      name: "Jade Lizard", outlook: "Bullish", riskLevel: "Medium",
      description: "Sell OTM Put + Bear Call Spread. No upside risk. Popular income strategy.",
      legs: [
        { type: "PE", action: "SELL", strike: atm - stepSize * 2, lots: 1, premium: 55 },
        { type: "CE", action: "SELL", strike: atm + stepSize * 2, lots: 1, premium: 60 },
        { type: "CE", action: "BUY", strike: atm + stepSize * 4, lots: 1, premium: 20 },
      ],
    },
  ];
}

export function calculatePayoff(legs: StrategyLeg[], lotSize: number, spotRange: number[]): { spot: number; pnl: number }[] {
  return spotRange.map(spot => {
    let pnl = 0;
    for (const leg of legs) {
      const multiplier = leg.action === "BUY" ? 1 : -1;
      const qty = leg.lots * lotSize;
      let intrinsic = 0;
      if (leg.type === "CE") {
        intrinsic = Math.max(0, spot - leg.strike);
      } else {
        intrinsic = Math.max(0, leg.strike - spot);
      }
      pnl += multiplier * (intrinsic - leg.premium) * qty;
    }
    return { spot, pnl: Math.round(pnl) };
  });
}

// Estimate margin requirement (simplified)
export function estimateMargin(legs: StrategyLeg[], lotSize: number, spotPrice: number): number {
  let margin = 0;
  for (const leg of legs) {
    if (leg.action === "SELL") {
      // Approximate SPAN margin for short options
      const otmAmount = leg.type === "CE" 
        ? Math.max(0, leg.strike - spotPrice)
        : Math.max(0, spotPrice - leg.strike);
      margin += (spotPrice * 0.12 - otmAmount * 0.5) * leg.lots * lotSize;
    }
  }
  // Net premium received reduces margin
  const netPremium = legs.reduce((s, l) => s + (l.action === "SELL" ? l.premium : -l.premium) * l.lots * lotSize, 0);
  margin = Math.max(margin - Math.max(0, netPremium), 0);
  return Math.round(Math.max(margin, spotPrice * 0.05 * lotSize));
}

// Probability of profit estimate (simplified normal distribution)
export function estimateProbOfProfit(legs: StrategyLeg[], lotSize: number, spotPrice: number, iv: number, daysToExpiry: number): number {
  const sigma = (iv / 100) * spotPrice * Math.sqrt(daysToExpiry / 365);
  if (sigma === 0) return 50;
  
  // Sample many points and check profitability
  let profitable = 0;
  const samples = 200;
  for (let i = 0; i < samples; i++) {
    const z = -3 + (6 * i / (samples - 1));
    const futureSpot = spotPrice * Math.exp(-0.5 * (iv / 100) ** 2 * (daysToExpiry / 365) + z * (iv / 100) * Math.sqrt(daysToExpiry / 365));
    let pnl = 0;
    for (const leg of legs) {
      const mult = leg.action === "BUY" ? 1 : -1;
      const intrinsic = leg.type === "CE" ? Math.max(0, futureSpot - leg.strike) : Math.max(0, leg.strike - futureSpot);
      pnl += mult * (intrinsic - leg.premium) * leg.lots * lotSize;
    }
    if (pnl > 0) profitable++;
  }
  return Math.round((profitable / samples) * 100);
}

// ── IV Analytics ──

export interface IVAnalytics {
  symbol: string;
  currentIV: number;
  ivRank: number;
  ivPercentile: number;
  iv52High: number;
  iv52Low: number;
  hvMonth: number;
  hvWeek: number;
  expectedMove: number;
  expectedMovePercent: number;
}

export function getIVAnalytics(symbol: string): IVAnalytics {
  const spotMap: Record<string, number> = {
    NIFTY: 24250.75, BANKNIFTY: 51850.40, FINNIFTY: 23180.55, MIDCPNIFTY: 12850.30,
    RELIANCE: 2945.50, TCS: 3850.70, HDFCBANK: 1685.40, INFY: 1520.85,
    ICICIBANK: 1245.60, SBIN: 825.75, TATAMOTORS: 985.30, BAJFINANCE: 7280.25,
    ITC: 468.35, MARUTI: 12450.60,
  };
  const spot = spotMap[symbol] || 2500;
  const rand = seededRandom(symbol.length * 137 + symbol.charCodeAt(0));
  const currentIV = 12 + rand() * 18;
  const iv52High = currentIV * (1.4 + rand() * 0.6);
  const iv52Low = currentIV * (0.4 + rand() * 0.2);
  const ivRange = iv52High - iv52Low;
  const ivRank = Math.round(((currentIV - iv52Low) / ivRange) * 100);
  const dte = 4;
  const expectedMove = spot * (currentIV / 100) * Math.sqrt(dte / 365);

  return {
    symbol,
    currentIV: Math.round(currentIV * 100) / 100,
    ivRank: Math.max(0, Math.min(100, ivRank)),
    ivPercentile: Math.max(0, Math.min(100, Math.round(ivRank * (0.9 + rand() * 0.2)))),
    iv52High: Math.round(iv52High * 100) / 100,
    iv52Low: Math.round(iv52Low * 100) / 100,
    hvMonth: Math.round((currentIV * (0.85 + rand() * 0.3)) * 100) / 100,
    hvWeek: Math.round((currentIV * (0.7 + rand() * 0.6)) * 100) / 100,
    expectedMove: Math.round(expectedMove * 100) / 100,
    expectedMovePercent: Math.round((expectedMove / spot) * 10000) / 100,
  };
}

export function generateIVHistory(symbol: string): { date: string; iv: number; hv: number }[] {
  const rand = seededRandom(symbol.charCodeAt(0) * 31);
  let iv = 14 + rand() * 10;
  let hv = iv * 0.9;
  const points: { date: string; iv: number; hv: number }[] = [];
  for (let d = 90; d >= 0; d--) {
    iv += (rand() - 0.48) * 1.5;
    hv += (rand() - 0.48) * 1.2;
    iv = Math.max(8, Math.min(45, iv));
    hv = Math.max(6, Math.min(40, hv));
    const date = new Date();
    date.setDate(date.getDate() - d);
    points.push({ date: `${date.getDate()}/${date.getMonth() + 1}`, iv: Math.round(iv * 100) / 100, hv: Math.round(hv * 100) / 100 });
  }
  return points;
}

// ── Scanner Data ──

export interface ScannerResult {
  symbol: string;
  ltp: number;
  changePercent: number;
  iv: number;
  ivRank: number;
  ivPercentile: number;
  totalOI: number;
  oiChange: number;
  oiChangePercent: number;
  volume: number;
  volumeAvgRatio: number;
  pcr: number;
  expectedMove: number;
  expectedMovePercent: number;
  signals: string[];
}

export function getScannerResults(): ScannerResult[] {
  const allSymbols = ["NIFTY", "BANKNIFTY", "FINNIFTY", ...fnoStocks];
  const rand = seededRandom(42);

  return allSymbols.map(symbol => {
    const ivData = getIVAnalytics(symbol);
    const spotMap: Record<string, number> = {
      NIFTY: 24250.75, BANKNIFTY: 51850.40, FINNIFTY: 23180.55,
      RELIANCE: 2945.50, TCS: 3850.70, HDFCBANK: 1685.40, INFY: 1520.85,
      ICICIBANK: 1245.60, SBIN: 825.75, TATAMOTORS: 985.30, BAJFINANCE: 7280.25,
      ITC: 468.35, MARUTI: 12450.60, HINDUNILVR: 2650, BHARTIARTL: 1580,
      KOTAKBANK: 1820, LT: 3450, AXISBANK: 1125, ASIANPAINT: 2890,
      SUNPHARMA: 1680, TITAN: 3250, WIPRO: 485, ULTRACEMCO: 10850,
      MIDCPNIFTY: 12850,
    };
    const ltp = spotMap[symbol] || (1000 + rand() * 5000);
    const changePercent = (rand() - 0.45) * 5;
    const totalOI = Math.round(5000000 + rand() * 50000000);
    const oiChange = Math.round((rand() - 0.4) * totalOI * 0.08);
    const volume = Math.round(2000000 + rand() * 15000000);
    const volumeAvgRatio = 0.5 + rand() * 3;
    const pcr = 0.5 + rand() * 1.5;

    const signals: string[] = [];
    if (ivData.ivRank > 75) signals.push("High IV Rank");
    if (ivData.ivRank < 20) signals.push("Low IV Rank");
    if (Math.abs(oiChange) / totalOI > 0.05) signals.push("OI Surge");
    if (volumeAvgRatio > 2) signals.push("Volume Spike");
    if (Math.abs(changePercent) > 3) signals.push("Price Breakout");
    if (pcr > 1.5) signals.push("High PCR");
    if (pcr < 0.5) signals.push("Low PCR");

    return {
      symbol, ltp, changePercent,
      iv: ivData.currentIV, ivRank: ivData.ivRank, ivPercentile: ivData.ivPercentile,
      totalOI, oiChange, oiChangePercent: Math.round((oiChange / totalOI) * 10000) / 100,
      volume, volumeAvgRatio: Math.round(volumeAvgRatio * 100) / 100,
      pcr: Math.round(pcr * 100) / 100,
      expectedMove: ivData.expectedMove, expectedMovePercent: ivData.expectedMovePercent,
      signals,
    };
  });
}

// ── Delta OI (OI × Delta per strike) ──

export interface DeltaOIData {
  strike: number;
  ceDeltaOI: number; // CE OI * CE Delta
  peDeltaOI: number; // PE OI * PE Delta (negative)
  netDeltaOI: number;
}

export function getDeltaOI(chain: OptionData[], spotPrice: number, stepSize: number): DeltaOIData[] {
  return chain
    .filter(o => o.ce.oi > 30000 || o.pe.oi > 30000)
    .map(o => {
      const ceDeltaOI = Math.round(o.ce.oi * o.ce.delta);
      const peDeltaOI = Math.round(o.pe.oi * o.pe.delta); // delta is negative for puts
      return {
        strike: o.strikePrice,
        ceDeltaOI: Math.round(ceDeltaOI / 1000),
        peDeltaOI: Math.round(peDeltaOI / 1000),
        netDeltaOI: Math.round((ceDeltaOI + peDeltaOI) / 1000),
      };
    });
}

// ── Strike-wise PCR ──

export interface StrikePCRData {
  strike: number;
  pcr: number;
  ceOI: number;
  peOI: number;
  distance: number;
}

export function getStrikePCR(chain: OptionData[], spotPrice: number): StrikePCRData[] {
  return chain
    .filter(o => o.ce.oi > 10000 && o.pe.oi > 10000)
    .map(o => ({
      strike: o.strikePrice,
      pcr: Math.round((o.pe.oi / o.ce.oi) * 100) / 100,
      ceOI: o.ce.oi,
      peOI: o.pe.oi,
      distance: Math.round(((o.strikePrice - spotPrice) / spotPrice) * 10000) / 100,
    }));
}

// ── ATM Zone Analysis (nearest N strikes) ──

export interface ATMZoneData {
  strikes: number;
  totalCEOI: number;
  totalPEOI: number;
  pcr: number;
  totalCEOIChg: number;
  totalPEOIChg: number;
  ceOIChgPercent: number;
  peOIChgPercent: number;
  pcrChange: number;
  strikeData: {
    strike: number;
    ceOI: number;
    peOI: number;
    pcr: number;
    ceOIChg: number;
    peOIChg: number;
    ceOIChgPct: number;
    peOIChgPct: number;
  }[];
}

export function getATMZoneAnalysis(chain: OptionData[], spotPrice: number, stepSize: number, numStrikes: number = 5): ATMZoneData {
  const atmStrike = Math.round(spotPrice / stepSize) * stepSize;
  const halfRange = Math.floor(numStrikes / 2);
  const zoneStrikes = chain.filter(o => {
    const strikeDist = Math.abs(o.strikePrice - atmStrike) / stepSize;
    return strikeDist <= halfRange;
  });

  const totalCEOI = zoneStrikes.reduce((s, o) => s + o.ce.oi, 0);
  const totalPEOI = zoneStrikes.reduce((s, o) => s + o.pe.oi, 0);
  const totalCEOIChg = zoneStrikes.reduce((s, o) => s + o.ce.oiChange, 0);
  const totalPEOIChg = zoneStrikes.reduce((s, o) => s + o.pe.oiChange, 0);

  return {
    strikes: numStrikes,
    totalCEOI,
    totalPEOI,
    pcr: totalCEOI > 0 ? Math.round((totalPEOI / totalCEOI) * 100) / 100 : 0,
    totalCEOIChg,
    totalPEOIChg,
    ceOIChgPercent: totalCEOI > 0 ? Math.round((totalCEOIChg / totalCEOI) * 10000) / 100 : 0,
    peOIChgPercent: totalPEOI > 0 ? Math.round((totalPEOIChg / totalPEOI) * 10000) / 100 : 0,
    pcrChange: totalCEOIChg !== 0 ? Math.round((totalPEOIChg / Math.abs(totalCEOIChg)) * 100) / 100 : 0,
    strikeData: zoneStrikes.map(o => ({
      strike: o.strikePrice,
      ceOI: o.ce.oi,
      peOI: o.pe.oi,
      pcr: o.ce.oi > 0 ? Math.round((o.pe.oi / o.ce.oi) * 100) / 100 : 0,
      ceOIChg: o.ce.oiChange,
      peOIChg: o.pe.oiChange,
      ceOIChgPct: o.ce.oi > 0 ? Math.round((o.ce.oiChange / o.ce.oi) * 10000) / 100 : 0,
      peOIChgPct: o.pe.oi > 0 ? Math.round((o.pe.oiChange / o.pe.oi) * 10000) / 100 : 0,
    })),
  };
}

// ── Option Price + OI Time Series (mock intraday) ──

export interface OptionOITimeSeriesPoint {
  time: string;
  optionPrice: number;
  oi: number;
  oiChange: number;
  volume: number;
}

export function generateOptionOITimeSeries(basePrice: number, baseOI: number): OptionOITimeSeriesPoint[] {
  const rand = seededRandom(Math.round(basePrice * 100 + baseOI));
  const points: OptionOITimeSeriesPoint[] = [];
  let price = basePrice;
  let oi = baseOI;
  let cumVolume = 0;

  const times = [];
  for (let h = 9; h <= 15; h++) {
    for (let m = h === 9 ? 15 : 0; m < 60; m += 5) {
      if (h === 15 && m > 30) break;
      times.push(`${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`);
    }
  }

  for (const time of times) {
    price += (rand() - 0.48) * basePrice * 0.03;
    price = Math.max(0.05, price);
    const oiDelta = Math.round((rand() - 0.45) * baseOI * 0.005);
    oi += oiDelta;
    cumVolume += Math.round(rand() * 50000);
    points.push({
      time,
      optionPrice: Math.round(price * 100) / 100,
      oi,
      oiChange: oiDelta,
      volume: cumVolume,
    });
  }
  return points;
}

// ── Candle-wise OI + Volume Data ──

export interface CandleOIData {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  oi: number;
  oiChange: number;
}

export function generateCandleOIData(basePrice: number, baseOI: number, count: number = 60): CandleOIData[] {
  const rand = seededRandom(Math.round(basePrice + baseOI * 0.001));
  let price = basePrice * 0.95;
  let oi = baseOI;
  const candles: CandleOIData[] = [];

  for (let i = 0; i < count; i++) {
    const open = price;
    const change = (rand() - 0.48) * basePrice * 0.012;
    const close = open + change;
    const wick = Math.abs(change) * (0.5 + rand());
    const high = Math.max(open, close) + wick * rand();
    const low = Math.min(open, close) - wick * rand();
    const volume = Math.round(500000 + rand() * 2000000);
    const oiDelta = Math.round((rand() - 0.45) * baseOI * 0.008);
    oi += oiDelta;

    const date = new Date();
    date.setDate(date.getDate() - (count - i));
    candles.push({
      time: `${date.getDate()}/${date.getMonth() + 1}`,
      open: Math.round(open * 100) / 100,
      high: Math.round(high * 100) / 100,
      low: Math.round(low * 100) / 100,
      close: Math.round(close * 100) / 100,
      volume,
      oi,
      oiChange: oiDelta,
    });
    price = close;
  }
  return candles;
}

// ── OI-Weighted Greeks ──

export interface OIWeightedGreeks {
  netDelta: number;
  netGamma: number;
  netTheta: number;
  netVega: number;
  gammaExposure: number; // GEX
  topDeltaStrikes: { strike: number; delta: number; oi: number; contribution: number; type: string }[];
}

export function getOIWeightedGreeks(chain: OptionData[], lotSize: number): OIWeightedGreeks {
  let netDelta = 0, netGamma = 0, netTheta = 0, netVega = 0, gex = 0;
  const deltaContributions: { strike: number; delta: number; oi: number; contribution: number; type: string }[] = [];

  for (const o of chain) {
    const ceDeltaContrib = o.ce.delta * o.ce.oi;
    const peDeltaContrib = o.pe.delta * o.pe.oi;
    netDelta += ceDeltaContrib + peDeltaContrib;
    netGamma += o.ce.gamma * o.ce.oi + o.pe.gamma * o.pe.oi;
    netTheta += o.ce.theta * o.ce.oi + o.pe.theta * o.pe.oi;
    netVega += o.ce.vega * o.ce.oi + o.pe.vega * o.pe.oi;
    gex += o.ce.gamma * o.ce.oi - o.pe.gamma * o.pe.oi; // GEX = call gamma OI - put gamma OI

    if (Math.abs(ceDeltaContrib) > 50000) {
      deltaContributions.push({ strike: o.strikePrice, delta: o.ce.delta, oi: o.ce.oi, contribution: Math.round(ceDeltaContrib), type: "CE" });
    }
    if (Math.abs(peDeltaContrib) > 50000) {
      deltaContributions.push({ strike: o.strikePrice, delta: o.pe.delta, oi: o.pe.oi, contribution: Math.round(peDeltaContrib), type: "PE" });
    }
  }

  return {
    netDelta: Math.round(netDelta),
    netGamma: Math.round(netGamma * 100) / 100,
    netTheta: Math.round(netTheta),
    netVega: Math.round(netVega),
    gammaExposure: Math.round(gex),
    topDeltaStrikes: deltaContributions
      .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))
      .slice(0, 8),
  };
}

// ── Candlestick Data (original, kept for backward compat) ──

export interface CandleData {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export function generateCandleData(basePrice: number, count: number = 60): CandleData[] {
  const rand = seededRandom(Math.round(basePrice));
  let price = basePrice * 0.95;
  const candles: CandleData[] = [];

  for (let i = 0; i < count; i++) {
    const open = price;
    const change = (rand() - 0.48) * basePrice * 0.012;
    const close = open + change;
    const wick = Math.abs(change) * (0.5 + rand());
    const high = Math.max(open, close) + wick * rand();
    const low = Math.min(open, close) - wick * rand();
    const volume = Math.round(500000 + rand() * 2000000);

    const date = new Date();
    date.setDate(date.getDate() - (count - i));
    candles.push({
      time: `${date.getDate()}/${date.getMonth() + 1}`,
      open: Math.round(open * 100) / 100,
      high: Math.round(high * 100) / 100,
      low: Math.round(low * 100) / 100,
      close: Math.round(close * 100) / 100,
      volume,
    });
    price = close;
  }
  return candles;
}

// ── Position Tracker ──

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

export function getMockPositions(): Position[] {
  return [
    { id: "1", symbol: "NIFTY", type: "CE", action: "SELL", strike: 24500, lots: 2, entryPrice: 85.50, currentPrice: 62.30, lotSize: 25, entryDate: "20 Mar", expiry: "27 Mar", pnl: 1160, pnlPercent: 27.1, delta: -0.32, theta: 12.5, iv: 13.8 },
    { id: "2", symbol: "NIFTY", type: "PE", action: "SELL", strike: 24000, lots: 2, entryPrice: 72.30, currentPrice: 48.15, lotSize: 25, entryDate: "20 Mar", expiry: "27 Mar", pnl: 1207.5, pnlPercent: 33.4, delta: 0.22, theta: 10.8, iv: 14.2 },
    { id: "3", symbol: "BANKNIFTY", type: "CE", action: "BUY", strike: 52000, lots: 1, entryPrice: 320.00, currentPrice: 285.50, lotSize: 15, entryDate: "21 Mar", expiry: "27 Mar", pnl: -517.5, pnlPercent: -10.8, delta: 0.48, theta: -28.5, iv: 15.1 },
    { id: "4", symbol: "NIFTY", type: "CE", action: "BUY", strike: 24300, lots: 1, entryPrice: 145.00, currentPrice: 168.25, lotSize: 25, entryDate: "19 Mar", expiry: "27 Mar", pnl: 581.25, pnlPercent: 16.0, delta: 0.55, theta: -18.2, iv: 13.2 },
    { id: "5", symbol: "RELIANCE", type: "PE", action: "BUY", strike: 2900, lots: 1, entryPrice: 45.80, currentPrice: 32.10, lotSize: 250, entryDate: "18 Mar", expiry: "24 Apr", pnl: -3425, pnlPercent: -29.9, delta: -0.28, theta: -3.5, iv: 22.5 },
    { id: "6", symbol: "HDFCBANK", type: "CE", action: "SELL", strike: 1700, lots: 1, entryPrice: 38.50, currentPrice: 28.90, lotSize: 550, entryDate: "21 Mar", expiry: "24 Apr", pnl: 5280, pnlPercent: 24.9, delta: -0.35, theta: 5.2, iv: 18.8 },
  ];
}

// ── Market Breadth Data ──

export interface MarketBreadthData {
  advDecLine: { time: string; adLine: number; nifty: number }[];
  emaCoverage: { label: string; above20: number; above50: number; above200: number }[];
  highsLows: { time: string; newHighs: number; newLows: number }[];
  sectorRotation: { sector: string; momentum: number; trend: number; quadrant: string }[];
}

export function getMarketBreadth(): MarketBreadthData {
  const rand = seededRandom(77);
  const adLinePoints: MarketBreadthData["advDecLine"] = [];
  let adLine = 0;
  let nifty = 23800;
  for (let i = 0; i < 30; i++) {
    const adv = Math.round(700 + rand() * 800);
    const dec = Math.round(500 + rand() * 700);
    adLine += (adv - dec);
    nifty += (rand() - 0.45) * 100;
    const d = new Date(); d.setDate(d.getDate() - (30 - i));
    adLinePoints.push({ time: `${d.getDate()}/${d.getMonth() + 1}`, adLine, nifty: Math.round(nifty) });
  }

  const emaCoverage = [
    { label: "Nifty 50", above20: 62, above50: 54, above200: 72 },
    { label: "Nifty 100", above20: 58, above50: 48, above200: 65 },
    { label: "Nifty 200", above20: 55, above50: 45, above200: 60 },
    { label: "Nifty 500", above20: 52, above50: 42, above200: 58 },
  ];

  const highsLowsData: MarketBreadthData["highsLows"] = [];
  for (let i = 0; i < 20; i++) {
    const d = new Date(); d.setDate(d.getDate() - (20 - i));
    highsLowsData.push({
      time: `${d.getDate()}/${d.getMonth() + 1}`,
      newHighs: Math.round(15 + rand() * 40),
      newLows: Math.round(5 + rand() * 25),
    });
  }

  const sectorRotation = sectorData.map(s => ({
    sector: s.name,
    momentum: Math.round((rand() - 0.4) * 200) / 100,
    trend: Math.round((rand() - 0.4) * 300) / 100,
    quadrant: rand() > 0.5 ? (rand() > 0.5 ? "Leading" : "Weakening") : (rand() > 0.5 ? "Improving" : "Lagging"),
  }));

  return { advDecLine: adLinePoints, emaCoverage, highsLows: highsLowsData, sectorRotation };
}

// ── IV Rank & Expected Move ──

export interface IVRankData {
  ivRank: number;
  ivPercentile: number;
  currentIV: number;
  ivHigh52w: number;
  ivLow52w: number;
  expectedMove: number;
  expectedMovePercent: number;
  expectedMoveUp: number;
  expectedMoveDown: number;
  ivHistory: { time: string; iv: number; hvol: number }[];
}

export function getIVRankData(symbol: string): IVRankData {
  const spotMap: Record<string, number> = {
    NIFTY: 24250.75, BANKNIFTY: 51850.40, FINNIFTY: 23180.55, MIDCPNIFTY: 12850.30,
  };
  const spot = spotMap[symbol] || 2000;
  const rand = seededRandom(symbol.length * 100 + 42);
  const currentIV = 12 + rand() * 10;
  const ivHigh52w = currentIV * (1.4 + rand() * 0.5);
  const ivLow52w = currentIV * (0.5 + rand() * 0.3);
  const ivRank = Math.round(((currentIV - ivLow52w) / (ivHigh52w - ivLow52w)) * 100);
  const daysToExpiry = 4;
  const expectedMove = spot * (currentIV / 100) * Math.sqrt(daysToExpiry / 365);

  const ivHistory: { time: string; iv: number; hvol: number }[] = [];
  let iv = currentIV * 0.85;
  let hvol = iv * 0.9;
  for (let i = 0; i < 60; i++) {
    iv += (rand() - 0.48) * 1.5;
    iv = Math.max(8, Math.min(35, iv));
    hvol += (rand() - 0.48) * 1.2;
    hvol = Math.max(6, Math.min(30, hvol));
    const d = new Date(); d.setDate(d.getDate() - (60 - i));
    ivHistory.push({ time: `${d.getDate()}/${d.getMonth() + 1}`, iv: Math.round(iv * 100) / 100, hvol: Math.round(hvol * 100) / 100 });
  }

  return {
    ivRank,
    ivPercentile: Math.min(100, ivRank + Math.round(rand() * 10)),
    currentIV: Math.round(currentIV * 100) / 100,
    ivHigh52w: Math.round(ivHigh52w * 100) / 100,
    ivLow52w: Math.round(ivLow52w * 100) / 100,
    expectedMove: Math.round(expectedMove * 100) / 100,
    expectedMovePercent: Math.round((expectedMove / spot) * 10000) / 100,
    expectedMoveUp: Math.round((spot + expectedMove) * 100) / 100,
    expectedMoveDown: Math.round((spot - expectedMove) * 100) / 100,
    ivHistory,
  };
}

// ── Intraday Timeframe Candle Generator ──

export function generateIntradayCandles(basePrice: number, timeframe: string, baseOI?: number): CandleOIData[] {
  const rand = seededRandom(Math.round(basePrice * 7 + (timeframe === "1m" ? 1 : timeframe === "5m" ? 5 : timeframe === "15m" ? 15 : 60)));
  let price = basePrice * (1 - 0.003);
  let oi = baseOI || (basePrice > 10000 ? 15000000 : 5000000);
  const candles: CandleOIData[] = [];

  const minuteStep = timeframe === "1m" ? 1 : timeframe === "5m" ? 5 : timeframe === "15m" ? 15 : 60;
  const startH = 9, startM = 15, endH = 15, endM = 30;

  for (let h = startH; h <= endH; h++) {
    for (let m = (h === startH ? startM : 0); m < 60; m += minuteStep) {
      if (h === endH && m > endM) break;
      const open = price;
      const change = (rand() - 0.48) * basePrice * 0.002 * Math.sqrt(minuteStep);
      const close = open + change;
      const wick = Math.abs(change) * (0.3 + rand() * 0.7);
      const high = Math.max(open, close) + wick * rand();
      const low = Math.min(open, close) - wick * rand();
      const volume = Math.round((100000 + rand() * 500000) * (minuteStep / 5));
      const oiDelta = Math.round((rand() - 0.45) * oi * 0.001);
      oi += oiDelta;
      candles.push({
        time: `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`,
        open: Math.round(open * 100) / 100,
        high: Math.round(high * 100) / 100,
        low: Math.round(low * 100) / 100,
        close: Math.round(close * 100) / 100,
        volume,
        oi,
        oiChange: oiDelta,
      });
      price = close;
    }
  }
  return candles;
}

// ── P&L Simulator ──

export interface PnLSimPoint {
  spotPrice: number;
  totalPnl: number;
  positions: { label: string; pnl: number }[];
}

export function simulatePnL(positions: Position[], spotRange: [number, number], steps: number = 50): PnLSimPoint[] {
  const [minSpot, maxSpot] = spotRange;
  const step = (maxSpot - minSpot) / steps;
  const points: PnLSimPoint[] = [];

  for (let i = 0; i <= steps; i++) {
    const spot = minSpot + step * i;
    let totalPnl = 0;
    const posPnls: { label: string; pnl: number }[] = [];

    for (const p of positions) {
      const mult = p.action === "BUY" ? 1 : -1;
      let intrinsic: number;
      if (p.type === "CE") {
        intrinsic = Math.max(0, spot - p.strike);
      } else {
        intrinsic = Math.max(0, p.strike - spot);
      }
      const pnl = (intrinsic - p.entryPrice) * mult * p.lots * p.lotSize;
      totalPnl += pnl;
      posPnls.push({ label: `${p.action} ${p.strike}${p.type}`, pnl: Math.round(pnl) });
    }

    points.push({ spotPrice: Math.round(spot * 100) / 100, totalPnl: Math.round(totalPnl), positions: posPnls });
  }
  return points;
}

// ── Greeks Decay Simulation ──

export interface GreeksDecayPoint {
  day: number;
  label: string;
  totalPnl: number;
  totalTheta: number;
  totalDelta: number;
}

export function simulateGreeksDecay(positions: Position[], daysForward: number = 7): GreeksDecayPoint[] {
  const rand = seededRandom(positions.length * 31);
  const points: GreeksDecayPoint[] = [];
  let cumulativeTheta = 0;

  for (let d = 0; d <= daysForward; d++) {
    let totalPnl = 0;
    let totalTheta = 0;
    let totalDelta = 0;

    for (const p of positions) {
      const mult = p.action === "BUY" ? 1 : -1;
      const decayFactor = Math.max(0, 1 - d * 0.12 * (1 + d * 0.03));
      const priceMove = p.currentPrice * decayFactor + (rand() - 0.5) * p.currentPrice * 0.05;
      const pnl = (priceMove - p.entryPrice) * mult * p.lots * p.lotSize;
      totalPnl += pnl;
      totalTheta += p.theta * mult * p.lots * p.lotSize;
      totalDelta += p.delta * mult * p.lots * p.lotSize;
    }

    cumulativeTheta += totalTheta;
    points.push({
      day: d,
      label: d === 0 ? "Today" : `T+${d}`,
      totalPnl: Math.round(totalPnl),
      totalTheta: Math.round(cumulativeTheta),
      totalDelta: Math.round(totalDelta),
    });
  }
  return points;
}
