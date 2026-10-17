/**
 * Pre-trade preview for a basket: expected fills, net premium, charges, margin estimate and free funds
 * after placing, grouped by underlying. Pure; the confirmation dialog renders it.
 */
import { BROKER_PRESETS, calcCharges, estimateMargin, getBrokerPreset, getContractSpec, istDateString, type OptionType, type Side } from "@/lib/options";
import { applyFill, contractKey, funds, marketFillPrice, nakedShortViolations, type OrderInput, type PaperOrder, type PaperState, type Quote, type RiskLeg } from "@/lib/paperTrading";

export interface PreviewLeg {
  key: string;
  input: OrderInput;
  /** Expected market fill per unit (NaN when there is no usable quote). */
  price: number;
  quoteSource: string | null;
  /** + credit, − debit (₹). */
  premium: number;
  charges: number;
}

export interface PreviewGroup {
  symbol: string;
  legs: PreviewLeg[];
  premium: number;
  charges: number;
  /** SPAN + exposure (+ ELM) a broker would block for this underlying's new legs, excluding premium (estimate). */
  margin: number;
  elm: number;
  hedgeBenefit: number;
  spot: number;
}

export interface BasketPreview {
  groups: PreviewGroup[];
  netPremium: number;
  charges: number;
  margin: number;
  availableBefore: number;
  availableAfter: number;
  /** Legs without a usable quote (cannot fill at market now). */
  unpriced: string[];
  naked: string[];
  anySample: boolean;
  riskLegs: RiskLeg[];
}

export function basketPreview(
  state: PaperState,
  orders: OrderInput[],
  quoteFor: (c: Pick<OrderInput, "symbol" | "expiry" | "strike" | "type">) => Quote | null,
  spots: Record<string, number>,
  now: Date = new Date(),
): BasketPreview {
  const broker = getBrokerPreset(state.settings.brokerId) ?? BROKER_PRESETS[0];
  const onDate = istDateString(now);
  const legs: PreviewLeg[] = orders.map((o) => {
    const q = quoteFor(o);
    const usable = !!q && (q.source !== "sample" || state.settings.allowSampleFills);
    const price = usable ? marketFillPrice(q, o.side, state.settings.slippagePct) : NaN;
    const qty = o.lots * o.lotSize;
    const ok = Number.isFinite(price) && price > 0;
    return {
      key: contractKey(o),
      input: o,
      price,
      quoteSource: q?.source ?? null,
      premium: ok ? (o.side === "SELL" ? 1 : -1) * price * qty : 0,
      charges: ok ? calcCharges([{ type: o.type, side: o.side, price, qty, exchange: getContractSpec(o.symbol)?.exchange ?? "NSE" }], { broker, onDate }).total : 0,
    };
  });
  const bySymbol = new Map<string, PreviewLeg[]>();
  for (const l of legs) {
    const arr = bySymbol.get(l.input.symbol);
    if (arr) arr.push(l);
    else bySymbol.set(l.input.symbol, [l]);
  }
  const groups: PreviewGroup[] = [];
  for (const [symbol, list] of bySymbol) {
    const priced = list.filter((l) => l.price > 0);
    const spot = spots[symbol] > 0 ? spots[symbol] : priced.length ? priced.reduce((a, l) => a + l.input.strike, 0) / priced.length : NaN;
    const m =
      priced.length && spot > 0
        ? estimateMargin(
            priced.map((l) => ({ symbol, type: l.input.type as OptionType, side: l.input.side as Side, strike: l.input.strike, expiry: l.input.expiry, lots: l.input.lots, lotSize: l.input.lotSize, premium: l.price })),
            { spot, now },
          )
        : null;
    groups.push({
      symbol,
      legs: list,
      premium: list.reduce((a, l) => a + l.premium, 0),
      charges: list.reduce((a, l) => a + l.charges, 0),
      // Margin blocked on top of the premium: SPAN + exposure (+ expiry-day ELM). Long-only legs need none.
      margin: m ? m.span + m.exposure + m.elmExpiryDay : 0,
      elm: m?.elmExpiryDay ?? 0,
      hedgeBenefit: m?.hedgeBenefit ?? 0,
      spot,
    });
  }
  groups.sort((a, b) => a.symbol.localeCompare(b.symbol));

  // Free funds after: apply every priced fill to a copy of the account, then measure.
  let after = state;
  legs.forEach((l, i) => {
    if (!(l.price > 0)) return;
    const ts = now.getTime();
    const order: PaperOrder = { ...l.input, id: `preview-${i}`, status: "OPEN", origin: "basket", createdAt: ts, updatedAt: ts };
    after = applyFill(after, order, l.price, now, l.quoteSource ?? undefined);
  });
  const before = funds(state, spots, now);
  const fAfter = funds(after, spots, now);
  return {
    groups,
    netPremium: legs.reduce((a, l) => a + l.premium, 0),
    charges: legs.reduce((a, l) => a + l.charges, 0),
    margin: groups.reduce((a, g) => a + g.margin, 0),
    availableBefore: before.available,
    availableAfter: fAfter.available,
    unpriced: legs.filter((l) => !(l.price > 0)).map((l) => `${l.input.symbol} ${l.input.strike} ${l.input.type}`),
    naked: nakedShortViolations(state.positions, orders),
    anySample: legs.some((l) => l.quoteSource === "sample"),
    riskLegs: legs.filter((l) => l.price > 0).map((l) => ({ input: l.input, price: l.price })),
  };
}
