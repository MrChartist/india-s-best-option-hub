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

export const fnoStocks = [
  "RELIANCE", "TCS", "HDFCBANK", "INFY", "ICICIBANK", "HINDUNILVR",
  "SBIN", "BHARTIARTL", "ITC", "KOTAKBANK", "LT", "AXISBANK",
  "ASIANPAINT", "MARUTI", "TATAMOTORS", "SUNPHARMA", "TITAN",
  "WIPRO", "ULTRACEMCO", "BAJFINANCE",
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
