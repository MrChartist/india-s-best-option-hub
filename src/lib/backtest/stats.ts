/**
 * Performance statistics, splits and CSV export for backtest trades. Pure functions.
 */
import { TRADING_DAYS_PER_YEAR, calendarDaysBetween } from "@/lib/options";
import type { BacktestStats, EquityPoint, ExitReason, SplitRow, Trade } from "./types";

const finite = (x: number) => Number.isFinite(x);

/** Drawdown fields for a sequence of equity values (in place on a copy). */
export function withDrawdown(points: Array<Omit<EquityPoint, "drawdown" | "drawdownPct">>): EquityPoint[] {
  let peak = -Infinity;
  return points.map((p) => {
    if (p.equity > peak) peak = p.equity;
    const drawdown = Math.min(0, p.equity - peak);
    const drawdownPct = peak > 0 ? (drawdown / peak) * 100 : 0;
    return { ...p, drawdown, drawdownPct };
  });
}

/** Longest run of consecutive trades meeting `pred`. */
export function maxStreak(trades: Trade[], pred: (t: Trade) => boolean): number {
  let best = 0;
  let cur = 0;
  for (const t of trades) {
    if (pred(t)) {
      cur += 1;
      if (cur > best) best = cur;
    } else cur = 0;
  }
  return best;
}

/** Gross winners ÷ gross losers on net P&L. Infinity with winners and no losers, NaN with neither. */
export function profitFactor(trades: Trade[]): number {
  let won = 0;
  let lost = 0;
  for (const t of trades) {
    if (t.net > 0) won += t.net;
    else if (t.net < 0) lost -= t.net;
  }
  if (lost === 0) return won > 0 ? Infinity : NaN;
  return won / lost;
}

function sharpeOf(equity: EquityPoint[]): number {
  if (equity.length < 20) return NaN;
  const rets: number[] = [];
  for (let i = 1; i < equity.length; i++) {
    const prev = equity[i - 1].equity;
    if (prev > 0) rets.push(equity[i].equity / prev - 1);
  }
  if (rets.length < 10) return NaN;
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const variance = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1);
  const sd = Math.sqrt(variance);
  if (!(sd > 0)) return NaN;
  return (mean / sd) * Math.sqrt(TRADING_DAYS_PER_YEAR);
}

export function computeStats(trades: Trade[], equity: EquityPoint[], capital: number): BacktestStats {
  const n = trades.length;
  const winners = trades.filter((t) => t.net > 0);
  const losers = trades.filter((t) => t.net <= 0);
  const sum = (xs: Trade[], f: (t: Trade) => number) => xs.reduce((a, t) => a + f(t), 0);
  const netPnl = sum(trades, (t) => t.net);
  const avgWin = winners.length ? sum(winners, (t) => t.net) / winners.length : NaN;
  const avgLoss = losers.length ? sum(losers, (t) => t.net) / losers.length : NaN;
  let maxDrawdown = 0;
  let maxDrawdownPct = 0;
  for (const p of equity) {
    if (-p.drawdown > maxDrawdown) maxDrawdown = -p.drawdown;
    if (-p.drawdownPct > maxDrawdownPct) maxDrawdownPct = -p.drawdownPct;
  }
  const cap = capital > 0 ? capital : NaN;
  const first = equity[0]?.date;
  const last = equity[equity.length - 1]?.date;
  const years = first && last ? calendarDaysBetween(first, last) / 365 : 0;
  const endEquity = equity.length ? equity[equity.length - 1].equity : cap;
  const cagrPct = years >= 1 / 12 && cap > 0 && endEquity > 0 ? (Math.pow(endEquity / cap, 1 / years) - 1) * 100 : NaN;
  return {
    trades: n,
    wins: winners.length,
    losses: losers.length,
    winRate: n ? (winners.length / n) * 100 : NaN,
    netPnl,
    grossPnl: sum(trades, (t) => t.gross),
    charges: sum(trades, (t) => t.charges),
    avgWin,
    avgLoss,
    expectancy: n ? netPnl / n : NaN,
    profitFactor: profitFactor(trades),
    payoffRatio: finite(avgWin) && finite(avgLoss) && avgLoss < 0 ? avgWin / -avgLoss : NaN,
    maxConsecWins: maxStreak(trades, (t) => t.net > 0),
    maxConsecLosses: maxStreak(trades, (t) => t.net <= 0),
    maxDrawdown,
    maxDrawdownPct,
    returnPct: cap > 0 ? (netPnl / cap) * 100 : NaN,
    cagrPct,
    sharpe: sharpeOf(equity),
    avgDaysHeld: n ? sum(trades, (t) => t.daysHeld) / n : NaN,
    best: n ? Math.max(...trades.map((t) => t.net)) : NaN,
    worst: n ? Math.min(...trades.map((t) => t.net)) : NaN,
    recoveryFactor: maxDrawdown > 0 ? netPnl / maxDrawdown : NaN,
    exposurePct: equity.length ? (equity.filter((p) => p.inTrade).length / equity.length) * 100 : NaN,
  };
}

/** Summary row for a group of trades. */
export function splitRow(key: string, label: string, trades: Trade[], hint?: string): SplitRow {
  const n = trades.length;
  const net = trades.reduce((a, t) => a + t.net, 0);
  const wins = trades.filter((t) => t.net > 0).length;
  return { key, label, hint, trades: n, winRate: n ? (wins / n) * 100 : NaN, net, expectancy: n ? net / n : NaN, profitFactor: profitFactor(trades) };
}

// ── VIX regimes ──

export type VixRegime = "low" | "normal" | "elevated" | "high" | "unknown";

export const VIX_REGIMES: ReadonlyArray<{ key: VixRegime; label: string; hint: string }> = [
  { key: "low", label: "Low", hint: "VIX below 12" },
  { key: "normal", label: "Normal", hint: "VIX 12 – 16" },
  { key: "elevated", label: "Elevated", hint: "VIX 16 – 20" },
  { key: "high", label: "High", hint: "VIX 20 and above" },
  { key: "unknown", label: "Unknown", hint: "No India VIX close for the entry day" },
];

export function vixRegime(vix: number | null | undefined): VixRegime {
  if (typeof vix !== "number" || !finite(vix) || vix <= 0) return "unknown";
  if (vix < 12) return "low";
  if (vix < 16) return "normal";
  if (vix < 20) return "elevated";
  return "high";
}

/** Splits by entry-day VIX regime; regimes with no trades are dropped (except when every one is empty). */
export function splitByVix(trades: Trade[]): SplitRow[] {
  return VIX_REGIMES.map((r) => splitRow(r.key, r.label, trades.filter((t) => vixRegime(t.vix) === r.key), r.hint)).filter((row) => row.trades > 0);
}

export const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
export const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export function splitByWeekday(trades: Trade[]): SplitRow[] {
  const out: SplitRow[] = [];
  for (let wd = 1; wd <= 5; wd++) {
    const group = trades.filter((t) => t.weekday === wd);
    if (group.length) out.push(splitRow(String(wd), WEEKDAY_NAMES[wd], group, "Entry day"));
  }
  return out;
}

export const EXIT_REASON_LABEL: Record<ExitReason, string> = {
  target: "Profit target",
  stop: "Stop loss",
  time: "Days held",
  dte: "Exit DTE",
  expiry: "Expiry",
  end: "End of data",
};

export function splitByReason(trades: Trade[]): SplitRow[] {
  const order: ExitReason[] = ["target", "stop", "time", "dte", "expiry", "end"];
  return order.map((r) => splitRow(r, EXIT_REASON_LABEL[r], trades.filter((t) => t.reason === r))).filter((row) => row.trades > 0);
}

// ── CSV ──

function csvCell(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return "";
  const s = typeof v === "number" ? (finite(v) ? String(Math.round(v * 100) / 100) : "") : v;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Human-readable legs, e.g. "S 1x 25000 CE · B 1x 24500 PE"; legs in a later expiry carry it ("@ 2026-01-27"). */
export function legsSummary(t: Pick<Trade, "legs" | "expiry">): string {
  return t.legs
    .map((l) => {
      const what = l.type === "FUT" ? "FUT" : `${l.strike} ${l.type}`;
      const later = l.expiry && l.expiry !== t.expiry ? ` @ ${l.expiry}` : "";
      return `${l.side === "BUY" ? "B" : "S"} ${l.lots}x ${what}${later}`;
    })
    .join(" · ");
}

export const CSV_HEADER = [
  "Trade",
  "Symbol",
  "Entry date",
  "Exit date",
  "Expiry",
  "Entry DTE",
  "Days held",
  "Entry spot",
  "Exit spot",
  "India VIX",
  "Legs",
  "Net premium (₹)",
  "Margin est. (₹)",
  "Gross P&L (₹)",
  "Charges (₹)",
  "Net P&L (₹)",
  "Exit reason",
  "Model-priced fills",
  "Data",
];

/** One row per trade; amounts in rupees, dates ISO. `source` labels every row as Sample or NSE bhavcopy. */
export function tradesToCsv(trades: Trade[], symbol: string, source: "sample" | "bhavcopy"): string {
  const label = source === "sample" ? "Sample (not market data)" : "NSE bhavcopy";
  const lines = [CSV_HEADER.map(csvCell).join(",")];
  for (const t of trades) {
    lines.push(
      [
        t.id,
        symbol,
        t.entryDate,
        t.exitDate,
        t.expiry,
        t.entryDte,
        t.daysHeld,
        t.entrySpot,
        t.exitSpot,
        t.vix,
        legsSummary(t),
        t.netPremium,
        t.margin,
        t.gross,
        t.charges,
        t.net,
        EXIT_REASON_LABEL[t.reason],
        t.modelFills,
        label,
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return lines.join("\n");
}
