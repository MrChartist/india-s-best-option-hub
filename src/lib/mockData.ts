// Types, constants, and calculation utilities for the options trading terminal

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

// -- Utility --


function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}


// -- Analysis Utilities (operate on live chain data) --

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

// ΓöÇΓöÇ Black-Scholes Greeks Calculator ΓöÇΓöÇ

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

// ΓöÇΓöÇ Strategy Definitions ΓöÇΓöÇ

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

// ΓöÇΓöÇ IV Analytics ΓöÇΓöÇ

// -- IV Analytics --

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

export interface ScannerResult {
  symbol: string;
  ltp: number;
  changePercent: number;
  iv: number;
  ivRank: number;
  ivPercentile: number;
  signalType: "Long Buildup" | "Short Buildup" | "Short Covering" | "Long Unwinding" | "High IV" | "Low IV";
  sector: string;
}


// ΓöÇΓöÇ Delta OI (OI ├ù Delta per strike) ΓöÇΓöÇ

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

// ΓöÇΓöÇ Strike-wise PCR ΓöÇΓöÇ

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

// ΓöÇΓöÇ ATM Zone Analysis (nearest N strikes) ΓöÇΓöÇ

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

// ΓöÇΓöÇ Option Price + OI Time Series (mock intraday) ΓöÇΓöÇ

export interface OptionOITimeSeriesPoint {
  time: string;
  optionPrice: number;
  oi: number;
  oiChange: number;
  volume: number;
}


// ΓöÇΓöÇ OI-Weighted Greeks ΓöÇΓöÇ

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

// ΓöÇΓöÇ Candlestick Data (original, kept for backward compat) ΓöÇΓöÇ

export interface CandleData {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

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



// ΓöÇΓöÇ P&L Simulator ΓöÇΓöÇ

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

// ΓöÇΓöÇ Greeks Decay Simulation ΓöÇΓöÇ

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

