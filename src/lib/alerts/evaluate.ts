/**
 * Rule evaluation (pure, no DOM).
 *
 * Every rule is evaluated against a RuleContext built from real data: chain metrics per
 * underlying (PCR from OI, ATM IV, IV percentile from recorded history, max pain, gamma flip,
 * walls, per-strike quotes, Premium Tide), derived flow prints, the NSE ban list and open
 * positions marked from live chains. Nothing is inferred from VIX and sample data never arrives.
 *
 * Level rules fire on a CROSSING (previous value on one side, current on the other). Zone rules
 * (IVP, OI change, IV spike, strike, P&L, Greeks) fire when the value ENTERS the zone, including
 * the first reading. Each rule then waits for its cooldown before it can fire again.
 */
import { formatINR, formatNumberIN, formatStrike } from "@/lib/options";
import type { FlowPrint } from "@/lib/flow/types";
import { GREEK_LABEL, STRIKE_FIELD_LABEL, fmtRs, formatGreekValue, formatStrikeValue } from "./describe";
import {
  ANY_SYMBOL,
  type AlertEvent,
  type AlertRule,
  type AlertSnapshot,
  type AlertTone,
  type Direction,
  type PortfolioSnapshot,
  type RuleContext,
  type RuleMemory,
  type RuleState,
  type StrikeOI,
  type SymbolMarket,
} from "./types";

const finite = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

export function crossed(prev: number | undefined, curr: number, level: number, dir: Direction): "up" | "down" | null {
  if (!finite(prev) || !finite(curr) || !finite(level)) return null;
  const up = prev < level && curr >= level;
  const down = prev > level && curr <= level;
  if (up && (dir === "above" || dir === "either")) return "up";
  if (down && (dir === "below" || dir === "either")) return "down";
  return null;
}

/** Strike with the largest OI on a side (NaN when none). */
export function oiWall(strikes: StrikeOI[] | undefined, side: "CE" | "PE"): number {
  let best = NaN;
  let max = 0;
  for (const s of strikes ?? []) {
    const v = side === "CE" ? s.ceOi : s.peOi;
    if (finite(v) && v > max) {
      max = v;
      best = s.strike;
    }
  }
  return best;
}

/** Rules that read their own underlying's option chain (re-evaluated only on new chain data). */
export function ruleNeedsChain(rule: AlertRule): boolean {
  switch (rule.type) {
    case "ban_entry":
    case "repeated_hits":
    case "big_opening_print":
    case "position_pnl":
    case "position_greek":
      return false;
    default:
      return rule.symbol !== ANY_SYMBOL;
  }
}

/** Current value a strike rule compares (NaN when the contract is not in the context). */
export function strikeRuleValue(
  rule: Extract<AlertRule, { type: "strike_level" }>,
  m: SymbolMarket | undefined,
): number {
  if (!m || m.expiry !== rule.expiry) return NaN;
  const q = m.quotes?.find((x) => x.strike === rule.strike);
  if (!q) return NaN;
  const leg = rule.side === "CE" ? q.ce : q.pe;
  if (rule.field === "premium") return leg.ltp > 0 ? leg.ltp : NaN;
  if (rule.field === "iv") return leg.iv > 0 ? leg.iv : NaN;
  return finite(leg.oiChange) ? leg.oiChange : NaN;
}

/**
 * Directional tone of a flow print from option type × aggressor. Buyers lifting the ask on calls
 * or sellers hitting the bid on puts (put writing) lean bullish; the reverse leans bearish. A
 * mid-market print has no side, so it stays neutral.
 */
export function printTone(p: Pick<FlowPrint, "type" | "aggressor">): AlertTone {
  if (p.aggressor !== "ASK" && p.aggressor !== "BID") return "info";
  const buyerAggressive = p.aggressor === "ASK";
  return (p.type === "CE") === buyerAggressive ? "bullish" : "bearish";
}

/** Portfolio snapshot a position rule reads, only when every leg in scope is marked live. */
export function portfolioFor(rule: AlertRule, ctx: Pick<RuleContext, "portfolio">): PortfolioSnapshot | null {
  const p = ctx.portfolio?.[rule.symbol];
  if (!p || p.legs === 0 || p.marked < p.legs) return null;
  return p;
}

function marketSnapshot(m: SymbolMarket | undefined, extra: AlertSnapshot = {}): AlertSnapshot {
  if (!m) return extra;
  const s: AlertSnapshot = { symbol: m.symbol, spot: m.spot, dataTs: m.ts };
  if (finite(m.pcr)) s.pcr = m.pcr;
  if (finite(m.atmIv)) s.atmIv = m.atmIv;
  if (m.ivp !== undefined) s.ivp = m.ivp;
  if (finite(m.maxPain)) s.maxPain = m.maxPain;
  if (m.gammaFlip !== undefined) s.gammaFlip = m.gammaFlip;
  if (finite(m.tideNet)) s.tideNet = m.tideNet;
  if (m.expiry) s.expiry = m.expiry;
  return { ...s, ...extra };
}

type Hit = { title: string; message: string; tone: AlertTone; symbol?: string; snapshot?: AlertSnapshot };

function zoneEntered(mem: RuleMemory, inZone: boolean): boolean {
  const entered = inZone && !mem.inZone;
  mem.inZone = inZone;
  return entered;
}

function evalOne(rule: AlertRule, ctx: RuleContext, mem: RuleMemory): Hit | null {
  const m = ctx.markets[rule.symbol];
  switch (rule.type) {
    case "pcr_cross": {
      if (!m || !finite(m.pcr)) return null;
      const c = crossed(mem.last, m.pcr, rule.level, rule.direction);
      mem.last = m.pcr;
      if (!c) return null;
      return {
        title: `${rule.symbol} PCR ${c === "up" ? "rose above" : "fell below"} ${rule.level.toFixed(2)}`,
        message: `PCR (OI) is now ${m.pcr.toFixed(2)}.`,
        tone: c === "down" ? "bearish" : "bullish",
        snapshot: marketSnapshot(m, { value: m.pcr, valueLabel: "PCR" }),
      };
    }
    case "price_level": {
      if (!m || !(m.spot > 0)) return null;
      const c = crossed(mem.last, m.spot, rule.level, rule.direction);
      mem.last = m.spot;
      if (!c) return null;
      return {
        title: `${rule.symbol} ${c === "up" ? "crossed above" : "crossed below"} ${formatNumberIN(rule.level, 2, { minDecimals: 0 })}`,
        message: `Last ${formatNumberIN(m.spot, 2)}.`,
        tone: c === "down" ? "bearish" : "bullish",
        snapshot: marketSnapshot(m, { value: m.spot, valueLabel: "Spot" }),
      };
    }
    case "iv_level": {
      if (!m || !finite(m.atmIv) || m.atmIv <= 0) return null;
      const c = crossed(mem.last, m.atmIv, rule.level, rule.direction);
      mem.last = m.atmIv;
      if (!c) return null;
      return {
        title: `${rule.symbol} ATM IV ${c === "up" ? "rose above" : "fell below"} ${formatNumberIN(rule.level, 2, { minDecimals: 0 })}%`,
        message: `ATM IV is now ${m.atmIv.toFixed(2)}%.`,
        tone: "warning",
        snapshot: marketSnapshot(m, { value: m.atmIv, valueLabel: "ATM IV %" }),
      };
    }
    case "ivp_level": {
      if (!m || !finite(m.ivp)) return null;
      const inZone = rule.direction === "above" ? m.ivp >= rule.level : m.ivp <= rule.level;
      if (!zoneEntered(mem, inZone)) return null;
      return {
        title: `${rule.symbol} IV percentile ${Math.round(m.ivp)}`,
        message:
          rule.direction === "above"
            ? "Options are expensive versus recorded history."
            : "Options are cheap versus recorded history.",
        tone: "warning",
        snapshot: marketSnapshot(m, { value: m.ivp, valueLabel: "IVP" }),
      };
    }
    case "oi_change_strike": {
      const s = m?.strikes?.find((x) => x.strike === rule.strike);
      if (!s) return null;
      const ce = Math.abs(s.ceOiChg);
      const pe = Math.abs(s.peOiChg);
      const val = rule.side === "CE" ? ce : rule.side === "PE" ? pe : Math.max(ce, pe);
      if (!zoneEntered(mem, val > rule.threshold)) return null;
      const which = rule.side === "BOTH" ? (ce >= pe ? "CE" : "PE") : rule.side;
      const chg = which === "CE" ? s.ceOiChg : s.peOiChg;
      return {
        title: `${rule.symbol} ${formatStrike(rule.strike)} ${which} OI ${chg >= 0 ? "+" : "−"}${formatNumberIN(Math.abs(chg))}`,
        message: `OI change passed ${formatNumberIN(rule.threshold)} contracts.`,
        tone: "info",
        snapshot: marketSnapshot(m, { value: chg, valueLabel: `${which} OI change` }),
      };
    }
    case "atm_iv_spike": {
      if (!m || !finite(m.atmIv) || m.atmIv <= 0) return null;
      const windowMs = Math.max(1, rule.windowMin) * 60_000;
      const series = (mem.ivSeries ?? []).filter(([t]) => ctx.now - t <= windowMs);
      const lowest = series.reduce((mn, [, v]) => Math.min(mn, v), Infinity);
      series.push([m.ts || ctx.now, m.atmIv]);
      mem.ivSeries = series.slice(-200);
      const jump = finite(lowest) ? m.atmIv - lowest : 0;
      if (!zoneEntered(mem, jump >= rule.points)) return null;
      return {
        title: `${rule.symbol} ATM IV +${jump.toFixed(1)} pts`,
        message: `ATM IV ${m.atmIv.toFixed(1)}% (from ${lowest.toFixed(1)}% within ${rule.windowMin} min).`,
        tone: "warning",
        snapshot: marketSnapshot(m, { value: jump, valueLabel: "IV rise (pts)" }),
      };
    }
    case "oi_wall_shift": {
      if (!m?.strikes?.length) return null;
      const ce = oiWall(m.strikes, "CE");
      const pe = oiWall(m.strikes, "PE");
      const msgs: string[] = [];
      let detail: "CE" | "PE" | undefined;
      if ((rule.side === "CE" || rule.side === "BOTH") && finite(mem.wallCe) && finite(ce) && ce !== mem.wallCe) {
        msgs.push(`Call wall ${formatStrike(mem.wallCe)} → ${formatStrike(ce)}`);
        detail = "CE";
      }
      if ((rule.side === "PE" || rule.side === "BOTH") && finite(mem.wallPe) && finite(pe) && pe !== mem.wallPe) {
        msgs.push(`Put wall ${formatStrike(mem.wallPe)} → ${formatStrike(pe)}`);
        detail = detail ?? "PE";
      }
      if (finite(ce)) mem.wallCe = ce;
      if (finite(pe)) mem.wallPe = pe;
      if (msgs.length === 0) return null;
      return {
        title: `${rule.symbol} OI wall moved`,
        message: msgs.join(" · "),
        tone: detail === "CE" ? "bearish" : "bullish",
        snapshot: marketSnapshot(m, {
          value: detail === "CE" ? ce : pe,
          valueLabel: detail === "CE" ? "Call wall" : "Put wall",
        }),
      };
    }
    case "spot_cross_ref": {
      const ref = rule.ref === "max_pain" ? m?.maxPain : m?.gammaFlip;
      if (!m || !(m.spot > 0) || !finite(ref) || ref <= 0) return null;
      const sign = Math.sign(m.spot - ref);
      const prev = mem.lastSign;
      if (sign !== 0) mem.lastSign = sign;
      if (!finite(prev) || prev === 0 || sign === 0 || sign === prev) return null;
      const name = rule.ref === "max_pain" ? "max pain" : "gamma flip";
      return {
        title: `${rule.symbol} crossed ${sign > 0 ? "above" : "below"} ${name}`,
        message: `Spot ${formatNumberIN(m.spot, 2)} vs ${name} ${formatNumberIN(ref, 0)}.`,
        tone: sign > 0 ? "bullish" : "bearish",
        snapshot: marketSnapshot(m, { value: ref, valueLabel: name === "max pain" ? "Max pain" : "Gamma flip" }),
      };
    }
    case "strike_level": {
      const cur = strikeRuleValue(rule, m);
      if (!finite(cur)) return null;
      const met = rule.op === "gte" ? cur >= rule.value : cur <= rule.value;
      if (!zoneEntered(mem, met)) return null;
      return {
        title: `${rule.symbol} ${formatStrike(rule.strike)} ${rule.side} ${STRIKE_FIELD_LABEL[rule.field]} ${rule.op === "gte" ? "≥" : "≤"} ${formatStrikeValue(rule.field, rule.value)}`,
        message: `Now ${formatStrikeValue(rule.field, cur)}.`,
        tone: rule.field === "premium" ? (rule.op === "gte" ? "bullish" : "bearish") : "info",
        snapshot: marketSnapshot(m, { value: cur, valueLabel: STRIKE_FIELD_LABEL[rule.field] }),
      };
    }
    case "premium_tide": {
      if (!m || !finite(m.tideNet)) return null;
      const c = crossed(mem.last, m.tideNet, rule.level, rule.direction);
      mem.last = m.tideNet;
      if (!c) return null;
      const lvl = `${rule.level < 0 ? "−" : ""}${fmtRs(Math.abs(rule.level))}`;
      return {
        title: `${rule.symbol} Premium Tide ${c === "up" ? "rose above" : "fell below"} ${lvl}`,
        message: `Net tide is now ${m.tideNet < 0 ? "−" : ""}${fmtRs(Math.abs(m.tideNet))} (derived from chain snapshots).`,
        tone: c === "down" ? "bearish" : "bullish",
        snapshot: marketSnapshot(m, { value: m.tideNet, valueLabel: "Net tide ₹" }),
      };
    }
    case "position_pnl": {
      const p = portfolioFor(rule, ctx);
      if (!p) return null;
      const inZone = rule.direction === "above" ? p.pnl >= rule.level : p.pnl <= rule.level;
      if (!zoneEntered(mem, inZone)) return null;
      const scope = rule.symbol === ANY_SYMBOL ? "Portfolio" : rule.symbol;
      return {
        title: `${scope} P&L ${rule.direction === "above" ? "reached" : "fell to"} ${formatINR(p.pnl, { decimals: 0 })}`,
        // portfolioFor only returns a snapshot when every leg is marked, so marked === legs here.
        message: `${p.marked} open leg${p.marked === 1 ? "" : "s"} marked from live chains, before charges.`,
        tone: p.pnl >= 0 ? "bullish" : "bearish",
        snapshot: {
          symbol: rule.symbol,
          value: p.pnl,
          valueLabel: "P&L ₹",
          pnl: p.pnl,
          netDelta: p.delta,
          dataTs: p.ts,
        },
      };
    }
    case "position_greek": {
      const p = portfolioFor(rule, ctx);
      if (!p) return null;
      const v = p[rule.greek];
      if (!finite(v)) return null;
      const inZone =
        rule.direction === "abs_above"
          ? Math.abs(v) >= rule.level
          : rule.direction === "above"
            ? v >= rule.level
            : v <= rule.level;
      if (!zoneEntered(mem, inZone)) return null;
      const scope = rule.symbol === ANY_SYMBOL ? "Portfolio" : rule.symbol;
      return {
        title: `${scope} ${GREEK_LABEL[rule.greek].toLowerCase()} ${formatGreekValue(rule.greek, v)}`,
        message: `Threshold ${rule.direction === "abs_above" ? "|value| ≥ " : rule.direction === "above" ? "≥ " : "≤ "}${formatGreekValue(rule.greek, rule.level)} across ${p.legs} open leg${p.legs === 1 ? "" : "s"}.`,
        tone: "warning",
        snapshot: {
          symbol: rule.symbol,
          value: v,
          valueLabel: GREEK_LABEL[rule.greek],
          pnl: p.pnl,
          netDelta: p.delta,
          dataTs: p.ts,
        },
      };
    }
    case "repeated_hits":
    case "big_opening_print": {
      const since = mem.printTs ?? -Infinity;
      const fresh = (ctx.prints ?? []).filter(
        (p) => p && p.ts > since && (rule.symbol === ANY_SYMBOL || p.symbol === rule.symbol),
      );
      const maxTs = fresh.reduce((mx, p) => Math.max(mx, p.ts), since);
      // First look: set the baseline without replaying the whole session.
      const firstLook = mem.printTs === undefined;
      mem.printTs = finite(maxTs) ? maxTs : (mem.printTs ?? ctx.now);
      if (firstLook) return null;
      if (rule.type === "big_opening_print") {
        const big = fresh
          .filter((p) => p.tag === "OPENING" && p.premium >= rule.minPremium)
          .sort((a, b) => b.premium - a.premium);
        if (big.length === 0) return null;
        const p = big[0];
        const more = big.length > 1 ? ` (+${big.length - 1} more)` : "";
        return {
          title: `${p.symbol} ${formatStrike(p.strike)} ${p.type} opening print ${fmtRs(p.premium)}`,
          message: `${formatNumberIN(p.dVol)} contracts at ₹${p.ltp.toFixed(2)}, ${p.aggressor === "ASK" ? "at the ask" : p.aggressor === "BID" ? "at the bid" : "mid-market"}, OI +${formatNumberIN(p.dOI)}${more}.`,
          tone: printTone(p),
          symbol: p.symbol,
          snapshot: marketSnapshot(ctx.markets[p.symbol], {
            symbol: p.symbol,
            value: p.premium,
            valueLabel: "Premium ₹",
            dataTs: p.ts,
          }),
        };
      }
      const windowMs = Math.max(1, rule.windowMin) * 60_000;
      const hits: Record<string, number[]> = {};
      for (const [k, arr] of Object.entries(mem.hits ?? {})) {
        const kept = arr.filter((t) => ctx.now - t <= windowMs);
        if (kept.length) hits[k] = kept;
      }
      let fired: { key: string; p: FlowPrint; n: number } | null = null;
      for (const p of fresh.filter((x) => x.premium >= rule.minPremium).sort((a, b) => a.ts - b.ts)) {
        const key = `${p.symbol}|${p.expiry}|${p.strike}|${p.type}`;
        const arr = (hits[key] ??= []);
        arr.push(p.ts);
        if (arr.length >= rule.minHits && (!fired || arr.length > fired.n)) fired = { key, p, n: arr.length };
      }
      if (fired) delete hits[fired.key];
      mem.hits = hits;
      if (!fired) return null;
      const p = fired.p;
      return {
        title: `${p.symbol} ${formatStrike(p.strike)} ${p.type}: ${fired.n} big prints`,
        message: `${fired.n} intervals of ${fmtRs(rule.minPremium)}+ within ${rule.windowMin} min. Last ${fmtRs(p.premium)} at ₹${p.ltp.toFixed(2)}.`,
        tone: printTone(p),
        symbol: p.symbol,
        snapshot: marketSnapshot(ctx.markets[p.symbol], {
          symbol: p.symbol,
          value: fired.n,
          valueLabel: "Hits",
          dataTs: p.ts,
        }),
      };
    }
    case "ban_entry": {
      if (!Array.isArray(ctx.banList)) return null;
      const now = [...new Set(ctx.banList.map((s) => String(s).toUpperCase()))];
      const before = mem.ban;
      mem.ban = now;
      if (rule.symbol === ANY_SYMBOL) {
        if (!before) return null;
        const added = now.filter((s) => !before.includes(s));
        if (added.length === 0) return null;
        return {
          title: `F&O ban: ${added.join(", ")}`,
          message: "New positions are not allowed in banned stocks; only reducing trades.",
          tone: "warning",
          snapshot: { value: now.length, valueLabel: "Stocks in ban" },
        };
      }
      const inNow = now.includes(rule.symbol);
      const wasIn = before ? before.includes(rule.symbol) : false;
      if (!inNow || wasIn) return null;
      return {
        title: `${rule.symbol} entered the F&O ban`,
        message: "MWPL crossed 95%. Only position-reducing trades are allowed.",
        tone: "warning",
        snapshot: { symbol: rule.symbol, value: now.length, valueLabel: "Stocks in ban" },
      };
    }
  }
}

function cloneMemory(m: RuleMemory | undefined): RuleMemory {
  const mem: RuleMemory = { ...(m ?? {}) };
  if (mem.ivSeries) mem.ivSeries = [...mem.ivSeries];
  if (mem.hits) mem.hits = Object.fromEntries(Object.entries(mem.hits).map(([k, v]) => [k, [...v]]));
  if (mem.ban) mem.ban = [...mem.ban];
  return mem;
}

/**
 * Evaluate every enabled rule. Returns the events that fired and the next state (the input state
 * is not mutated). A snoozed rule keeps its crossing memory up to date but does not fire.
 */
export function evaluateRules(
  rules: AlertRule[],
  ctx: RuleContext,
  state: RuleState = {},
): { events: AlertEvent[]; state: RuleState } {
  const next: RuleState = {};
  const events: AlertEvent[] = [];
  for (const rule of rules ?? []) {
    if (!rule?.id) continue;
    const mem = cloneMemory(state[rule.id]);
    next[rule.id] = mem;
    if (!rule.enabled) continue;
    // Chain rules only re-evaluate on new data.
    if (ruleNeedsChain(rule)) {
      const m = ctx.markets[rule.symbol];
      if (!m) continue;
      if (mem.marketTs !== undefined && m.ts <= mem.marketTs) continue;
      mem.marketTs = m.ts;
    }
    const hit = evalOne(rule, ctx, mem);
    if (!hit) continue;
    if (finite(rule.snoozeUntil) && ctx.now < rule.snoozeUntil) continue;
    const cooling = finite(mem.lastFiredAt) && ctx.now - mem.lastFiredAt < Math.max(0, rule.cooldownMin) * 60_000;
    if (cooling) continue;
    mem.lastFiredAt = ctx.now;
    mem.fireCount = (mem.fireCount ?? 0) + 1;
    events.push({
      id: `${rule.id}:${ctx.now}`,
      ruleId: rule.id,
      type: rule.type,
      symbol: hit.symbol ?? rule.symbol,
      ts: ctx.now,
      title: hit.title,
      message: hit.message,
      tone: hit.tone,
      snapshot: hit.snapshot,
    });
  }
  return { events, state: next };
}
