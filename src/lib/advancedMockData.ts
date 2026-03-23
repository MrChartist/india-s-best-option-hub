// Advanced mock data for Straddle Charts, IV Surface, FII/DII, OI Spurts, Watchlist

function seededRandom(seed: number): () => number {
  let s = seed;
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
}

// ── Straddle/Strangle Charts ──

export interface StraddlePremiumPoint {
  time: string;
  straddlePremium: number;
  stranglePremium: number;
  spotPrice: number;
  cePrice: number;
  pePrice: number;
  iv: number;
}

export function generateStraddleIntraday(spotBase: number, ceBase: number, peBase: number): StraddlePremiumPoint[] {
  const rand = seededRandom(Math.round(spotBase * 11));
  const points: StraddlePremiumPoint[] = [];
  let spot = spotBase, ce = ceBase, pe = peBase, iv = 13.5;
  const strangleCE = ceBase * 0.4, stranglePE = peBase * 0.35;
  let sce = strangleCE, spe = stranglePE;

  for (let h = 9; h <= 15; h++) {
    for (let m = h === 9 ? 15 : 0; m < 60; m += 5) {
      if (h === 15 && m > 30) break;
      const move = (rand() - 0.48) * spotBase * 0.001;
      spot += move;
      ce += (rand() - 0.52) * ceBase * 0.015;
      pe += (rand() - 0.48) * peBase * 0.015;
      sce += (rand() - 0.52) * strangleCE * 0.02;
      spe += (rand() - 0.48) * stranglePE * 0.02;
      iv += (rand() - 0.5) * 0.15;
      ce = Math.max(1, ce); pe = Math.max(1, pe);
      sce = Math.max(0.5, sce); spe = Math.max(0.5, spe);
      points.push({
        time: `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`,
        straddlePremium: Math.round((ce + pe) * 100) / 100,
        stranglePremium: Math.round((sce + spe) * 100) / 100,
        spotPrice: Math.round(spot * 100) / 100,
        cePrice: Math.round(ce * 100) / 100,
        pePrice: Math.round(pe * 100) / 100,
        iv: Math.round(iv * 100) / 100,
      });
    }
  }
  return points;
}

export function generateStraddleHistory(spotBase: number): { date: string; premium: number; premiumDecay: number; spot: number }[] {
  const rand = seededRandom(Math.round(spotBase * 3));
  const points: { date: string; premium: number; premiumDecay: number; spot: number }[] = [];
  let premium = spotBase * 0.025;
  let spot = spotBase * 0.98;
  for (let d = 30; d >= 0; d--) {
    premium *= (1 - 0.03 + (rand() - 0.5) * 0.04);
    premium = Math.max(spotBase * 0.002, premium);
    spot += (rand() - 0.48) * spotBase * 0.005;
    const dt = new Date(); dt.setDate(dt.getDate() - d);
    points.push({
      date: `${dt.getDate()}/${dt.getMonth() + 1}`,
      premium: Math.round(premium * 100) / 100,
      premiumDecay: Math.round((spotBase * 0.025 - premium) * 100) / 100,
      spot: Math.round(spot * 100) / 100,
    });
  }
  return points;
}

// ── IV Surface ──

export interface IVSurfacePoint {
  strike: number;
  expiry: string;
  daysToExpiry: number;
  iv: number;
  moneyness: number;
}

export function generateIVSurface(spotPrice: number, stepSize: number): IVSurfacePoint[] {
  const rand = seededRandom(Math.round(spotPrice * 7));
  const expiries = [
    { label: "27 Mar", days: 4 }, { label: "3 Apr", days: 11 },
    { label: "10 Apr", days: 18 }, { label: "17 Apr", days: 25 },
    { label: "24 Apr", days: 32 }, { label: "29 May", days: 67 },
  ];
  const points: IVSurfacePoint[] = [];
  const atm = Math.round(spotPrice / stepSize) * stepSize;

  for (const exp of expiries) {
    for (let i = -8; i <= 8; i++) {
      const strike = atm + i * stepSize;
      const moneyness = (strike - spotPrice) / spotPrice;
      // IV smile with term structure
      const baseIV = 13 + Math.pow(Math.abs(moneyness) * 15, 1.6) + (moneyness < 0 ? 1.5 : 0);
      const termPremium = Math.sqrt(exp.days / 30) * 1.5;
      const noise = (rand() - 0.5) * 1;
      points.push({
        strike,
        expiry: exp.label,
        daysToExpiry: exp.days,
        iv: Math.round((baseIV + termPremium + noise) * 100) / 100,
        moneyness: Math.round(moneyness * 10000) / 100,
      });
    }
  }
  return points;
}

export interface IVTermStructure {
  expiry: string;
  daysToExpiry: number;
  atmIV: number;
  callSkew: number;
  putSkew: number;
}

export function getIVTermStructure(spotPrice: number, stepSize: number): IVTermStructure[] {
  const surface = generateIVSurface(spotPrice, stepSize);
  const atm = Math.round(spotPrice / stepSize) * stepSize;
  const expiries = [...new Set(surface.map(p => p.expiry))];
  
  return expiries.map(exp => {
    const expiryPoints = surface.filter(p => p.expiry === exp);
    const atmPoint = expiryPoints.find(p => p.strike === atm);
    const otmPut = expiryPoints.find(p => p.strike === atm - stepSize * 3);
    const otmCall = expiryPoints.find(p => p.strike === atm + stepSize * 3);
    return {
      expiry: exp,
      daysToExpiry: expiryPoints[0]?.daysToExpiry || 0,
      atmIV: atmPoint?.iv || 13,
      putSkew: otmPut ? otmPut.iv - (atmPoint?.iv || 13) : 0,
      callSkew: otmCall ? otmCall.iv - (atmPoint?.iv || 13) : 0,
    };
  });
}

// ── FII/DII Activity ──

export interface FIIDIIDay {
  date: string;
  fiiBuy: number;
  fiiSell: number;
  fiiNet: number;
  diiBuy: number;
  diiSell: number;
  diiNet: number;
  niftyClose: number;
}

export function generateFIIDIIHistory(): FIIDIIDay[] {
  const rand = seededRandom(999);
  const days: FIIDIIDay[] = [];
  let nifty = 23800;
  for (let d = 30; d >= 0; d--) {
    const fiiBuy = 3000 + rand() * 4000;
    const fiiSell = 2800 + rand() * 4200;
    const diiBuy = 2500 + rand() * 3000;
    const diiSell = 2200 + rand() * 3200;
    nifty += (fiiBuy - fiiSell + diiBuy - diiSell) * 0.02 + (rand() - 0.5) * 80;
    const dt = new Date(); dt.setDate(dt.getDate() - d);
    days.push({
      date: `${dt.getDate()}/${dt.getMonth() + 1}`,
      fiiBuy: Math.round(fiiBuy), fiiSell: Math.round(fiiSell), fiiNet: Math.round(fiiBuy - fiiSell),
      diiBuy: Math.round(diiBuy), diiSell: Math.round(diiSell), diiNet: Math.round(diiBuy - diiSell),
      niftyClose: Math.round(nifty),
    });
  }
  return days;
}

export interface RolloverData {
  symbol: string;
  currentMonthOI: number;
  nextMonthOI: number;
  rolloverPercent: number;
  prevRollover: number;
  costOfCarry: number;
  marketWideOI: number;
  interpretation: string;
}

export function getRolloverData(): RolloverData[] {
  const rand = seededRandom(555);
  const symbols = ["NIFTY", "BANKNIFTY", "FINNIFTY", "RELIANCE", "TCS", "HDFCBANK", "INFY", "ICICIBANK", "SBIN", "TATAMOTORS"];
  return symbols.map(s => {
    const currentOI = 5000000 + rand() * 20000000;
    const nextOI = currentOI * (0.3 + rand() * 0.5);
    const rollover = (nextOI / (currentOI + nextOI)) * 100;
    const prevRollover = rollover * (0.85 + rand() * 0.3);
    const costOfCarry = (rand() - 0.3) * 2;
    return {
      symbol: s,
      currentMonthOI: Math.round(currentOI),
      nextMonthOI: Math.round(nextOI),
      rolloverPercent: Math.round(rollover * 100) / 100,
      prevRollover: Math.round(prevRollover * 100) / 100,
      costOfCarry: Math.round(costOfCarry * 100) / 100,
      marketWideOI: Math.round(currentOI + nextOI),
      interpretation: costOfCarry > 0.5 ? "Bullish Carry" : costOfCarry < -0.3 ? "Bearish Carry" : "Neutral",
    };
  });
}

export interface FIIFuturesOI {
  date: string;
  longOI: number;
  shortOI: number;
  netOI: number;
  longShortRatio: number;
}

export function generateFIIFuturesOI(): FIIFuturesOI[] {
  const rand = seededRandom(321);
  const points: FIIFuturesOI[] = [];
  let longOI = 450000, shortOI = 420000;
  for (let d = 30; d >= 0; d--) {
    longOI += Math.round((rand() - 0.48) * 15000);
    shortOI += Math.round((rand() - 0.52) * 15000);
    longOI = Math.max(300000, longOI); shortOI = Math.max(280000, shortOI);
    const dt = new Date(); dt.setDate(dt.getDate() - d);
    points.push({
      date: `${dt.getDate()}/${dt.getMonth() + 1}`,
      longOI, shortOI,
      netOI: longOI - shortOI,
      longShortRatio: Math.round((longOI / shortOI) * 100) / 100,
    });
  }
  return points;
}

// ── OI Spurts ──

export interface OISpurt {
  symbol: string;
  strike: number;
  type: "CE" | "PE";
  previousOI: number;
  currentOI: number;
  oiChange: number;
  oiChangePercent: number;
  ltp: number;
  ltpChange: number;
  volume: number;
  timestamp: string;
  interpretation: "Long Buildup" | "Short Buildup" | "Long Unwinding" | "Short Covering";
}

export function getOISpurts(): OISpurt[] {
  const rand = seededRandom(88);
  const spurts: OISpurt[] = [];
  const symbols = ["NIFTY", "BANKNIFTY", "RELIANCE", "HDFCBANK", "INFY", "TATAMOTORS", "SBIN", "TCS"];
  const spotPrices: Record<string, number> = {
    NIFTY: 24250, BANKNIFTY: 51850, RELIANCE: 2945, HDFCBANK: 1685,
    INFY: 1520, TATAMOTORS: 985, SBIN: 825, TCS: 3850,
  };

  for (let i = 0; i < 20; i++) {
    const sym = symbols[Math.floor(rand() * symbols.length)];
    const spot = spotPrices[sym] || 2000;
    const step = sym === "BANKNIFTY" ? 100 : sym === "NIFTY" ? 50 : 25;
    const strikeOffset = Math.round((rand() - 0.5) * 6) * step;
    const type = rand() > 0.5 ? "CE" as const : "PE" as const;
    const prevOI = Math.round(200000 + rand() * 2000000);
    const oiChg = Math.round(prevOI * (0.08 + rand() * 0.25) * (rand() > 0.3 ? 1 : -1));
    const ltpChg = (rand() - 0.45) * 20;
    const interp = oiChg > 0
      ? (ltpChg > 0 ? "Long Buildup" : "Short Buildup")
      : (ltpChg > 0 ? "Short Covering" : "Long Unwinding");
    const h = 9 + Math.floor(rand() * 6);
    const m = Math.floor(rand() * 12) * 5;

    spurts.push({
      symbol: sym,
      strike: Math.round(spot / step) * step + strikeOffset,
      type,
      previousOI: prevOI,
      currentOI: prevOI + oiChg,
      oiChange: oiChg,
      oiChangePercent: Math.round((oiChg / prevOI) * 10000) / 100,
      ltp: Math.round((20 + rand() * 200) * 100) / 100,
      ltpChange: Math.round(ltpChg * 100) / 100,
      volume: Math.round(50000 + rand() * 500000),
      timestamp: `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`,
      interpretation: interp as OISpurt["interpretation"],
    });
  }
  return spurts.sort((a, b) => Math.abs(b.oiChangePercent) - Math.abs(a.oiChangePercent));
}

// ── Watchlist ──

export interface WatchlistItem {
  symbol: string;
  ltp: number;
  change: number;
  changePercent: number;
  iv: number;
  ivRank: number;
  oi: number;
  oiChange: number;
  pcr: number;
  volume: number;
}

export function getDefaultWatchlist(): WatchlistItem[] {
  const rand = seededRandom(42);
  const items: { sym: string; ltp: number }[] = [
    { sym: "NIFTY", ltp: 24250 }, { sym: "BANKNIFTY", ltp: 51850 },
    { sym: "FINNIFTY", ltp: 23180 }, { sym: "RELIANCE", ltp: 2945 },
    { sym: "HDFCBANK", ltp: 1685 }, { sym: "INFY", ltp: 1520 },
    { sym: "TCS", ltp: 3850 }, { sym: "SBIN", ltp: 825 },
    { sym: "TATAMOTORS", ltp: 985 }, { sym: "BAJFINANCE", ltp: 7280 },
  ];
  return items.map(({ sym, ltp }) => ({
    symbol: sym, ltp,
    change: Math.round((rand() - 0.45) * ltp * 0.02 * 100) / 100,
    changePercent: Math.round((rand() - 0.45) * 3 * 100) / 100,
    iv: Math.round((12 + rand() * 15) * 100) / 100,
    ivRank: Math.round(rand() * 100),
    oi: Math.round(5000000 + rand() * 30000000),
    oiChange: Math.round((rand() - 0.4) * 2000000),
    pcr: Math.round((0.5 + rand() * 1.5) * 100) / 100,
    volume: Math.round(2000000 + rand() * 10000000),
  }));
}
