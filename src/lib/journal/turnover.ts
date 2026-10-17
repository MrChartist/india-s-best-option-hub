/**
 * ITR-ready F&O turnover (business income, ITR-3).
 *
 * Follows the ICAI Guidance Note on Tax Audit (revised 2022): for futures and options, turnover is the
 * aggregate of absolute favourable and unfavourable differences on each trade. Option premium is no
 * longer added. Charges (brokerage, STT, exchange, SEBI, stamp, GST) are listed separately as
 * expenses. Indian financial years run 1 April to 31 March; a trade belongs to the year it closes in.
 * Educational aid only: confirm with a chartered accountant before filing.
 */
import type { RoundTrip } from "./types";
import { contractName } from "./roundTrips";

const round2 = (v: number) => Math.round(v * 100) / 100;

/** "FY 2026-27" for an ISO date (April to March). */
export function financialYear(iso: string): string {
  const y = +iso.slice(0, 4);
  const m = +iso.slice(5, 7);
  const start = m >= 4 ? y : y - 1;
  return `FY ${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

export function financialYears(trips: RoundTrip[]): string[] {
  return [...new Set(trips.map((t) => financialYear(t.exitDate)))].sort().reverse();
}

export interface TurnoverSummary {
  fy: string;
  trades: number;
  /** Σ |gross P&L| over trades. */
  turnover: number;
  optionsTurnover: number;
  futuresTurnover: number;
  gross: number;
  charges: number;
  net: number;
  /** Sum of premium received on option sells (shown for reference; not part of turnover since 2022). */
  premiumReceived: number;
}

export function turnoverSummary(trips: RoundTrip[], fy: string): TurnoverSummary {
  const list = trips.filter((t) => financialYear(t.exitDate) === fy);
  const abs = (t: RoundTrip) => Math.abs(t.gross);
  const opt = list.filter((t) => t.type !== "FUT");
  const fut = list.filter((t) => t.type === "FUT");
  return {
    fy,
    trades: list.length,
    turnover: round2(list.reduce((a, t) => a + abs(t), 0)),
    optionsTurnover: round2(opt.reduce((a, t) => a + abs(t), 0)),
    futuresTurnover: round2(fut.reduce((a, t) => a + abs(t), 0)),
    gross: round2(list.reduce((a, t) => a + t.gross, 0)),
    charges: round2(list.reduce((a, t) => a + t.charges, 0)),
    net: round2(list.reduce((a, t) => a + t.net, 0)),
    premiumReceived: round2(opt.reduce((a, t) => a + (t.direction === "SHORT" ? t.entryPrice * t.qty : t.exitPrice * t.qty), 0)),
  };
}

function cell(v: string | number): string {
  const s = typeof v === "number" ? (Number.isFinite(v) ? v.toFixed(2) : "") : v;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV: one row per round trip closed in the FY, then a summary block. */
export function turnoverCsv(trips: RoundTrip[], fy: string, o?: { sample?: boolean }): string {
  const list = trips.filter((t) => financialYear(t.exitDate) === fy).sort((a, b) => (a.exitDate < b.exitDate ? -1 : a.exitDate > b.exitDate ? 1 : 0));
  const s = turnoverSummary(trips, fy);
  const lines: string[] = [];
  if (o?.sample) lines.push(cell("SAMPLE DATA - generated tradebook for demonstration, not real trades"));
  lines.push(
    [
      "Exit date",
      "Entry date",
      "Instrument",
      "Segment",
      "Expiry",
      "Direction",
      "Quantity",
      "Buy value (INR)",
      "Sell value (INR)",
      "Gross P&L (INR)",
      "Turnover = |Gross P&L| (INR)",
      "Charges (INR)",
      "Net P&L (INR)",
      "Note",
    ]
      .map(cell)
      .join(","),
  );
  for (const t of list) {
    const buy = (t.direction === "LONG" ? t.entryPrice : t.exitPrice) * t.qty;
    const sell = (t.direction === "LONG" ? t.exitPrice : t.entryPrice) * t.qty;
    lines.push(
      [
        t.exitDate,
        t.entryDate,
        contractName(t),
        t.type === "FUT" ? "Futures" : "Options",
        t.expiry,
        t.direction === "LONG" ? "Long" : "Short",
        String(t.qty),
        buy,
        sell,
        t.gross,
        Math.abs(t.gross),
        t.charges,
        t.net,
        t.assumedExpiry ? "Expired worthless (assumed)" : t.settled ? "Settled at expiry" : "",
      ]
        .map(cell)
        .join(","),
    );
  }
  lines.push("");
  lines.push([cell("Summary"), cell(s.fy)].join(","));
  lines.push([cell("Trades"), String(s.trades)].join(","));
  lines.push([cell("F&O turnover (INR)"), cell(s.turnover)].join(","));
  lines.push([cell("  of which options"), cell(s.optionsTurnover)].join(","));
  lines.push([cell("  of which futures"), cell(s.futuresTurnover)].join(","));
  lines.push([cell("Gross P&L (INR)"), cell(s.gross)].join(","));
  lines.push([cell("Charges / expenses (INR)"), cell(s.charges)].join(","));
  lines.push([cell("Net P&L (INR)"), cell(s.net)].join(","));
  lines.push(cell("Method: ICAI Guidance Note on Tax Audit (2022): turnover = sum of absolute profit and loss per trade. Report under business income (ITR-3). Verify with a chartered accountant."));
  return lines.join("\n");
}
