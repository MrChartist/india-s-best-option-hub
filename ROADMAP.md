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
- [x] **Pure, tested pricing core**: normal CDF/PDF/inverse, Black-Scholes and Black-76, full Greeks (Δ Γ Θ ν ρ plus vanna, charm, vomma). Remove the three duplicate BS copies (mockData, PayoffMultiDTE, WhatIfSimulator). **H / M**
- [x] **IV solver**: Newton on vega with a Brent fallback, seeded by Corrado-Miller; returns NaN below intrinsic. **H / M**
- [x] **Time and expiry engine**: IST clock, NSE/BSE holidays, NIFTY weekly Tuesday, SENSEX weekly Thursday, other indices monthly only, shift to the previous trading day on holidays, T measured in minutes to 15:30 IST, market session (pre-open, open, closed, holiday). **H / M**
- [x] **Instrument registry**: 2026 lot sizes (NIFTY 65, BANKNIFTY 30, FINNIFTY 60, MIDCPNIFTY 120, SENSEX 20, all marked *verify*), strike steps, freeze quantities, effective-from dates; lot size is per contract, so old contracts keep their old lot. **H / S**
- [x] **Payoff engine**: exact piecewise-linear breakevens, detection of unlimited profit or loss, T+x valuation, P&L matrix. **H / M**
- [x] **Probability**: lognormal POP (fixes the uniform-z bug: a short straddle shows 17% when it should be about 38%), P(ITM), P(touch), P(between), EV, Monte-Carlo P50. **H / S**
- [x] **Expected move**: IV-based (log-space 1σ/2σ) and straddle-based (0.85 × straddle). **H / S**
- [x] **Charges**: dated rate table. STT on option sell is 0.15% from 1 April 2026 (0.1% before); exercise STT on intrinsic value; NSE/BSE transaction charges; SEBI fee; stamp duty; GST; broker presets. **H / M**
- [x] **Margin estimate**: SPAN-style 16 scenarios, plus exposure margin, plus 2% ELM on expiry day, with hedge benefit; defined-risk positions use max loss. Labelled "estimate". **H / M**
- [x] **Volatility helpers**: close-to-close, Parkinson and Yang-Zhang HV; IVR and IVP; forward vol; constant-maturity interpolation; RR25/BF25. **H / S**
- [x] **Chain enrichment**: fill missing IV and Greeks for NSE legs (NSE sends 0); modal strike step; true ATM; implied forward from put-call parity; leg IV that ignores zero IVs. **H / S**
- [x] **Indian number formatting**: ₹, lakh/crore, compact K/L/Cr, signed %, IST time. Replaces about 120 ad-hoc formatters. **M / S**
- [x] **Sample chain generator**, BS-consistent with a skew, for clearly labelled demo mode. **M / S**
- [x] vitest suite: Hull reference values, parity, Greeks vs finite differences, IV round-trip, POP, charges vs a broker calculator; coverage at least 90% on `src/lib/options/**`. **H / M**

### 1B. Theme migration
- [x] Token swap in `index.css` (primitives, light, dark, washes, chart, sentiment, shadows, motion). **H / S**
- [x] `tailwind.config.ts`: colours, type scale (micro/label/body/lead/title/display/num-hero), radius, shadows, easing; delete neon tokens. **H / S**
- [x] `index.html`: Google Fonts via preconnect, orange favicon, theme-color per scheme, system-scheme script inside try/catch, plain meta copy. **M / S**
- [x] shadcn primitives: button (buy/sell variants), card, badge (bullish/bearish/info/warning chips), tabs, input/select, popover, dialog (panel radius), sonner, table. **H / S**
- [x] DashboardLayout glass header with capsule ticker, one status pill (session plus data feed), IST clock; StatusFooter laid out in normal flow (no longer covers the sidebar) with a compliance line. **H / S**
- [x] `src/lib/chartTheme.ts`: Recharts palette tokens, tooltip styles, payoff fills. **H / S**
- [x] Sidebar restyle (paper/void, orange active pill, remove teal rail) is done by the **integrator** in `AppSidebar.tsx`. **H / M**

### 1C. Critical bug fixes (P0)
- [x] Remove the **leaked prompt-injection text** in WelcomeBanner and the Index "Live Indices" subtitle; add a CI grep guard. **H / S**
- [x] Proxy hides Dhan failures as an empty "success", so the NSE fallback never runs and users without keys see no chain. **H / S**
- [x] Dhan WebSocket parser: prices are float32 (code reads int32/100), and the Full-packet offsets are wrong. **H / M**
- [x] Dhan expiry list uses `UnderlyingSeg` NSE_FNO; it should be IDX_I. **H / S**
- [x] Stale lot sizes everywhere (NIFTY 25, so figures are 2-3x off); a fallback of 500 for unknown symbols. **H / S**
- [x] NSE Greeks are hardcoded to 0, which breaks Delta, Delta-OI and GEX. Compute them client-side. **H / M**
- [x] OI and OI-change columns never render on the Option Chain (OIBar is dead code). **H / S**
- [x] OI buildup checks `ltp > 0` instead of price change; add `change`/`pChange`/`prevClose` to the leg type. **H / M**
- [x] Combined gamma and vega use `Math.abs(qty)`, so a short straddle shows as long gamma. **H / S**
- [x] Max profit/loss never shows "unlimited"; breakevens snap to a 25-point grid. **H / S**
- [x] `updateLeg` mutates preset objects in place. **M / S**
- [x] Fake IV Rank/IVP (seededRandom) and an expected move driven by VIX × fudge factors. Replace with real values or show "insufficient history". **H / M**
- [x] Clocks labelled IST show browser time; the expiry countdown assumes Thursday; BANKNIFTY is labelled weekly. **H / M**
- [x] Command Palette and Ctrl+4/5 point to `/greeks` and `/strategy`, which do not exist. **H / S** (integrator plus route registry)
- [x] Proxy security: CORS `*`, binds 0.0.0.0, no WebSocket Origin check, while holding the Dhan token. **H / S**
- [x] Broker passwords, MPINs and TOTP secrets in plain-text localStorage, with a misleading "secure" notice. **H / M**
- [x] CI `tsc --noEmit` checks 0 files; turn on `strict` (already 0 errors). **H / S**
- [x] Dockerfile copies `.env` into the image, deletes the lockfile and runs as root on EOL Node 18. **M / S**

### 1D. Data layer hardening
- [x] Response envelope `{data, meta:{source, asOf, stale, reason}}`, plus a global DataFreshness badge. **H / M**
- [x] Request coalescing, a per-upstream token bucket (Dhan OC 1 per 3 s), an LRU cache, upstream timeouts, honouring Retry-After. **H / M**
- [x] NSE session: `getSetCookie()`, a shared session promise, warm-up, option-chain-v3 with legacy fallback, expiry normalised to ISO. **M / S**
- [x] Fix last-good cache rehydration keys; keep last-good until the next session; atomic writes. **M / S**
- [x] New proxy endpoints: lot sizes, holidays, participant OI and volume, FII stats, ban list, MWPL, VIX history, OI spurts, most-active contracts, F&O bhavcopy, event calendar, bulk and block deals, multi-expiry chain. **H / L**
- [x] **Snapshot recorder** (`src/lib/snapshotStore.ts`, IndexedDB `chainSnapshots` plus `dailyStats`). It is the foundation for flow, replay, IV history and PCR history. **H / M**
- [x] Charts send browser-stored Dhan keys; the security-ID map is generated from the scrip master; WebSocket ticks are keyed by `segment:id`. **M / S**

---

## 4. Phase 2: Feature parity (Sensibull · OptionStrat · Unusual Whales · SpotGamma · ORATS, adapted for NSE)

### 2A. Option chain (parity with Sensibull/Kite)
- [x] Column presets (Basic, Greeks, Liquidity) with persistence; a single column-definition array that drives header, body and footer. **M / M**
- [x] OI/OI-change in-cell bars; ITM shading; ATM brand wash; a spot/futures divider row; highest-OI and highest-volume badges. **H / S**
- [x] Buildup tags LB/SB/SC/LU per strike; PCR, Max Pain, ATM IV, synthetic future, straddle % and breakevens in the header. **H / S**
- [x] Strike range ±10/15/20/30/All; memoised rows; one shared context menu. **H / M**
- [x] Hover B/S buttons that add legs to a basket drawer, then "Open in Strategy Builder" with real expiry and mid price. **H / M**
- [x] Prob ITM / Prob Touch columns; a delta view with the 16Δ/30Δ rows highlighted; liquidity score 1-5; spread %. **M / S**
- [x] Gamma-level badges (CW, PW, AG, FLIP) on rows; SENSEX/BANKEX; working keyboard shortcuts; per-strike alerts. **M / M**
- [x] Multi-expiry By-Strike view built from real per-expiry fetches (the current one is fabricated). **H / M**

### 2B. Strategy Builder (parity with OptionStrat/Sensibull)
- [x] Symbol and per-leg expiry selectors; legs priced from the live chain (mid/LTP/natural). **H / L**
- [x] One chart with a target-date slider, IV-shift slider, 1σ/2σ bands and a lognormal POP shading. **H / M**
- [x] **P&L heat table** (spot × date) with ₹ / % toggle and CSV export. **H / M**
- [x] Per-leg Greeks table, net Greeks (signed), stats panel with POP, P50, EV, max P/L (∞ aware), R:R, margin with hedge benefit, charges, and **breakevens after costs**. **H / M**
- [x] About 40 templates grouped by view, strikes defined by delta or expected move; calendars, diagonals and futures legs. **H / M**
- [x] Save/share via `?s=` base64 URL; PNG export; "Add to Positions"; hotkeys. **M / M**
- [x] **Optimizer** (OptionStrat-style): target price and date, budget, a return-vs-chance slider, ranked cards, run in a Web Worker. **H / L**

### 2C. Volatility analytics (ORATS / Market Chameleon)
- [x] Real IVR/IVP from VIX history, snapshots and a bhavcopy backfill; "insufficient history" state. **H / M**
- [x] OTM-composite smile per expiry with RR25/BF25 and overlays (1 h ago, yesterday). **H / M**
- [x] Term structure (ATM IV by DTE), contango/backwardation badge, forward vol. **H / M**
- [x] IV vs HV (C2C, Parkinson, Yang-Zhang), volatility cone, VRP gauge. **M / S**
- [ ] Expected move: IV-based and straddle-based per expiry; cones on StockChart; hit rate. **H / S** (per-expiry table shipped; cones and one consistent EM across pages are in Round 2 R2-04/R2-06)
- [x] Surface heatmap (strike or delta × expiry). **M / M**

### 2D. GEX and dealer positioning (SpotGamma)
- [x] Real gamma flip (zero crossing of total GEX over a hypothetical spot grid); GEX profile chart. **H / M**
- [x] Call Wall, Put Wall, Absolute Gamma strike, Vol Trigger; all expiries vs 0DTE. **H / S**
- [x] DEX, VEX, CEX per strike; a sign-convention toggle ("net option-seller gamma" for India) with an explainer. **M / M**
- [x] Strike × expiry heatmap (OI, ΔOI, GEX, DEX). **H / M**

### 2E. OI, max pain and PCR
- [x] Expiry selector on OI Analysis; trim from 4 polls to 1; relative thresholds instead of absolute units. **H / M**
- [x] Max pain payout curve, a table across expiries, distance in points, % and EM multiples, and drift over time. **M / S**
- [x] PCR suite: OI, volume, change-in-OI and premium PCR; one consistent `pcrSignal`; intraday and 60-day history with percentile. **M / S**
- [x] Intraday OI replay with a time slider and T1-vs-T2 diff (built on snapshots). **H / M**
- [x] Writer delta exposure (renamed and sign-corrected); real ±N ATM zone. **L / S**

### 2F. Flow and unusual activity (Unusual Whales / Barchart, NSE-adapted)
- [x] **Derived interval flow tape** from snapshot deltas: premium = dVol × LTP × lot, aggressor from bid/ask position, opening or closing from dOI. Clearly labelled "derived". **H / L**
- [x] Net premium and **Premium Tide** charts (CE vs PE signed premium, with spot overlay). **H / M**
- [x] Unusual activity scanner (Vol/OI ≥ 1.25, volume vs 5-day average, premium threshold) with presets. **H / L**
- [x] Rule-based alerts (repeated hits, big opening print, OI wall shift, PCR cross, IV spike, spot crossing max pain or the flip) via toast, Notification API and sound; export/import rules. **H / M**
- [x] Hottest chains and top-premium contracts leaderboard. **M / S**

### 2G. India-native data
- [x] **FII/DII/Pro/Client participant OI** dashboard (index futures long %, call/put positioning, Client-vs-FII mirror, 30-90-day history). **H / M**
- [x] F&O stock screener: buildup quadrant, ATM IVP, PCR, MWPL %, ban list, near-ban alert at 80% or above. **H / M**
- [x] Futures and basis: rollover %, cost of carry, basis. **M / S**
- [x] Big Money feed: bulk and block deals, plus stock-futures OI jumps above 10% (no fake dark-pool labels). **M / S**

### 2H. Expiry-day tools
- [x] **Expiry Day** page: live ATM straddle with intraday decay chart vs opening, multi-straddle and strangle charts, hero-zero list, theta per minute, OI walls and max-pain drift, countdown to 15:30, settlement-window note, STT-on-exercise warning. **H / M**
- [x] Combined "this week's weeklies" widget: NIFTY Tuesday vs SENSEX Thursday side by side. **M / S**

### 2I. Calculators
- [x] Charges calculator (per-leg breakdown, broker presets), SPAN-style margin calculator, position-size calculator (risk % of capital to lots), lot-size and expiry lookup, options fair-value and Greeks calculator, IV calculator. **H / M**

### 2J. Positions and paper trading
- [x] Live-recomputed portfolio Greeks, beta-weighted NIFTY delta in lots, scenario grid, margin used, net-of-charges MTM. **H / M**
- [x] **Paper trading** with an order book (market/limit at mid ± slippage), SL/target, automatic settlement at expiry with exercise STT, P&L calendar. **H / M**
- [x] Management hints (50% profit, roll the untested side, delta-hedge in futures lots), expiry gamma-risk warning. **M / M**
- [x] Data model: ISO expiry picker, zod-validated import, strategy grouping. **M / M**

### 2K. Dashboard and UX
- [x] IST market session, correct expiry countdown per underlying, per-widget loading/error/stale states, no full-page skeleton. **H / M**
- [x] Remove duplicate status indicators; merge ticker into IndexCards; dismissible one-line welcome; density toggle. **M / M**
- [x] Gamma Levels card, Premium Tide card, FII long % card, VRP gauge (data from feature streams). **H / M**
- [x] Watchlist: sortable columns, symbol validation, mobile card list, multiple watchlists, ban badges. **M / M**
- [ ] Accessibility: keyboard-reachable cards, aria-labels, skip link, reduced motion, contrast. **H / M** (partly shipped; axe found contrast, slider-name, tabs and heading-order issues, fixed in Round 2 R2-01)
- [x] Route registry driving sidebar, palette, shortcuts, titles and sitemap; new grouped IA (Overview · Chain & OI · Volatility · Positioning · Strategy · Portfolio · Learn · Settings). **H / M** (integrator)

### 2L. Education
- [x] **Learn hub, branded NISMExams.com**: Options 101 path, interactive mini-sims (drag IV to see the straddle price move, payoff builder), glossary, a "why it matters" card for every metric with a live NIFTY example, links to NISM certification prep. **M / M**
- [ ] Shared `<MetricHelp metric="ivr" />` hover card used across the app; a SEBI risk banner on Strategy Builder. **M / S** (component and banner shipped; only Learn uses MetricHelp so far, and Round 2 page streams add it to KPI labels)

---

## 5. Phase 3: Differentiators (what no single competitor offers)

- [x] **End-of-day backtester on NSE bhavcopy**, cached in IndexedDB: delta-targeted entries, profit-take and stop, net of real charges, lot-size history correct by date, results by VIX regime and weekday. **H / L** (shipped in R2-13 at `/backtest`; intraday per-leg rules are R3-14)
- [x] **HIRO-style hedging-pressure estimate** from snapshot deltas (₹ crore dealer hedge flow vs NIFTY), split into calls, puts and 0DTE. **H / L** (shipped in R2-09 as the Flow hedging-pressure card)
- [ ] **Event-aware calendar**: RBI MPC, Budget, results, FOMC/CPI on expiry pickers, payoff date slider and IV charts; implied vs realized event move history and the "straddle overpriced X% of the time" statistic. **H / L**
- [x] **Trade journal and edge analytics net of costs**: import Zerodha/Dhan/Upstox tradebooks; charges as % of gross; expectancy by DTE, IVP bucket and time of day; ITR-ready turnover CSV. **M / M** (shipped in R2-12 at `/journal`, with Angel One import too; expectancy by IVP bucket still to come)
- [x] **SEBI-style guardrails**: beginner mode (naked shorts hidden), max loss in ₹ and % of capital before any trade, daily loss cap and kill switch for basket orders. **M / M** (shipped in R2-12 on Paper Trading)
- [ ] **Basket execution via broker APIs** (Dhan first): hedge legs first, freeze-quantity slicing, margin check, charge preview; OAuth flows only, with WebCrypto-encrypted tokens. **H / L**
- [ ] **Modular workspaces** (Super-Flow style): widget grid, colour-linked symbol groups, Scalper/Writer/Swing presets, JSON share. **M / L**
- [x] **Contract lookup page** `/contract/:symbol/:expiry/:strike/:type`: intraday LTP/IV/OI/volume, bhavcopy history, greeks, depth. **M / M** (shipped in R2-03)
- [ ] **True burst detection** via an opt-in Dhan tick feed (LTQ/LTT, aggressor classification). **M / L**
- [x] **Server-side snapshot recorder** in the proxy (NDJSON/SQLite) so history survives tab closes; export as CSV. **H / L** (shipped in R2-03 as the opt-in NDJSON recorder with a hydrate endpoint)
- [ ] **Installable PWA** with an offline last-snapshot shell and background notifications. **M / M**
- [ ] **Colour-blind palette**, a compact/comfortable density setting, and BSE multi-exchange parity. **M / S**

---

## 6. Round 2 (shipped)

Round 1 shipped Phases 1 and 2. Round 2 acts on four critiques (feature gaps, design, trader workflow, tech/a11y/perf). It runs as 16 parallel streams with strict file ownership. The integrator alone owns `src/App.tsx`, `src/components/AppSidebar.tsx`, `src/components/CommandPalette.tsx`, `src/lib/routes.ts`, `src/lib/routeIcons.ts` and `package.json`. It wires the new routes, mounts `PaletteToggle`, sets the QueryClient defaults (`retry:1, refetchOnWindowFocus:false, staleTime:15s`), removes the Radix `<Toaster/>`, wraps NotFound in the layout and installs any listed dependencies.

Contracts streams can rely on: `PageHeader`, `BuildupBadge`, `ScrollRegion`, the `--wash-itm` token and `compactAxisTick` (R2-01); the `/contract/:symbol/:expiry/:strike/:type` URL shape (R2-03); `/paper-trading?legs=${encodeLegs(legs)}` and `/strategy-builder?legs=…&mode=append` (R2-04/R2-05); expected move always shown with a method tag, either "IV 1σ" or "Straddle ×0.85" (R2-06); a global SampleBanner driven by the proxy gate, so pages drop duplicate sample banners (R2-02).

| # | Stream | Headline deliverables | New route |
|---|---|---|---|
| R2-01 | Design system and accessibility | `th[scope=row]` fix, heading word-spacing, `--wash-itm` and dark warning tokens, contrast tokens, CVD palette, `PageHeader`/`BuildupBadge`/`ScrollRegion`, slider, tabs, CardTitle a11y, compact Recharts axis ticks, axe CI spec, Learn and Calculators polish | – |
| R2-02 | App shell, network, performance, PWA, SEO | Shared proxy gate with backoff, WebSocket gating, function-form `manualChunks` (charts off first paint), lazy CommandPalette, single toast system, global SampleBanner, useMarketData policy and tests, coverage ratchet, vite-plugin-pwa, sitemap from ROUTES, `usePageMeta` | – |
| R2-03 | History store, server recorder, Contract page | Columnar snapshots, quota and persist handling, opt-in proxy NDJSON recorder plus hydrate endpoint, fake-indexeddb tests, contract detail page (LTP/OI/IV/greeks over time) | `/contract/:symbol/:expiry/:strike/:type` |
| R2-04 | Option chain | Mobile compact chain, neutral ITM wash, 6-tile summary, fixed row height, B/S column, legend, basket replace/append, group by symbol and paper-trade button, stable rows, StockChart overlays (max pain, walls, flip, EM cones), MetricHelp, contract links | – |
| R2-05 | Strategy Builder and sharing | Basket replaces the draft (with undo), no auto-saved template, mobile overflow fix with payoff first, split-fill payoff, Paper trade CTA, sample-tagged Add to Positions, margin breakdown, frozen-price shared view, copy as image, tests | – |
| R2-06 | Optimizer and options math core | Funds-required margin, varied per-symbol sample chain (max pain off spot, PCR spread, stock IVs), `expectedMoves()` helper, `ordinal()`, outline CTAs, table view, neutral-view tagging, keyboard target slider, Paper trade | – |
| R2-07 | OI Analysis and Max Pain/PCR | Multi-strike OI over time, cumulative CE vs PE OI change with spot, ATM±N range chart, label and axis fixes, no row-level SAMPLE chips, trade-this-view handoffs | – |
| R2-08 | Expiry Day and Straddles | Sample session anchored to the chain, one KPI row, decay-chart domain, new any-day straddle/strangle page with premium VWAP and multi-day history | `/straddles` |
| R2-09 | GEX and Flow | One convention everywhere, honest seller-view regime, GEX levels over time, HIRO-style hedging-pressure estimate, unit-consistent heatmap, realistic sample tape, Premium Tide legend and labels | – |
| R2-10 | Volatility and India VIX | Labelled 1-year sample IV/HV, Smile as the default tab when there is no history, IVR label and NIFTY fallback, VIX analytics tab, richer surface, Compare symbols tab | – |
| R2-11 | Dashboard and Watchlist | Sample fallbacks for indices, movers and breadth, collapsed "needs live data" strip, merged IV-rank card, PCR banding, daily market brief, onboarding tour, named workspaces and presets, Watchlist sample quotes | – |
| R2-12 | Portfolio and Journal | Gamma P&L for a 1% move, sample-sourced positions, paper account in Positions, basket confirmation with margin and charges, guardrails (max loss, daily cap, kill switch), refreshed stock spots, trade journal with tradebook import and ITR turnover CSV | `/journal` |
| R2-13 | Backtester | EOD Web-Worker engine on bhavcopy plus a labelled sample dataset: templates, DTE/weekday/delta entries, profit/SL/time exits, net of charges, date-correct lots, VIX-regime and weekday splits, CSV | `/backtest` |
| R2-14 | Alerts Centre | One rule model across header, strike and flow alerts; trigger log with context; channels; import/export; lazy alert sheet; zod removed from rules | `/alerts` |
| R2-15 | Events calendar | RBI/Budget/CPI/FOMC/holidays/results with symbol filters, a `useEvents` hook and `EventMarker` for later wiring, results implied vs realised move statistic | `/events` |
| R2-16 | Screener, Futures, Participants, Broker | Screener row actions and suggested structures, near-ban count fix, BuildupBadge; Futures and rollover page; participant hatch bars, ordinal fix, tiles and history depth; Broker layout | `/futures` |

---

## 7. Round 3 (in progress)

Round 3 acts on four new critiques: feature gaps against Sensibull, Opstra, Quantsapp, OptionStrat, Unusual Whales, SpotGamma, Stockmock and Market Chameleon; design; trader workflow and consistency; and tech, performance, SEO and accessibility. It runs as 16 parallel streams with strict file ownership. As before, the integrator alone owns `src/App.tsx`, `src/components/AppSidebar.tsx`, `src/components/CommandPalette.tsx`, `src/lib/routes.ts`, `src/lib/routeIcons.ts` and `package.json`. In this round the integrator also: mounts `SymbolProvider` and wraps each route in `RouteMeta`; adds `usesMarketData` and `seoDescription` to `RouteDef`; keeps the "New" badge on 3 routes only and renders it as a dot; renames the nav label to "Learn"; adds `aria-hidden` to the sidebar `<kbd>` and badge, plus `aria-keyshortcuts`; wires the omnibox from `commandPaletteSearch.ts` into the palette; registers `/stock/:symbol`, `/scanner` and any other new routes; and installs listed dependencies.

Contracts streams can rely on:
- `useActiveSymbol()` from `src/lib/symbolContext`, which returns `{symbol, setSymbol, expiry, setExpiry}`. It is synced to `?symbol=&expiry=`, remembered for the session, and works without the provider (R3-01).
- `PageContainer` (with a `wide` variant), `PageHeader` with a 2-line clamp, `Tabs` variants `page`/`inline`, `useReducedMotion()`, and a dark `--wash-brand` with low chroma (R3-01).
- `formatAxisIndian(domainMax)` and `formatIndianColumn(values)` from `src/lib/options/format`; IV returns `null` at the minimum tick; `getReferencePrice(symbol)` in `instruments.ts`; `generateSampleChain({ atmIv, strikes, asOf })`; one seeded sample index path (R3-04).
- `oiWalls(chain)` from `oiUtils.ts`, which returns the max OI per side plus the nearest level above or below spot, each labelled (R3-08). "Gamma call wall" is the GEX term (R3-09).
- `/stock/:symbol` URL shape (R3-11); `/strategy-builder?template=<id>&symbol=` and `?mode=adjust&base=<encodedLegs>` (R3-05); `ExecuteWithBroker` at `src/components/broker/ExecuteWithBroker.tsx` (R3-07).
- The existing `useEvents` and `EventMarker` APIs stay unchanged, so the chain, builder, volatility and stock pages can use them in parallel.

| # | Stream | Headline deliverables | New route |
|---|---|---|---|
| R3-01 | Shell, design system and global symbol context | `SymbolProvider`/`useActiveSymbol`, header symbol and expiry switcher, omnibox parser, dark brand wash fix, SampleBanner only on market-data routes and fixed live region, one sample chip per page, `PageContainer`, PageHeader clamp, two tab variants, reduced motion, charts with no animation on refetch | – |
| R3-02 | Performance, SEO, PWA and accessibility CI | Leaf imports out of the entry chunk, Radix shell allowlist, icons chunk, AlertSystem mounted only when needed, per-route meta and static prerender (Learn included), self-hosted fonts, slim SW precache, manifest shortcuts, bundle-size budget, a11y states sweep, Learn "Try it in the terminal" links | – |
| R3-03 | Options math core and sample consistency | Axis/column unit formatter, null IV at minimum tick, per-symbol reference prices, sample chain IV/strikes/asOf inputs, one time basis for IV and EM, one seeded index path for all sample sessions | – |
| R3-04 | Option chain | Lazy by-strike view, row virtualisation, focus state in the table and grid a11y, chain within 150px of the top, neutral group headers, B/S on every row with the expiry in the label, ranked volume spikes, mobile compact preset, EM probabilities, event markers on expiries, basket kept until the paper fill | – |
| R3-05 | Strategy Builder | Greeks-vs-spot/time charts, compare 2–4 strategies, `?template=`, event IV-crush scenario and events on the date slider, dense leg table, mobile order and sticky summary, tidy metrics grid, ±3σ default range, adjust mode with ghost curves | – |
| R3-06 | Positions and Paper Trading | Hedge-exit guard in beginner mode, persisted staged basket, exit-strategy groups, intraday MTM/greeks timeline, adjust and hedge suggester, one margin basis, link to paper analytics, defined-risk prefill, paper history archived to IndexedDB | – |
| R3-07 | Broker execution and server-side alerts | Dhan basket execution (hedges first, freeze slicing, margin pre-check, charge preview), order-book and position sync, WebCrypto tokens, Telegram channel, rule evaluation in the proxy, PWA push | – |
| R3-08 | OI Analysis and Max Pain/PCR | One OI-wall definition, ranked levels with strength bars, OI tile labels by sign, colour by meaning, spread CTA with risk, OI heatmap in dark mode, wash fixes | – |
| R3-09 | GEX and Flow | Call wall labels relative to spot, headline led by flip, padded domain, trade-this links, historical flow search, saved searches, daily net-premium bars, returns after large prints, flow store ring buffer | – |
| R3-10 | Volatility, expected-move hit rate, seasonality | 3D IV surface, RR25/BF25 skew history with percentiles, events on the term structure, EM hit rate by VIX regime and event weeks, seasonality tab, heading order, trade-this links | – |
| R3-11 | Stock overview, Watchlist, Contract, Events | `/stock/:symbol` profile for about 200 F&O names, events on candles, Watchlist polish and tests, Contract error states, flat event chips | `/stock/:symbol` |
| R3-12 | Optimizer and strategy scanner | Cross-symbol scanner on the optimizer worker, results table fit, labelled actions, expiries for calendars, honest "matches your view" and estimated max loss | `/scanner` |
| R3-13 | Screener, Futures, Participants | Screener IV matches the chain, builder link carries the suggestion, lazy quadrant, universe buildup heatmap, rollover vs 3-series average, calendar spread, BSE parity, gauge and chart a11y | – |
| R3-14 | Intraday backtester | 1-minute entries at a set time, per-leg SL/target/trailing, re-entry, SL to cost, premium-based strikes, 15:15 square-off, custom legs, parameter-sweep heatmap, expectancy by IVP | – |
| R3-15 | Dashboard and modular workspaces | 390px overflow fix, shorter dashboard, sparkline caption, lazy below-the-fold widgets, resizable widget grid with colour-linked symbol groups, brief walls from `oiWalls` | – |
| R3-16 | Expiry Day, Straddles, Journal | Sticky section tabs, weekend next-session card, one IV/EM time basis, spot axis ticks, scatter a11y, journal IVP buckets, tags, mistakes, R-multiples, per-strategy breakdown, chain replay link, store cap | – |

### Round 4 backlog (deferred)
- True burst detection on an opt-in Dhan/Upstox tick feed (needs a WebSocket in the proxy).
- Hindi and regional languages (react-i18next), a mobile bottom tab bar and quick chain + payoff view.
- Strategy sharing gallery, OG share cards, short links and embeddable widgets.
- Upgrade to Recharts 3, or hand-written SVG for the small charts.

### Round 3 backlog (deferred in Round 2, now planned above)
- Broker basket execution (Dhan) and live position sync, after the proxy recorder lands.
- Global `?symbol=&expiry=` URL state plus an omnibox in CommandPalette (integrator-owned).
- Event markers on expiry pickers, the payoff date slider and the IV term structure (consumes R2-15).
- Historical flow search and per-symbol flow summary (needs the R2-03 recorder).
- Stock overview pages for about 200 F&O names; IV surface 3D mesh; embeddable widgets and prerendered Learn pages.
- Drag-resize widget grid with colour-linked symbol groups.

---

## 8. Execution model

Work runs in parallel streams with **strict file ownership**. `src/App.tsx`, `src/components/AppSidebar.tsx`, `src/components/CommandPalette.tsx`, `src/lib/routes.ts`, `src/lib/routeIcons.ts` and `package.json` belong to the integrator, who wires each stream's reported route, page file and nav label/group. All math goes through `src/lib/options/`; the signatures are published up front so streams can code against them before the core lands. Every stream falls back to labelled sample data when live data is unavailable.

Quality gates for every merge: `npm run typecheck && npm run lint -- --max-warnings 0 && npm test && npm run build`.

---

## 9. Sources (selection)
OptionStrat features and optimizer · SpotGamma Call/Put Wall support docs · Unusual Whales Super Flow and flow-alert docs · Market Chameleon implied moves and IV movers · Barchart max pain and UOA · OptionCharts docs · NSE/Kotak/Fyers/Sahi lot-size bulletins (Dec 2025) · Navia/Zerodha/share.market STT and charge notes · Dhan v2 live-feed and option-chain docs · mrchartist.com stylesheet (mc.css). Rates, lot sizes and endpoints marked *verify* must be checked against current NSE/SEBI circulars before release.
