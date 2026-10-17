# Mr. Chartist Terminal: Product Roadmap

> Status: draft v1 (2026-10-17). Combines 9 research and audit tracks: US flow tools, US strategy and volatility tools, Indian competitors, the mrchartist.com theme, and audits of the option chain/OI, strategy, data layer, UX and engineering quality.
> Legend: **Impact** H/M/L · **Effort** S (≤1 day), M (2-4 days), L (1-2 weeks). Each item is a checkbox; tick it when it ships.

---

## 1. Vision

**Build the most accurate, most honest and most useful options terminal for Indian F&O traders: free, open source and not tied to any broker.**

Sensibull, Opstra, Quantsapp and Stockmock each do one thing well. US tools (OptionStrat, Unusual Whales, SpotGamma, ORATS, Market Chameleon, Barchart) set the bar for analytics. Mr. Chartist Terminal aims to:

1. **Get the numbers right first.** Use Black-76 on the forward, measure time to the 15:30 IST expiry, use real lot sizes and real expiry rules (NIFTY Tuesday, SENSEX Thursday), apply 2026 STT and charges, compute a proper lognormal POP and show SPAN-style margin with hedge benefit. A tool that is quietly wrong is worse than having no tool.
2. **Be clear about where every number comes from.** Each value is marked Live, Delayed, Cached or Sample. The app never shows a made-up IV Rank. NSE has no tick-level data, so derived "flow" is labelled as derived.
3. **Bring US-grade analytics to NSE.** This covers GEX, call and put walls, the gamma flip, vanna and charm, IV surface and term structure, an optimizer, a P&L heat table, flow and unusual-activity scanners, and a backtester.
4. **Add what only India has.** That means participant-wise OI (FII/DII/Pro/Client), the F&O ban list and MWPL, expiry-day (0DTE) tools, net-of-STT P&L, the exercise-STT trap and SEBI guardrails.
5. **Teach while people trade.** Every metric gets an inline explainer, and a Learn hub is branded with **NISMExams.com**. SEBI found that about 9 in 10 individual F&O traders lose money, so responsible design matters.

**North-star metrics:** number of correct-math tests passing (target 300+); the share of displayed values backed by real data instead of mock (target 100% or labelled); time to the first useful insight on the dashboard (under 2 s); weekly returning users.

---

## 2. Theme direction: the mrchartist.com design language

The terminal currently uses a generic cyan "neon obsidian" look. It will move to the **Mr. Chartist / Investology** brand: a warm, editorial style with "paper" and "ink-wine" in light mode, near-black "void" in dark mode, and **orange-500 with wine text** as the signature.

| Decision | Spec |
|---|---|
| Light surfaces | paper-1 `72 20% 95.1%` (bg) · paper-0 `0 0% 99.6%` (card) · ink-wine `336.7 41% 8.6%` (fg) |
| Dark surfaces | void-1 `210 25% 3.1%` (bg) · void-3 `214 20% 8.4%` (card) · void-2 surface · paper-1 fg |
| Primary | orange-500 `17.9 85.5% 53.9%` fill, **wine text on top** (5.66:1). New `--primary-ink` `18 85% 42%` for orange used as text in light mode (orange-500 text fails at 3.27:1) |
| Trading colours | light bullish `152 48% 29%` / bearish `1 55% 42%`; dark bullish `148.9 45.5% 63.3%` / bearish `3 72% 66%` (AA-tuned) |
| Washes | wash-profit, wash-loss, wash-warning, wash-brand (ATM row), wash-info |
| Product accent | options navy `212.6 80% 33.3%` (dark `211 78% 68%`) for neutral analytics emphasis |
| Call/Put | Indian convention: **CE OI = bearish/red (resistance), PE OI = bullish/green (support)** across all charts |
| Fonts | Inter (body and numbers, `tnum`+`zero`), Plus Jakarta Sans 700/800 (headings), Instrument Serif italic (accent); JetBrains Mono only for kbd and code |
| Radius | chip 6 · pill 7 · tab 8 · tile 10 · card 14 · panel 24 · capsule 999; `--radius: .75rem` |
| Shadows | warm paper shadows (light), slab plus rim-light (dark), ember focus glow; **no neon glows** |
| Motion | out-expo `cubic-bezier(.16,1,.3,1)`; durations 120/150/250/320/500 ms; honour `prefers-reduced-motion` |
| Scheme | follow the system by default; three-way Light / System / Dark toggle |
| Voice | plain and honest: "A clearer view of the markets." Every page says "Data for education and research. Not investment advice." |

All text/background pairs have been checked for WCAG AA (at least 4.5:1). Colour is never the only signal: values always carry +/− or ▲/▼.

---

## 3. Phase 1: Foundation (correctness, shared math, theme, critical bugs)

### 1A. Shared options math core: `src/lib/options/`
- [ ] **Pure, tested pricing core**: normal CDF/PDF/inverse, Black-Scholes and Black-76, full Greeks (Δ Γ Θ ν ρ plus vanna, charm, vomma). Remove the three duplicate BS copies (mockData, PayoffMultiDTE, WhatIfSimulator). **H / M**
- [ ] **IV solver**: Newton on vega with a Brent fallback, seeded by Corrado-Miller; returns NaN below intrinsic. **H / M**
- [ ] **Time and expiry engine**: IST clock, NSE/BSE holidays, NIFTY weekly Tuesday, SENSEX weekly Thursday, other indices monthly only, shift to the previous trading day on holidays, T measured in minutes to 15:30 IST, market session (pre-open, open, closed, holiday). **H / M**
- [ ] **Instrument registry**: 2026 lot sizes (NIFTY 65, BANKNIFTY 30, FINNIFTY 60, MIDCPNIFTY 120, SENSEX 20, all marked *verify*), strike steps, freeze quantities, effective-from dates; lot size is per contract, so old contracts keep their old lot. **H / S**
- [ ] **Payoff engine**: exact piecewise-linear breakevens, detection of unlimited profit or loss, T+x valuation, P&L matrix. **H / M**
- [ ] **Probability**: lognormal POP (fixes the uniform-z bug: a short straddle shows 17% when it should be about 38%), P(ITM), P(touch), P(between), EV, Monte-Carlo P50. **H / S**
- [ ] **Expected move**: IV-based (log-space 1σ/2σ) and straddle-based (0.85 × straddle). **H / S**
- [ ] **Charges**: dated rate table. STT on option sell is 0.15% from 1 April 2026 (0.1% before); exercise STT on intrinsic value; NSE/BSE transaction charges; SEBI fee; stamp duty; GST; broker presets. **H / M**
- [ ] **Margin estimate**: SPAN-style 16 scenarios, plus exposure margin, plus 2% ELM on expiry day, with hedge benefit; defined-risk positions use max loss. Labelled "estimate". **H / M**
- [ ] **Volatility helpers**: close-to-close, Parkinson and Yang-Zhang HV; IVR and IVP; forward vol; constant-maturity interpolation; RR25/BF25. **H / S**
- [ ] **Chain enrichment**: fill missing IV and Greeks for NSE legs (NSE sends 0); modal strike step; true ATM; implied forward from put-call parity; leg IV that ignores zero IVs. **H / S**
- [ ] **Indian number formatting**: ₹, lakh/crore, compact K/L/Cr, signed %, IST time. Replaces about 120 ad-hoc formatters. **M / S**
- [ ] **Sample chain generator**, BS-consistent with a skew, for clearly labelled demo mode. **M / S**
- [ ] vitest suite: Hull reference values, parity, Greeks vs finite differences, IV round-trip, POP, charges vs a broker calculator; coverage at least 90% on `src/lib/options/**`. **H / M**

### 1B. Theme migration
- [ ] Token swap in `index.css` (primitives, light, dark, washes, chart, sentiment, shadows, motion). **H / S**
- [ ] `tailwind.config.ts`: colours, type scale (micro/label/body/lead/title/display/num-hero), radius, shadows, easing; delete neon tokens. **H / S**
- [ ] `index.html`: Google Fonts via preconnect, orange favicon, theme-color per scheme, system-scheme script inside try/catch, plain meta copy. **M / S**
- [ ] shadcn primitives: button (buy/sell variants), card, badge (bullish/bearish/info/warning chips), tabs, input/select, popover, dialog (panel radius), sonner, table. **H / S**
- [ ] DashboardLayout glass header with capsule ticker, one status pill (session plus data feed), IST clock; StatusFooter laid out in normal flow (no longer covers the sidebar) with a compliance line. **H / S**
- [ ] `src/lib/chartTheme.ts`: Recharts palette tokens, tooltip styles, payoff fills. **H / S**
- [ ] Sidebar restyle (paper/void, orange active pill, remove teal rail) is done by the **integrator** in `AppSidebar.tsx`. **H / M**

### 1C. Critical bug fixes (P0)
- [ ] Remove the **leaked prompt-injection text** in WelcomeBanner and the Index "Live Indices" subtitle; add a CI grep guard. **H / S**
- [ ] Proxy hides Dhan failures as an empty "success", so the NSE fallback never runs and users without keys see no chain. **H / S**
- [ ] Dhan WebSocket parser: prices are float32 (code reads int32/100), and the Full-packet offsets are wrong. **H / M**
- [ ] Dhan expiry list uses `UnderlyingSeg` NSE_FNO; it should be IDX_I. **H / S**
- [ ] Stale lot sizes everywhere (NIFTY 25, so figures are 2-3x off); a fallback of 500 for unknown symbols. **H / S**
- [ ] NSE Greeks are hardcoded to 0, which breaks Delta, Delta-OI and GEX. Compute them client-side. **H / M**
- [ ] OI and OI-change columns never render on the Option Chain (OIBar is dead code). **H / S**
- [ ] OI buildup checks `ltp > 0` instead of price change; add `change`/`pChange`/`prevClose` to the leg type. **H / M**
- [ ] Combined gamma and vega use `Math.abs(qty)`, so a short straddle shows as long gamma. **H / S**
- [ ] Max profit/loss never shows "unlimited"; breakevens snap to a 25-point grid. **H / S**
- [ ] `updateLeg` mutates preset objects in place. **M / S**
- [ ] Fake IV Rank/IVP (seededRandom) and an expected move driven by VIX × fudge factors. Replace with real values or show "insufficient history". **H / M**
- [ ] Clocks labelled IST show browser time; the expiry countdown assumes Thursday; BANKNIFTY is labelled weekly. **H / M**
- [ ] Command Palette and Ctrl+4/5 point to `/greeks` and `/strategy`, which do not exist. **H / S** (integrator plus route registry)
- [ ] Proxy security: CORS `*`, binds 0.0.0.0, no WebSocket Origin check, while holding the Dhan token. **H / S**
- [ ] Broker passwords, MPINs and TOTP secrets in plain-text localStorage, with a misleading "secure" notice. **H / M**
- [ ] CI `tsc --noEmit` checks 0 files; turn on `strict` (already 0 errors). **H / S**
- [ ] Dockerfile copies `.env` into the image, deletes the lockfile and runs as root on EOL Node 18. **M / S**

### 1D. Data layer hardening
- [ ] Response envelope `{data, meta:{source, asOf, stale, reason}}`, plus a global DataFreshness badge. **H / M**
- [ ] Request coalescing, a per-upstream token bucket (Dhan OC 1 per 3 s), an LRU cache, upstream timeouts, honouring Retry-After. **H / M**
- [ ] NSE session: `getSetCookie()`, a shared session promise, warm-up, option-chain-v3 with legacy fallback, expiry normalised to ISO. **M / S**
- [ ] Fix last-good cache rehydration keys; keep last-good until the next session; atomic writes. **M / S**
- [ ] New proxy endpoints: lot sizes, holidays, participant OI and volume, FII stats, ban list, MWPL, VIX history, OI spurts, most-active contracts, F&O bhavcopy, event calendar, bulk and block deals, multi-expiry chain. **H / L**
- [ ] **Snapshot recorder** (`src/lib/snapshotStore.ts`, IndexedDB `chainSnapshots` plus `dailyStats`). It is the foundation for flow, replay, IV history and PCR history. **H / M**
- [ ] Charts send browser-stored Dhan keys; the security-ID map is generated from the scrip master; WebSocket ticks are keyed by `segment:id`. **M / S**

---

## 4. Phase 2: Feature parity (Sensibull · OptionStrat · Unusual Whales · SpotGamma · ORATS, adapted for NSE)

### 2A. Option chain (parity with Sensibull/Kite)
- [ ] Column presets (Basic, Greeks, Liquidity) with persistence; a single column-definition array that drives header, body and footer. **M / M**
- [ ] OI/OI-change in-cell bars; ITM shading; ATM brand wash; a spot/futures divider row; highest-OI and highest-volume badges. **H / S**
- [ ] Buildup tags LB/SB/SC/LU per strike; PCR, Max Pain, ATM IV, synthetic future, straddle % and breakevens in the header. **H / S**
- [ ] Strike range ±10/15/20/30/All; memoised rows; one shared context menu. **H / M**
- [ ] Hover B/S buttons that add legs to a basket drawer, then "Open in Strategy Builder" with real expiry and mid price. **H / M**
- [ ] Prob ITM / Prob Touch columns; a delta view with the 16Δ/30Δ rows highlighted; liquidity score 1-5; spread %. **M / S**
- [ ] Gamma-level badges (CW, PW, AG, FLIP) on rows; SENSEX/BANKEX; working keyboard shortcuts; per-strike alerts. **M / M**
- [ ] Multi-expiry By-Strike view built from real per-expiry fetches (the current one is fabricated). **H / M**

### 2B. Strategy Builder (parity with OptionStrat/Sensibull)
- [ ] Symbol and per-leg expiry selectors; legs priced from the live chain (mid/LTP/natural). **H / L**
- [ ] One chart with a target-date slider, IV-shift slider, 1σ/2σ bands and a lognormal POP shading. **H / M**
- [ ] **P&L heat table** (spot × date) with ₹ / % toggle and CSV export. **H / M**
- [ ] Per-leg Greeks table, net Greeks (signed), stats panel with POP, P50, EV, max P/L (∞ aware), R:R, margin with hedge benefit, charges, and **breakevens after costs**. **H / M**
- [ ] About 40 templates grouped by view, strikes defined by delta or expected move; calendars, diagonals and futures legs. **H / M**
- [ ] Save/share via `?s=` base64 URL; PNG export; "Add to Positions"; hotkeys. **M / M**
- [ ] **Optimizer** (OptionStrat-style): target price and date, budget, a return-vs-chance slider, ranked cards, run in a Web Worker. **H / L**

### 2C. Volatility analytics (ORATS / Market Chameleon)
- [ ] Real IVR/IVP from VIX history, snapshots and a bhavcopy backfill; "insufficient history" state. **H / M**
- [ ] OTM-composite smile per expiry with RR25/BF25 and overlays (1 h ago, yesterday). **H / M**
- [ ] Term structure (ATM IV by DTE), contango/backwardation badge, forward vol. **H / M**
- [ ] IV vs HV (C2C, Parkinson, Yang-Zhang), volatility cone, VRP gauge. **M / S**
- [ ] Expected move: IV-based and straddle-based per expiry; cones on StockChart; hit rate. **H / S**
- [ ] Surface heatmap (strike or delta × expiry). **M / M**

### 2D. GEX and dealer positioning (SpotGamma)
- [ ] Real gamma flip (zero crossing of total GEX over a hypothetical spot grid); GEX profile chart. **H / M**
- [ ] Call Wall, Put Wall, Absolute Gamma strike, Vol Trigger; all expiries vs 0DTE. **H / S**
- [ ] DEX, VEX, CEX per strike; a sign-convention toggle ("net option-seller gamma" for India) with an explainer. **M / M**
- [ ] Strike × expiry heatmap (OI, ΔOI, GEX, DEX). **H / M**

### 2E. OI, max pain and PCR
- [ ] Expiry selector on OI Analysis; trim from 4 polls to 1; relative thresholds instead of absolute units. **H / M**
- [ ] Max pain payout curve, a table across expiries, distance in points, % and EM multiples, and drift over time. **M / S**
- [ ] PCR suite: OI, volume, change-in-OI and premium PCR; one consistent `pcrSignal`; intraday and 60-day history with percentile. **M / S**
- [ ] Intraday OI replay with a time slider and T1-vs-T2 diff (built on snapshots). **H / M**
- [ ] Writer delta exposure (renamed and sign-corrected); real ±N ATM zone. **L / S**

### 2F. Flow and unusual activity (Unusual Whales / Barchart, NSE-adapted)
- [ ] **Derived interval flow tape** from snapshot deltas: premium = dVol × LTP × lot, aggressor from bid/ask position, opening or closing from dOI. Clearly labelled "derived". **H / L**
- [ ] Net premium and **Premium Tide** charts (CE vs PE signed premium, with spot overlay). **H / M**
- [ ] Unusual activity scanner (Vol/OI ≥ 1.25, volume vs 5-day average, premium threshold) with presets. **H / L**
- [ ] Rule-based alerts (repeated hits, big opening print, OI wall shift, PCR cross, IV spike, spot crossing max pain or the flip) via toast, Notification API and sound; export/import rules. **H / M**
- [ ] Hottest chains and top-premium contracts leaderboard. **M / S**

### 2G. India-native data
- [ ] **FII/DII/Pro/Client participant OI** dashboard (index futures long %, call/put positioning, Client-vs-FII mirror, 30-90-day history). **H / M**
- [ ] F&O stock screener: buildup quadrant, ATM IVP, PCR, MWPL %, ban list, near-ban alert at 80% or above. **H / M**
- [ ] Futures and basis: rollover %, cost of carry, basis. **M / S**
- [ ] Big Money feed: bulk and block deals, plus stock-futures OI jumps above 10% (no fake dark-pool labels). **M / S**

### 2H. Expiry-day tools
- [ ] **Expiry Day** page: live ATM straddle with intraday decay chart vs opening, multi-straddle and strangle charts, hero-zero list, theta per minute, OI walls and max-pain drift, countdown to 15:30, settlement-window note, STT-on-exercise warning. **H / M**
- [ ] Combined "this week's weeklies" widget: NIFTY Tuesday vs SENSEX Thursday side by side. **M / S**

### 2I. Calculators
- [ ] Charges calculator (per-leg breakdown, broker presets), SPAN-style margin calculator, position-size calculator (risk % of capital to lots), lot-size and expiry lookup, options fair-value and Greeks calculator, IV calculator. **H / M**

### 2J. Positions and paper trading
- [ ] Live-recomputed portfolio Greeks, beta-weighted NIFTY delta in lots, scenario grid, margin used, net-of-charges MTM. **H / M**
- [ ] **Paper trading** with an order book (market/limit at mid ± slippage), SL/target, automatic settlement at expiry with exercise STT, P&L calendar. **H / M**
- [ ] Management hints (50% profit, roll the untested side, delta-hedge in futures lots), expiry gamma-risk warning. **M / M**
- [ ] Data model: ISO expiry picker, zod-validated import, strategy grouping. **M / M**

### 2K. Dashboard and UX
- [ ] IST market session, correct expiry countdown per underlying, per-widget loading/error/stale states, no full-page skeleton. **H / M**
- [ ] Remove duplicate status indicators; merge ticker into IndexCards; dismissible one-line welcome; density toggle. **M / M**
- [ ] Gamma Levels card, Premium Tide card, FII long % card, VRP gauge (data from feature streams). **H / M**
- [ ] Watchlist: sortable columns, symbol validation, mobile card list, multiple watchlists, ban badges. **M / M**
- [ ] Accessibility: keyboard-reachable cards, aria-labels, skip link, reduced motion, contrast. **H / M**
- [ ] Route registry driving sidebar, palette, shortcuts, titles and sitemap; new grouped IA (Overview · Chain & OI · Volatility · Positioning · Strategy · Portfolio · Learn · Settings). **H / M** (integrator)

### 2L. Education
- [ ] **Learn hub, branded NISMExams.com**: Options 101 path, interactive mini-sims (drag IV to see the straddle price move, payoff builder), glossary, a "why it matters" card for every metric with a live NIFTY example, links to NISM certification prep. **M / M**
- [ ] Shared `<MetricHelp metric="ivr" />` hover card used across the app; a SEBI risk banner on Strategy Builder. **M / S**

---

## 5. Phase 3: Differentiators (what no single competitor offers)

- [ ] **End-of-day backtester on NSE bhavcopy**, cached in IndexedDB: delta-targeted entries, profit-take and stop, net of real charges, lot-size history correct by date, results by VIX regime and weekday. **H / L**
- [ ] **HIRO-style hedging-pressure estimate** from snapshot deltas (₹ crore dealer hedge flow vs NIFTY), split into calls, puts and 0DTE. **H / L**
- [ ] **Event-aware calendar**: RBI MPC, Budget, results, FOMC/CPI on expiry pickers, payoff date slider and IV charts; implied vs realized event move history and the "straddle overpriced X% of the time" statistic. **H / L**
- [ ] **Trade journal and edge analytics net of costs**: import Zerodha/Dhan/Upstox tradebooks; charges as % of gross; expectancy by DTE, IVP bucket and time of day; ITR-ready turnover CSV. **M / M**
- [ ] **SEBI-style guardrails**: beginner mode (naked shorts hidden), max loss in ₹ and % of capital before any trade, daily loss cap and kill switch for basket orders. **M / M**
- [ ] **Basket execution via broker APIs** (Dhan first): hedge legs first, freeze-quantity slicing, margin check, charge preview; OAuth flows only, with WebCrypto-encrypted tokens. **H / L**
- [ ] **Modular workspaces** (Super-Flow style): widget grid, colour-linked symbol groups, Scalper/Writer/Swing presets, JSON share. **M / L**
- [ ] **Contract lookup page** `/contract/:symbol/:expiry/:strike/:type`: intraday LTP/IV/OI/volume, bhavcopy history, greeks, depth. **M / M**
- [ ] **True burst detection** via an opt-in Dhan tick feed (LTQ/LTT, aggressor classification). **M / L**
- [ ] **Server-side snapshot recorder** in the proxy (NDJSON/SQLite) so history survives tab closes; export as CSV. **H / L**
- [ ] **Installable PWA** with an offline last-snapshot shell and background notifications. **M / M**
- [ ] **Colour-blind palette**, a compact/comfortable density setting, and BSE multi-exchange parity. **M / S**

---

## 6. Execution model

Work runs in parallel streams with **strict file ownership**. `src/App.tsx`, `src/components/AppSidebar.tsx` and `src/components/CommandPalette.tsx` belong to the integrator, who wires each stream's reported route, page file and nav label/group. All math goes through `src/lib/options/`; the signatures are published up front so streams can code against them before the core lands. Every stream falls back to labelled sample data when live data is unavailable.

Quality gates for every merge: `npm run typecheck && npm run lint -- --max-warnings 0 && npm test && npm run build`.

---

## 7. Sources (selection)
OptionStrat features and optimizer · SpotGamma Call/Put Wall support docs · Unusual Whales Super Flow and flow-alert docs · Market Chameleon implied moves and IV movers · Barchart max pain and UOA · OptionCharts docs · NSE/Kotak/Fyers/Sahi lot-size bulletins (Dec 2025) · Navia/Zerodha/share.market STT and charge notes · Dhan v2 live-feed and option-chain docs · mrchartist.com stylesheet (mc.css). Rates, lot sizes and endpoints marked *verify* must be checked against current NSE/SEBI circulars before release.
