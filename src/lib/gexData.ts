// GEX (Gamma Exposure) calculation engine + mock data generators
// GEX = Gamma × OI × Contract Multiplier × Spot² × 0.01

export interface GEXByStrike {
  strike: number;
  callGEX: number;
  putGEX: number;
  netGEX: number;
  callOI: number;
  putOI: number;
  callGamma: number;
  putGamma: number;
}

export interface GEXSummary {
  totalCallGEX: number;
  totalPutGEX: number;
  netGEX: number;
  flipPoint: number; // where net GEX flips sign
  keyLevels: { strike: number; type: "support" | "resistance" | "magnet"; strength: number }[];
  dealerPosition: "long_gamma" | "short_gamma" | "neutral";
}

export interface IVRankData {
  symbol: string;
  currentIV: number;
  ivRank: number;        // 0-100, where current IV sits vs 52-week range
  ivPercentile: number;  // % of days IV was below current level
  iv52High: number;
  iv52Low: number;
  ivMean: number;
  hvCurrent: number;     // current realized vol
  vrp: number;           // IV - HV = volatility risk premium
  ivHistory: { date: string; iv: number; hv: number }[];
}

export interface ExpectedMoveData {
  symbol: string;
  spotPrice: number;
  iv: number;
  daysToExpiry: number;
  expectedMove: number;      // ±1σ in points
  expectedMovePercent: number;
  upperBound1SD: number;
  lowerBound1SD: number;
  upperBound2SD: number;
  lowerBound2SD: number;
  straddlePrice: number;     // ATM straddle as market-implied move
}

// ── GEX Calculation ──

function seededRandom(seed: number): () => number {
  let s = seed;
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
}

export function calculateGEX(
  spotPrice: number,
  chain: { strikePrice: number; ce: { oi: number; gamma: number }; pe: { oi: number; gamma: number } }[],
  lotSize: number
): GEXByStrike[] {
  return chain.map(row => {
    const callGEX = row.ce.gamma * row.ce.oi * lotSize * spotPrice * spotPrice * 0.01 / 1e7;
    const putGEX = -row.pe.gamma * row.pe.oi * lotSize * spotPrice * spotPrice * 0.01 / 1e7;
    return {
      strike: row.strikePrice,
      callGEX: Math.round(callGEX * 100) / 100,
      putGEX: Math.round(putGEX * 100) / 100,
      netGEX: Math.round((callGEX + putGEX) * 100) / 100,
      callOI: row.ce.oi,
      putOI: row.pe.oi,
      callGamma: row.ce.gamma,
      putGamma: row.pe.gamma,
    };
  });
}

export function getGEXSummary(gexByStrike: GEXByStrike[], spotPrice: number): GEXSummary {
  const totalCallGEX = gexByStrike.reduce((s, r) => s + r.callGEX, 0);
  const totalPutGEX = gexByStrike.reduce((s, r) => s + r.putGEX, 0);
  const netGEX = totalCallGEX + totalPutGEX;

  // Find flip point (where net GEX changes sign)
  let flipPoint = spotPrice;
  for (let i = 1; i < gexByStrike.length; i++) {
    if ((gexByStrike[i - 1].netGEX > 0 && gexByStrike[i].netGEX < 0) ||
        (gexByStrike[i - 1].netGEX < 0 && gexByStrike[i].netGEX > 0)) {
      flipPoint = gexByStrike[i].strike;
      break;
    }
  }

  // Key levels: strikes with highest absolute GEX
  const sorted = [...gexByStrike].sort((a, b) => Math.abs(b.netGEX) - Math.abs(a.netGEX));
  const keyLevels = sorted.slice(0, 5).map(s => ({
    strike: s.strike,
    type: (s.netGEX > 0 ? "resistance" : s.strike < spotPrice ? "support" : "magnet") as "support" | "resistance" | "magnet",
    strength: Math.abs(s.netGEX),
  }));

  return {
    totalCallGEX: Math.round(totalCallGEX * 100) / 100,
    totalPutGEX: Math.round(totalPutGEX * 100) / 100,
    netGEX: Math.round(netGEX * 100) / 100,
    flipPoint,
    keyLevels,
    dealerPosition: netGEX > 2 ? "long_gamma" : netGEX < -2 ? "short_gamma" : "neutral",
  };
}

// ── Mock GEX Data ──

export function generateMockGEX(spotPrice: number, stepSize: number = 50): GEXByStrike[] {
  const rand = seededRandom(Math.round(spotPrice * 7));
  const atmStrike = Math.round(spotPrice / stepSize) * stepSize;
  const strikes: GEXByStrike[] = [];

  for (let i = -20; i <= 20; i++) {
    const strike = atmStrike + i * stepSize;
    const moneyness = Math.abs(i);
    const oiBase = Math.max(500000, 5000000 * Math.exp(-moneyness * 0.15));
    const callOI = Math.round(oiBase * (0.7 + rand() * 0.6) * (i < 0 ? 0.5 : 1));
    const putOI = Math.round(oiBase * (0.7 + rand() * 0.6) * (i > 0 ? 0.5 : 1));
    const gammaBase = 0.002 * Math.exp(-moneyness * moneyness * 0.02);
    const callGamma = gammaBase * (0.8 + rand() * 0.4);
    const putGamma = gammaBase * (0.8 + rand() * 0.4);

    const callGEX = callGamma * callOI * 25 * spotPrice * spotPrice * 0.01 / 1e7;
    const putGEX = -putGamma * putOI * 25 * spotPrice * spotPrice * 0.01 / 1e7;

    strikes.push({
      strike,
      callGEX: Math.round(callGEX * 100) / 100,
      putGEX: Math.round(putGEX * 100) / 100,
      netGEX: Math.round((callGEX + putGEX) * 100) / 100,
      callOI,
      putOI,
      callGamma,
      putGamma,
    });
  }
  return strikes;
}

// ── IV Rank / Percentile ──

export function generateIVRankData(symbol: string, currentIV: number): IVRankData {
  const rand = seededRandom(symbol.length * 31 + Math.round(currentIV * 100));
  const iv52High = currentIV * (1.4 + rand() * 0.6);
  const iv52Low = currentIV * (0.4 + rand() * 0.2);
  const ivRank = Math.round(((currentIV - iv52Low) / (iv52High - iv52Low)) * 100);
  const hvCurrent = currentIV * (0.7 + rand() * 0.3);

  // Generate 252 trading days of IV history
  const ivHistory: { date: string; iv: number; hv: number }[] = [];
  let iv = iv52Low + rand() * (iv52High - iv52Low);
  let hv = iv * (0.6 + rand() * 0.3);
  for (let d = 252; d >= 0; d--) {
    iv += (rand() - 0.5) * 1.5;
    iv = Math.max(iv52Low * 0.8, Math.min(iv52High * 1.1, iv));
    hv += (rand() - 0.5) * 1.2;
    hv = Math.max(iv52Low * 0.5, Math.min(iv52High * 0.9, hv));
    const dt = new Date();
    dt.setDate(dt.getDate() - d);
    if (dt.getDay() === 0 || dt.getDay() === 6) continue;
    ivHistory.push({
      date: `${dt.getDate()}/${dt.getMonth() + 1}`,
      iv: Math.round(iv * 100) / 100,
      hv: Math.round(hv * 100) / 100,
    });
  }

  // IV Percentile: % of days IV was below current
  const belowCount = ivHistory.filter(p => p.iv < currentIV).length;
  const ivPercentile = Math.round((belowCount / ivHistory.length) * 100);

  return {
    symbol,
    currentIV,
    ivRank: Math.max(0, Math.min(100, ivRank)),
    ivPercentile,
    iv52High: Math.round(iv52High * 100) / 100,
    iv52Low: Math.round(iv52Low * 100) / 100,
    ivMean: Math.round(((iv52High + iv52Low) / 2) * 100) / 100,
    hvCurrent: Math.round(hvCurrent * 100) / 100,
    vrp: Math.round((currentIV - hvCurrent) * 100) / 100,
    ivHistory: ivHistory.slice(-60), // last 60 trading days
  };
}

// ── Expected Move Calculator ──

export function calculateExpectedMove(
  spotPrice: number,
  iv: number,         // annualized IV as percentage (e.g., 13.5)
  daysToExpiry: number,
  straddlePrice?: number
): ExpectedMoveData {
  // Expected Move = Spot × IV% × √(DTE/365)
  const ivDecimal = iv / 100;
  const sqrtTime = Math.sqrt(daysToExpiry / 365);
  const expectedMove = spotPrice * ivDecimal * sqrtTime;
  const expectedMovePercent = ivDecimal * sqrtTime * 100;

  return {
    symbol: "",
    spotPrice,
    iv,
    daysToExpiry,
    expectedMove: Math.round(expectedMove * 100) / 100,
    expectedMovePercent: Math.round(expectedMovePercent * 100) / 100,
    upperBound1SD: Math.round((spotPrice + expectedMove) * 100) / 100,
    lowerBound1SD: Math.round((spotPrice - expectedMove) * 100) / 100,
    upperBound2SD: Math.round((spotPrice + expectedMove * 2) * 100) / 100,
    lowerBound2SD: Math.round((spotPrice - expectedMove * 2) * 100) / 100,
    straddlePrice: straddlePrice || Math.round(expectedMove * 0.85 * 100) / 100, // straddle is usually ~85% of 1SD
  };
}

// Generate IV Rank for multiple symbols
export function generateMultiSymbolIVRank(): IVRankData[] {
  const symbols = [
    { symbol: "NIFTY", iv: 13.45 },
    { symbol: "BANKNIFTY", iv: 15.2 },
    { symbol: "FINNIFTY", iv: 12.8 },
    { symbol: "RELIANCE", iv: 22.5 },
    { symbol: "TCS", iv: 18.3 },
    { symbol: "HDFCBANK", iv: 20.1 },
    { symbol: "INFY", iv: 24.6 },
    { symbol: "ICICIBANK", iv: 21.8 },
    { symbol: "SBIN", iv: 28.4 },
    { symbol: "TATAMOTORS", iv: 32.1 },
  ];
  return symbols.map(s => generateIVRankData(s.symbol, s.iv));
}
