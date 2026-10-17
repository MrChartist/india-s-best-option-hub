/**
 * Searchable F&O glossary. Terms that have a full metric explainer link to it via `metric`.
 */
import type { GlossaryTerm } from "./types";

export const GLOSSARY: GlossaryTerm[] = [
  { term: "Absolute gamma strike", aka: ["abs gamma"], definition: "The strike with the largest combined call and put gamma, often a magnet into expiry.", metric: "absGamma", lessonSlug: "gamma-exposure" },
  { term: "American option", definition: "An option that can be exercised any time before expiry. Indian exchange-traded options are European, not American." },
  { term: "Assignment", definition: "When an option seller is required to fulfil the contract because the buyer's ITM option is exercised at expiry." },
  { term: "At the money (ATM)", aka: ["ATM"], definition: "The strike closest to the current spot price. ATM options carry the most time value.", lessonSlug: "moneyness-and-premium" },
  { term: "Basis", definition: "Futures price minus spot price. It converges to zero at expiry.", metric: "basis", lessonSlug: "open-interest-buildup" },
  { term: "Bear put spread", definition: "Buy a higher-strike put and sell a lower-strike put: a defined-risk bearish trade.", lessonSlug: "spreads-and-straddles" },
  { term: "Black-Scholes", aka: ["BS", "Black-76"], definition: "The standard option pricing model. Black-76 is its version on the forward or futures price, used for index options in this terminal." },
  { term: "Breakeven", definition: "The underlying price at expiry where a strategy neither makes nor loses money, before charges.", lessonSlug: "spreads-and-straddles" },
  { term: "Bull call spread", definition: "Buy a lower-strike call and sell a higher-strike call: a defined-risk bullish trade.", lessonSlug: "spreads-and-straddles" },
  { term: "Butterfly (25Δ)", aka: ["BF25", "fly"], definition: "Average of 25-delta call and put IV minus ATM IV. Measures how much the market pays for tail moves.", metric: "bf25", lessonSlug: "volatility-skew" },
  { term: "Call option (CE)", aka: ["CE", "call"], definition: "The right, not the obligation, to buy the underlying at the strike price on expiry.", lessonSlug: "what-is-an-option" },
  { term: "Call wall", definition: "The strike above spot with the largest call gamma; a likely resistance zone.", metric: "callWall", lessonSlug: "gamma-exposure" },
  { term: "Charm", definition: "The change in delta per day as time passes, spot unchanged.", metric: "charm", lessonSlug: "volatility-skew" },
  { term: "Delta", aka: ["Δ"], definition: "Change in option price for a ₹1 change in the underlying.", metric: "delta", lessonSlug: "delta-gamma" },
  { term: "Delta exposure (DEX)", aka: ["DEX"], definition: "Net delta across all open options under a dealer-side assumption.", metric: "dex", lessonSlug: "gamma-exposure" },
  { term: "Exercise", definition: "Using the right an option gives. In India ITM options are exercised automatically at expiry.", lessonSlug: "charges-and-stt-trap" },
  { term: "European option", definition: "An option that can only be exercised on its expiry day. All NSE and BSE options are European." },
  { term: "Expected move (EM)", aka: ["EM", "implied move"], definition: "The one-standard-deviation range the options market prices until expiry.", metric: "em", lessonSlug: "expected-move" },
  { term: "Expected value (EV)", aka: ["EV"], definition: "Probability-weighted average P&L at expiry.", metric: "ev", lessonSlug: "probability-of-profit" },
  { term: "Expiry", definition: "The last trading day of a contract. NIFTY weeklies expire on Tuesday, SENSEX weeklies on Thursday, at 15:30 IST.", lessonSlug: "lot-sizes-and-expiries" },
  { term: "Exposure margin", definition: "Margin charged on top of SPAN, 2% of notional for index options.", lessonSlug: "margin-span-elm" },
  { term: "Extreme loss margin (ELM)", aka: ["ELM"], definition: "Additional margin including an extra 2% on short index options on expiry day.", metric: "elm", lessonSlug: "margin-span-elm" },
  { term: "F&O ban", aka: ["ban period"], definition: "When a stock's open interest crosses 95% of its MWPL, only position-reducing trades are allowed.", metric: "mwpl", lessonSlug: "open-interest-buildup" },
  { term: "Freeze quantity", definition: "The maximum quantity allowed in a single order. Larger orders must be split (sliced)." },
  { term: "Gamma", aka: ["Γ"], definition: "Change in delta for a ₹1 change in the underlying.", metric: "gamma", lessonSlug: "delta-gamma" },
  { term: "Gamma exposure (GEX)", aka: ["GEX"], definition: "Estimated hedging flow per 1% move from options gamma across all strikes.", metric: "gex", lessonSlug: "gamma-exposure" },
  { term: "Gamma flip", aka: ["zero gamma", "flip level"], definition: "The index level where estimated net GEX changes sign.", metric: "flip", lessonSlug: "gamma-exposure" },
  { term: "Hedge", definition: "A position taken to reduce risk, such as buying a far-OTM option against a short option." },
  { term: "Historical volatility (HV)", aka: ["HV", "realised volatility", "realized volatility", "RV"], definition: "Annualised standard deviation of past returns.", metric: "hv", lessonSlug: "implied-volatility" },
  { term: "Implied volatility (IV)", aka: ["IV"], definition: "The volatility that makes the model price match the market price.", metric: "iv", lessonSlug: "implied-volatility" },
  { term: "In the money (ITM)", aka: ["ITM"], definition: "A call with strike below spot, or a put with strike above spot. It has intrinsic value.", lessonSlug: "moneyness-and-premium" },
  { term: "India VIX", aka: ["VIX"], definition: "NSE's index of expected NIFTY volatility over the next 30 calendar days, derived from option prices.", lessonSlug: "implied-volatility" },
  { term: "Intrinsic value", definition: "What an option would be worth if exercised now: max(S − K, 0) for calls, max(K − S, 0) for puts.", lessonSlug: "moneyness-and-premium" },
  { term: "Iron condor", definition: "A short strangle with bought wings on both sides: range-bound with defined risk.", lessonSlug: "spreads-and-straddles" },
  { term: "IV crush", definition: "A sharp fall in implied volatility after an event, which hurts option buyers.", lessonSlug: "theta-vega-rho" },
  { term: "IV Percentile (IVP)", aka: ["IVP"], definition: "Share of past-year days when IV was lower than today.", metric: "ivp", lessonSlug: "implied-volatility" },
  { term: "IV Rank (IVR)", aka: ["IVR"], definition: "Position of today's IV in its 52-week range, 0 to 100.", metric: "ivr", lessonSlug: "implied-volatility" },
  { term: "Long buildup", definition: "Price up with OI up: fresh long positions.", metric: "buildup", lessonSlug: "open-interest-buildup" },
  { term: "Long unwinding", definition: "Price down with OI down: longs closing positions.", metric: "buildup", lessonSlug: "open-interest-buildup" },
  { term: "Lot size", aka: ["lot"], definition: "The number of units in one contract. NIFTY is 65 from the December 2025 revision (verify against the current NSE circular).", lessonSlug: "lot-sizes-and-expiries" },
  { term: "Max pain", definition: "The expiry price where option holders in total lose the most.", metric: "maxPain", lessonSlug: "max-pain-pcr" },
  { term: "Moneyness", definition: "Where a strike sits relative to spot: ITM, ATM or OTM.", lessonSlug: "moneyness-and-premium" },
  { term: "Market-wide position limit (MWPL)", aka: ["MWPL"], definition: "Exchange cap on total open interest in a stock's derivatives.", metric: "mwpl", lessonSlug: "open-interest-buildup" },
  { term: "NISM Series VIII", aka: ["NISM", "equity derivatives certification"], definition: "The NISM Equity Derivatives certification for people dealing in F&O. Prepare with mock tests at NISMExams.com.", lessonSlug: "risk-disclosure" },
  { term: "Open interest (OI)", aka: ["OI"], definition: "The number of contracts outstanding at a point in time.", lessonSlug: "open-interest-buildup" },
  { term: "Out of the money (OTM)", aka: ["OTM"], definition: "A call with strike above spot or a put with strike below spot. All of its premium is time value.", lessonSlug: "moneyness-and-premium" },
  { term: "P50", definition: "Probability of touching 50% of max profit before expiry.", metric: "p50", lessonSlug: "probability-of-profit" },
  { term: "Payoff diagram", definition: "A chart of profit or loss against the underlying price at expiry (and at earlier dates).", lessonSlug: "spreads-and-straddles" },
  { term: "Physical settlement", definition: "Settlement by delivery of shares. Applies to stock F&O in India held to expiry.", lessonSlug: "what-is-an-option" },
  { term: "Premium", definition: "The price of an option, quoted per unit. Rupee cost = premium × lot size × lots.", lessonSlug: "what-is-an-option" },
  { term: "Probability of profit (POP)", aka: ["POP"], definition: "Model probability of making at least ₹1 at expiry.", metric: "pop", lessonSlug: "probability-of-profit" },
  { term: "Put option (PE)", aka: ["PE", "put"], definition: "The right, not the obligation, to sell the underlying at the strike on expiry.", lessonSlug: "what-is-an-option" },
  { term: "Put wall", definition: "The strike below spot with the largest put gamma; a likely support zone.", metric: "putWall", lessonSlug: "gamma-exposure" },
  { term: "Put-call ratio (PCR)", aka: ["PCR"], definition: "Total put OI divided by total call OI.", metric: "pcr", lessonSlug: "max-pain-pcr" },
  { term: "PCR (change in OI)", aka: ["change PCR", "ΔPCR"], definition: "Put OI added today divided by call OI added today.", metric: "pcrChg", lessonSlug: "max-pain-pcr" },
  { term: "Rho", aka: ["ρ"], definition: "Change in option price for a 1% change in interest rates.", metric: "rho", lessonSlug: "theta-vega-rho" },
  { term: "Risk reversal (25Δ)", aka: ["RR25"], definition: "25-delta call IV minus 25-delta put IV: the direction of skew.", metric: "rr25", lessonSlug: "volatility-skew" },
  { term: "Rollover", definition: "Share of expiring futures positions carried to the next month.", metric: "rollover", lessonSlug: "open-interest-buildup" },
  { term: "Securities transaction tax (STT)", aka: ["STT"], definition: "Tax on the sell side of options (on premium) and on intrinsic value at exercise.", metric: "stt", lessonSlug: "charges-and-stt-trap" },
  { term: "Short buildup", definition: "Price down with OI up: fresh short positions.", metric: "buildup", lessonSlug: "open-interest-buildup" },
  { term: "Short covering", definition: "Price up with OI down: shorts buying back.", metric: "buildup", lessonSlug: "open-interest-buildup" },
  { term: "Skew", aka: ["smile", "volatility smile"], definition: "The pattern of IV across strikes. NIFTY usually has higher IV on OTM puts.", lessonSlug: "volatility-skew" },
  { term: "SPAN margin", aka: ["SPAN"], definition: "The exchange's worst-case one-day loss estimate across price and volatility scenarios.", metric: "span", lessonSlug: "margin-span-elm" },
  { term: "Spot", definition: "The current price of the underlying index or stock." },
  { term: "Straddle", definition: "A call and a put at the same strike. The ATM straddle price is the market's price for movement.", metric: "straddle", lessonSlug: "expected-move" },
  { term: "Strangle", definition: "An OTM call and an OTM put at different strikes.", lessonSlug: "spreads-and-straddles" },
  { term: "Strike price", aka: ["strike"], definition: "The price at which an option can be exercised.", lessonSlug: "what-is-an-option" },
  { term: "Theta", aka: ["Θ", "time decay"], definition: "Value an option loses per day, all else equal.", metric: "theta", lessonSlug: "theta-vega-rho" },
  { term: "Time value", aka: ["extrinsic value"], definition: "Premium minus intrinsic value. It falls to zero at expiry.", lessonSlug: "moneyness-and-premium" },
  { term: "Vanna", definition: "Change in delta for a 1-point change in IV.", metric: "vanna", lessonSlug: "volatility-skew" },
  { term: "Vega", aka: ["ν"], definition: "Change in option price for a 1-point change in IV.", metric: "vega", lessonSlug: "theta-vega-rho" },
  { term: "Volatility risk premium (VRP)", aka: ["VRP"], definition: "Implied minus realised volatility: what option sellers are paid.", metric: "vrp", lessonSlug: "implied-volatility" },
  { term: "Weekly expiry", definition: "A contract that expires every week. One per exchange: NIFTY (NSE, Tuesday) and SENSEX (BSE, Thursday).", lessonSlug: "lot-sizes-and-expiries" },
  { term: "Writer", aka: ["option seller"], definition: "The seller of an option, who receives the premium and takes on the obligation.", lessonSlug: "what-is-an-option" },
];

function norm(s: string): string {
  return s.toLowerCase().normalize("NFKD").replace(/\p{M}+/gu, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

/**
 * Case-insensitive search across term, aliases and definition. Results are ranked:
 * exact term/alias match, then prefix, then substring in the term, then in the definition.
 */
export function searchGlossary(query: string, terms: GlossaryTerm[] = GLOSSARY): GlossaryTerm[] {
  const q = norm(query ?? "");
  const sorted = [...terms].sort((a, b) => a.term.localeCompare(b.term, "en-IN"));
  if (!q) return sorted;
  const scored: Array<{ t: GlossaryTerm; score: number }> = [];
  for (const t of sorted) {
    const names = [t.term, ...(t.aka ?? [])].map(norm);
    let score = 0;
    if (names.some((n) => n === q)) score = 4;
    else if (names.some((n) => n.startsWith(q))) score = 3;
    else if (names.some((n) => n.includes(q))) score = 2;
    else if (norm(t.definition).includes(q)) score = 1;
    if (score > 0) scored.push({ t, score });
  }
  return scored.sort((a, b) => b.score - a.score).map((s) => s.t);
}

/** First letter used for A–Z grouping ("#" for non-letters). */
export function glossaryLetter(term: string): string {
  const c = term.trim().charAt(0).toUpperCase();
  return /[A-Z]/.test(c) ? c : "#";
}
