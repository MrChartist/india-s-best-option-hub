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
  ce: {
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
  };
  pe: {
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
  };
}

export interface ExpiryDate {
  label: string;
  value: string;
  daysToExpiry: number;
}

export const indicesData: IndexData[] = [
  { name: "NIFTY 50", symbol: "NIFTY", ltp: 24250.75, change: 125.30, changePercent: 0.52, high: 24310.00, low: 24100.50, open: 24125.45, prevClose: 24125.45 },
  { name: "BANK NIFTY", symbol: "BANKNIFTY", ltp: 51850.40, change: -180.60, changePercent: -0.35, high: 52100.00, low: 51700.25, open: 52031.00, prevClose: 52031.00 },
  { name: "FIN NIFTY", symbol: "FINNIFTY", ltp: 23180.55, change: 45.20, changePercent: 0.20, high: 23250.00, low: 23100.00, open: 23135.35, prevClose: 23135.35 },
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
};

export const expiryDates: ExpiryDate[] = [
  { label: "27 Mar 2026", value: "2026-03-27", daysToExpiry: 4 },
  { label: "03 Apr 2026", value: "2026-04-03", daysToExpiry: 11 },
  { label: "10 Apr 2026", value: "2026-04-10", daysToExpiry: 18 },
  { label: "17 Apr 2026", value: "2026-04-17", daysToExpiry: 25 },
  { label: "24 Apr 2026", value: "2026-04-24", daysToExpiry: 32 },
];

export const fnoStocks = [
  "RELIANCE", "TCS", "HDFCBANK", "INFY", "ICICIBANK", "HINDUNILVR",
  "SBIN", "BHARTIARTL", "ITC", "KOTAKBANK", "LT", "AXISBANK",
  "ASIANPAINT", "MARUTI", "TATAMOTORS", "SUNPHARMA", "TITAN",
  "WIPRO", "ULTRACEMCO", "BAJFINANCE",
];

function generateOptionChain(spotPrice: number, stepSize: number, numStrikes: number = 15): OptionData[] {
  const atmStrike = Math.round(spotPrice / stepSize) * stepSize;
  const strikes: OptionData[] = [];

  for (let i = -numStrikes; i <= numStrikes; i++) {
    const strike = atmStrike + i * stepSize;
    const moneyness = (spotPrice - strike) / spotPrice;
    const isITMCall = strike < spotPrice;
    const isITMPut = strike > spotPrice;

    const baseIV = 14 + Math.abs(moneyness) * 80 + Math.random() * 3;
    const ceOI = Math.round((isITMCall ? 2000 : 8000) * (1 + Math.random()) * 75);
    const peOI = Math.round((isITMPut ? 2000 : 8000) * (1 + Math.random()) * 75);

    const ceLTP = Math.max(0.05, isITMCall
      ? spotPrice - strike + Math.random() * 50
      : Math.max(0.05, (200 - Math.abs(i) * 15) * Math.random()));
    const peLTP = Math.max(0.05, isITMPut
      ? strike - spotPrice + Math.random() * 50
      : Math.max(0.05, (200 - Math.abs(i) * 15) * Math.random()));

    strikes.push({
      strikePrice: strike,
      ce: {
        ltp: Math.round(ceLTP * 100) / 100,
        oi: ceOI,
        oiChange: Math.round((Math.random() - 0.4) * ceOI * 0.1),
        volume: Math.round(Math.random() * 50000),
        iv: Math.round(baseIV * 100) / 100,
        delta: Math.round((isITMCall ? 0.6 + Math.random() * 0.35 : Math.random() * 0.4) * 1000) / 1000,
        gamma: Math.round(Math.random() * 0.005 * 10000) / 10000,
        theta: -Math.round(Math.random() * 15 * 100) / 100,
        vega: Math.round(Math.random() * 12 * 100) / 100,
        bidPrice: Math.round((ceLTP - Math.random() * 2) * 100) / 100,
        askPrice: Math.round((ceLTP + Math.random() * 2) * 100) / 100,
      },
      pe: {
        ltp: Math.round(peLTP * 100) / 100,
        oi: peOI,
        oiChange: Math.round((Math.random() - 0.4) * peOI * 0.1),
        volume: Math.round(Math.random() * 50000),
        iv: Math.round((baseIV + Math.random() * 2) * 100) / 100,
        delta: -Math.round((isITMPut ? 0.6 + Math.random() * 0.35 : Math.random() * 0.4) * 1000) / 1000,
        gamma: Math.round(Math.random() * 0.005 * 10000) / 10000,
        theta: -Math.round(Math.random() * 15 * 100) / 100,
        vega: Math.round(Math.random() * 12 * 100) / 100,
        bidPrice: Math.round((peLTP - Math.random() * 2) * 100) / 100,
        askPrice: Math.round((peLTP + Math.random() * 2) * 100) / 100,
      },
    });
  }

  return strikes;
}

export function getOptionChain(symbol: string): { data: OptionData[]; spotPrice: number; lotSize: number } {
  switch (symbol) {
    case "NIFTY":
      return { data: generateOptionChain(24250.75, 50), spotPrice: 24250.75, lotSize: 25 };
    case "BANKNIFTY":
      return { data: generateOptionChain(51850.40, 100), spotPrice: 51850.40, lotSize: 15 };
    case "FINNIFTY":
      return { data: generateOptionChain(23180.55, 50), spotPrice: 23180.55, lotSize: 25 };
    default:
      return { data: generateOptionChain(2500, 25, 10), spotPrice: 2500, lotSize: 500 };
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

// Black-Scholes Greeks Calculator
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

// Strategy definitions
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
}

export function getPresetStrategies(spotPrice: number, stepSize: number): Strategy[] {
  const atm = Math.round(spotPrice / stepSize) * stepSize;
  return [
    {
      name: "Long Straddle",
      description: "Buy ATM Call + ATM Put. Profit from large moves in either direction.",
      legs: [
        { type: "CE", action: "BUY", strike: atm, lots: 1, premium: 150 },
        { type: "PE", action: "BUY", strike: atm, lots: 1, premium: 140 },
      ],
    },
    {
      name: "Short Straddle",
      description: "Sell ATM Call + ATM Put. Profit from low volatility / range-bound market.",
      legs: [
        { type: "CE", action: "SELL", strike: atm, lots: 1, premium: 150 },
        { type: "PE", action: "SELL", strike: atm, lots: 1, premium: 140 },
      ],
    },
    {
      name: "Long Strangle",
      description: "Buy OTM Call + OTM Put. Cheaper than straddle, needs bigger move.",
      legs: [
        { type: "CE", action: "BUY", strike: atm + stepSize * 2, lots: 1, premium: 60 },
        { type: "PE", action: "BUY", strike: atm - stepSize * 2, lots: 1, premium: 55 },
      ],
    },
    {
      name: "Bull Call Spread",
      description: "Buy lower strike Call, Sell higher strike Call. Limited risk bullish bet.",
      legs: [
        { type: "CE", action: "BUY", strike: atm, lots: 1, premium: 150 },
        { type: "CE", action: "SELL", strike: atm + stepSize * 3, lots: 1, premium: 50 },
      ],
    },
    {
      name: "Bear Put Spread",
      description: "Buy higher strike Put, Sell lower strike Put. Limited risk bearish bet.",
      legs: [
        { type: "PE", action: "BUY", strike: atm, lots: 1, premium: 140 },
        { type: "PE", action: "SELL", strike: atm - stepSize * 3, lots: 1, premium: 45 },
      ],
    },
    {
      name: "Iron Condor",
      description: "Sell OTM Call + Put spreads. Profit from range-bound market.",
      legs: [
        { type: "PE", action: "BUY", strike: atm - stepSize * 4, lots: 1, premium: 25 },
        { type: "PE", action: "SELL", strike: atm - stepSize * 2, lots: 1, premium: 55 },
        { type: "CE", action: "SELL", strike: atm + stepSize * 2, lots: 1, premium: 60 },
        { type: "CE", action: "BUY", strike: atm + stepSize * 4, lots: 1, premium: 20 },
      ],
    },
    {
      name: "Long Call Butterfly",
      description: "Buy 1 ITM Call, Sell 2 ATM Calls, Buy 1 OTM Call. Low cost, profit at ATM.",
      legs: [
        { type: "CE", action: "BUY", strike: atm - stepSize * 2, lots: 1, premium: 220 },
        { type: "CE", action: "SELL", strike: atm, lots: 2, premium: 150 },
        { type: "CE", action: "BUY", strike: atm + stepSize * 2, lots: 1, premium: 60 },
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
