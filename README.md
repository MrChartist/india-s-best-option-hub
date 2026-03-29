# 🚀 India's Best Option Hub — Open-Source Options & Futures Terminal

<div align="center">

**India's most comprehensive open-source Options & Futures analytics terminal.**

Built for NSE F&O traders who want institutional-grade tools — free, open-source, and running in your browser.

[![React](https://img.shields.io/badge/React-18.3-61dafb?logo=react&logoColor=white)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178c6?logo=typescript&logoColor=white)](https://typescriptlang.org)
[![Vite](https://img.shields.io/badge/Vite-5.4-646cff?logo=vite&logoColor=white)](https://vitejs.dev)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-3.4-06b6d4?logo=tailwindcss&logoColor=white)](https://tailwindcss.com)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/MrChartist/india-s-best-option-hub/pulls)

[Features](#-what-you-get) · [Quick Start](#-quick-start-5-minutes) · [Data Sources](#-data-sources) · [Pages Guide](#-pages-guide) · [Roadmap](#-current-status--roadmap) · [Contributing](#-contributing)

</div>

---

> **⚠️ BASE PROJECT — Work in Progress**
>
> This is a **base/starter project** — it's functional and covers a LOT of ground, but some features may not be fully connected or polished yet. Think of it as a solid foundation you can build on top of. The creator ([MrChartist](https://github.com/MrChartist)) is actively working on completing this within the next **10–30 days**. See the [Roadmap](#-current-status--roadmap) for details.
>
> **You're free to fork, copy, modify, and improve this project!** It's MIT licensed. If something doesn't make sense, throw the code at Claude/ChatGPT/Gemini and vibe-code your way through it. 🚀

---

## 🧠 What Is This?

This is a **free, browser-based Options & Futures analytics terminal** for the Indian stock market (NSE).

**Think of it as your personal trading dashboard** that shows:
- Live prices of NIFTY, BANKNIFTY, and other indices
- Full option chain with OI (Open Interest), IV (Implied Volatility), and Greeks
- Charts showing where the smart money is positioned
- Tools to build and test trading strategies before risking real money

**Who is this for?**
- 📈 **Options traders** who want professional tools without paying ₹2000+/month
- 🎓 **Beginners** learning about option chains, OI analysis, and Greeks
- 💻 **Developers** who want to build on top of a solid F&O analytics platform
- 🧪 **Vibe coders** who want a real-world project to hack on with AI tools

---

## ✨ What You Get

| Feature | What It Does | Status |
|---------|-------------|--------|
| **📊 Live Dashboard** | Real-time NIFTY, BANKNIFTY prices, VIX, sector heatmap, market sentiment score | ✅ Working |
| **⛓️ Option Chain** | Full strike-wise data — LTP, OI, OI Change, Volume, IV for every CE/PE strike | ✅ Working |
| **📈 OI Analysis** | Visual charts showing Call/Put writers positioning (Max Pain, Delta OI, PCR) | ✅ Working |
| **🧮 Strategy Builder** | Build Bull Call Spread, Iron Condor, Straddle — see payoff chart before you trade | ✅ Working |
| **💼 Position Tracker** | Track your open positions with real-time P&L | ✅ Working |
| **⭐ Watchlist** | Save your favorite stocks for quick access | ✅ Working |
| **🔑 Broker API Keys** | Connect your Dhan/Zerodha/Angel One account for live data (BYOK) | ✅ Working (Dhan fully connected) |
| **📡 WebSocket Live Feed** | Real-time price ticks via Dhan WebSocket binary protocol | ✅ Working |
| **🗄️ Local Database** | IndexedDB-based persistence for price snapshots and candle history | ✅ Working |

### Dashboard Sections

The dashboard is packed with live data widgets:

- **Index Cards** — NIFTY 50, BANK NIFTY, FINNIFTY, MIDCAP NIFTY with live prices & intraday sparklines
- **Data Sources Bar** — Real-time status of all 6 data sources (Dhan API, Dhan WS, Live Feed, NSE, TradingView, VIX)
- **Key Metrics** — PCR, VIX, Max Pain for NIFTY and BANKNIFTY
- **Expected Move** — How much NIFTY/BANKNIFTY might move before expiry (based on IV)
- **IV Rank Scanner** — Scans major stocks for IV Rank with buy/sell signals
- **Top Movers** — Today's biggest gainers and losers in F&O
- **Futures & VIX** — Premium/Discount analysis and VIX trend charts
- **Sector Performance** — Color-coded sector heatmap showing money flow
- **Most Active F&O** — Stocks with highest trading activity + OI interpretation
- **Market Breadth** — Overall market health score, Advance/Decline ratio, VIX regime

---

## 🚀 Quick Start (5 Minutes)

### Prerequisites

| Tool | Version | Download |
|------|---------|----------|
| **Node.js** | v18 or higher | [nodejs.org](https://nodejs.org/) |
| **Git** | Any recent version | [git-scm.com](https://git-scm.com/downloads) |
| **Code Editor** | Optional but recommended | [VS Code](https://code.visualstudio.com/) |

> **New to coding?** Don't worry! Just follow the steps below. If you get stuck, copy the error message and ask ChatGPT/Claude/Gemini for help.

### Step 1: Clone the Repository

**Option A: Using Git (recommended)**

Open your terminal (Command Prompt, PowerShell, or Terminal on Mac/Linux) and run:

```bash
git clone https://github.com/MrChartist/india-s-best-option-hub.git
cd india-s-best-option-hub
```

**Option B: Download ZIP (no Git needed)**

1. Go to [github.com/MrChartist/india-s-best-option-hub](https://github.com/MrChartist/india-s-best-option-hub)
2. Click the green **"Code"** button → **"Download ZIP"**
3. Extract the ZIP file to any folder
4. Open a terminal in that folder

### Step 2: Install Dependencies

```bash
npm install
```

This downloads all the libraries the project needs. Wait for it to finish (~1-2 minutes on first install).

> **Getting errors?** Make sure Node.js is installed by running `node --version`. You should see `v18.x.x` or higher. If not, [download Node.js](https://nodejs.org/).

### Step 3: Start the App

```bash
npm run dev
```

This starts **two servers simultaneously**:

| Server | URL | Purpose |
|--------|-----|---------|
| **Vite** (frontend) | `http://localhost:4001` | The React app you see in the browser |
| **Proxy** (data relay) | `http://localhost:4002` | Routes data from Dhan/NSE/TradingView |

**Open your browser and go to:** `http://localhost:4001`

🎉 **That's it!** You should see the dashboard loading. During market hours (Mon–Fri, 9:15 AM – 3:30 PM IST), live data from TradingView and NSE will populate automatically — no API key needed for basic data.

### Step 4 (Optional): Add Dhan API for Premium Data

For the best experience (real-time option chain, Greeks, live WebSocket ticks):

1. **Create a Dhan account** at [dhan.co](https://dhan.co) (free)
2. **Get API credentials** from [Dhan Developer Portal](https://dhanhq.co/docs/v2/)
3. **Create a `.env` file** in the project root:

```bash
# Windows
copy .env.example .env

# Mac/Linux
cp .env.example .env
```

4. **Add your credentials** to `.env`:

```env
DHAN_CLIENT_ID=your_client_id_here
DHAN_ACCESS_TOKEN=your_access_token_here
```

5. **Restart the app** (press `Ctrl+C` to stop, then run `npm run dev` again)

The proxy server will automatically detect your Dhan credentials and connect to the Dhan WebSocket for live ticks.

> **📝 Note:** You can also add Dhan credentials from the UI itself — go to **Broker Settings** page (`/broker-settings`) and enter your keys there. They're stored in your browser's localStorage and never sent to any external server.

### Step 5 (Optional): Add Other Broker Keys

The Broker Settings page supports entering API keys for 7 Indian brokers:

| Broker | Status |
|--------|--------|
| **Dhan** | ✅ Fully integrated (Option Chain, Greeks, WebSocket) |
| **Zerodha (Kite)** | 🔧 UI ready, backend integration coming soon |
| **Angel One (SmartAPI)** | 🔧 UI ready, backend integration coming soon |
| **Upstox** | 🔧 UI ready, backend integration coming soon |
| **Fyers** | 🔧 UI ready, backend integration coming soon |
| **5paisa** | 🔧 UI ready, backend integration coming soon |
| **Alice Blue** | 🔧 UI ready, backend integration coming soon |

---

## ## 🐳 Running with Docker (No Local Setup Required)

You can run the entire application using Docker without installing Node.js or any dependencies on your system.

---

### ✅ Prerequisites

* Install **Docker Desktop**
* Ensure Docker is running

Verify:

```bash
docker --version
```

---

### 🚀 Quick Start

#### 1. Clone the repository

```bash
git clone https://github.com/MrChartist/india-s-best-option-hub.git
cd india-s-best-option-hub
```

---

#### 2. Build the Docker image

```bash
docker build -t option-hub .
```

Sample Output:
```aiignore
[+] Building 87.4s (10/10) FINISHED                                                                                                                                                                                                                      docker:desktop-linux
 => [internal] load build definition from Dockerfile                                                                                                                                                                                                                     0.0s
 => => transferring dockerfile: 294B                                                                                                                                                                                                                                     0.0s
 => [internal] load metadata for docker.io/library/node:18                                                                                                                                                                                                               2.1s
 => [internal] load .dockerignore                                                                                                                                                                                                                                        0.0s
 => => transferring context: 144B                                                                                                                                                                                                                                        0.0s
 => [1/5] FROM docker.io/library/node:18@sha256:c6ae79e38498325db67193d391e6ec1d224d96c693a8a4d943498556716d3783                                                                                                                                                         0.0s
 => => resolve docker.io/library/node:18@sha256:c6ae79e38498325db67193d391e6ec1d224d96c693a8a4d943498556716d3783                                                                                                                                                         0.0s
 => [internal] load build context                                                                                                                                                                                                                                        0.0s
 => => transferring context: 7.42kB                                                                                                                                                                                                                                      0.0s
 => CACHED [2/5] WORKDIR /app                                                                                                                                                                                                                                            0.0s
 => CACHED [3/5] COPY package*.json ./                                                                                                                                                                                                                                   0.0s
 => [4/5] RUN rm -rf node_modules package-lock.json     && npm install --force                                                                                                                                                                                          75.2s
 => [5/5] COPY . .                                                                                                                                                                                                                                                       0.1s 
 => exporting to image                                                                                                                                                                                                                                                   9.9s 
 => => exporting layers                                                                                                                                                                                                                                                  7.4s 
 => => exporting manifest sha256:75e3c113eac8c8dcc0ec769ec51bdfb5767ce0883609fe46f7ee57d983af34bb                                                                                                                                                                        0.0s 
 => => exporting config sha256:e8dfd38c4b9b20bb6f764db17b5a0c770d80d79ef0fa696956fd6f14a7195eaa                                                                                                                                                                          0.0s 
 => => exporting attestation manifest sha256:f65b10ee21b3422cab3fa8ba6596aed9a79262d011e0e87187cdaa28bde88f12                                                                                                                                                            0.0s 
 => => exporting manifest list sha256:5ccf075f6e80ce19f175629b38be8df5b4a010110a079c3ed06228c1182029d9                                                                                                                                                                   0.0s
 => => naming to docker.io/library/option-hub:latest                                                                                                                                                                                                                     0.0s
 => => unpacking to docker.io/library/option-hub:latest                                                                                                                                                                                                                  2.4s

View build details: docker-desktop://dashboard/build/desktop-linux/desktop-linux/q8ak3rr7fs3kwdwy7u8e48itu
```

Verify generated build image:
```aiignore
docker images | grep option-hub
```

Sample Output
```aiignore
option-hub                            latest    d906950fcb94   About a minute ago   2.24GB
```
---

#### 3. Run the container

```bash
docker run -p 4001:4001 -p 4002:4002 option-hub
```

Sample Output
```aiignore

> india-s-best-option-hub@1.0.0 dev
> concurrently -n vite,proxy -c cyan,green "vite" "node proxy-server.mjs" --host

[proxy] 
[proxy]   🚀 Mr. Chartist Proxy Server
[proxy]   ├─ HTTP:       http://localhost:4002
[proxy]   ├─ WebSocket:  ws://localhost:4002/ws
[proxy]   ├─ Health:     http://localhost:4002/health
[proxy]   ├─ Dhan (1°):  http://localhost:4002/api/dhan-proxy?endpoint=option-chain&symbol=NIFTY
[proxy]   ├─ NSE  (2°):  http://localhost:4002/api/nse-proxy?endpoint=indices
[proxy]   └─ TV Scanner: http://localhost:4002/api/tv-scan?type=stocks
[proxy] 
[proxy]   Data Priority: Dhan → NSE → TradingView
[proxy]   Dhan credentials: ⚠️  Not set (configure in .env or Broker Settings)
[proxy] 
[vite] 
[vite]   VITE v5.4.21  ready in 83 ms
[vite] 
[vite]   ➜  Local:   http://localhost:4001/
[vite]   ➜  Network: http://172.17.0.2:4001/
[proxy] [Proxy Error] /api/dhan-proxy: DHAN_CLIENT_ID or DHAN_ACCESS_TOKEN not configured. Add them to .env or pass via headers.
[proxy] [Proxy Error] /api/dhan-proxy: DHAN_CLIENT_ID or DHAN_ACCESS_TOKEN not configured. Add them to .env or pass via headers.
[proxy] [Proxy Error] /api/dhan-proxy: DHAN_CLIENT_ID or DHAN_ACCESS_TOKEN not configured. Add them to .env or pass via headers.
[proxy] [Proxy Error] /api/dhan-proxy: DHAN_CLIENT_ID or DHAN_ACCESS_TOKEN not configured. Add them to .env or pass via headers.
[proxy]   🌐 Browser WebSocket client connected
```

---

#### 4. Open in browser

```
http://localhost:4001
```

---

### 🔧 How it Works

* **Frontend (Vite)** runs on: `http://localhost:4001`
* **Proxy Server** runs on: `http://localhost:4002`
* Everything runs inside an isolated container

---

### ⚠️ Notes

* If port `4001` or `4002` is already in use, run:

```bash
docker run -p 5001:4001 -p 5002:4002 option-hub
```

Then open:

```
http://localhost:5001
```

---

### 🔁 Development Mode (Hot Reload)

To enable live code changes:

```bash
docker run -p 4001:4001 -p 4002:4002 -v $(pwd):/app option-hub
```

---

### 🧠 Apple Silicon (M1/M2/M3) Note

If you face issues related to Rollup or native modules, rebuild using:

```bash
docker build --no-cache -t option-hub .
```

---

### 🛑 Stopping the Container

Find running containers:

```bash
docker ps
```

Stop:

```bash
docker stop <container_id>
```

---

### 🧹 Cleanup

Remove container:

```bash
docker rm <container_id>
```

Remove image:

```bash
docker rmi option-hub
```

---

### 📦 Optional: Docker Compose

Create a `docker-compose.yml`:

```yaml
version: "3"

services:
  option-hub:
    build: .
    ports:
      - "4001:4001"
      - "4002:4002"
    volumes:
      - .:/app
    command: npm run dev -- --host
```

Run:

```bash
docker-compose up --build
```

---

### 🎯 Benefits of Docker Setup

* No local dependency installation
* Clean and isolated environment
* Works across Mac, Linux, Windows
* Easy onboarding for new users

---

## 📡 Data Sources

The terminal uses **3 data sources** with automatic failover:

```
Priority: Dhan API (1st) → NSE India (2nd) → TradingView (3rd)
```

| Source | What It Provides | Auth Needed? | Accuracy |
|--------|-----------------|-------------|----------|
| **Dhan API** ⭐ | Option Chain, Greeks, Expiry List, Live WebSocket Ticks | Yes (free API key) | Real-time |
| **NSE India** | Indices, Sectors, Advance/Decline, Option Chain (fallback) | No | 3-5 sec delay |
| **TradingView** | 100+ F&O stock prices, Volume, Sector data | No | 15-30 sec delay |

### How the Data Flows

```
Your Browser  ←→  Local Proxy Server (:4002)  ←→  Dhan / NSE / TradingView
      ↑                    ↑
      │                    │
   React App          Handles CORS,
   (port 4001)        caching, retry,
                       WebSocket relay
```

1. Your browser sends requests to the **local proxy server** (runs on your machine)
2. The proxy forwards requests to Dhan/NSE/TradingView APIs
3. The proxy caches responses (3–30 seconds) to avoid rate limits
4. Data flows back to your browser in real-time
5. Dhan WebSocket data is parsed from binary and relayed as clean JSON to the browser

> **🔒 Security:** Your API keys never leave your machine. The proxy runs 100% locally — no external servers, no cloud, no tracking. Broker keys stored in the browser are kept in localStorage only.

### Data Source Status Bar

The dashboard shows a **real-time status bar** at the top with all 6 source indicators:

| Indicator | Meaning |
|-----------|---------|
| 🟢 **Dhan API** | Primary data source — Option Chain, Greeks |
| 🟢 **Dhan WS** | WebSocket live ticks — Index prices, VIX |
| 🟢 **Live Feed** | Browser receiving WebSocket data |
| 🟢 **NSE** | Fallback — Indices, Sectors, A/D ratio |
| 🟢 **TradingView** | F&O stock scanner — LTP, Volume |
| 🟢 **VIX** | India VIX from WebSocket or NSE |

Hover over any indicator to see detailed connection info, including tick count, cached data, and connected clients.

---

## 📖 Pages Guide

### 1. Dashboard (`/`)

The main dashboard with 10+ live data sections. Everything refreshes automatically during market hours.

**Key sections:**
- **Ticker Tape** — Scrolling prices at the top
- **Index Cards** — Click any card to open its option chain
- **Key Metrics** — PCR, VIX, Max Pain
- **IV Rank Scanner** — Shows if options are cheap or expensive
- **Market Breadth** — Overall market health with sentiment score (0–100)

### 2. Option Chain (`/option-chain`)

Full option chain for any F&O symbol — NIFTY, BANKNIFTY, FINNIFTY, MIDCPNIFTY, or individual stocks.

**Features:**
- All strikes with CE/PE data (LTP, OI, OI Change, Volume, IV)
- ATM (At-The-Money) strike auto-highlighted
- Switch between expiry dates
- PCR and total OI shown in the header
- Click any row for quick trade actions

### 3. OI Analysis (`/oi-analysis`)

Deep analysis of Open Interest data with 7 chart tabs:

| Tab | What It Shows |
|-----|--------------|
| **OI Distribution** | Where Call/Put writers are concentrated |
| **Delta OI** | Directional exposure at each strike |
| **Strike PCR** | Put-Call ratio per strike |
| **ATM Zone** | OI buildup around the current price |
| **Multi-Expiry** | Weekly vs Monthly OI comparison |
| **IV Smile** | Implied Volatility skew across strikes |
| **PCR Dashboard** | Live PCR gauge + OI breakdown |

### 4. Strategy Builder (`/strategy-builder`)

Build any options strategy and see its payoff chart before trading.

**Pre-built strategies:** Bull Call Spread, Bear Put Spread, Long Straddle, Iron Condor, Butterfly, Collar, and more.

### 5. Position Tracker (`/position-tracker`)

Track your open option positions with simulated P&L.

### 6. Watchlist (`/watchlist`)

Save your favorite F&O symbols for quick access.

### 7. Broker Settings (`/broker-settings`)

Configure your broker API credentials. See real-time connection status for all data sources. Supports 7 Indian brokers with BYOK (Bring Your Own Key) architecture.

---

## ⌨️ Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `⌘1` or `Ctrl+1` | Go to Dashboard |
| `⌘2` or `Ctrl+2` | Go to Option Chain |
| `⌘3` or `Ctrl+3` | Go to OI Analysis |
| `⌘4` or `Ctrl+4` | Go to Watchlist |
| `⌘5` or `Ctrl+5` | Go to Strategy Builder |
| `⌘6` or `Ctrl+6` | Go to Position Tracker |

---

## 🧱 Tech Stack

| What | Technology | Why |
|------|-----------|-----|
| **Frontend** | React 18 + TypeScript | Modern, type-safe UI with component reuse |
| **Build Tool** | Vite 5 | Instant hot-reload during development |
| **Data Fetching** | TanStack React Query | Automatic caching, retry, and background refresh |
| **UI Library** | shadcn/ui + Radix | Beautiful, accessible components out of the box |
| **Styling** | Tailwind CSS 3 | Fast styling with dark/light theme support |
| **Charts** | Recharts | Interactive charts for OI, IV, and payoff diagrams |
| **Proxy Server** | Node.js (native http + ws) | Local CORS proxy — no Express, no bloat |
| **WebSocket** | ws (Node.js) | Real-time binary protocol parsing for Dhan feed |
| **Local Storage** | IndexedDB (localDatabase.ts) | Persistent price snapshots + candle history |
| **Routing** | React Router v6 | Client-side navigation between pages |

---

## 📁 Project Structure

```
india-s-best-option-hub/
├── proxy-server.mjs          # Local proxy server (Dhan + NSE + TradingView + WebSocket relay)
├── .env.example              # Environment variable template  
├── package.json              # Dependencies and scripts
├── vite.config.ts            # Vite configuration (port 4001)
├── tailwind.config.ts        # Tailwind CSS with custom design system
├── index.html                # HTML entry point with SEO meta tags
│
├── src/
│   ├── main.tsx              # App entry point
│   ├── App.tsx               # Routes and providers (React Query, Router, Toasts)
│   ├── index.css             # Design system (CSS variables, dark/light themes)
│   │
│   ├── pages/                # Each page = one route
│   │   ├── Index.tsx         # Dashboard (/) — 10+ widget sections
│   │   ├── OptionChain.tsx   # Option Chain (/option-chain)
│   │   ├── OIAnalysis.tsx    # OI Analysis (/oi-analysis) — 7 chart tabs
│   │   ├── Watchlist.tsx     # Watchlist (/watchlist)
│   │   ├── StrategyBuilder.tsx # Strategy Builder (/strategy-builder)
│   │   ├── PositionTracker.tsx # Position Tracker (/position-tracker)
│   │   ├── BrokerSettings.tsx  # Broker Settings (/broker-settings)
│   │   └── NotFound.tsx      # 404 page
│   │
│   ├── components/           # Reusable UI pieces
│   │   ├── ui/               # Base components (Button, Card, Table, Badge, etc.)
│   │   ├── dashboard/        # Dashboard section widgets
│   │   │   ├── DataSourcesBar.tsx    # 6-source real-time status bar
│   │   │   ├── MarketHeader.tsx      # Market open/closed indicator
│   │   │   ├── TickerTape.tsx        # Scrolling price ticker
│   │   │   ├── IndexCards.tsx        # NIFTY/BANKNIFTY cards with sparklines
│   │   │   ├── KeyMetrics.tsx        # PCR, VIX, Max Pain cards
│   │   │   ├── TopMovers.tsx         # Gainers & losers table
│   │   │   ├── SectorHeatmap.tsx     # Color-coded sector performance grid
│   │   │   ├── MostActiveFnO.tsx     # Highest activity F&O stocks
│   │   │   ├── MarketBreadth.tsx     # Sentiment score, A/D ratio, VIX regime
│   │   │   ├── FuturesVIX.tsx        # Futures premium/discount + VIX chart
│   │   │   ├── GiftNiftyExpiry.tsx   # GIFT Nifty + expiry countdown
│   │   │   ├── WelcomeBanner.tsx     # Welcome message
│   │   │   ├── QuickTradeActions.tsx # Quick navigation cards
│   │   │   ├── SectionHeader.tsx     # Section titles with tooltips
│   │   │   └── InfoTooltip.tsx       # Educational tooltips
│   │   ├── IVPercentileGauge.tsx     # IV analysis with live smile chart
│   │   ├── IVRankWidget.tsx          # IV rank scanner (multi-symbol)
│   │   ├── ExpectedMoveWidget.tsx    # Expected move calculator
│   │   ├── DashboardLayout.tsx       # Sidebar + main content layout
│   │   ├── AppSidebar.tsx            # Navigation sidebar with all routes
│   │   ├── CommandPalette.tsx        # Cmd+K command palette
│   │   ├── AlertSystem.tsx           # Price/OI alert engine
│   │   ├── DatabaseManager.tsx       # IndexedDB price/candle manager UI
│   │   ├── ErrorBoundary.tsx         # Graceful error handling
│   │   ├── LoadingSkeletons.tsx      # Loading skeleton animations
│   │   └── ...                       # More specialized components
│   │
│   ├── hooks/                # React hooks (data fetching & state)
│   │   ├── useMarketData.ts  # All market data hooks (option chain, indices, F&O stocks)
│   │   ├── useWebSocket.ts   # WebSocket connection for live Dhan ticks
│   │   ├── useLocalDatabase.ts # IndexedDB read/write hooks
│   │   ├── useKeyboardShortcuts.ts # Global keyboard shortcuts
│   │   ├── useAlertEngine.ts # Alert engine logic
│   │   └── useTheme.ts      # Dark/light theme toggle
│   │
│   ├── lib/                  # Utility functions & core logic
│   │   ├── marketApi.ts      # API calls (Dhan → NSE → TradingView fallback chain)
│   │   ├── websocketClient.ts # Browser-side WebSocket client for Dhan relay
│   │   ├── brokerConfig.ts   # Broker definitions + localStorage key management
│   │   ├── oiUtils.ts        # OI analysis calculations (Max Pain, PCR, Delta OI)
│   │   ├── positionStore.ts  # Position tracking with lot sizes
│   │   ├── localDatabase.ts  # IndexedDB wrapper for persistent storage
│   │   ├── mockData.ts       # TypeScript type definitions and data models
│   │   └── utils.ts          # General utilities (cn helper)
│   │
│   └── test/                 # Test files
│
├── docs/
│   └── screenshots/          # App screenshots for README
│
└── public/                   # Static files
```

---

## 📜 Available Scripts

| Command | What It Does |
|---------|-------------|
| `npm run dev` | **Start everything** — Vite frontend (`:4001`) + Proxy server (`:4002`) together |
| `npm run dev:vite` | Start only Vite (frontend only, no live data from proxy) |
| `npm run proxy` | Start only the proxy server |
| `npm run build` | Create production build in `dist/` folder |
| `npm run preview` | Preview the production build locally |
| `npm run lint` | Check code for TypeScript/ESLint errors |
| `npm run test` | Run tests with Vitest |

---

## 🔧 Troubleshooting

### "The dashboard shows no data"

- **During market hours?** Data loads automatically from TradingView/NSE. Wait 5–10 seconds.
- **After market hours?** Most data sources return empty responses. This is normal — NSE/TradingView only serve data during trading sessions.
- **Check the status bar** at the top — it shows which sources are connected. Hover over each indicator for details.
- **Proxy not running?** Make sure you used `npm run dev` (not `npm run dev:vite`).

### "npm install fails"

- Make sure you have **Node.js v18+** installed: `node --version`
- Try clearing npm cache: `npm cache clean --force` then `npm install` again
- On Windows, try running as Administrator
- On Mac/Linux, if permission errors: `sudo npm install` (not recommended long-term — fix npm permissions instead)

### "Port 4001 is already in use"

Edit `vite.config.ts` and change the port:

```ts
server: {
  port: 3000, // Change to any available port
}
```

### "Port 4002 is already in use"

Create a `.env` file and change the proxy port:

```env
PROXY_PORT=4003
```

### "Dhan API shows 429 Too Many Requests"

This means you're hitting Dhan's rate limit. The proxy caches responses to minimize this, but on weekends/holidays, Dhan may still reject requests. Wait and retry during market hours.

### "Option chain shows no data"

- Option chain data requires **Dhan API** or **NSE** to be responsive
- On weekends, both return empty responses — data will load on Monday
- Check Broker Settings page to verify your Dhan credentials
- Verify the proxy is running: visit `http://localhost:4002/health` in your browser

### "WebSocket not connecting"

- WebSocket requires valid Dhan credentials (Client ID + Access Token)
- Check `http://localhost:4002/health` — it shows `websocket.dhanConnected: true/false`
- The WS auto-reconnects with exponential backoff if disconnected

---

## 🗺️ Current Status & Roadmap

### ✅ What's Working Now

- Full Dashboard with 10+ live widgets
- Option Chain (Dhan primary, NSE fallback)
- OI Analysis with 7 chart types
- Strategy Builder with payoff diagrams
- Position Tracker
- Watchlist
- Dhan WebSocket live feed with binary protocol parsing
- Proxy server with 3-source failover (Dhan → NSE → TradingView)
- Data source status bar
- Keyboard shortcuts & command palette
- Dark/Light theme
- IndexedDB local persistence
- BYOK broker key storage

### 🔧 What's Being Worked On (Next 10–30 Days)

- [ ] Full integration for Zerodha, Angel One, Upstox, Fyers APIs
- [ ] Historical OI change charts
- [ ] Options Greeks calculator with real-time Greeks from Dhan
- [ ] Multi-expiry comparison views
- [ ] Alert system with push notifications
- [ ] Advanced strategy P&L with multi-DTE scenarios
- [ ] GEX (Gamma Exposure) analysis
- [ ] FII/DII activity dashboard
- [ ] Mobile-responsive layout improvements
- [ ] Production deployment guide (Vercel + VPS proxy)

### 🤔 Known Gaps (Help Wanted!)

- Some dashboard sections may show empty during off-market hours — this is by design (no mock data)
- Zerodha/Angel One/Upstox/Fyers/5paisa/Alice Blue have UI forms but no backend connectors yet
- The Strategy Builder payoff chart doesn't integrate with live option chain pricing yet
- Some component state doesn't persist across page navigation

---

## 🌐 Deploying to Production

### Deploy on Vercel / Netlify (Frontend Only)

```bash
npm run build
```

Upload the `dist/` folder to any static hosting (Vercel, Netlify, GitHub Pages).

> **Note:** Without the proxy server, live data won't work. The frontend will show empty states gracefully. For full functionality, you need the proxy running somewhere.

### Deploy Full Stack (Frontend + Proxy)

For a complete deployment with live data:

1. Deploy the **proxy server** (`proxy-server.mjs`) on a VPS (DigitalOcean, AWS, Railway, Render, etc.)
2. Set `VITE_PROXY_URL` in `.env` to your proxy's public URL
3. Deploy the frontend on Vercel/Netlify
4. Set environment variables on the VPS: `DHAN_CLIENT_ID`, `DHAN_ACCESS_TOKEN`

---

## 🤝 Contributing

**Contributions are very welcome!** This is a community project and there's a LOT of room for improvement.

### How to Contribute

1. **Fork** this repository
2. **Create** a feature branch: `git checkout -b feature/my-feature`
3. **Make changes** and commit: `git commit -m 'Add my feature'`
4. **Push** to your fork: `git push origin feature/my-feature`
5. **Open** a Pull Request

### Contribution Ideas

- 🔌 **Add a new broker connector** (Zerodha, Angel One, Upstox, etc.)
- 📊 **Improve charts** (candlestick charts, better OI visualization)
- 📱 **Mobile responsiveness** (some sections need mobile love)
- 🧪 **Add tests** (very few tests exist right now)
- 📝 **Documentation** (component docs, API docs)
- 🎨 **UI polish** (animations, better loading states)
- 🐛 **Bug fixes** (find something broken? Fix it!)

### Rules

- Write TypeScript (no plain JavaScript in `src/`)
- Use the design system (CSS variables) — no hardcoded colors
- Test in both dark and light themes
- Don't add mock/fake data — all data must come from real APIs
- Keep the proxy server dependency-free (only `ws` as external dep)

---

## 🧑‍💻 New to This? Start Here

If you're new to web development or this codebase, here's how to navigate:

1. **Start with `src/pages/Index.tsx`** — this is the Dashboard page. It imports and renders all dashboard widgets.
2. **Read `src/hooks/useMarketData.ts`** — this is where all data fetching happens. Understand the WebSocket → Polling → Database fallback chain.
3. **Check `src/lib/marketApi.ts`** — this is the API layer. See how Dhan → NSE → TradingView fallback works.
4. **Look at `proxy-server.mjs`** — the Node.js proxy server that handles CORS, caching, and WebSocket relay.
5. **Use AI tools!** Copy any file into Claude/ChatGPT and ask "explain this code" — it works great for understanding the architecture.

### Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│                    Browser (React)                  │
│                                                     │
│  Pages → Hooks (useMarketData) → API (marketApi)   │
│             ↓                        ↓              │
│     WebSocket Client          fetch() calls         │
│         (ws://)               (http://)             │
└─────────────┬──────────────────────┬────────────────┘
              │                      │
              ▼                      ▼
┌─────────────────────────────────────────────────────┐
│              Proxy Server (Node.js :4002)            │
│                                                     │
│  WebSocket Relay ← Dhan WS (binary)    HTTP Routes  │
│  (JSON broadcast)                       ↓     ↓    │
│                                    Dhan  NSE  TV    │
│                                    API   API  Scan  │
│                           ┌─ Cache Layer (Map) ──┐  │
└─────────────────────────────────────────────────────┘
```

---

## ⚠️ Disclaimer

This project is for **educational and analytical purposes only**. It is **not financial advice**.

- Trading in derivatives involves significant risk and may result in loss of capital
- Always do your own research and consult a registered financial advisor (SEBI-registered)
- The developers are not responsible for any financial losses
- This tool does not execute trades — it is an analytics-only platform
- API keys are stored locally and never transmitted to external servers

---

## 📄 License

This project is licensed under the **MIT License** — see [LICENSE](LICENSE) for details.

You are free to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies. Just include the original license.

---

<div align="center">

**Built with ❤️ by [Mr. Chartist](https://github.com/MrChartist) for the Indian Options Trading Community**

*If this project helps your trading, consider giving it a ⭐ on GitHub!*

*Found a bug? Have an idea? [Open an issue](https://github.com/MrChartist/india-s-best-option-hub/issues) or submit a PR!*

</div>
