<div align="center">

<a href="https://mrchartist.com/open-source/india-s-best-option-hub?utm_source=github&utm_medium=readme&utm_campaign=option-hub">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/brand/logo-white.svg">
    <img src="docs/brand/logo-black.svg" alt="Mr. Chartist logo" width="96" height="96">
  </picture>
</a>

# Option Hub by Mr. Chartist

**India's options terminal for NSE and BSE F&O. Free for personal use.**<br>
Option chain, OI, max pain, GEX, volatility, flow, strategy builder, optimizer, backtester and paper trading, in one app that runs on your own computer.

[![CI](https://github.com/MrChartist/india-s-best-option-hub/actions/workflows/ci.yml/badge.svg)](https://github.com/MrChartist/india-s-best-option-hub/actions/workflows/ci.yml)
[![Licence: personal use only](https://img.shields.io/badge/licence-personal_use_only_·_commercial_by_permission-111111.svg)](COMMERCIAL-LICENSE.md)
[![Tests](https://img.shields.io/badge/tests-1%2C400%2B_passing-2f7d4f.svg)](#quality)
[![Made for India](https://img.shields.io/badge/Made_for-NSE_%26_BSE-e8642c.svg)](#built-for-indian-markets)
[![Stars](https://img.shields.io/github/stars/MrChartist/india-s-best-option-hub?style=flat&color=111111)](https://github.com/MrChartist/india-s-best-option-hub/stargazers)

[**Quick start**](#quick-start) · [**Feature tour**](#feature-tour) · [**Screenshots**](#screenshots) · [**Full gallery**](docs/screenshots/README.md) · [**41 brokers**](docs/BROKERS.md) · [**Data sources**](#data-sources) · [**Licence**](#licence) · [**More from Mr. Chartist**](#more-from-mr-chartist)

<br>

<img src="docs/screenshots/dashboard-dark.webp" alt="Option Hub market dashboard in dark mode" width="100%">

</div>

---

## Why Option Hub

Most serious options tools for Indian traders sit behind a monthly fee. The best analytics in the world, such as GEX, IV surfaces, flow scanners and strategy optimisers, are built for the US market. Option Hub brings both together for NSE and BSE, keeps it free for individual traders and learners, and publishes the full source code.

- **Numbers you can trust.** Every price, IV and Greek comes from one tested maths library (Black-76 on the forward, time measured to 15:30 IST, real lot sizes and expiry rules). More than 1,400 unit tests check it.
- **Honest about data.** Every number carries its source: Live, Delayed, Last saved or **Sample**. If the data feed is off, the app says so on every page. It never presents made-up numbers as live.
- **Private by design.** It runs on your machine. Your broker keys stay in your browser and your local proxy. There is no cloud account, no tracking and no sign-up.
- **Built for how Indians trade.** It covers weekly expiries, lakh and crore formatting, IST everywhere, FII/DII participant data, F&O ban list, STT and charges, and SEBI's risk reminders.
- **Teaches while you trade.** Inline explainers on every metric and a Learn hub built with [NISMExams.com](https://nismexams.com?utm_source=github&utm_medium=readme&utm_campaign=option-hub).

> Data for education and research. Not investment advice.

---

## Feature tour

| Area | Pages | What you get |
|---|---|---|
| **Markets** | Dashboard · Watchlist · Events Calendar | Indices, India VIX, daily market brief, positioning summary, customisable layout, results and macro events |
| **Chain & OI** | Option Chain · OI Analysis · Max Pain & PCR · F&O Screener · Expiry Day · Straddles · Contract | Greeks, OI build-up labels (LB / SB / SC / LU), ATM focus, strike range, volume spikes, max pain curve, PCR history, buildup scanner, 0DTE command centre, straddle and strangle charts, per-contract history |
| **Volatility** | Volatility | IV rank and percentile, smile, term structure, volatility cone, expected move, India VIX analytics, symbol compare |
| **Positioning** | Gamma Exposure · Options Flow · FII / DII Positioning · Futures & Rollover | GEX profile, call and put walls, gamma flip, DEX / VEX / CEX, derived flow tape, unusual activity, participant-wise OI, rollover and basis |
| **Strategy** | Strategy Builder · Optimizer · Backtester · Calculators | Multi-leg payoff with target-date and IV sliders, lognormal POP, margin and charges estimate, strategy optimizer by view and budget, backtests on past expiries, charges, margin, position size, option price and IV calculators |
| **Trade** (beta) | 1Cliq Trade · Orders | Keyboard-first one-click terminal with arming, server-side stop-loss and target engine, <kbd>F6</kbd> close all and <kbd>F7</kbd> cancel all, trading lock, and today's Dhan order book with cancel. Paper fills until you turn on Live trading |
| **Portfolio** | Positions · Paper Trading · Trade Journal · Alerts | Live P&L and Greeks, paper trading with a real order ticket, tradebook import and analytics, price, IV, PCR and OI alerts |
| **Learn** | Learn · Mr. Chartist ecosystem | Lessons from options basics to dealer gamma, quizzes and simulators, links to every Mr. Chartist product |
| **Settings** | Broker Settings | 41 Indian brokers in one directory with a capability matrix, encrypted key vault, per-session Log in for brokers that need a PIN and TOTP, data-source health and the Live trading switch. See [docs/BROKERS.md](docs/BROKERS.md) |

Press <kbd>Ctrl</kbd> <kbd>K</kbd> anywhere to jump to any page or symbol, and <kbd>?</kbd> to see every keyboard shortcut.

### 1Cliq Trade and Orders (beta)

A keyboard-first execution terminal at `/one-cliq` (<kbd>G</kbd> then <kbd>T</kbd>), with today's order book at `/orders`. The full build spec is in [`1CLIQ-TRADE-SPEC.md`](1CLIQ-TRADE-SPEC.md).

- **Live trading is off by default.** Fills are simulated paper trades until you turn on **Live trading** in Broker Settings, accept the real-money warning and arm the terminal (<kbd>O</kbd>). Arming never survives a reload and switches itself off when idle.
- **Keys:** arrow keys for market orders, <kbd>+</kbd> / <kbd>-</kbd> lots, <kbd>1</kbd> to <kbd>5</kbd> lot presets, <kbd>F6</kbd> close all (press twice), <kbd>F7</kbd> cancel all, <kbd>Esc</kbd> disarm, <kbd>?</kbd> cheat sheet.
- **Risk engine on the proxy, not in the tab.** Every Dhan tick reaches the server risk engine before any browser, so a closed or throttled tab cannot delay an exit. Spot-referenced stop-loss and target, trailing ratchet, a position state machine and a one-second dead-man's switch. Real exit orders from the risk engine are not wired yet: it calls a stub, so treat its stop-loss and target as alerts for now.
- **Panic layer.** Close all cancels first, then closes shorts, hedges and futures in three waves, always re-reading the order book from Dhan and confirming before it reports success.
- **Trading lock** with a server-computed cooling-off period.
- **Save as basket** in Strategy Builder resolves legs against the live chain. It never places orders.

Orders are placed through Dhan only. The other 40 brokers supply data. Every state-changing route on the proxy is POST-only, behind the same host and origin checks as the rest of the proxy.

### 41 brokers

Broker Settings lists **41 Indian brokers** (Dhan, Zerodha, Upstox, Angel One, Fyers, Flattrade, Shoonya, Kotak Neo, 5paisa and more) with what each adapter can do: option chain, quotes, depth, candles, Greeks, portfolio and orders. Dhan is verified with a live account; the others are fixture-tested and marked beta. Passwords, PINs and TOTP secrets are never stored: brokers that need them ask in a **Log in** dialog each session and only the returned session token is kept. Full list and capability matrix: [docs/BROKERS.md](docs/BROKERS.md).

---

## Screenshots

All screenshots were taken in **sample-data mode** (no data feed connected), which is exactly what you see on first run. Live numbers replace them once the local proxy is running. Every page is shown in dark mode below; open the sections underneath for light mode, phone views and the [**full screenshot gallery**](docs/screenshots/README.md) (88 images with sizes, plus a [`manifest.json`](docs/screenshots/manifest.json)).

### Markets

| Dashboard | Watchlist |
|---|---|
| <img src="docs/screenshots/dashboard-dark.webp" alt="Dashboard, dark mode"> | <img src="docs/screenshots/watchlist-dark.webp" alt="Watchlist, dark mode"> |
| **Events Calendar** | |
| <img src="docs/screenshots/events-calendar-dark.webp" alt="Events Calendar, dark mode"> | |

### Chain & OI

| Option Chain | OI Analysis |
|---|---|
| <img src="docs/screenshots/option-chain-dark.webp" alt="Option Chain, dark mode"> | <img src="docs/screenshots/oi-analysis-dark.webp" alt="OI Analysis, dark mode"> |
| **Max Pain & PCR** | **F&O Screener** |
| <img src="docs/screenshots/max-pain-pcr-dark.webp" alt="Max Pain & PCR, dark mode"> | <img src="docs/screenshots/fno-screener-dark.webp" alt="F&O Screener, dark mode"> |
| **Expiry Day (0DTE)** | **Straddles** |
| <img src="docs/screenshots/expiry-day-dark.webp" alt="Expiry Day (0DTE), dark mode"> | <img src="docs/screenshots/straddles-dark.webp" alt="Straddles, dark mode"> |
| **Contract page** | **Option chain by strike** |
| <img src="docs/screenshots/contract-dark.webp" alt="Contract page, dark mode"> | <img src="docs/screenshots/feature-option-chain-by-strike-dark.webp" alt="Option chain by strike, dark mode"> |

### Volatility and positioning

| Volatility | Gamma Exposure |
|---|---|
| <img src="docs/screenshots/volatility-dark.webp" alt="Volatility, dark mode"> | <img src="docs/screenshots/gamma-exposure-dark.webp" alt="Gamma Exposure, dark mode"> |
| **Options Flow** | **FII / DII Positioning** |
| <img src="docs/screenshots/options-flow-dark.webp" alt="Options Flow, dark mode"> | <img src="docs/screenshots/fii-dii-positioning-dark.webp" alt="FII / DII Positioning, dark mode"> |
| **Futures & Rollover** | |
| <img src="docs/screenshots/futures-rollover-dark.webp" alt="Futures & Rollover, dark mode"> | |

### Strategy

| Strategy Builder | Template applied (Bull Call Spread) |
|---|---|
| <img src="docs/screenshots/strategy-builder-dark.webp" alt="Strategy Builder, dark mode"> | <img src="docs/screenshots/feature-strategy-template-dark.webp" alt="Template applied (Bull Call Spread), dark mode"> |
| **Optimizer** | **Backtester** |
| <img src="docs/screenshots/optimizer-dark.webp" alt="Optimizer, dark mode"> | <img src="docs/screenshots/backtester-dark.webp" alt="Backtester, dark mode"> |
| **Calculators** | |
| <img src="docs/screenshots/calculators-dark.webp" alt="Calculators, dark mode"> | |

### Trade (beta)

| 1Cliq Trade | Orders |
|---|---|
| <img src="docs/screenshots/one-cliq-dark.webp" alt="1Cliq Trade, dark mode"> | <img src="docs/screenshots/orders-dark.webp" alt="Orders, dark mode"> |

### Portfolio

| Positions | Paper Trading |
|---|---|
| <img src="docs/screenshots/positions-dark.webp" alt="Positions, dark mode"> | <img src="docs/screenshots/paper-trading-dark.webp" alt="Paper Trading, dark mode"> |
| **Trade Journal** | **Alerts** |
| <img src="docs/screenshots/trade-journal-dark.webp" alt="Trade Journal, dark mode"> | <img src="docs/screenshots/alerts-dark.webp" alt="Alerts, dark mode"> |

### Learn and ecosystem

| Learn (with NISMExams.com) | A lesson |
|---|---|
| <img src="docs/screenshots/learn-dark.webp" alt="Learn (with NISMExams.com), dark mode"> | <img src="docs/screenshots/learn-lesson-dark.webp" alt="A lesson, dark mode"> |
| **More from Mr. Chartist** | |
| <img src="docs/screenshots/ecosystem-dark.webp" alt="More from Mr. Chartist, dark mode"> | |

### Settings and 41 brokers

| Broker Settings | 41-broker capability matrix |
|---|---|
| <img src="docs/screenshots/broker-settings-dark.webp" alt="Broker Settings, dark mode"> | <img src="docs/screenshots/feature-broker-directory-dark.webp" alt="41-broker capability matrix, dark mode"> |
| **Session login (PIN + TOTP, never saved)** | |
| <img src="docs/screenshots/feature-session-login-dark.webp" alt="Session login (PIN + TOTP, never saved), dark mode"> | |

### Everyday features

| Command palette (Ctrl K) | Keyboard shortcuts (?) |
|---|---|
| <img src="docs/screenshots/feature-command-palette-dark.webp" alt="Command palette (Ctrl K), dark mode"> | <img src="docs/screenshots/feature-keyboard-shortcuts-dark.webp" alt="Keyboard shortcuts (?), dark mode"> |
| **Collapsed sidebar** | **Page not found** |
| <img src="docs/screenshots/feature-collapsed-sidebar-dark.webp" alt="Collapsed sidebar, dark mode"> | <img src="docs/screenshots/feature-not-found-dark.webp" alt="Page not found, dark mode"> |

<details>
<summary><strong>Light mode, every page</strong> (click to open)</summary>

<br>

#### Markets

| Dashboard | Watchlist |
|---|---|
| <img src="docs/screenshots/dashboard-light.webp" alt="Dashboard, light mode"> | <img src="docs/screenshots/watchlist-light.webp" alt="Watchlist, light mode"> |
| **Events Calendar** | |
| <img src="docs/screenshots/events-calendar-light.webp" alt="Events Calendar, light mode"> | |

#### Chain & OI

| Option Chain | OI Analysis |
|---|---|
| <img src="docs/screenshots/option-chain-light.webp" alt="Option Chain, light mode"> | <img src="docs/screenshots/oi-analysis-light.webp" alt="OI Analysis, light mode"> |
| **Max Pain & PCR** | **F&O Screener** |
| <img src="docs/screenshots/max-pain-pcr-light.webp" alt="Max Pain & PCR, light mode"> | <img src="docs/screenshots/fno-screener-light.webp" alt="F&O Screener, light mode"> |
| **Expiry Day (0DTE)** | **Straddles** |
| <img src="docs/screenshots/expiry-day-light.webp" alt="Expiry Day (0DTE), light mode"> | <img src="docs/screenshots/straddles-light.webp" alt="Straddles, light mode"> |
| **Contract page** | **Option chain by strike** |
| <img src="docs/screenshots/contract-light.webp" alt="Contract page, light mode"> | <img src="docs/screenshots/feature-option-chain-by-strike-light.webp" alt="Option chain by strike, light mode"> |

#### Volatility and positioning

| Volatility | Gamma Exposure |
|---|---|
| <img src="docs/screenshots/volatility-light.webp" alt="Volatility, light mode"> | <img src="docs/screenshots/gamma-exposure-light.webp" alt="Gamma Exposure, light mode"> |
| **Options Flow** | **FII / DII Positioning** |
| <img src="docs/screenshots/options-flow-light.webp" alt="Options Flow, light mode"> | <img src="docs/screenshots/fii-dii-positioning-light.webp" alt="FII / DII Positioning, light mode"> |
| **Futures & Rollover** | |
| <img src="docs/screenshots/futures-rollover-light.webp" alt="Futures & Rollover, light mode"> | |

#### Strategy

| Strategy Builder | Template applied (Bull Call Spread) |
|---|---|
| <img src="docs/screenshots/strategy-builder-light.webp" alt="Strategy Builder, light mode"> | <img src="docs/screenshots/feature-strategy-template-light.webp" alt="Template applied (Bull Call Spread), light mode"> |
| **Optimizer** | **Backtester** |
| <img src="docs/screenshots/optimizer-light.webp" alt="Optimizer, light mode"> | <img src="docs/screenshots/backtester-light.webp" alt="Backtester, light mode"> |
| **Calculators** | |
| <img src="docs/screenshots/calculators-light.webp" alt="Calculators, light mode"> | |

#### Trade (beta)

| 1Cliq Trade | Orders |
|---|---|
| <img src="docs/screenshots/one-cliq-light.webp" alt="1Cliq Trade, light mode"> | <img src="docs/screenshots/orders-light.webp" alt="Orders, light mode"> |

#### Portfolio

| Positions | Paper Trading |
|---|---|
| <img src="docs/screenshots/positions-light.webp" alt="Positions, light mode"> | <img src="docs/screenshots/paper-trading-light.webp" alt="Paper Trading, light mode"> |
| **Trade Journal** | **Alerts** |
| <img src="docs/screenshots/trade-journal-light.webp" alt="Trade Journal, light mode"> | <img src="docs/screenshots/alerts-light.webp" alt="Alerts, light mode"> |

#### Learn and ecosystem

| Learn (with NISMExams.com) | A lesson |
|---|---|
| <img src="docs/screenshots/learn-light.webp" alt="Learn (with NISMExams.com), light mode"> | <img src="docs/screenshots/learn-lesson-light.webp" alt="A lesson, light mode"> |
| **More from Mr. Chartist** | |
| <img src="docs/screenshots/ecosystem-light.webp" alt="More from Mr. Chartist, light mode"> | |

#### Settings and 41 brokers

| Broker Settings | 41-broker capability matrix |
|---|---|
| <img src="docs/screenshots/broker-settings-light.webp" alt="Broker Settings, light mode"> | <img src="docs/screenshots/feature-broker-directory-light.webp" alt="41-broker capability matrix, light mode"> |
| **Session login (PIN + TOTP, never saved)** | |
| <img src="docs/screenshots/feature-session-login-light.webp" alt="Session login (PIN + TOTP, never saved), light mode"> | |

#### Everyday features

| Command palette (Ctrl K) | Keyboard shortcuts (?) |
|---|---|
| <img src="docs/screenshots/feature-command-palette-light.webp" alt="Command palette (Ctrl K), light mode"> | <img src="docs/screenshots/feature-keyboard-shortcuts-light.webp" alt="Keyboard shortcuts (?), light mode"> |
| **Collapsed sidebar** | **Page not found** |
| <img src="docs/screenshots/feature-collapsed-sidebar-light.webp" alt="Collapsed sidebar, light mode"> | <img src="docs/screenshots/feature-not-found-light.webp" alt="Page not found, light mode"> |

</details>

<details>
<summary><strong>Phone, dark mode</strong> (click to open)</summary>

<br>

<p align="center">
  <img src="docs/screenshots/mobile-dashboard-dark.webp" alt="Dashboard on a phone, dark mode" width="24%">
  <img src="docs/screenshots/mobile-option-chain-dark.webp" alt="Option Chain on a phone, dark mode" width="24%">
  <img src="docs/screenshots/mobile-strategy-builder-dark.webp" alt="Strategy Builder on a phone, dark mode" width="24%">
  <img src="docs/screenshots/mobile-gamma-exposure-dark.webp" alt="Gamma Exposure on a phone, dark mode" width="24%">
  <img src="docs/screenshots/mobile-broker-settings-dark.webp" alt="Broker Settings on a phone, dark mode" width="24%">
  <img src="docs/screenshots/mobile-one-cliq-dark.webp" alt="1Cliq Trade on a phone, dark mode" width="24%">
  <img src="docs/screenshots/mobile-learn-dark.webp" alt="Learn on a phone, dark mode" width="24%">
</p>

</details>

<details>
<summary><strong>Phone, light mode</strong> (click to open)</summary>

<br>

<p align="center">
  <img src="docs/screenshots/mobile-dashboard-light.webp" alt="Dashboard on a phone, light mode" width="24%">
  <img src="docs/screenshots/mobile-option-chain-light.webp" alt="Option Chain on a phone, light mode" width="24%">
  <img src="docs/screenshots/mobile-strategy-builder-light.webp" alt="Strategy Builder on a phone, light mode" width="24%">
  <img src="docs/screenshots/mobile-gamma-exposure-light.webp" alt="Gamma Exposure on a phone, light mode" width="24%">
  <img src="docs/screenshots/mobile-broker-settings-light.webp" alt="Broker Settings on a phone, light mode" width="24%">
  <img src="docs/screenshots/mobile-one-cliq-light.webp" alt="1Cliq Trade on a phone, light mode" width="24%">
  <img src="docs/screenshots/mobile-learn-light.webp" alt="Learn on a phone, light mode" width="24%">
</p>

</details>

---

## Quick start

You need **Node.js 20 or newer** ([download the LTS version](https://nodejs.org/)), this project, and a browser. Nothing is hosted; everything runs on your computer.

### No coding experience? Follow these steps

<details open>
<summary><strong>Windows</strong></summary>

1. Install Node.js LTS from [nodejs.org](https://nodejs.org/).
2. On this page, click **Code → Download ZIP**, then extract the ZIP.
3. Open the extracted folder. Click the address bar, type `cmd` and press **Enter**.
4. In the black window, type `npm install` and press **Enter**. Wait for it to finish.
5. Type `npm run dev` and press **Enter**.
6. Open **http://localhost:4001** in Chrome, Edge or Brave.

</details>

<details>
<summary><strong>Mac</strong></summary>

1. Install Node.js LTS from [nodejs.org](https://nodejs.org/).
2. On this page, click **Code → Download ZIP**, then double-click the ZIP to extract it.
3. Open **Terminal**. Type `cd ` (with a space), drag the project folder into the window and press **Enter**.
4. Run `npm install`, then `npm run dev`.
5. Open **http://localhost:4001** in Safari, Chrome or Brave.

</details>

Keep the window open while you use the app. Press <kbd>Ctrl</kbd> <kbd>C</kbd> in it to stop.

### For developers

```bash
git clone https://github.com/MrChartist/india-s-best-option-hub.git
cd india-s-best-option-hub
npm install
npm run dev          # app on :4001 and local data proxy on :4002
```

That is all you need. Without broker keys the app still runs, with NSE and public data where available, and clearly labelled sample data where not.

### Optional: add Dhan for real-time chains and Greeks

A free [Dhan API](https://dhanhq.co/docs/v2/) key gives you the best option chain, Greeks and live WebSocket ticks, and is the broker 1Cliq Trade places orders with. Either enter it in the app under **Broker Settings**, or put it in a `.env` file:

```bash
cp .env.example .env
# then set DHAN_CLIENT_ID and DHAN_ACCESS_TOKEN
```

Using another broker? Add its keys under **Broker Settings → All brokers**. The active broker then supplies option chains and expiries through the local proxy; the live feed and 1Cliq orders stay on Dhan. See [docs/BROKERS.md](docs/BROKERS.md).

### Run with Docker

```bash
docker compose up --build      # open http://localhost:4001
```

Ports are bound to `127.0.0.1` only, because the proxy can hold your broker token. Your `.env` file is read at runtime and never copied into the image.

---

## Data sources

```mermaid
flowchart LR
  B["Your browser<br/>Option Hub app :4001"] <--> P["Local proxy :4002<br/>cache · retry · rate limit<br/>WebSocket relay"]
  P <--> D["Dhan API<br/>chain, Greeks, live ticks"]
  P <--> N["NSE<br/>indices, chain, F&O stock quotes,<br/>participant data"]
  P <--> Y["Yahoo Finance<br/>historical candles"]
```

| Source | Provides | Key needed |
|---|---|---|
| **Dhan API** | Option chain, Greeks, expiry list, live WebSocket ticks, 1Cliq orders | Yes (free) |
| **40 other brokers** | Option chain, quotes and more, per the [capability matrix](docs/BROKERS.md) | Yes (your own keys) |
| **NSE** | Indices, sectors, advance/decline, F&O stock prices, volumes and OI, option chain fallback, participant-wise OI, bhavcopy | No |
| **Yahoo Finance** | Historical OHLCV candles for charts | No |

**How the labels work.** The badge on each card tells you where its number came from:

| Badge | Meaning |
|---|---|
| **Live** | Streaming or freshly fetched during market hours |
| **Delayed** | From a source that lags by a few seconds to minutes |
| **Last saved** | The last good value, kept from your local history |
| **Sample** | Generated for demonstration when no feed is connected. Never a real price |
| **Derived** | Calculated by the app (for example flow from chain snapshots, or IV from price) |

**Security.** The proxy listens on `127.0.0.1` only and accepts requests from your local app only. It checks the host and origin of each request. Your keys are kept per connection and never logged. Set `VITE_DATA_MODE=sample` to skip the proxy completely.

---

## Built for Indian markets

| Topic | How Option Hub handles it |
|---|---|
| **Expiry calendar** | NIFTY weekly on Tuesday, SENSEX weekly on Thursday, other indices and stocks monthly. If expiry falls on a holiday, it moves to the previous trading day |
| **Time to expiry** | Measured to 15:30 IST to the minute, not in whole days |
| **Lot sizes** | Per-contract history, so older contracts keep their old lot size |
| **Pricing** | Black-76 on the forward from put-call parity, with an IV solver that refuses impossible prices |
| **Charges** | Dated tables for STT (including STT on exercise), exchange charges, SEBI fee, stamp duty and GST |
| **Margin** | A SPAN-style 16-scenario estimate with exposure margin and hedge benefit. Always labelled as an estimate |
| **Formatting** | ₹, lakh and crore, IST everywhere, and the Indian CE/PE colour convention |

> Lot sizes, holiday lists and charge rates change through exchange and SEBI circulars. They live in [`src/lib/options/`](src/lib/options), each value is marked for verification, and you can correct them in one place.

---

## Keyboard shortcuts

| Keys | Action |
|---|---|
| <kbd>Ctrl</kbd> <kbd>K</kbd> | Command palette: pages, indices and F&O stocks |
| <kbd>?</kbd> | Show all shortcuts |
| <kbd>R</kbd> | Refresh data |
| <kbd>G</kbd> then <kbd>D</kbd> | Dashboard |
| <kbd>G</kbd> then <kbd>C</kbd> | Option Chain |
| <kbd>G</kbd> then <kbd>O</kbd> | OI Analysis |
| <kbd>G</kbd> then <kbd>V</kbd> | Volatility |
| <kbd>G</kbd> then <kbd>X</kbd> | Gamma Exposure |
| <kbd>G</kbd> then <kbd>F</kbd> | Options Flow |
| <kbd>G</kbd> then <kbd>S</kbd> | Strategy Builder |
| <kbd>G</kbd> then <kbd>T</kbd> | 1Cliq Trade |
| <kbd>G</kbd> then <kbd>P</kbd> | Positions |
| <kbd>G</kbd> then <kbd>L</kbd> | Learn |

---

## Tech stack

**React 18** · **TypeScript** · **Vite** · **Tailwind CSS** with shadcn/ui and Radix · **Recharts** and Lightweight Charts · **TanStack Query** · **IndexedDB** for local history · **Workbox PWA** (installable, works offline for the app shell) · **Node.js** proxy with WebSocket relay · **Vitest**, **Playwright** and **axe** for testing.

<details>
<summary><strong>Project structure</strong></summary>

```
├── proxy-server.mjs        Local data proxy (Dhan, NSE, Yahoo) on :4002
├── src/
│   ├── pages/              One file per route
│   ├── components/         UI by feature (option-chain, strategy, gex, flow, volatility, …)
│   │   ├── ui/             Design-system primitives (shadcn/ui, Mr. Chartist theme)
│   │   └── brand/          Official Mr. Chartist logo
│   ├── lib/
│   │   ├── options/        Pricing, Greeks, IV, IST calendar, lot sizes, payoff, POP, charges, margin
│   │   ├── routes.ts       Route registry: drives routing, sidebar, command palette, shortcuts
│   │   ├── brand/          Product links and UTM helper
│   │   └── …               Feature logic (screener, flow, gex, backtest, journal, alerts, …)
│   ├── content/learn/      Learn hub lessons
│   └── hooks/              Data, theme and shortcut hooks
├── e2e/                    Playwright smoke and accessibility tests
└── docs/                   Architecture, data endpoints, screenshots, brand assets
```

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) and [`docs/DATA_ENDPOINTS.md`](docs/DATA_ENDPOINTS.md) for details, and [`ROADMAP.md`](ROADMAP.md) for what is next.

</details>

<details>
<summary><strong>Scripts</strong></summary>

| Command | What it does |
|---|---|
| `npm run dev` | App on :4001 and proxy on :4002 |
| `npm run dev:vite` | App only (sample or cached data) |
| `npm run proxy` | Proxy only |
| `npm run build` / `npm run preview` | Production build and local preview |
| `npm run typecheck` | TypeScript checks for app, Node config and e2e |
| `npm run lint` | ESLint |
| `npm test` / `npm run test:coverage` | Unit tests, with coverage gates |
| `npm run test:e2e` | Playwright smoke and accessibility tests (desktop and 375 px) |
| `npm run check` | Typecheck, lint, test and build in one go |

</details>

---

## Quality

- **1,400+ unit tests** with Vitest. The options maths library has a hard 90% coverage gate, and there is a global coverage ratchet.
- **Browser tests** with Playwright on every page, at desktop width and at 375 px, in light and dark mode.
- **Accessibility checks** with axe on every page: no serious WCAG violations allowed.
- **CI on every pull request**: typecheck, lint, unit tests with coverage, build, browser tests, a proxy health check and a dependency audit.

---

## Troubleshooting

<details>
<summary><strong>The app shows "Sample data" everywhere</strong></summary>

The local proxy is not reachable. Start the app with `npm run dev` (not `npm run dev:vite`), then check **http://localhost:4002/health** in your browser. Outside market hours and on holidays, NSE and brokers often return empty data. That is normal.
</details>

<details>
<summary><strong>Port 4001 or 4002 is already in use</strong></summary>

For the proxy, set `PROXY_PORT=4003` in `.env` and `VITE_PROXY_URL=http://localhost:4003`. For the app, change `server.port` in `vite.config.ts`.
</details>

<details>
<summary><strong>The option chain or live ticks do not load</strong></summary>

The richest chain and the WebSocket feed need Dhan credentials. Check **Broker Settings**, and look at `websocket.dhanConnected` on the `/health` page. The feed reconnects on its own with back-off.
</details>

<details>
<summary><strong>npm install fails</strong></summary>

Check `node --version` shows 20 or newer. Then run `npm cache clean --force` and `npm install` again.
</details>

---

## Contributing

Pull requests are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) (it explains how contributions are licensed), keep all maths in `src/lib/options`, label sample or derived data, and run `npm run check` before you push. Good first areas: more broker relays, verified lot-size and holiday updates, more Learn lessons, and translations.

Found a bug or have an idea? [Open an issue](https://github.com/MrChartist/india-s-best-option-hub/issues).

---

## More from Mr. Chartist

Option Hub is one part of the [Mr. Chartist ecosystem](https://mrchartist.com/ecosystem?utm_source=github&utm_medium=readme&utm_campaign=option-hub): tools, research and education for Indian markets, built around one price-action workflow.

| Product | What it is |
|---|---|
| [**FII/DII Data**](https://fii-diidata.mrchartist.com?utm_source=github&utm_medium=readme&utm_campaign=option-hub) | Track FII and DII institutional money flows, F&O positioning, sector-wise FPI allocation and flow heatmaps |
| [**IPO Decode**](https://ipodecode.mrchartist.com?utm_source=github&utm_medium=readme&utm_campaign=option-hub) | Every mainboard and SME IPO on NSE and BSE: subscription, grey market premium, allotment status and listing performance |
| [**TradeBook**](https://tradebook.mrchartist.com?utm_source=github&utm_medium=readme&utm_campaign=option-hub) | Trading journal for Indian markets: NSE, MCX and F&O |
| [**NISM Exams**](https://nismexams.com?utm_source=github&utm_medium=readme&utm_campaign=option-hub) | Notes, mock tests, explanations and performance tracking for NISM Series V-A, VIII, XV, X-A, X-B, XXI-A and XXI-B |
| [**Weekly ChartBook**](https://mrchartist.com/research/category/chartbook?utm_source=github&utm_medium=readme&utm_campaign=option-hub) | 280+ editions of visual chart analysis with actionable setups |
| [**Trading Books**](https://mrchartist.com/books?utm_source=github&utm_medium=readme&utm_campaign=option-hub) | *Trading Candlestick Patterns* and *Trading Chart Patterns*, two price-action books with real NSE and BSE examples |
| [**OptionsDesk**](https://optionsdesk.mrchartist.com?utm_source=github&utm_medium=readme&utm_campaign=option-hub) | More options tools from Mr. Chartist |
| [**FundaDesk**](https://funda.mrchartist.com?utm_source=github&utm_medium=readme&utm_campaign=option-hub) | Fundamentals tools from Mr. Chartist |
| [**Investology**](https://investology.mrchartist.com/?utm_source=github&utm_medium=readme&utm_campaign=option-hub) | SEBI-registered research from Mr. Chartist |
| [**Learn**](https://mrchartist.com/learn?utm_source=github&utm_medium=readme&utm_campaign=option-hub) | Free courses on options, technical analysis, TradingView, NISM and more |

**Follow for market views:**
[X / Twitter](https://x.com/Mr_Chartist) ·
[YouTube](https://www.youtube.com/mr_chartist) ·
[Telegram](https://t.me/official_mrchartist) ·
[WhatsApp channel](https://whatsapp.com/channel/0029VaDUeH159PwXDwq8yI1I) ·
[Instagram](https://instagram.com/mrchartist) ·
[LinkedIn](https://www.linkedin.com/in/rohit-mrchartist/) ·
[TradingView](https://tradingview.com/u/MrChartist) ·
[GitHub](https://github.com/MrChartist)

Built by **Rohit Singh (Mr. Chartist)**. INVESTOLOGY · SEBI Registered Research Analyst — INH000015297 ([verify on SEBI](https://www.sebi.gov.in/sebiweb/other/OtherAction.do?doRecognisedFpi=yes&intmId=14&regno=INH000015297)).

---

## Disclaimer

Option Hub is for **education and research only**. It is **not investment advice** and not a recommendation to buy or sell any security.

- Trading in derivatives carries substantial risk. A SEBI study found that about 9 in 10 individual F&O traders lost money between FY22 and FY24.
- Sample, derived and estimated values (including margin) are approximations. Check them with your broker before you trade.
- Do your own research, and consult a SEBI-registered adviser where needed.
- Your API keys stay on your machine. The authors are not responsible for any trading losses.

## Licence

**Free for personal use by individuals only. Any commercial or organisational use needs written permission.**

Option Hub is source-available under the [Option Hub Personal Use Licence 1.0](LICENSE). A plain-English summary is in [COMMERCIAL-LICENSE.md](COMMERCIAL-LICENSE.md).

| ✅ Free, for individuals | ❌ Needs written permission |
|---|---|
| Running it on your own computer and trading **your own** account | Any use by or for a company, firm, school, charity, government body or other organisation |
| Learning, studying and changing the code for yourself | Any commercial purpose, or selling or charging for it in any form |
| Sharing it free with other individuals, with the LICENCE and notices kept | Hosting it for other people (website, app, SaaS, API), paid or free |
| Free, credited reviews and tutorials | Trading or advising for clients, or paid courses, groups, signals or sponsored content |
| Contributing back to this repository | White-labelling, or removing the Mr. Chartist name, logo and notices |

**For permission or a commercial licence, email [rohit@mrchartist.com](mailto:rohit@mrchartist.com?subject=Option%20Hub%20commercial%20licence)** and tell us who you are and how you want to use it.

Earlier versions released under the MIT License or the PolyForm Noncommercial License 1.0.0 keep those licences for those versions only. Third-party notices are in [NOTICE.md](NOTICE.md).

<div align="center">

<br>

**If Option Hub helps your trading or learning, please give it a ⭐. It helps other Indian traders find it.**

<a href="https://mrchartist.com?utm_source=github&utm_medium=readme&utm_campaign=option-hub">mrchartist.com</a> · A clearer view of the markets.

</div>
