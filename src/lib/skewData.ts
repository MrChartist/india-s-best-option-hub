// Skew Dashboard data generators

export interface SkewPoint {
  strike: number;
  callIV: number;
  putIV: number;
  skew: number; // putIV - callIV
  moneyness: number; // strike / spot
}

export interface TermStructurePoint {
  expiry: string;
  dte: number;
  atmIV: number;
  p25IV: number; // 25-delta put IV
  c25IV: number; // 25-delta call IV
  skew25d: number; // p25 - c25
  butterfly: number; // (p25 + c25) / 2 - atm
}

export interface SkewPercentile {
  symbol: string;
  currentSkew: number;
  skew30dAvg: number;
  skew90dAvg: number;
  percentile: number; // 0-100
  zScore: number;
  signal: 'rich' | 'fair' | 'cheap';
  trend: 'steepening' | 'flat' | 'flattening';
}

export interface SkewHistory {
  date: string;
  skew25d: number;
  skew10d: number;
  atmIV: number;
}

const SYMBOLS_CONFIG: Record<string, { spot: number; baseIV: number; skewBias: number }> = {
  'NIFTY': { spot: 24850, baseIV: 13.2, skewBias: 2.8 },
  'BANKNIFTY': { spot: 53200, baseIV: 16.5, skewBias: 3.5 },
  'FINNIFTY': { spot: 23800, baseIV: 12.8, skewBias: 2.2 },
  'MIDCPNIFTY': { spot: 12450, baseIV: 15.1, skewBias: 3.0 },
  'RELIANCE': { spot: 2920, baseIV: 22.5, skewBias: 4.1 },
  'TCS': { spot: 3680, baseIV: 18.3, skewBias: 2.9 },
  'HDFCBANK': { spot: 1780, baseIV: 19.8, skewBias: 3.3 },
  'INFY': { spot: 1520, baseIV: 21.2, skewBias: 3.6 },
  'ICICIBANK': { spot: 1340, baseIV: 20.1, skewBias: 3.1 },
  'SBIN': { spot: 820, baseIV: 24.6, skewBias: 4.5 },
};

function seededRandom(seed: number): number {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

export function generateSkewSmile(symbol: string): SkewPoint[] {
  const config = SYMBOLS_CONFIG[symbol] || SYMBOLS_CONFIG['NIFTY'];
  const { spot, baseIV, skewBias } = config;
  const step = symbol.includes('NIFTY') ? 50 : Math.round(spot * 0.005);
  const points: SkewPoint[] = [];

  for (let i = -12; i <= 12; i++) {
    const strike = spot + i * step;
    const moneyness = strike / spot;
    const otmFactor = Math.abs(1 - moneyness);

    // Volatility smile with put skew
    const smileBase = baseIV + otmFactor * otmFactor * 120;
    const putSkewAdj = moneyness < 1 ? skewBias * (1 - moneyness) * 40 : 0;
    const callSkewAdj = moneyness > 1 ? (moneyness - 1) * 15 : 0;

    const seed = strike * 7 + baseIV;
    const noise = (seededRandom(seed) - 0.5) * 1.2;

    const putIV = smileBase + putSkewAdj + noise;
    const callIV = smileBase + callSkewAdj + noise * 0.8;
    const skew = putIV - callIV;

    points.push({
      strike,
      callIV: Math.round(callIV * 100) / 100,
      putIV: Math.round(putIV * 100) / 100,
      skew: Math.round(skew * 100) / 100,
      moneyness: Math.round(moneyness * 10000) / 10000,
    });
  }

  return points;
}

export function generateTermStructure(symbol: string): TermStructurePoint[] {
  const config = SYMBOLS_CONFIG[symbol] || SYMBOLS_CONFIG['NIFTY'];
  const { baseIV, skewBias } = config;

  const expiries = [
    { expiry: '27 Mar', dte: 3 },
    { expiry: '03 Apr', dte: 10 },
    { expiry: '10 Apr', dte: 17 },
    { expiry: '17 Apr', dte: 24 },
    { expiry: '24 Apr', dte: 31 },
    { expiry: '29 May', dte: 66 },
    { expiry: '26 Jun', dte: 94 },
    { expiry: '25 Sep', dte: 185 },
  ];

  return expiries.map(({ expiry, dte }) => {
    const seed = dte * 13 + baseIV;
    const noise = (seededRandom(seed) - 0.5) * 1.5;

    // Term structure: near-term higher IV (contango/backwardation)
    const termFactor = dte < 15 ? 1.15 : dte < 30 ? 1.05 : dte < 60 ? 1.0 : 0.95 + dte * 0.0002;
    const atmIV = baseIV * termFactor + noise;
    const p25IV = atmIV + skewBias + (seededRandom(seed + 1) - 0.3) * 1.5;
    const c25IV = atmIV - skewBias * 0.3 + (seededRandom(seed + 2) - 0.5) * 0.8;

    return {
      expiry,
      dte,
      atmIV: Math.round(atmIV * 100) / 100,
      p25IV: Math.round(p25IV * 100) / 100,
      c25IV: Math.round(c25IV * 100) / 100,
      skew25d: Math.round((p25IV - c25IV) * 100) / 100,
      butterfly: Math.round(((p25IV + c25IV) / 2 - atmIV) * 100) / 100,
    };
  });
}

export function generateSkewPercentiles(): SkewPercentile[] {
  return Object.entries(SYMBOLS_CONFIG).map(([symbol, config]) => {
    const seed = config.baseIV * 31 + config.skewBias * 17;
    const currentSkew = config.skewBias + (seededRandom(seed) - 0.4) * 2;
    const skew30dAvg = config.skewBias + (seededRandom(seed + 5) - 0.5) * 1;
    const skew90dAvg = config.skewBias + (seededRandom(seed + 10) - 0.5) * 0.5;
    const percentile = Math.round(seededRandom(seed + 3) * 100);
    const zScore = (currentSkew - skew90dAvg) / (config.skewBias * 0.4);

    let signal: 'rich' | 'fair' | 'cheap';
    if (percentile > 70) signal = 'rich';
    else if (percentile < 30) signal = 'cheap';
    else signal = 'fair';

    let trend: 'steepening' | 'flat' | 'flattening';
    if (currentSkew > skew30dAvg * 1.05) trend = 'steepening';
    else if (currentSkew < skew30dAvg * 0.95) trend = 'flattening';
    else trend = 'flat';

    return {
      symbol,
      currentSkew: Math.round(currentSkew * 100) / 100,
      skew30dAvg: Math.round(skew30dAvg * 100) / 100,
      skew90dAvg: Math.round(skew90dAvg * 100) / 100,
      percentile,
      zScore: Math.round(zScore * 100) / 100,
      signal,
      trend,
    };
  });
}

export function generateSkewHistory(symbol: string): SkewHistory[] {
  const config = SYMBOLS_CONFIG[symbol] || SYMBOLS_CONFIG['NIFTY'];
  const history: SkewHistory[] = [];

  for (let i = 90; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    const seed = i * 7 + config.baseIV * 3;

    const cyclical = Math.sin(i / 15) * 1.2;
    const skew25d = config.skewBias + cyclical + (seededRandom(seed) - 0.5) * 1.5;
    const skew10d = skew25d + 1.5 + (seededRandom(seed + 1) - 0.5) * 2;
    const atmIV = config.baseIV + Math.sin(i / 20) * 2 + (seededRandom(seed + 2) - 0.5) * 1;

    history.push({
      date: date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }),
      skew25d: Math.round(skew25d * 100) / 100,
      skew10d: Math.round(skew10d * 100) / 100,
      atmIV: Math.round(atmIV * 100) / 100,
    });
  }

  return history;
}
