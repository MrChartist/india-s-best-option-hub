# TODO: Option Hub redesign in the IPO Decode design system

Goal: make Option Hub a clean, impressive, premium trading website that follows the design system of
[IPO Decode](https://github.com/MrChartist/IPO-Decode) (same React + Tailwind stack) exactly. Every page calmer,
airier and easier to use; clutter removed; every option and futures feature kept and completed.

Work on branch `claude/ipo-decode-redesign`, then merge into `main` with a pull request.

## 0 · Before starting

- [x] Baseline green: `npm run typecheck`, `npm run lint`, `npx vitest run` (3,138 tests), `npm run build`.
      Tests whose recorded data has dated expiries now run with the clock pinned (`src/test/pinDate.ts`).
- [ ] Read IPO Decode's `docs/DESIGN-IOS27.md` (the design system) and `AGENTS.md`; this repo's `README.md`,
      `docs/ARCHITECTURE.md`, `src/App.tsx`, `DashboardLayout.tsx`, `AppSidebar.tsx`, `CommandPalette.tsx`.
- [ ] Build and run IPO Decode locally; take reference screenshots (desktop and phone, light and dark).
      IPO Decode is read-only: never change it.

## 1 · Foundation (finish before any page work)

### Design system
- [ ] Port IPO Decode's "Liquid Glass" tokens: iOS system colours, materials, shadows, radii (cards 28 px, tiles
      16 px, controls fully round), warm paper (light) / warm charcoal (dark) canvas with the faint brand-symbol
      backdrop.
- [ ] Self-host the three fonts: Plus Jakarta Sans (headings), Inter (body and all numbers, tabular figures), DM Serif
      Display (a rare one-word italic accent). No external font requests; check CSP, Vite, proxy and service worker.
- [ ] Light / Dark / System, keeping the existing theme storage key.
- [ ] Re-point the shadcn CSS variables at the new tokens so every existing component re-skins at once.
- [ ] Keep the colour-blind palette working on the new tokens.

### Shell
- [ ] Desktop (≥ 1024 px): floating glass sidebar with grouped pages, ⌘K search, appearance switch.
- [ ] Phones and tablets (< 1024 px): floating glass bottom tab bar (Dashboard, Option Chain, Futures, Strategy, More)
      and a More sheet listing every other page by group.
- [ ] Glass toolbar: page title, symbol search, IST market clock with market status, data-source status, refresh,
      alerts.
- [ ] One route list feeding the sidebar, tab bar, More sheet and command palette.
- [ ] Every route and keyboard shortcut still works (G-then-key navigation, Ctrl K, ?, F6/F7 on 1Cliq).
- [ ] 44 px touch targets, safe-area insets, scroll-edge veil.

### Shared components (`src/components/ios/`)
- [ ] Layout: Card, CardHeader (tinted icon tile), List/Row, PageHeader (eyebrow, large title, subtitle, actions;
      one h1), numbered SectionEyebrow, Metric.
- [ ] Pills and badges: StatusPill; DeltaPill (▲/▼ plus colour, `--` when missing); SourceBadge (Live / Delayed /
      Last saved / Sample, once per card or page, never on every tile).
- [ ] Controls: Segmented; Sheet (bottom sheet on phones, centred from 720 px; focus trap, Esc, scroll lock); Toast;
      "Show more" disclosure; column-visibility picker.
- [ ] States and motion: EmptyState; card-shaped skeleton loaders; spring motion (framer-motion,
      reduced motion respected).
- [ ] Charts: port IPO Decode's SVG chart kit; theme recharts to match.
- [ ] Write `docs/DESIGN.md` explaining how to use all of it.

### Numbers
- [ ] One formatter following IPO Decode's rule: no grouping commas (24250.00), fixed decimals per column, `--` for
      missing values, tabular figures.
- [ ] Keep lakh/crore compaction (1.31L, 2.4Cr) for large OI and volume counts.

### Remove clutter everywhere
- [ ] "New" and "Beta" badges in navigation (keep one quiet "Beta" only on 1Cliq live trading).
- [ ] Developer text in banners (for example `VITE_DATA_MODE=sample`); the sample notice becomes one calm line.
- [ ] Repeated "Sample" tags on every tile.
- [ ] Promo strips inside content (keep "More from Mr. Chartist" only in the sidebar footer and on Ecosystem).
- [ ] Long chip rows; sentence case everywhere.

## Clean-and-airy rules (every page)

- Generous spacing: 24–32 px between sections, roomy card padding, table rows about 44–48 px on desktop.
- Separate things with grouped surfaces and spacing, not lines and borders.
- Essentials by default; advanced detail behind "Show more" (for example "More stats", extra chain columns).
- One hero figure per card; secondary text quieter.
- Colour only for meaning: green/red for gain/loss and good/bad, blue for interactive, orange for caution.
- Polished hover states, transitions, skeletons and empty states.

## 2 · Redraw every page and complete the features

Four areas, each owning its own folders; they can run in parallel once the foundation is done.

### A · Option chain (the flagship)
- [ ] Option Chain: essential columns by default, column picker for Greeks, OI change, IV and build-up; clear ATM /
      spot / max-pain markers; strike inspector as a sheet; on phones a compact readable calls-and-puts layout instead
      of a squeezed table; basket hand-off to Strategy Builder and Paper Trading kept.
- [ ] Contract
- [ ] Expiry Day
- [ ] Straddles

### B · Analytics
- [ ] OI Analysis
- [ ] Max Pain & PCR
- [ ] F&O Screener
- [ ] Gamma Exposure
- [ ] Options Flow
- [ ] FII / DII Positioning
- [ ] Volatility

### C · Futures and markets
- [ ] Dashboard
- [ ] Watchlist
- [ ] Events
- [ ] Futures, redrawn (overview, price-and-OI chart, rollover tracker and comparison, term structure) and completed:
  - [ ] Long build-up / short build-up / short covering / long unwinding scanner across all F&O stocks
  - [ ] Basis and cost of carry, annualised
  - [ ] Calendar-spread charts
  - [ ] Intraday futures chart with VWAP
  - [ ] Lot size and margin details
  - [ ] Top movers by OI change and by price change
  - Every new figure comes from the existing data layer or sample data, labelled honestly.

### D · Strategy, trading and the rest
- [ ] Strategy Builder
- [ ] Optimizer
- [ ] Backtester
- [ ] Calculators
- [ ] 1Cliq Trade (safety rules unchanged)
- [ ] Orders
- [ ] Positions
- [ ] Paper Trading
- [ ] Journal
- [ ] Alerts
- [ ] Learn
- [ ] Broker Settings
- [ ] Ecosystem

### For every area
- [ ] Compare with leading Indian tools (Sensibull, Opstra, Quantsapp) and add missing option and futures features
      where the app's data supports them.
- [ ] Never present made-up numbers as live data; keep the Live / Delayed / Sample honesty.
- [ ] Leave the maths library (`src/lib/options/**`) and its 90% coverage gate alone unless something is a real bug.

## 3 · Verify and finish

- [ ] `npm run typecheck`, `npm run lint`, `npx vitest run`, `npm run build` all pass. Update tests only where markup or
      text changed on purpose; never weaken behaviour checks.
- [ ] Playwright in sample mode: every route at 320, 390, 768, 1024, 1280, 1440 and 1920 px, light and dark. No
      console errors, no failed requests (fonts included), no horizontal scrolling. Every sheet and dialog opened at
      phone and desktop sizes.
- [ ] Side-by-side comparison with IPO Decode; iterate until it genuinely matches and looks impressive.
- [ ] Regenerate `docs/screenshots` (same file names, `manifest.json`); update `README.md` and the changelog.
- [ ] Commit in clear steps on `claude/ipo-decode-redesign`, open a pull request describing what changed and how it
      was tested, then merge into `main`.
- [ ] Safety: never place real orders; live trading stays off by default; 1Cliq's safety rules unchanged.
