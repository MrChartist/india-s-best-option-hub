// Volume Profile (POC / VAH / VAL) approximated from real OHLCV candles.
//
// This repo has no tick/time-and-sales feed, so a true volume-at-price
// profile isn't available. Every volume figure used here is genuine live
// data — this only approximates WHERE within each candle's real high-low
// range its real volume traded, by distributing it evenly across the price
// buckets that range overlaps. That's a standard technique for charting
// tools that only have OHLCV bars, and is the same epistemic category as
// the Black-Scholes gamma this app already computes elsewhere: a real-data
// input run through a standard, disclosed modeling assumption — not
// fabricated data. See CONTRIBUTING.md's "no mock data" rule.

import type { OHLCVCandle } from "@/hooks/useChartData";

export interface VolumeProfileLevels {
  poc: number; // Point of Control — the price with the most traded volume
  vah: number; // Value Area High
  val: number; // Value Area Low
}

const DEFAULT_BUCKET_COUNT = 24;
const VALUE_AREA_FRACTION = 0.7;

export function getVolumeProfile(
  candles: OHLCVCandle[],
  bucketCount: number = DEFAULT_BUCKET_COUNT
): VolumeProfileLevels | null {
  const withVolume = candles.filter((c) => c.volume && c.volume > 0);
  if (withVolume.length === 0) return null;

  let min = Infinity;
  let max = -Infinity;
  for (const c of withVolume) {
    if (c.low < min) min = c.low;
    if (c.high > max) max = c.high;
  }
  if (!(max > min)) return null;

  const bucketSize = (max - min) / bucketCount;
  const buckets = new Array(bucketCount).fill(0);

  for (const c of withVolume) {
    const lowIdx = Math.min(bucketCount - 1, Math.max(0, Math.floor((c.low - min) / bucketSize)));
    const highIdx = Math.min(bucketCount - 1, Math.max(0, Math.floor((c.high - min) / bucketSize)));
    const spanBuckets = highIdx - lowIdx + 1;
    const volumePerBucket = (c.volume ?? 0) / spanBuckets;
    for (let i = lowIdx; i <= highIdx; i++) buckets[i] += volumePerBucket;
  }

  let pocIdx = 0;
  for (let i = 1; i < buckets.length; i++) {
    if (buckets[i] > buckets[pocIdx]) pocIdx = i;
  }

  // Value Area: expand outward from POC, always toward whichever adjacent
  // bucket carries more volume, until 70% of total volume is captured.
  const totalVolume = buckets.reduce((s: number, v: number) => s + v, 0);
  const targetVolume = totalVolume * VALUE_AREA_FRACTION;

  let lowIdx = pocIdx;
  let highIdx = pocIdx;
  let accumulated = buckets[pocIdx];
  while (accumulated < targetVolume && (lowIdx > 0 || highIdx < buckets.length - 1)) {
    const lowerVol = lowIdx > 0 ? buckets[lowIdx - 1] : -1;
    const upperVol = highIdx < buckets.length - 1 ? buckets[highIdx + 1] : -1;
    if (upperVol >= lowerVol) {
      highIdx++;
      accumulated += buckets[highIdx];
    } else {
      lowIdx--;
      accumulated += buckets[lowIdx];
    }
  }

  const bucketPrice = (idx: number) => min + (idx + 0.5) * bucketSize;

  return {
    poc: Math.round(bucketPrice(pocIdx) * 100) / 100,
    vah: Math.round(bucketPrice(highIdx) * 100) / 100,
    val: Math.round(bucketPrice(lowIdx) * 100) / 100,
  };
}
