/** Position sizing from a risk budget. */

/**
 * Lots that keep the worst-case loss within riskPct of capital.
 * riskPct is in percent (2 = 2%); maxLossPerLot is the rupee loss for one lot (sign ignored).
 */
export function positionSize(o: { capital: number; riskPct: number; maxLossPerLot: number; lotSize: number }): {
  lots: number;
  riskAmount: number;
  capitalAtRisk: number;
} {
  const capital = Number(o?.capital);
  const riskPct = Number(o?.riskPct);
  const perLot = Math.abs(Number(o?.maxLossPerLot));
  if (!Number.isFinite(capital) || !Number.isFinite(riskPct) || capital <= 0 || riskPct <= 0) return { lots: 0, riskAmount: 0, capitalAtRisk: 0 };
  const riskAmount = (capital * riskPct) / 100;
  if (!Number.isFinite(perLot) || perLot <= 0) return { lots: 0, riskAmount, capitalAtRisk: 0 };
  const lots = Math.floor(riskAmount / perLot + 1e-9);
  return { lots, riskAmount, capitalAtRisk: lots * perLot };
}

/** Units for a number of lots. */
export function lotsToQty(lots: number, lotSize: number): number {
  return Number.isFinite(lots) && Number.isFinite(lotSize) ? Math.trunc(lots) * lotSize : 0;
}
