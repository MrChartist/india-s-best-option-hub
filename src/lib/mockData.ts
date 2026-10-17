// Types, constants and legacy calculation utilities for the options terminal.
// New code should use "@/lib/options" (the shared, tested math core); the calculators here are
// thin deprecated wrappers kept so older imports keep working.
import {
  estimateMargin as estimateMarginCore,
  getExpiries,
  probabilityOfProfit,
  type Leg,
} from "@/lib/options";

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

function toContractLegs(legs: StrategyLeg[], lotSize: number, symbol: string, expiry: string): Leg[] {
  return legs.map((l) => ({
    symbol,
    type: l.type,
    side: l.action,
    strike: l.strike,
    expiry,
    lots: l.lots,
    lotSize,
    premium: l.premium,
  }));
}

/**
 * @deprecated Use estimateMargin() from "@/lib/options" (SPAN-style estimate with hedge benefit).
 * Returns the estimated total margin in rupees. symbol/expiry default to NIFTY and its nearest expiry.
 */
export function estimateMargin(
  legs: StrategyLeg[], lotSize: number, spotPrice: number,
  opts?: { symbol?: string; expiry?: string; iv?: number }
): number {
  const symbol = opts?.symbol ?? "NIFTY";
  const expiry = opts?.expiry ?? getExpiries(symbol, new Date(), 1)[0]?.date ?? "";
  const est = estimateMarginCore(toContractLegs(legs, lotSize, symbol, expiry), {
    spot: spotPrice,
    sigma: opts?.iv && opts.iv > 0 ? opts.iv / 100 : undefined,
  });
  return Number.isFinite(est.total) ? Math.round(est.total) : 0;
}

/**
 * @deprecated Use probabilityOfProfit() from "@/lib/options" (lognormal integral).
 * iv in PERCENT, daysToExpiry in calendar days. Returns a whole-number percentage (0-100).
 */
export function estimateProbOfProfit(legs: StrategyLeg[], lotSize: number, spotPrice: number, iv: number, daysToExpiry: number): number {
  const pop = probabilityOfProfit(toContractLegs(legs, lotSize, "NIFTY", ""), {
    F: spotPrice,
    T: Math.max(daysToExpiry, 0) / 365,
    sigma: iv / 100,
  });
  return Number.isFinite(pop) ? Math.round(pop * 100) : 0;
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


// ── Delta OI (OI × Delta per strike) ──

export interface DeltaOIData {
  strike: number;
  ceDeltaOI: number; // CE OI * CE Delta
  peDeltaOI: number; // PE OI * PE Delta (negative)
  netDeltaOI: number;
}

// ── Strike-wise PCR ──

export interface StrikePCRData {
  strike: number;
  pcr: number;
  ceOI: number;
  peOI: number;
  distance: number;
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

// ── Option Price + OI Time Series (mock intraday) ──

export interface OptionOITimeSeriesPoint {
  time: string;
  optionPrice: number;
  oi: number;
  oiChange: number;
  volume: number;
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

export function getOIWeightedGreeks(chain: OptionData[], _lotSize: number): OIWeightedGreeks {
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

/**
 * Deterministic premium-decay sketch for a set of positions (no random noise: the result is a
 * rough illustration, not a forecast). Prefer the payoff and Greeks helpers in "@/lib/options".
 */
export function simulateGreeksDecay(positions: Position[], daysForward: number = 7): GreeksDecayPoint[] {
  const points: GreeksDecayPoint[] = [];
  let cumulativeTheta = 0;

  for (let d = 0; d <= daysForward; d++) {
    let totalPnl = 0;
    let totalTheta = 0;
    let totalDelta = 0;

    for (const p of positions) {
      const mult = p.action === "BUY" ? 1 : -1;
      const decayFactor = Math.max(0, 1 - d * 0.12 * (1 + d * 0.03));
      const priceMove = p.currentPrice * decayFactor;
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

