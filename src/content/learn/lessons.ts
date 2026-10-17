/**
 * Learn hub lessons and learning paths. Plain Indian English, NSE/BSE conventions, ₹ and IST.
 * Rates, lot sizes and expiry rules come from @/lib/options at render time (contractTable,
 * expiryList blocks) so the lessons stay in step with the terminal's dated tables.
 */
import type { Lesson, LearningPath, PathId } from "./types";

export const SEBI_STUDY_2024_URL = "https://www.sebi.gov.in/sebi_data/attachdocs/sep-2024/1727086965496.pdf";
export const SEBI_STUDY_2026_URL = "https://www.sebi.gov.in/sebi_data/attachdocs/aug-2026/1787233506209.pdf";

export const PATHS: LearningPath[] = [
  { id: "options-101", title: "Options 101", blurb: "Calls and puts, moneyness, 2026 lot sizes and the Tuesday/Thursday expiry calendar.", icon: "BookOpen" },
  { id: "greeks", title: "The Greeks", blurb: "Delta, gamma, theta, vega and rho, and why expiry day behaves so differently.", icon: "Sigma" },
  { id: "volatility", title: "Volatility", blurb: "IV, IV Rank and Percentile, realised volatility, the expected move and skew.", icon: "Activity" },
  { id: "strategies", title: "Strategies", blurb: "Spreads, straddles and condors, and how to judge them with POP and expected value.", icon: "Layers" },
  { id: "risk-costs", title: "Risk & costs", blurb: "STT, charges, SPAN and ELM margin, and the honest numbers on F&O losses.", icon: "ShieldAlert" },
  { id: "oi-pcr", title: "Reading OI, PCR & max pain", blurb: "Open interest buildups, put-call ratio, MWPL, basis, rollover and max pain.", icon: "BarChart3" },
  { id: "gex-india", title: "GEX for India", blurb: "Gamma exposure, walls and the flip level, with the caveats that matter on NSE.", icon: "Magnet" },
];

export const LESSONS: Lesson[] = [
  // ── Options 101 ────────────────────────────────────────────────────────────
  {
    slug: "what-is-an-option",
    path: "options-101",
    title: "Calls and puts in plain English",
    summary: "What an option contract is, who pays whom, and how the payoff looks at expiry.",
    minutes: 7,
    level: "Beginner",
    metrics: [],
    sims: ["payoff"],
    blocks: [
      { kind: "p", text: "An option is a contract that gives the **buyer a right** and the **seller an obligation**. The buyer pays a price called the **premium** up front. The seller keeps the premium and takes on the risk." },
      { kind: "h", text: "Call option (CE)" },
      { kind: "p", text: "A call gives the right to buy the underlying at the **strike price** on expiry. Buyers profit when the index finishes above strike plus premium. Sellers keep the premium if it finishes below the strike." },
      { kind: "h", text: "Put option (PE)" },
      { kind: "p", text: "A put gives the right to sell at the strike. Buyers profit when the index finishes below strike minus premium. Put buyers often use them as insurance for a portfolio." },
      {
        kind: "table",
        caption: "Four basic positions",
        head: ["Position", "You pay or receive", "Best case", "Worst case"],
        rows: [
          ["Buy call", "Pay premium", "Unlimited upside", "Lose the premium"],
          ["Sell call", "Receive premium", "Keep the premium", "Unlimited loss"],
          ["Buy put", "Pay premium", "Index falls to zero", "Lose the premium"],
          ["Sell put", "Receive premium", "Keep the premium", "Large loss if the index crashes"],
        ],
      },
      { kind: "callout", tone: "info", title: "Index options in India are European and cash-settled", text: "NIFTY, BANKNIFTY and SENSEX options can only be exercised on expiry and settle in cash at the closing price. Stock options are **physically settled**: an ITM stock option held to expiry means taking or giving delivery of the shares." },
      { kind: "sim", sim: "payoff", caption: "Click a strike to add a leg. Start with one bought call, then switch to a bought put." },
      { kind: "formula", label: "Payoff at expiry, per unit", text: "Long call = max(S_T − K, 0) − premium     Long put = max(K − S_T, 0) − premium" },
    ],
    quiz: [
      { id: "q1", prompt: "You buy a NIFTY 25,000 CE for ₹120. NIFTY settles at 25,300 on expiry. What is your profit per unit?", options: ["₹300", "₹180", "₹120", "₹420"], answer: 1, explain: "Intrinsic value is 25,300 − 25,000 = ₹300. Subtract the ₹120 premium: ₹180 per unit." },
      { id: "q2", prompt: "Who has an obligation in an options contract?", options: ["The buyer", "The seller (writer)", "Both", "Neither, until expiry"], answer: 1, explain: "The buyer pays for a right; the seller is obliged to honour it if exercised." },
      { id: "q3", prompt: "What happens to an ITM RELIANCE call held to expiry?", options: ["It settles in cash", "It lapses", "You must take delivery of the shares", "It rolls to next month"], answer: 2, explain: "Stock options in India are physically settled, so you need funds to take delivery." },
    ],
  },
  {
    slug: "moneyness-and-premium",
    path: "options-101",
    title: "Moneyness, intrinsic and time value",
    summary: "ITM, ATM and OTM, and why every premium splits into intrinsic value plus time value.",
    minutes: 6,
    level: "Beginner",
    metrics: ["straddle"],
    sims: ["greeks"],
    blocks: [
      { kind: "p", text: "**Moneyness** describes where the strike sits relative to spot. It decides how much of the premium is real (intrinsic) and how much is hope (time value)." },
      {
        kind: "table",
        caption: "NIFTY at 25,000",
        head: ["Strike", "Call (CE)", "Put (PE)"],
        rows: [
          ["24,500", "ITM (₹500 intrinsic)", "OTM"],
          ["25,000", "ATM", "ATM"],
          ["25,500", "OTM", "ITM (₹500 intrinsic)"],
        ],
      },
      { kind: "formula", label: "Premium split", text: "Premium = Intrinsic value + Time value;   Intrinsic_call = max(S − K, 0), Intrinsic_put = max(K − S, 0)" },
      { kind: "p", text: "Time value is highest at the money and shrinks to zero at expiry. OTM options are **all time value**, which is why they go to zero so often." },
      { kind: "callout", tone: "warning", title: "Cheap is not the same as good value", text: "A ₹5 far-OTM weekly option looks cheap but needs a large move in a few days. Most of them expire worthless." },
      { kind: "sim", sim: "greeks", caption: "Move the strike from ITM to OTM and watch the price and delta change." },
      { kind: "metrics", metrics: ["straddle"] },
    ],
    quiz: [
      { id: "q1", prompt: "NIFTY is at 25,000. A 24,800 PE is…", options: ["ITM", "ATM", "OTM", "Deep ITM"], answer: 2, explain: "A put is ITM only when the strike is above spot. 24,800 is below 25,000, so the put is OTM." },
      { id: "q2", prompt: "A 24,800 CE trades at ₹260 with NIFTY at 25,000. What is its time value?", options: ["₹260", "₹200", "₹60", "₹0"], answer: 2, explain: "Intrinsic = 25,000 − 24,800 = ₹200. Time value = 260 − 200 = ₹60." },
      { id: "q3", prompt: "Which option has the most time value?", options: ["Deep ITM", "ATM", "Deep OTM", "They are all equal"], answer: 1, explain: "Time value peaks at the money, where the outcome is most uncertain." },
    ],
  },
  {
    slug: "lot-sizes-and-expiries",
    path: "options-101",
    title: "Lot sizes and expiry days in 2026",
    summary: "Contract sizes after the December 2025 revision, NIFTY weekly on Tuesday, SENSEX weekly on Thursday.",
    minutes: 6,
    level: "Beginner",
    metrics: [],
    sims: [],
    blocks: [
      { kind: "p", text: "Options trade in **lots**. The premium you see is per unit, so the rupee cost is premium × lot size × number of lots. SEBI sets lot sizes so that one contract is worth roughly ₹15 lakh or more, and NSE revises them periodically." },
      { kind: "contractTable" },
      { kind: "callout", tone: "warning", title: "Lot size belongs to the contract", text: "When lot sizes change, contracts that already exist keep their old lot. New expiries from the effective date use the new lot. Always check the lot on the contract you trade." },
      { kind: "h", text: "One weekly expiry per exchange" },
      { kind: "list", items: [
        "**NSE**: NIFTY is the only weekly index option and expires on **Tuesday**. BANKNIFTY, FINNIFTY, MIDCPNIFTY and stock options are monthly, expiring on the last Tuesday of the month.",
        "**BSE**: SENSEX is the only weekly and expires on **Thursday**. BANKEX is monthly, on the last Thursday.",
        "If the expiry day is a trading holiday, expiry moves to the **previous** trading day.",
        "Trading stops at **15:30 IST** on expiry day; index options settle at the closing price.",
      ] },
      { kind: "expiryList", symbols: ["NIFTY", "SENSEX", "BANKNIFTY"] },
      { kind: "formula", label: "Rupee value of a position", text: "Cost = premium × lot size × lots;   e.g. ₹120 × 65 × 2 = ₹15,600" },
    ],
    quiz: [
      { id: "q1", prompt: "On which day does the NIFTY weekly option expire in 2026?", options: ["Monday", "Tuesday", "Thursday", "Friday"], answer: 1, explain: "Since September 2025 NSE's weekly NIFTY options expire on Tuesday." },
      { id: "q2", prompt: "If expiry Tuesday is a market holiday, the contract expires on…", options: ["Wednesday", "The previous trading day", "The next Tuesday", "It does not expire"], answer: 1, explain: "Expiry shifts to the previous trading day, usually Monday." },
      { id: "q3", prompt: "You buy 2 lots of a NIFTY option at ₹80 with a lot of 65. What do you pay in premium?", options: ["₹160", "₹5,200", "₹10,400", "₹13,000"], answer: 2, explain: "₹80 × 65 × 2 = ₹10,400 (before charges)." },
      { id: "q4", prompt: "Which index has a weekly expiry on BSE?", options: ["BANKEX", "SENSEX", "Both", "Neither"], answer: 1, explain: "SENSEX is BSE's only weekly; BANKEX is monthly." },
    ],
  },

  // ── Greeks ────────────────────────────────────────────────────────────────
  {
    slug: "delta-gamma",
    path: "greeks",
    title: "Delta and gamma",
    summary: "How option prices respond to the index, and why expiry-day gamma is so violent.",
    minutes: 8,
    level: "Intermediate",
    metrics: ["delta", "gamma"],
    sims: ["greeks"],
    blocks: [
      { kind: "p", text: "**Delta** tells you how much the option moves for a ₹1 move in the index. **Gamma** tells you how fast delta itself changes. Together they describe your directional exposure." },
      { kind: "list", items: [
        "Calls have delta between 0 and 1; puts between −1 and 0.",
        "ATM options have delta near ±0.5; deep ITM near ±1; far OTM near 0.",
        "Position delta × lot size = futures-equivalent units. Delta 0.30 on one NIFTY lot of 65 behaves like 19.5 units of NIFTY.",
      ] },
      { kind: "sim", sim: "greeks", caption: "Slide days-to-expiry down to 0.1 and see the delta curve turn into a step and gamma spike at the strike." },
      { kind: "callout", tone: "warning", title: "Short gamma on expiry day", text: "A short ATM straddle on Tuesday afternoon can swing from a profit to a large loss on a 100-point NIFTY move, because gamma is many times higher than earlier in the week." },
      { kind: "metrics", metrics: ["delta", "gamma"] },
    ],
    quiz: [
      { id: "q1", prompt: "A NIFTY CE has delta 0.40. NIFTY rises 50 points. Roughly how much does the option gain?", options: ["₹50", "₹20", "₹40", "₹0.40"], answer: 1, explain: "Δ × move = 0.40 × 50 = ₹20 per unit (ignoring gamma and theta)." },
      { id: "q2", prompt: "Where is gamma highest?", options: ["Deep ITM, far from expiry", "ATM, close to expiry", "Far OTM, far from expiry", "It is constant"], answer: 1, explain: "Gamma peaks at the money and grows sharply as expiry approaches." },
      { id: "q3", prompt: "What is the delta of a long put?", options: ["Between 0 and 1", "Between −1 and 0", "Always −0.5", "Always 0"], answer: 1, explain: "Puts gain when the index falls, so their delta is negative." },
    ],
  },
  {
    slug: "theta-vega-rho",
    path: "greeks",
    title: "Theta, vega and rho",
    summary: "Time decay, sensitivity to volatility, and why theta races on expiry afternoon.",
    minutes: 8,
    level: "Intermediate",
    metrics: ["theta", "vega", "rho"],
    sims: ["thetaDecay"],
    blocks: [
      { kind: "p", text: "**Theta** is the daily cost of holding an option: what it loses if spot and IV stay where they are. Decay is not linear. It speeds up in the last few days, and on expiry day it compresses into a few hours." },
      { kind: "sim", sim: "thetaDecay", caption: "Drag the clock from 09:15 to 15:30 on expiry day. The last hour usually burns more value than the first three." },
      { kind: "p", text: "**Vega** is the change in premium for a 1-point change in IV. Buyers are long vega and get hurt by an **IV crush** after events such as RBI policy, the Union Budget or results. **Rho** measures rate sensitivity and is tiny for weekly options." },
      { kind: "formula", label: "Rough daily P&L of an option", text: "ΔP ≈ Δ·ΔS + ½·Γ·ΔS² + Θ·Δt + ν·ΔIV" },
      { kind: "callout", tone: "info", title: "Theta is payment for gamma", text: "Sellers earn theta because they carry gamma risk. A position with big positive theta always has big negative gamma." },
      { kind: "metrics", metrics: ["theta", "vega", "rho"] },
    ],
    quiz: [
      { id: "q1", prompt: "An ATM NIFTY weekly has theta −₹9 per day. Nothing else changes for two days. What is the approximate change in premium?", options: ["+₹18", "−₹18", "−₹9", "No change"], answer: 1, explain: "Two days × −₹9 = −₹18 per unit." },
      { id: "q2", prompt: "IV falls 4 points after an event. An option has vega ₹6. Roughly how much does the premium change?", options: ["−₹24", "+₹24", "−₹6", "−₹1.50"], answer: 0, explain: "ν × ΔIV = 6 × (−4) = −₹24 per unit." },
      { id: "q3", prompt: "Which Greek matters least for weekly NIFTY options?", options: ["Delta", "Gamma", "Theta", "Rho"], answer: 3, explain: "With only days to expiry, interest-rate sensitivity is negligible." },
    ],
  },

  // ── Volatility ────────────────────────────────────────────────────────────
  {
    slug: "implied-volatility",
    path: "volatility",
    title: "Implied volatility, IV Rank and IV Percentile",
    summary: "What IV means, how to tell rich from cheap, and how realised volatility fits in.",
    minutes: 9,
    level: "Intermediate",
    metrics: ["iv", "ivr", "ivp", "hv", "vrp"],
    sims: ["ivStraddle"],
    blocks: [
      { kind: "p", text: "Option prices are known; volatility is not. **Implied volatility** is the volatility you must put into the pricing model to reproduce the market price. It is the market's forecast of movement, expressed as an annual percentage." },
      { kind: "sim", sim: "ivStraddle", caption: "Drag IV and watch the ATM straddle and expected move change together." },
      { kind: "h", text: "Is IV high or low?" },
      { kind: "p", text: "A 14% IV can be cheap for one stock and expensive for NIFTY. Compare IV with its own history using **IV Rank** (position in the 52-week range) and **IV Percentile** (share of days below today)." },
      { kind: "p", text: "Then compare with what the market actually delivers: **historical (realised) volatility**. The gap, the **volatility risk premium**, is what option sellers are paid for." },
      { kind: "metrics", metrics: ["iv", "ivr", "ivp", "hv", "vrp"] },
      { kind: "callout", tone: "info", title: "India VIX", text: "India VIX is computed by NSE from near and next month NIFTY options and represents expected volatility over the next 30 calendar days." },
    ],
    quiz: [
      { id: "q1", prompt: "NIFTY IV over a year ranged 10% to 20%. Today it is 12%. What is the IV Rank?", options: ["12", "20", "60", "80"], answer: 1, explain: "(12 − 10) ÷ (20 − 10) × 100 = 20." },
      { id: "q2", prompt: "IV Percentile 90 means…", options: ["IV is 90%", "IV was lower on 90% of past days", "There is a 90% chance IV falls", "IV is 90% of HV"], answer: 1, explain: "IVP counts the share of days with lower IV than today." },
      { id: "q3", prompt: "IV 15%, 20-day HV 11%. The volatility risk premium is…", options: ["+4 points", "−4 points", "26 points", "Zero"], answer: 0, explain: "VRP = IV − HV = 15 − 11 = +4 points." },
    ],
  },
  {
    slug: "expected-move",
    path: "volatility",
    title: "The expected move and the straddle",
    summary: "Turn IV or the ATM straddle into a price range for expiry.",
    minutes: 6,
    level: "Intermediate",
    metrics: ["em", "straddle"],
    sims: ["ivStraddle"],
    blocks: [
      { kind: "p", text: "The **expected move** converts IV into points. It is the one-standard-deviation range the options market is pricing until expiry." },
      { kind: "formula", label: "Two ways to compute it", text: "From IV (1σ): EM ≈ S × σ × √(days ÷ 365)     Straddle rule: EM ≈ 0.85 × (CE_ATM + PE_ATM)" },
      { kind: "p", text: "The two numbers are not the same. The ATM straddle prices the **average** absolute move, which is about 0.8 × the one-sigma move. So the 0.85 × straddle rule gives a tighter band of roughly 0.68σ, which the index stays inside about **half** the time. The IV version is the true one-sigma band, which holds about **two times in three**." },
      { kind: "sim", sim: "ivStraddle", caption: "Shorten the days to expiry and see the range narrow with the square root of time." },
      { kind: "list", items: [
        "About two times in three the index finishes inside the 1σ band; about one time in three it does not.",
        "Doubling the time to expiry widens the move by about 41% (√2), not 100%.",
        "Before events the straddle includes an extra 'event premium' that disappears right after.",
      ] },
      { kind: "metrics", metrics: ["em", "straddle"] },
    ],
    quiz: [
      { id: "q1", prompt: "The NIFTY ATM straddle is ₹300. Using the 0.85 rule, what is the expected move?", options: ["±300", "±255", "±150", "±353"], answer: 1, explain: "0.85 × 300 = ±255 points." },
      { id: "q2", prompt: "If the time to expiry quadruples, the expected move roughly…", options: ["Quadruples", "Doubles", "Stays the same", "Halves"], answer: 1, explain: "Move scales with √T: √4 = 2." },
      { id: "q3", prompt: "How often should the index finish outside a one-sigma expected move?", options: ["Almost never", "About 1 in 3", "About 1 in 20", "Half the time"], answer: 1, explain: "One sigma covers about 68%, so roughly 32% of outcomes fall outside." },
      { id: "q4", prompt: "Why is the 0.85 × straddle range narrower than the IV-based one-sigma range?", options: ["The straddle includes charges", "The straddle prices the average move, about 0.8σ", "IV is always overstated", "It is not narrower"], answer: 1, explain: "An ATM straddle ≈ 0.8 × S × σ√T, so 0.85 × straddle ≈ 0.68σ: a band hit about half the time." },
    ],
  },
  {
    slug: "volatility-skew",
    path: "volatility",
    title: "Skew, risk reversals, vanna and charm",
    summary: "Why NIFTY puts cost more than calls, and the second-order Greeks that move dealers.",
    minutes: 8,
    level: "Advanced",
    metrics: ["rr25", "bf25", "vanna", "charm"],
    sims: [],
    blocks: [
      { kind: "p", text: "Not every strike trades at the same IV. For NIFTY, OTM puts usually carry higher IV than OTM calls: the **put skew**. It reflects demand for crash protection and the fact that markets fall faster than they rise." },
      { kind: "table", caption: "Illustrative NIFTY weekly smile (spot 25,000)", head: ["Strike", "Delta", "IV"], rows: [["24,400 PE", "−0.15", "15.8%"], ["24,700 PE", "−0.25", "14.5%"], ["25,000", "±0.50", "12.4%"], ["25,300 CE", "0.25", "11.5%"], ["25,600 CE", "0.15", "11.9%"]] },
      { kind: "p", text: "Two numbers summarise the smile: the **25-delta risk reversal** (direction of skew) and the **25-delta butterfly** (curvature, the price of tails)." },
      { kind: "h", text: "Vanna and charm" },
      { kind: "p", text: "**Vanna** is how delta changes with IV; **charm** is how delta changes with time. Around events and expiry these flows can push the index as hedgers adjust, even without news." },
      { kind: "metrics", metrics: ["rr25", "bf25", "vanna", "charm"] },
    ],
    quiz: [
      { id: "q1", prompt: "25Δ call IV 11%, 25Δ put IV 15%. What is RR25?", options: ["+4", "−4", "13", "26"], answer: 1, explain: "RR25 = call IV − put IV = 11 − 15 = −4 points." },
      { id: "q2", prompt: "Using the same wings and ATM IV 12%, what is BF25?", options: ["+1", "−1", "+3", "0"], answer: 0, explain: "(11 + 15) ÷ 2 − 12 = 13 − 12 = +1 point." },
      { id: "q3", prompt: "With spot unchanged, the delta of an OTM call as expiry approaches…", options: ["Rises towards 1", "Falls towards 0", "Stays the same", "Turns negative"], answer: 1, explain: "Charm pulls OTM deltas towards zero as time runs out." },
    ],
  },

  // ── Strategies ────────────────────────────────────────────────────────────
  {
    slug: "spreads-and-straddles",
    path: "strategies",
    title: "Spreads, straddles and condors",
    summary: "Build defined-risk and volatility trades, and read their payoff diagrams.",
    minutes: 9,
    level: "Intermediate",
    metrics: [],
    sims: ["payoff"],
    blocks: [
      { kind: "p", text: "Combining options lets you shape risk. A **spread** buys one option and sells another to cap both cost and reward. A **straddle** or **strangle** trades volatility rather than direction." },
      { kind: "table", caption: "Common structures", head: ["Strategy", "Legs", "View", "Max loss"], rows: [
        ["Bull call spread", "Buy lower CE, sell higher CE", "Moderately bullish", "Net debit"],
        ["Bear put spread", "Buy higher PE, sell lower PE", "Moderately bearish", "Net debit"],
        ["Long straddle", "Buy ATM CE + ATM PE", "Big move either way", "Net debit"],
        ["Short strangle", "Sell OTM CE + OTM PE", "Range-bound", "Unlimited"],
        ["Iron condor", "Short strangle + long wings", "Range-bound", "Width − credit"],
      ] },
      { kind: "sim", sim: "payoff", caption: "Load a preset, then click strikes to add or change legs. Watch breakevens and max loss update." },
      { kind: "callout", tone: "success", title: "Prefer defined risk while learning", text: "Adding a cheap far-OTM wing turns an unlimited-loss short strangle into an iron condor with a known worst case, and usually cuts the margin sharply too." },
    ],
    quiz: [
      { id: "q1", prompt: "Bull call spread: buy 25,000 CE at ₹150, sell 25,200 CE at ₹70. What is the max profit per unit?", options: ["₹200", "₹120", "₹80", "₹220"], answer: 1, explain: "Width 200 − net debit 80 = ₹120." },
      { id: "q2", prompt: "Which strategy has unlimited risk?", options: ["Iron condor", "Bull call spread", "Short strangle", "Long straddle"], answer: 2, explain: "Naked short options have unlimited (call side) or very large (put side) risk." },
      { id: "q3", prompt: "A long straddle costs ₹280 at strike 25,000. Where are the expiry breakevens?", options: ["24,720 and 25,280", "24,860 and 25,140", "25,000 only", "24,440 and 25,560"], answer: 0, explain: "Strike ± total premium: 25,000 ± 280." },
    ],
  },
  {
    slug: "probability-of-profit",
    path: "strategies",
    title: "Probability of profit, P50 and expected value",
    summary: "What POP really measures, and why high-probability trades are not automatically good trades.",
    minutes: 8,
    level: "Advanced",
    metrics: ["pop", "p50", "ev"],
    sims: ["pop"],
    blocks: [
      { kind: "p", text: "**POP** is the model probability that a strategy makes at least ₹1 at expiry. The terminal computes it by integrating a lognormal distribution, centred on the forward and scaled by IV, over the price ranges where the payoff is positive." },
      { kind: "sim", sim: "pop", caption: "Move the short strikes closer or further and compare POP with expected value." },
      { kind: "callout", tone: "warning", title: "High POP, negative EV", text: "Selling far-OTM options can show 85% POP. But when the 15% arrives the loss can wipe out many months of small wins. Always read POP with max loss and EV." },
      { kind: "list", items: [
        "**POP** answers: how often do I win at expiry?",
        "**P50** answers: how often will I be able to book half the max profit early?",
        "**EV** answers: on average, what do I make per trade, before and after charges?",
      ] },
      { kind: "metrics", metrics: ["pop", "p50", "ev"] },
    ],
    quiz: [
      { id: "q1", prompt: "A short strangle shows POP 80%, max profit ₹4,000 and max loss (at 3σ) ₹30,000. What should you check next?", options: ["Nothing, 80% is great", "Expected value and tail risk", "Only the margin", "Only theta"], answer: 1, explain: "High POP can coexist with negative EV once rare large losses are counted." },
      { id: "q2", prompt: "POP in this terminal uses which distribution?", options: ["Uniform", "Lognormal", "Binomial with 2 steps", "Historical only"], answer: 1, explain: "A lognormal around the forward, scaled by IV and time." },
      { id: "q3", prompt: "Before charges and with fair pricing, the EV of a strategy is close to…", options: ["Its max profit", "Zero", "Its credit", "Its POP × max profit"], answer: 1, explain: "When the model's IV equals the market's, options are fairly priced and EV is about zero; charges push it negative." },
    ],
  },

  // ── Risk & costs ──────────────────────────────────────────────────────────
  {
    slug: "charges-and-stt-trap",
    path: "risk-costs",
    title: "Charges, STT and the expiry-day exercise trap",
    summary: "Every rupee between gross and net P&L: brokerage, STT, exchange fees, SEBI fee, stamp duty and GST.",
    minutes: 8,
    level: "Beginner",
    metrics: ["stt"],
    sims: ["charges"],
    blocks: [
      { kind: "p", text: "A trade's gross profit is not what reaches your bank. Each order pays **brokerage**, **exchange transaction charges**, the **SEBI turnover fee**, **stamp duty** on buys, **GST** on fees and **STT** on sells." },
      { kind: "sim", sim: "charges", caption: "Change premium, lots and the rate date to see how each charge moves." },
      { kind: "h", text: "The exercise STT trap" },
      { kind: "p", text: "If you hold a **long ITM option to expiry**, it is exercised automatically and STT is charged on the **intrinsic value**, not on the premium. Until 2016 STT was levied on the full settlement value, which made exercise ruinous. Under the 2024 table exercise STT (0.125%) was higher than sell STT (0.1%). From 1 April 2026 the terminal's table uses 0.15% for both, so the gap is small, but the habit of squaring off ITM options before 15:30 is still sensible." },
      { kind: "callout", tone: "danger", title: "Stock options: delivery, not just tax", text: "An ITM stock option held to expiry is physically settled. A RELIANCE call left open can turn into a buy obligation worth several lakh rupees. Brokers often square these off from the Thursday or Friday before expiry week." },
      { kind: "metrics", metrics: ["stt"] },
    ],
    quiz: [
      { id: "q1", prompt: "On which side of an options trade is STT charged?", options: ["Buy only", "Sell only", "Both", "Neither"], answer: 1, explain: "STT on options applies to the sell side (and to intrinsic value on exercise)." },
      { id: "q2", prompt: "From 1 April 2026, what STT does the terminal apply to selling one NIFTY lot of 65 at ₹100?", options: ["₹6.50", "₹9.75", "₹65", "₹0"], answer: 1, explain: "0.15% × ₹100 × 65 = ₹9.75." },
      { id: "q3", prompt: "A long ITM option held to expiry pays STT on…", options: ["The premium paid", "The intrinsic value", "The full contract value", "Nothing"], answer: 1, explain: "Exercise STT is charged on intrinsic value." },
    ],
  },
  {
    slug: "margin-span-elm",
    path: "risk-costs",
    title: "SPAN, exposure and expiry-day ELM margin",
    summary: "Why selling options needs lakhs of margin, how hedges cut it, and why it rises on expiry day.",
    minutes: 7,
    level: "Intermediate",
    metrics: ["span", "elm"],
    sims: [],
    blocks: [
      { kind: "p", text: "Option buyers pay the premium in full. Option sellers post **margin**: SPAN (the worst one-day scenario loss) plus **exposure margin** (2% of notional for index options)." },
      { kind: "formula", label: "Margin blocked for a short option", text: "Total ≈ SPAN + Exposure + (ELM on expiry day) − premium received benefit (broker dependent)" },
      { kind: "list", items: [
        "**Hedges** get a large SPAN benefit: buying a far wing can cut the margin of a short strangle by half or more.",
        "**Expiry day**: short index options attract an extra 2% extreme loss margin, and calendar-spread benefits are removed on that day.",
        "**Upfront collection**: SEBI requires brokers to collect option premium and margins upfront; intraday leverage beyond that is not allowed.",
      ] },
      { kind: "callout", tone: "info", title: "Estimates are estimates", text: "The terminal's margin numbers come from a 16-scenario SPAN approximation. Your broker's figure, based on the exchange's SPAN file, is the one that counts." },
      { kind: "metrics", metrics: ["span", "elm"] },
    ],
    quiz: [
      { id: "q1", prompt: "Why does a short straddle need more margin on expiry day?", options: ["STT doubles", "An extra 2% ELM applies to short index options", "Lot size increases", "It does not"], answer: 1, explain: "SEBI's extra 2% ELM applies to short options on the contract's expiry day." },
      { id: "q2", prompt: "What usually cuts the margin of a short strangle the most?", options: ["Adding more lots", "Buying far-OTM wings", "Trading near 15:30", "Choosing a monthly expiry"], answer: 1, explain: "Wings cap the worst case, so SPAN falls sharply." },
      { id: "q3", prompt: "Who pays SPAN margin?", options: ["Option buyers", "Option sellers", "Both equally", "Only brokers"], answer: 1, explain: "Buyers pay the premium; sellers post margin against potential losses." },
    ],
  },
  {
    slug: "risk-disclosure",
    path: "risk-costs",
    title: "Risk disclosure: what SEBI's data says",
    summary: "Nine in ten individual F&O traders lose money. What the studies found and how to protect yourself.",
    minutes: 6,
    level: "Beginner",
    metrics: [],
    sims: [],
    blocks: [
      { kind: "callout", tone: "danger", title: "About 9 in 10 individual F&O traders lose money", text: "SEBI's study of FY22 to FY24 found that **93%** of individual traders in equity F&O made losses, with aggregate losses of over **₹1.8 lakh crore** over three years. More than three-quarters of loss-makers kept trading after two consecutive loss-making years." },
      { kind: "source", label: "SEBI press release PR No. 22/2024 (23 Sep 2024)", href: SEBI_STUDY_2024_URL, note: "Updated study on profit and loss of individual traders in equity F&O, FY22–FY24." },
      { kind: "p", text: "A later SEBI study on FY25 and FY26 reported the share of loss-makers at about 91% in FY25 and about 88% in FY26, after the 2024–25 rule changes (larger lots, one weekly expiry per exchange, upfront premium collection and expiry-day ELM)." },
      { kind: "source", label: "SEBI study: Profitability of individual traders in the equity derivatives segment (Aug 2026)", href: SEBI_STUDY_2026_URL },
      { kind: "h", text: "Why most traders lose" },
      { kind: "list", items: [
        "**Costs**: brokerage, STT and fees are paid on every trade, win or lose. Frequent traders pay a large share of gross profits in costs.",
        "**Asymmetric losses**: short premium wins small and often, then loses big. Long OTM options lose small and very often.",
        "**Leverage**: one NIFTY lot controls roughly ₹16 lakh of index exposure.",
        "**Behaviour**: averaging losers, revenge trading and oversizing after a win.",
      ] },
      { kind: "h", text: "Practical guardrails" },
      { kind: "list", ordered: true, items: [
        "Risk no more than 1–2% of trading capital on any one trade; know the max loss in rupees before entering.",
        "Prefer defined-risk structures until you have a tested process.",
        "Track every trade **net of charges**.",
        "Set a daily loss limit and stop when it is hit.",
        "Learn the rules first. NISM Series VIII (Equity Derivatives) is the certification for people dealing in F&O.",
      ] },
      { kind: "callout", tone: "info", title: "This hub is educational", text: "Nothing in the Mr. Chartist terminal or this Learn hub is investment advice. Numbers in examples and simulators are illustrative." },
    ],
    quiz: [
      { id: "q1", prompt: "According to SEBI's FY22–FY24 study, roughly what share of individual F&O traders lost money?", options: ["About 50%", "About 70%", "About 93%", "About 30%"], answer: 2, explain: "SEBI reported 93% of individual traders made losses over FY22–FY24." },
      { id: "q2", prompt: "Which habit best limits the damage from one bad trade?", options: ["Averaging down", "Fixing max loss in rupees before entry", "Doubling size after a loss", "Holding to expiry"], answer: 1, explain: "Knowing and capping your max loss up front is the most effective guardrail." },
      { id: "q3", prompt: "Which NISM certification covers equity derivatives?", options: ["Series V-A", "Series VIII", "Series XV", "Series X-A"], answer: 1, explain: "NISM Series VIII is the Equity Derivatives certification." },
    ],
  },

  // ── Reading OI / PCR / Max pain ───────────────────────────────────────────
  {
    slug: "open-interest-buildup",
    path: "oi-pcr",
    title: "Open interest, buildups, basis and rollover",
    summary: "Read price and OI together, and understand MWPL bans, futures basis and rollover.",
    minutes: 8,
    level: "Intermediate",
    metrics: ["buildup", "mwpl", "basis", "rollover"],
    sims: [],
    blocks: [
      { kind: "p", text: "**Open interest** is the number of contracts outstanding. Volume counts trades; OI counts positions still open. OI rises when new positions open and falls when they close." },
      { kind: "table", caption: "Buildup matrix", head: ["Price", "OI", "Reading", "Tone"], rows: [
        ["Up", "Up", "Long buildup", "Bullish"],
        ["Down", "Up", "Short buildup", "Bearish"],
        ["Up", "Down", "Short covering", "Bullish but weaker"],
        ["Down", "Down", "Long unwinding", "Bearish but weaker"],
      ] },
      { kind: "callout", tone: "info", title: "Indian convention for option OI", text: "Heavy **call OI** at a strike is read as **resistance** (writers defend it) and shown in red. Heavy **put OI** is read as **support** and shown in green." },
      { kind: "p", text: "**MWPL** caps total OI in a stock's derivatives. Above 95% the stock enters the F&O ban. **Basis** is futures minus spot, and **rollover** is the share of positions carried into the next month near expiry." },
      { kind: "metrics", metrics: ["buildup", "mwpl", "basis", "rollover"] },
    ],
    quiz: [
      { id: "q1", prompt: "Price falls and OI rises. This is…", options: ["Long buildup", "Short buildup", "Short covering", "Long unwinding"], answer: 1, explain: "New positions are opening while price falls: shorts are being added." },
      { id: "q2", prompt: "At what MWPL usage does a stock enter the F&O ban?", options: ["80%", "90%", "95%", "100%"], answer: 2, explain: "Above 95% of MWPL; the ban lifts when usage drops below 80%." },
      { id: "q3", prompt: "Large call OI at 25,500 above spot is usually read as…", options: ["Support", "Resistance", "Max pain", "Irrelevant"], answer: 1, explain: "Call writers defend the strike, so it acts as resistance." },
    ],
  },
  {
    slug: "max-pain-pcr",
    path: "oi-pcr",
    title: "PCR and max pain",
    summary: "Two popular OI summaries, how they are computed and when to trust them.",
    minutes: 7,
    level: "Intermediate",
    metrics: ["pcr", "pcrChg", "maxPain"],
    sims: [],
    blocks: [
      { kind: "p", text: "**Put-call ratio** compares total put OI with total call OI. Because Indian traders mostly *write* puts as support, a rising PCR is usually read as bullish and a falling PCR as bearish." },
      { kind: "table", caption: "Rough PCR (OI) zones for NIFTY", head: ["PCR", "Common reading"], rows: [["Below 0.7", "Heavy call writing, bearish tone"], ["0.7 – 1.0", "Neutral to mildly bearish"], ["1.0 – 1.3", "Neutral to mildly bullish"], ["Above 1.3", "Very bullish; can be over-stretched"]] },
      { kind: "p", text: "**Max pain** is the expiry level where option holders in total lose the most. It is computed by trying every strike as the settlement price and summing what writers would pay." },
      { kind: "formula", label: "Max pain", text: "MaxPain = argmin over S of Σ_K [OI_CE(K) × max(S − K, 0) + OI_PE(K) × max(K − S, 0)]" },
      { kind: "callout", tone: "warning", title: "Neither is a forecast", text: "PCR extremes often reverse, and max pain matters mostly in the final day or two when OI is concentrated. In trending markets both are ignored." },
      { kind: "metrics", metrics: ["pcr", "pcrChg", "maxPain"] },
    ],
    quiz: [
      { id: "q1", prompt: "Total put OI 12 crore, call OI 10 crore. PCR is…", options: ["0.83", "1.20", "2.20", "22"], answer: 1, explain: "12 ÷ 10 = 1.20." },
      { id: "q2", prompt: "Max pain is the level where…", options: ["Option buyers make the most", "Option writers pay out the least", "OI is highest", "IV is lowest"], answer: 1, explain: "It minimises the total payout to option holders." },
      { id: "q3", prompt: "When is max pain most relevant?", options: ["Three weeks before expiry", "The last day or two before expiry", "Only on Mondays", "Never"], answer: 1, explain: "Pinning effects are strongest close to expiry with concentrated OI." },
    ],
  },

  // ── GEX for India ─────────────────────────────────────────────────────────
  {
    slug: "gamma-exposure",
    path: "gex-india",
    title: "Gamma exposure on NSE: walls, flip and pinning",
    summary: "How hedging flows can dampen or amplify NIFTY moves, and why the Indian market needs caveats.",
    minutes: 9,
    level: "Advanced",
    metrics: ["gex", "flip", "callWall", "putWall", "absGamma", "dex"],
    sims: ["greeks"],
    blocks: [
      { kind: "p", text: "Whoever is short options must hedge their delta, and gamma tells them how much that hedge changes as the index moves. **Gamma exposure (GEX)** adds this up across all strikes to estimate hedging flows per 1% move." },
      { kind: "formula", label: "Per strike", text: "GEX_K = Γ_K × OI_K × lot size × S² × 0.01   (calls +, puts −)" },
      { kind: "list", items: [
        "**Positive net GEX**: hedgers sell rallies and buy dips. Ranges and pinning are more likely.",
        "**Negative net GEX**: hedgers chase the move. Trends and gaps can extend.",
        "**Call wall / put wall**: strikes with the largest call or put gamma, acting as resistance and support.",
        "**Flip level**: where net GEX changes sign.",
      ] },
      { kind: "sim", sim: "greeks", caption: "Gamma concentrates near the strike as expiry nears: this is why walls matter most on Tuesday." },
      { kind: "callout", tone: "warning", title: "India-specific caveats", text: "The US convention assumes dealers are short calls and long puts sold to customers. On NSE a large share of writing comes from proprietary traders and individuals, and NSE does not publish who is long or short each strike. Treat GEX signs as an assumption, and OI-based levels as zones that update only a few times a day." },
      { kind: "metrics", metrics: ["gex", "flip", "callWall", "putWall", "absGamma", "dex"] },
    ],
    quiz: [
      { id: "q1", prompt: "In a positive net GEX regime, hedging flows tend to…", options: ["Amplify moves", "Dampen moves", "Have no effect", "Only affect stocks"], answer: 1, explain: "Hedgers buy dips and sell rallies, which dampens volatility." },
      { id: "q2", prompt: "The flip level is where…", options: ["IV equals HV", "Net GEX changes sign", "PCR equals 1", "Max pain sits"], answer: 1, explain: "Above it net GEX is positive; below it negative." },
      { id: "q3", prompt: "Why is GEX less certain in India than the US textbook version?", options: ["NSE options are American", "Who is long or short each strike is not published, and writers are not only dealers", "Lot sizes are too small", "Gamma does not exist for weekly options"], answer: 1, explain: "The dealer-short assumption is weaker on NSE, so the sign is an estimate." },
    ],
  },
];

const BY_SLUG: Record<string, Lesson> = Object.fromEntries(LESSONS.map((l) => [l.slug, l]));

export function getLesson(slug: string | undefined): Lesson | undefined {
  if (!slug) return undefined;
  return BY_SLUG[slug];
}

export function getPath(id: PathId): LearningPath | undefined {
  return PATHS.find((p) => p.id === id);
}

export function lessonsInPath(id: PathId): Lesson[] {
  return LESSONS.filter((l) => l.path === id);
}

/** Previous and next lesson in global order (paths are contiguous in LESSONS). */
export function adjacentLessons(slug: string): { prev?: Lesson; next?: Lesson } {
  const i = LESSONS.findIndex((l) => l.slug === slug);
  if (i < 0) return {};
  return { prev: i > 0 ? LESSONS[i - 1] : undefined, next: i < LESSONS.length - 1 ? LESSONS[i + 1] : undefined };
}

export const TOTAL_MINUTES = LESSONS.reduce((s, l) => s + l.minutes, 0);
