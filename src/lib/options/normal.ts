/**
 * Standard normal distribution helpers.
 * normCdf uses W. J. Cody's rational Chebyshev approximation of erfc
 * (relative error below 1e-14 across the real line).
 */

const SQRT2PI = Math.sqrt(2 * Math.PI);
const INV_SQRT2PI = 1 / SQRT2PI;

export function normPdf(x: number): number {
  if (Number.isNaN(x)) return NaN;
  if (!Number.isFinite(x)) return 0;
  return INV_SQRT2PI * Math.exp(-0.5 * x * x);
}

// Cody coefficients
const A = [3.1611237438705655, 113.86415415105016, 377.485237685302, 3209.3775891384694, 0.18577770618460315];
const B = [23.601290952344122, 244.02463793444417, 1282.6165260773723, 2844.236833439171];
const C = [
  0.5641884969886701, 8.883149794388377, 66.11919063714163, 298.6351381974001, 881.952221241769,
  1712.0476126340707, 2051.0783778260716, 1230.3393547979972, 2.1531153547440383e-8,
];
const D = [
  15.744926110709835, 117.6939508913125, 537.1811018620099, 1621.3895745666903, 3290.7992357334597,
  4362.619090143247, 3439.3676741437216, 1230.3393548037495,
];
const P = [0.30532663496123236, 0.36034489994980445, 0.12578172611122926, 0.016083785148742275, 0.0006587491615298378, 0.016315387137302097];
const Q = [2.568520192289822, 1.8729528499234673, 0.5279051029514285, 0.06051834131244132, 0.0023352049762686918];
const INV_SQRTPI = 0.5641895835477563;

/** Complementary error function (Cody). */
export function erfc(x: number): number {
  if (Number.isNaN(x)) return NaN;
  const y = Math.abs(x);
  let result: number;
  if (y <= 0.46875) {
    const ysq = y > 1.11e-16 ? y * y : 0;
    let xnum = A[4] * ysq;
    let xden = ysq;
    for (let i = 0; i < 3; i++) {
      xnum = (xnum + A[i]) * ysq;
      xden = (xden + B[i]) * ysq;
    }
    const erfv = (x * (xnum + A[3])) / (xden + B[3]);
    return 1 - erfv;
  } else if (y <= 4) {
    let xnum = C[8] * y;
    let xden = y;
    for (let i = 0; i < 7; i++) {
      xnum = (xnum + C[i]) * y;
      xden = (xden + D[i]) * y;
    }
    result = (xnum + C[7]) / (xden + D[7]);
    const ysq = Math.trunc(y * 16) / 16;
    const del = (y - ysq) * (y + ysq);
    result = Math.exp(-ysq * ysq) * Math.exp(-del) * result;
  } else {
    if (y >= 26.6) {
      result = 0;
    } else {
      const ysq = 1 / (y * y);
      let xnum = P[5] * ysq;
      let xden = ysq;
      for (let i = 0; i < 4; i++) {
        xnum = (xnum + P[i]) * ysq;
        xden = (xden + Q[i]) * ysq;
      }
      result = (ysq * (xnum + P[4])) / (xden + Q[4]);
      result = (INV_SQRTPI - result) / y;
      const ysq2 = Math.trunc(y * 16) / 16;
      const del = (y - ysq2) * (y + ysq2);
      result = Math.exp(-ysq2 * ysq2) * Math.exp(-del) * result;
    }
  }
  return x < 0 ? 2 - result : result;
}

/** Standard normal CDF, accurate to ~1e-15 in the tails. */
export function normCdf(x: number): number {
  if (Number.isNaN(x)) return NaN;
  if (x === Infinity) return 1;
  if (x === -Infinity) return 0;
  return 0.5 * erfc(-x / Math.SQRT2);
}

// Acklam coefficients
const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];

/** Inverse standard normal CDF (Acklam with one Halley refinement). */
export function normInv(p: number): number {
  if (Number.isNaN(p) || p < 0 || p > 1) return NaN;
  if (p === 0) return -Infinity;
  if (p === 1) return Infinity;
  const pLow = 0.02425;
  const pHigh = 1 - pLow;
  let x: number;
  if (p < pLow) {
    const q = Math.sqrt(-2 * Math.log(p));
    x = (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  } else if (p <= pHigh) {
    const q = p - 0.5;
    const r = q * q;
    x = ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  } else {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    x = -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  // Halley refinement
  const e = normCdf(x) - p;
  const u = e * SQRT2PI * Math.exp((x * x) / 2);
  x = x - u / (1 + (x * u) / 2);
  return x;
}
