/**
 * Metric explainers used by <MetricHelp metric="…"/> across the terminal and by the Learn hub.
 * Worked examples that quote numbers compute them with @/lib/options, so the copy can never
 * drift from the maths the terminal actually uses.
 */
import {
  bsPrice,
  expectedMoveFromIV,
  expectedMoveFromStraddle,
  formatCompactIN,
  formatGreek,
  formatINR,
  formatNumberIN,
  formatPct,
  formatSigned,
  getChargeRates,
  getLotSize,
  greeks,
} from "@/lib/options";
import type { MetricInfo, MetricKey } from "./types";

// ── Worked-example inputs (illustrative, not market data) ────────────────────
const EX_SPOT = 25000;
const EX_IV = 0.12;
const EX_DAYS = 7;
const EX_T = EX_DAYS / 365;
const EX_R = 0.065;
const NIFTY_LOT = getLotSize("NIFTY") ?? 65;

const exCe = bsPrice({ S: EX_SPOT, K: EX_SPOT, T: EX_T, r: EX_R, sigma: EX_IV, type: "CE" });
const exPe = bsPrice({ S: EX_SPOT, K: EX_SPOT, T: EX_T, r: EX_R, sigma: EX_IV, type: "PE" });
const exStraddle = exCe + exPe;
const exEmIv = expectedMoveFromIV(EX_SPOT, EX_IV, EX_T);
const exEmStraddle = expectedMoveFromStraddle(exStraddle, EX_SPOT);
const exOtmCall = greeks({ S: EX_SPOT, K: EX_SPOT + 200, T: EX_T, r: EX_R, sigma: EX_IV, type: "CE" });
const exAtmCall = greeks({ S: EX_SPOT, K: EX_SPOT, T: EX_T, r: EX_R, sigma: EX_IV, type: "CE" });
const sttSell = getChargeRates("2026-04-01").sttOptionSell;
const sttPrev = getChargeRates("2025-04-01").sttOptionSell;

const n0 = (v: number) => formatNumberIN(v, 0);
const n2 = (v: number) => formatNumberIN(v, 2);
const inr0 = (v: number) => formatINR(v, { decimals: 0 });

export const METRICS: Record<MetricKey, MetricInfo> = {
  iv: {
    key: "iv",
    title: "Implied volatility (IV)",
    short: "IV",
    oneLiner: "The yearly volatility that makes the Black-Scholes price equal the option's market price: the market's forecast of how much the index will move.",
    formula: "Solve Price_market = BS(S, K, T, r, σ) for σ (Newton on vega, Brent fallback)",
    howToRead:
      "Higher IV means richer premiums and a wider expected range. Divide by √(days/365) to turn it into a move: 12% IV over 7 days ≈ 12% × √(7/365) ≈ 1.66%. Compare IV with its own history (IVR, IVP) rather than across symbols.",
    indiaExample: `NIFTY at ${n0(EX_SPOT)}, ATM ${EX_DAYS}-day call trading at ₹${n2(exCe)} implies an IV of about ${formatPct(EX_IV * 100, { decimals: 0 })}. India VIX is a 30-day NIFTY IV built from the near and next month chains.`,
    pitfalls: [
      "IV is not a direction signal. High IV can occur in rallies and in sell-offs.",
      "Deep OTM strikes often show inflated IV from wide bid-ask spreads; prefer mid prices.",
      "On expiry day ATM IV can jump around because a ₹1 move in premium is a big IV change when little time is left.",
    ],
    lessonSlug: "implied-volatility",
    unit: "pct",
  },
  ivr: {
    key: "ivr",
    title: "IV Rank (IVR)",
    short: "IVR",
    oneLiner: "Where today's IV sits between its 52-week low (0) and high (100).",
    formula: "IVR = (IV_now − IV_low) ÷ (IV_high − IV_low) × 100",
    howToRead: "Above 50: IV is in the upper half of its yearly range, so premiums are relatively rich. Below 20: options are relatively cheap. Use it with IVP because one spike can distort IVR for a year.",
    indiaExample: "NIFTY IV range over a year 10%–24%, today 13%: IVR = (13 − 10) ÷ (24 − 10) × 100 ≈ 21. Premiums are on the cheaper side of the year.",
    pitfalls: [
      "One extreme day (an election result, say) sets the high and squashes IVR for the next 12 months.",
      "Needs at least about 20 observations; the terminal shows no value with less history.",
    ],
    lessonSlug: "implied-volatility",
    unit: "score",
  },
  ivp: {
    key: "ivp",
    title: "IV Percentile (IVP)",
    short: "IVP",
    oneLiner: "The share of days in the past year when IV was lower than it is today.",
    formula: "IVP = (days with IV < IV_now) ÷ (total days) × 100",
    howToRead: "IVP 80 means IV was lower on 80% of days. It is robust to one-off spikes, so it is usually a better 'rich or cheap' gauge than IVR.",
    indiaExample: "If NIFTY's 30-day IV was below 13% on 140 of the last 250 sessions, IVP = 56: today's IV is about average.",
    pitfalls: ["Percentile says nothing about how far IV is from the extremes; read it next to IVR.", "Regime changes (a new lot size, weekly expiry rules) can make old history less comparable."],
    lessonSlug: "implied-volatility",
    unit: "score",
  },
  hv: {
    key: "hv",
    title: "Historical volatility (HV)",
    short: "HV",
    oneLiner: "How much the index actually moved, measured from past prices and annualised.",
    formula: "HV = stdev(ln(C_t ÷ C_t−1)) × √252   (Parkinson and Yang-Zhang use high, low and open too)",
    howToRead: "HV is the realised move; IV is the forecast. When IV is far above HV, options are priced for more movement than the market has been delivering.",
    indiaExample: "If NIFTY's daily log returns over 20 sessions have a standard deviation of 0.65%, HV20 = 0.65% × √252 ≈ 10.3%.",
    pitfalls: ["Window choice matters: HV10 reacts fast, HV60 is smooth.", "Gaps at the open are missed by close-to-close HV; use Yang-Zhang for gap-heavy stocks."],
    lessonSlug: "implied-volatility",
    unit: "pct",
  },
  vrp: {
    key: "vrp",
    title: "Volatility risk premium (VRP)",
    short: "VRP",
    oneLiner: "The gap between implied and realised volatility: what option buyers pay for protection.",
    formula: "VRP = IV − HV   (or IV² − HV² in variance terms)",
    howToRead: "Positive VRP is normal: sellers demand a premium for taking crash risk. A very wide VRP favours selling premium; a negative VRP means options are cheap relative to actual movement.",
    indiaExample: "NIFTY IV 13% vs HV20 10% gives a VRP of +3 points. Sellers are being paid for about 30% more movement than recent history.",
    pitfalls: ["VRP is positive on average but sellers still lose heavily on the rare days the move exceeds it.", "Compare matching horizons: 7-day IV with recent realised, not 30-day HV."],
    lessonSlug: "implied-volatility",
    unit: "points",
  },
  pop: {
    key: "pop",
    title: "Probability of profit (POP)",
    short: "POP",
    oneLiner: "The model probability that the strategy makes at least ₹1 at expiry.",
    formula: "POP = ∫ over profitable price ranges of the lognormal density f(S_T; F, σ, T) dS_T",
    howToRead: "Higher POP usually means smaller wins and larger rare losses (short premium). Always read POP next to max loss and expected value.",
    indiaExample: "A NIFTY short straddle at the ATM strike typically shows a POP near 40%, not 17%: the profitable zone is the band between the two breakevens.",
    pitfalls: [
      "Uses implied volatility, which is a risk-neutral forecast, not a real-world probability.",
      "Real index returns have fatter tails than the lognormal model, so far-OTM short options are riskier than POP suggests.",
      "Charges shift breakevens and lower the true POP slightly.",
    ],
    lessonSlug: "probability-of-profit",
    unit: "pct",
  },
  p50: {
    key: "p50",
    title: "Probability of 50% profit (P50)",
    short: "P50",
    oneLiner: "The chance the trade touches half of its maximum profit at any point before expiry.",
    formula: "P50 = share of Monte-Carlo price paths where P&L(t) ≥ 0.5 × max profit before expiry",
    howToRead: "Credit sellers who book profits early care more about P50 than POP. P50 is usually higher than POP for short-premium trades.",
    indiaExample: "An iron condor collecting ₹6,000 per lot might show POP 62% but P50 75%, because there is time for the position to decay to ₹3,000 before any adverse move.",
    pitfalls: ["Depends on the path model and its volatility input.", "Ignores slippage on exit, which can be large in illiquid strikes."],
    lessonSlug: "probability-of-profit",
    unit: "pct",
  },
  ev: {
    key: "ev",
    title: "Expected value (EV)",
    short: "EV",
    oneLiner: "The probability-weighted average P&L at expiry across all possible prices.",
    formula: "EV = ∫ payoff(S_T) × f(S_T) dS_T   (≈ 0 under fair pricing, before charges)",
    howToRead: "With option prices at fair value, EV is close to zero before costs, and negative after charges. A strongly positive EV usually means your volatility input disagrees with the market's.",
    indiaExample: "A NIFTY bull call spread priced off the same IV used for EV will show EV of a few rupees either side of zero per lot; subtract roughly ₹100–₹150 of charges per round trip.",
    pitfalls: ["High POP and negative EV often go together: frequent small wins, rare large losses.", "EV says nothing about the size of the worst case."],
    lessonSlug: "probability-of-profit",
    unit: "inr",
  },
  em: {
    key: "em",
    title: "Expected move (EM)",
    short: "EM",
    oneLiner: "The one-standard-deviation price range the options market is pricing until expiry.",
    formula: "1σ band = F × e^{±σ√T} ≈ ± S × σ × √(days ÷ 365);   straddle rule: 0.85 × ATM straddle",
    howToRead: "In the model the index finishes inside the 1σ band about 68% of the time. The popular 0.85 × straddle rule gives a narrower band (about 0.68σ) that holds roughly half the time, because the straddle prices the average move, which is only about 0.8σ.",
    indiaExample: `NIFTY ${n0(EX_SPOT)}, IV ${formatPct(EX_IV * 100, { decimals: 0 })}, ${EX_DAYS} days: EM ≈ ±${n0(exEmIv.move)} points (${formatNumberIN(exEmIv.lower, 0)} to ${formatNumberIN(exEmIv.upper, 0)}). The 0.85 × straddle rule gives a tighter ±${n0(exEmStraddle.move)}.`,
    pitfalls: ["Know which version you are reading: the 1σ band is missed about one time in three, the straddle-rule band about one time in two.", "Event days (RBI policy, Budget, US CPI) can make the realised move much larger."],
    lessonSlug: "expected-move",
    unit: "points",
  },
  straddle: {
    key: "straddle",
    title: "ATM straddle price",
    short: "Straddle",
    oneLiner: "The cost of buying both the at-the-money call and put: the market's price for movement.",
    formula: "Straddle = CE_ATM + PE_ATM;   Straddle % = Straddle ÷ Spot × 100",
    howToRead: "A falling straddle on a quiet day is theta at work. A rising straddle while spot is flat means IV is being bid up, often ahead of an event.",
    indiaExample: `NIFTY ${n0(EX_SPOT)}, ${EX_DAYS} days to expiry, IV ${formatPct(EX_IV * 100, { decimals: 0 })}: CE ≈ ₹${n2(exCe)} + PE ≈ ₹${n2(exPe)} = ₹${n2(exStraddle)} (${formatPct((exStraddle / EX_SPOT) * 100, { decimals: 2 })} of spot), or ${inr0(exStraddle * NIFTY_LOT)} per lot of ${NIFTY_LOT}.`,
    pitfalls: ["Use mid prices: last-traded prices of the two legs can be minutes apart.", "The ATM strike changes as spot moves, which makes intraday straddle charts jumpy."],
    lessonSlug: "expected-move",
    unit: "inr",
  },
  gex: {
    key: "gex",
    title: "Gamma exposure (GEX)",
    short: "GEX",
    oneLiner: "An estimate of how much option dealers must buy or sell the index for each 1% move, given their gamma.",
    formula: "GEX_K = Γ_K × OI_K × lot × S² × 0.01 × sign (calls +, puts − under the dealer-short-puts assumption)",
    howToRead: "Positive net GEX: dealers hedge against the move (buy dips, sell rips), which tends to dampen volatility. Negative GEX: hedging chases the move and can amplify it.",
    indiaExample: "Large NIFTY call OI above spot and put OI below often gives positive GEX mid-week, with the index pinned near the big strikes into Tuesday expiry.",
    pitfalls: [
      "In India a large share of option writing is by proprietary traders and retail sellers, not just dealers, so the sign convention is an assumption.",
      "OI updates only a few times a day on NSE, so intraday GEX is stale between updates.",
    ],
    lessonSlug: "gamma-exposure",
    unit: "inrCompact",
  },
  flip: {
    key: "flip",
    title: "Gamma flip level",
    short: "Flip",
    oneLiner: "The index level where estimated net GEX changes sign from positive to negative.",
    formula: "Flip = S* where Σ_K GEX_K(S*) = 0 (recomputed with Γ at each trial spot)",
    howToRead: "Above the flip: a calmer, mean-reverting tape is more likely. Below it: moves can extend as hedging adds fuel.",
    indiaExample: "If NIFTY trades at 25,150 and the flip is 24,900, a break below 24,900 would put the market in a negative-gamma zone.",
    pitfalls: ["Only as good as the GEX sign assumption.", "Moves as OI changes; treat it as a zone, not a line."],
    lessonSlug: "gamma-exposure",
    unit: "points",
  },
  callWall: {
    key: "callWall",
    title: "Call wall",
    short: "Call wall",
    oneLiner: "The strike above spot with the largest call gamma exposure: a likely resistance zone.",
    formula: "Call wall = argmax_K (call GEX_K) for K above spot",
    howToRead: "Heavy call writing at a strike makes sellers defend it. In Indian convention CE OI is read as resistance (shown in red).",
    indiaExample: "NIFTY with 1.2 crore contracts of call OI at 25,500 vs under 50 lakh at nearby strikes: 25,500 is the call wall.",
    pitfalls: ["Walls shift as writers roll. A decisive break above a wall can trigger short covering."],
    lessonSlug: "gamma-exposure",
    unit: "points",
  },
  putWall: {
    key: "putWall",
    title: "Put wall",
    short: "Put wall",
    oneLiner: "The strike below spot with the largest put gamma exposure: a likely support zone.",
    formula: "Put wall = argmax_K (|put GEX_K|) for K below spot",
    howToRead: "Put writers defend the strike, so it often acts as support. PE OI is read as support (shown in green).",
    indiaExample: "Heavy NIFTY 24,500 PE writing ahead of expiry makes 24,500 the put wall and a common bounce area.",
    pitfalls: ["When the put wall breaks, writers cover by selling futures, which can speed up the fall."],
    lessonSlug: "gamma-exposure",
    unit: "points",
  },
  absGamma: {
    key: "absGamma",
    title: "Absolute gamma strike",
    short: "Abs gamma",
    oneLiner: "The strike with the largest combined call and put gamma, ignoring sign.",
    formula: "AbsGamma = argmax_K (|call GEX_K| + |put GEX_K|)",
    howToRead: "Acts like a magnet near expiry: hedging flows are heaviest here, so price often gravitates to it on expiry day.",
    indiaExample: "On a NIFTY Tuesday expiry with 25,000 the biggest combined OI strike, the index often closes within 50 points of it.",
    pitfalls: ["Pinning is a tendency, not a rule; news overrides it easily."],
    lessonSlug: "gamma-exposure",
    unit: "points",
  },
  dex: {
    key: "dex",
    title: "Delta exposure (DEX)",
    short: "DEX",
    oneLiner: "The net delta held across all open options, in index units or ₹, under a dealer-side assumption.",
    formula: "DEX = Σ_K (Δ_call × OI_call − |Δ_put| × OI_put) × lot × S",
    howToRead: "Shows how much underlying the option book is effectively long or short. Big shifts in DEX force hedging in futures.",
    indiaExample: "If NIFTY options carry net call delta worth ₹8,000 crore, a dealer short that book needs about ₹8,000 crore of long futures to stay hedged.",
    pitfalls: ["Assumes who is long and who is short each strike; NSE does not publish that split by strike."],
    lessonSlug: "gamma-exposure",
    unit: "inrCompact",
  },
  vanna: {
    key: "vanna",
    title: "Vanna",
    short: "Vanna",
    oneLiner: "How much an option's delta changes when IV changes by one point.",
    formula: "Vanna = ∂Δ/∂σ = ∂ν/∂S = −e^{−qT} × N′(d1) × d2 ÷ σ",
    howToRead: "Explains why OTM put deltas shrink when IV collapses after an event, which can force dealers to buy back hedges and lift the market.",
    indiaExample: "After an RBI policy day IV crush, NIFTY OTM puts lose delta fast; hedgers buy futures back, a common 'vanna rally'.",
    pitfalls: ["Small per contract, large in aggregate; matters most around events and expiry."],
    lessonSlug: "volatility-skew",
    unit: "greek",
  },
  charm: {
    key: "charm",
    title: "Charm (delta decay)",
    short: "Charm",
    oneLiner: "How much an option's delta changes each day as time passes, with spot unchanged.",
    formula: "Charm = −∂Δ/∂t (delta change per calendar day)",
    howToRead: "OTM option deltas fall towards zero and ITM deltas rise towards one as expiry nears. On expiry day charm is very strong.",
    indiaExample: "A NIFTY 25,200 CE with spot at 25,000 might have delta 0.25 on Friday and 0.08 by Tuesday morning if spot stays put.",
    pitfalls: ["Weekends: calendar-day charm counts Saturday and Sunday; trading-day models do not."],
    lessonSlug: "volatility-skew",
    unit: "greek",
  },
  rr25: {
    key: "rr25",
    title: "25-delta risk reversal (RR25)",
    short: "RR25",
    oneLiner: "The IV of the 25-delta call minus the IV of the 25-delta put: the direction of skew.",
    formula: "RR25 = IV(25Δ call) − IV(25Δ put)",
    howToRead: "Negative RR25 (normal for NIFTY) means puts are dearer than calls: demand for crash protection. A move towards zero or positive means upside demand.",
    indiaExample: "NIFTY 25Δ put IV 14.5%, 25Δ call IV 11.5%: RR25 = −3.0 points, a typical put skew.",
    pitfalls: ["Weekly expiries can show noisy skew because the 25Δ strikes sit close to the money."],
    lessonSlug: "volatility-skew",
    unit: "points",
  },
  bf25: {
    key: "bf25",
    title: "25-delta butterfly (BF25)",
    short: "BF25",
    oneLiner: "How much higher the wings' IV is than ATM IV: the curvature of the smile.",
    formula: "BF25 = (IV(25Δ call) + IV(25Δ put)) ÷ 2 − IV(ATM)",
    howToRead: "A higher BF25 means the market is paying up for tail moves in both directions.",
    indiaExample: "Wings at 14.5% and 11.5% with ATM 12.4%: BF25 = 13.0 − 12.4 = +0.6 points.",
    pitfalls: ["Very sensitive to the quality of OTM quotes; use mid prices."],
    lessonSlug: "volatility-skew",
    unit: "points",
  },
  maxPain: {
    key: "maxPain",
    title: "Max pain",
    short: "Max pain",
    oneLiner: "The expiry price at which option buyers, in total, would lose the most (writers pay out the least).",
    formula: "MaxPain = argmin_S Σ_K [OI_CE,K × max(S − K, 0) + OI_PE,K × max(K − S, 0)]",
    howToRead: "Treat it as a gravity zone for expiry day, most useful in the last day or two and when OI is concentrated.",
    indiaExample: "If NIFTY max pain is 25,000 and spot is 25,180 on Monday, some traders expect a drift towards 25,000 into Tuesday expiry.",
    pitfalls: ["It is not a forecast: trending markets ignore it.", "Changes through the day as OI changes; earlier in the week it means little."],
    lessonSlug: "max-pain-pcr",
    unit: "points",
  },
  pcr: {
    key: "pcr",
    title: "Put-call ratio (PCR)",
    short: "PCR",
    oneLiner: "Total put open interest divided by total call open interest.",
    formula: "PCR (OI) = Σ OI_PE ÷ Σ OI_CE",
    howToRead: "In India puts are mostly written as support, so a rising PCR is usually read as bullish. Above about 1.3 can mean over-confidence; below 0.7 means heavy call writing.",
    indiaExample: "NIFTY put OI 9.6 crore vs call OI 8.0 crore: PCR = 1.20, a moderately bullish reading.",
    pitfalls: ["Volume PCR and OI PCR say different things; know which one you are reading.", "Extreme readings are contrarian signals more often than trend signals."],
    lessonSlug: "max-pain-pcr",
    unit: "ratio",
  },
  pcrChg: {
    key: "pcrChg",
    title: "Change-in-OI PCR",
    short: "ΔPCR",
    oneLiner: "Put OI added today divided by call OI added today: today's positioning, not the backlog.",
    formula: "PCR_chg = Σ ΔOI_PE ÷ Σ ΔOI_CE",
    howToRead: "Above 1 means more puts than calls are being written today (support building). Negative values mean one side is unwinding.",
    indiaExample: "By noon 1.5 crore NIFTY puts and 0.6 crore calls added: change PCR = 2.5, strong fresh put writing.",
    pitfalls: ["Unstable early in the session when the denominator is small.", "A negative denominator flips the reading; check the raw changes."],
    lessonSlug: "max-pain-pcr",
    unit: "ratio",
  },
  span: {
    key: "span",
    title: "SPAN margin",
    short: "SPAN",
    oneLiner: "The exchange's worst-case one-day loss estimate for a position, across price and volatility scenarios.",
    formula: "SPAN = max loss over 16 scenarios (price ± up to 3 scan ranges × IV up/down) + short option minimum",
    howToRead: "SPAN plus exposure margin is what your broker blocks. Hedged positions get a large SPAN benefit.",
    indiaExample: "One lot of naked short NIFTY ATM call might need around ₹1.2–1.6 lakh total margin; buying a 300-point-away call as a hedge can cut it by more than half.",
    pitfalls: ["SPAN files update several times a day; margins can rise intraday on volatile days.", "Estimates in this terminal are approximations, not the exchange's file."],
    lessonSlug: "margin-span-elm",
    unit: "inr",
  },
  elm: {
    key: "elm",
    title: "Extreme loss margin (ELM)",
    short: "ELM",
    oneLiner: "An extra margin on top of SPAN, including an additional 2% for short index options on expiry day.",
    formula: "ELM = notional × ELM% (2% on index options; +2% extra on the expiry day for short positions)",
    howToRead: "Explains why the margin on the same short straddle rises on expiry day.",
    indiaExample: `One NIFTY lot (${NIFTY_LOT} × ${n0(EX_SPOT)} = ${formatINR(NIFTY_LOT * EX_SPOT, { decimals: 0 })} notional): the extra 2% expiry-day ELM adds about ${formatINR(NIFTY_LOT * EX_SPOT * 0.02, { decimals: 0 })}.`,
    pitfalls: ["Applies to short options on the expiry day of that contract only."],
    lessonSlug: "margin-span-elm",
    unit: "inr",
  },
  stt: {
    key: "stt",
    title: "Securities transaction tax (STT)",
    short: "STT",
    oneLiner: "A tax on the sell side of option trades, and on intrinsic value when an option is exercised.",
    formula: `STT_sell = ${formatPct(sttSell * 100, { decimals: 2 })} × premium × qty (from 1 Apr 2026; ${formatPct(sttPrev * 100, { decimals: 2 })} before)`,
    howToRead: "STT does not depend on profit; it applies even to losing trades. For short-premium scalpers it is often the largest cost after brokerage.",
    indiaExample: `Selling one NIFTY lot (${NIFTY_LOT}) at ₹100: STT = ${formatPct(sttSell * 100, { decimals: 2 })} × ₹100 × ${NIFTY_LOT} = ${formatINR(sttSell * 100 * NIFTY_LOT)}.`,
    pitfalls: ["Exercised ITM options pay STT on intrinsic value; for stock options exercise also means physical delivery.", "Rates change with the Budget; this terminal uses a dated table marked for verification."],
    lessonSlug: "charges-and-stt-trap",
    unit: "inr",
  },
  delta: {
    key: "delta",
    title: "Delta (Δ)",
    short: "Δ",
    oneLiner: "How much the option price changes for a ₹1 move in the underlying.",
    formula: "Δ_call = e^{−qT} N(d1);   Δ_put = −e^{−qT} N(−d1)",
    howToRead: "Calls 0 to 1, puts −1 to 0. ATM is near ±0.5. Also a rough probability of finishing in the money and the futures-equivalent position.",
    indiaExample: `NIFTY ${n0(EX_SPOT)}, 25,200 CE, ${EX_DAYS} days, IV ${formatPct(EX_IV * 100, { decimals: 0 })}: Δ ≈ ${formatGreek("delta", exOtmCall.delta)}. One lot behaves like ${n2(exOtmCall.delta * NIFTY_LOT)} units of NIFTY.`,
    pitfalls: ["Delta changes as spot, time and IV change (gamma, charm, vanna).", "Treating delta as an exact probability ignores skew and drift."],
    lessonSlug: "delta-gamma",
    unit: "greek",
  },
  gamma: {
    key: "gamma",
    title: "Gamma (Γ)",
    short: "Γ",
    oneLiner: "How much delta changes for a ₹1 move in the underlying.",
    formula: "Γ = e^{−qT} N′(d1) ÷ (S σ √T)",
    howToRead: "Highest for ATM options close to expiry. Long gamma profits from big moves; short gamma loses on them.",
    indiaExample: `ATM NIFTY ${EX_DAYS}-day option: Γ ≈ ${formatGreek("gamma", exAtmCall.gamma)}, so a 100-point move shifts delta by about ${n2(exAtmCall.gamma * 100)}.`,
    pitfalls: ["Expiry-day gamma on ATM strikes is extreme: deltas can swing from 0.2 to 0.8 within minutes."],
    lessonSlug: "delta-gamma",
    unit: "greek",
  },
  theta: {
    key: "theta",
    title: "Theta (Θ)",
    short: "Θ",
    oneLiner: "How much value an option loses per calendar day if nothing else changes.",
    formula: "Θ ≈ −S N′(d1) σ e^{−qT} ÷ (2√T) − r K e^{−rT} N(d2)  (per year; ÷ 365 per day)",
    howToRead: "Negative for buyers, positive for sellers. Theta accelerates sharply in the last few days and hours before expiry.",
    indiaExample: `ATM NIFTY ${EX_DAYS}-day call: Θ ≈ ${formatINR(exAtmCall.theta)} per day per unit, about ${formatINR(exAtmCall.theta * NIFTY_LOT, { decimals: 0 })} per lot of ${NIFTY_LOT}.`,
    pitfalls: ["Weekends: premiums usually price in weekend decay by Friday afternoon.", "Theta income is compensation for gamma risk, not free money."],
    lessonSlug: "theta-vega-rho",
    unit: "inr",
  },
  vega: {
    key: "vega",
    title: "Vega (ν)",
    short: "ν",
    oneLiner: "How much the option price changes for a 1-point change in implied volatility.",
    formula: "ν = S e^{−qT} N′(d1) √T ÷ 100   (per vol point)",
    howToRead: "Largest for ATM, longer-dated options. Long options are long vega; an IV crush after an event hurts buyers even if spot moves their way.",
    indiaExample: `ATM NIFTY ${EX_DAYS}-day option: ν ≈ ${formatINR(exAtmCall.vega)} per vol point. A 3-point IV crush costs about ${formatINR(exAtmCall.vega * 3 * NIFTY_LOT, { decimals: 0 })} per lot.`,
    pitfalls: ["Weekly options have small vega but huge gamma; monthly options are the opposite."],
    lessonSlug: "theta-vega-rho",
    unit: "inr",
  },
  rho: {
    key: "rho",
    title: "Rho (ρ)",
    short: "ρ",
    oneLiner: "How much the option price changes for a 1% change in interest rates.",
    formula: "ρ_call = K T e^{−rT} N(d2) ÷ 100;   ρ_put = −K T e^{−rT} N(−d2) ÷ 100",
    howToRead: "Usually negligible for weekly index options; matters for long-dated options and futures pricing.",
    indiaExample: "A 25 bp RBI rate cut barely moves a weekly NIFTY option (a few paise); it shifts the fair value of a 3-month future by about 0.06%.",
    pitfalls: ["Use a rate close to the T-bill yield, not the repo rate, for fair values."],
    lessonSlug: "theta-vega-rho",
    unit: "inr",
  },
  buildup: {
    key: "buildup",
    title: "OI buildup",
    short: "Buildup",
    oneLiner: "Reading price change and open-interest change together to infer who is opening or closing positions.",
    formula: "Price ↑ OI ↑ Long buildup · Price ↓ OI ↑ Short buildup · Price ↑ OI ↓ Short covering · Price ↓ OI ↓ Long unwinding",
    howToRead: "Buildups with rising OI show fresh conviction; covering and unwinding show positions being closed and often run out of steam.",
    indiaExample: "NIFTY futures up 0.8% with OI up 6%: long buildup. Up 0.8% with OI down 4%: short covering, a weaker signal.",
    pitfalls: ["For options, rising OI with rising price on a call can be buyers or writers being forced to hold; context matters.", "Day-end OI only; intraday OI updates are periodic."],
    lessonSlug: "open-interest-buildup",
    unit: "text",
  },
  mwpl: {
    key: "mwpl",
    title: "Market-wide position limit (MWPL)",
    short: "MWPL",
    oneLiner: "The exchange cap on total open interest in a stock's derivatives; crossing 95% puts the stock in the F&O ban.",
    formula: "MWPL usage = combined futures-equivalent OI ÷ MWPL × 100",
    howToRead: "Above 95% the stock enters the ban period: only position-reducing trades are allowed until usage falls below 80%.",
    indiaExample: "A mid-cap stock at 92% MWPL usage is close to the ban; fresh positions carry the risk of being stuck if it crosses 95%.",
    pitfalls: ["Opening a new position in a banned stock attracts penalties even if accidental."],
    lessonSlug: "open-interest-buildup",
    unit: "pct",
  },
  basis: {
    key: "basis",
    title: "Futures basis",
    short: "Basis",
    oneLiner: "The gap between the futures price and the spot index.",
    formula: "Basis = Futures − Spot;   fair basis ≈ S × (e^{(r−q)T} − 1)",
    howToRead: "A premium above fair suggests long demand; a discount (negative basis) suggests short-heavy positioning or dividend effects.",
    indiaExample: `NIFTY spot ${n0(EX_SPOT)}, one month to expiry, r 6.5%, dividend yield 1.3%: fair basis ≈ ${formatSigned(EX_SPOT * (Math.exp((0.065 - 0.013) * (30 / 365)) - 1), 0)} points.`,
    pitfalls: ["Basis converges to zero at expiry, which is not a signal.", "Large dividends cause temporary discounts in stock futures."],
    lessonSlug: "open-interest-buildup",
    unit: "points",
  },
  rollover: {
    key: "rollover",
    title: "Rollover",
    short: "Rollover",
    oneLiner: "The share of expiring-month futures positions carried into the next month.",
    formula: "Rollover % = (next + far month OI) ÷ (near + next + far month OI) × 100, near expiry",
    howToRead: "Higher than average rollover with a rising basis suggests longs are being carried forward; with a falling basis, shorts.",
    indiaExample: "NIFTY rollover of 78% vs a three-month average of 72%, with rollover cost rising: traders are carrying longs into the next series.",
    pitfalls: ["Compare with the stock's own history; rollover levels differ a lot across stocks."],
    lessonSlug: "open-interest-buildup",
    unit: "pct",
  },
};

export const METRIC_KEYS = Object.keys(METRICS) as MetricKey[];

const NORMALISED: Record<string, MetricKey> = Object.fromEntries(METRIC_KEYS.map((k) => [k.toLowerCase(), k]));

const ALIASES: Record<string, MetricKey> = {
  impliedvolatility: "iv",
  ivrank: "ivr",
  ivpercentile: "ivp",
  historicalvolatility: "hv",
  realisedvolatility: "hv",
  realizedvolatility: "hv",
  probabilityofprofit: "pop",
  expectedvalue: "ev",
  expectedmove: "em",
  gammaexposure: "gex",
  gammaflip: "flip",
  zerogamma: "flip",
  callwall: "callWall",
  putwall: "putWall",
  absolutegamma: "absGamma",
  deltaexposure: "dex",
  riskreversal: "rr25",
  butterfly: "bf25",
  maxpain: "maxPain",
  putcallratio: "pcr",
  changepcr: "pcrChg",
  pcrchange: "pcrChg",
  oibuildup: "buildup",
  atmstraddle: "straddle",
};

/** "IV_Rank", "call-wall", "callWall" → canonical key; undefined when unknown. */
export function normalizeMetricKey(metric: string): MetricKey | undefined {
  if (typeof metric !== "string") return undefined;
  const flat = metric.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!flat) return undefined;
  return NORMALISED[flat] ?? ALIASES[flat];
}

export function isMetricKey(metric: string): metric is MetricKey {
  return Object.prototype.hasOwnProperty.call(METRICS, metric);
}

export function getMetric(metric: string): MetricInfo | undefined {
  const key = normalizeMetricKey(metric);
  return key ? METRICS[key] : undefined;
}

/** Format a live value for display inside the explainer, using the metric's unit. */
export function formatMetricValue(metric: string, value: number | string | undefined | null): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") return value.trim() || undefined;
  if (!Number.isFinite(value)) return undefined;
  const info = getMetric(metric);
  switch (info?.unit) {
    case "pct":
      return formatPct(value, { decimals: 1 });
    case "inr":
      return formatINR(value, { decimals: Math.abs(value) >= 1000 ? 0 : 2 });
    case "inrCompact":
      return formatCompactIN(value, { symbol: true, decimals: 2 });
    case "points":
      return formatNumberIN(value, Math.abs(value) >= 100 ? 0 : 2);
    case "ratio":
      return formatNumberIN(value, 2);
    case "score":
      return formatNumberIN(value, 0);
    case "greek":
      return formatNumberIN(value, Math.abs(value) < 0.01 ? 5 : 3);
    default:
      return formatNumberIN(value, 2);
  }
}
