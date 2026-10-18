# Contributing to Mr. Chartist Options Terminal

Thank you for helping. Every contribution counts, from a typo fix to a new page. This guide covers setup, the rules that keep the terminal trustworthy, and the checklist every pull request must pass.

- [Setup](#setup)
- [Before you open a PR: the checklist](#before-you-open-a-pr-the-checklist)
- [Where things live](#where-things-live)
- [Coding rules](#coding-rules)
- [Tests](#tests)
- [Adding a page](#adding-a-page)
- [Pull request process](#pull-request-process)

## Setup

Requirements: **Node.js 20 or newer** (22 LTS recommended) and npm 10.

```bash
git clone https://github.com/YOUR-USERNAME/india-s-best-option-hub.git
cd india-s-best-option-hub
npm ci                      # exact versions from package-lock.json
cp .env.example .env        # optional: Dhan keys
npm run dev                 # frontend :4001 + proxy :4002
git checkout -b feat/your-change
```

No keys? `npm run dev:vite` with `VITE_DATA_MODE=sample` runs the frontend on labelled sample data.

## Before you open a PR: the checklist

Run this once; it is what CI runs:

```bash
npm run check               # typecheck → lint → unit tests → build
```

- [ ] `npm run typecheck` passes (TypeScript `strict` is on)
- [ ] `npm run lint` passes with no errors, and you added no new warnings (`npm run lint:strict` is the target)
- [ ] `npm test` passes; new logic in `src/lib/**` has Vitest tests
- [ ] `npm run build` succeeds
- [ ] If you touched a page: `npm run test:e2e` passes (run `npx playwright install chromium` once)
- [ ] Checked in **light and dark** themes and at **375 px** width
- [ ] Keyboard works: every control is reachable with Tab and has a visible focus ring
- [ ] Loading, empty and error states exist for anything that fetches data
- [ ] Sample or derived numbers carry a visible **Sample data** / **Derived** badge
- [ ] New pages show: "Data for education and research. Not investment advice."

## Where things live

```
proxy-server.mjs        Local Node proxy: Dhan, NSE, TradingView, Yahoo; caching; WebSocket relay
src/
├── lib/
│   ├── options/        Pricing, Greeks, IV, IST time, expiry, lot sizes, payoff, POP, charges, formatting
│   ├── api/            proxyClient.ts: the only place the browser talks to the proxy
│   ├── marketApi.ts    Typed fetchers over the proxy, with fallbacks
│   ├── routes.ts       Route registry: sidebar, palette, shortcuts, titles, 404 suggestions
│   ├── log.ts          In-memory ring-buffer logger used in error reports
│   └── lazyWithRetry.ts  React.lazy with chunk retry and a guarded reload
├── hooks/              React Query hooks (useMarketData.ts) and UI hooks
├── components/         Shared components; ui/ holds the shadcn primitives
└── pages/              One file per route
e2e/                    Playwright smoke tests
docs/                   ARCHITECTURE.md, DATA_ENDPOINTS.md
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the data flow and the units contract.

## Coding rules

**Maths.** Import pricing, Greeks, IV, time-to-expiry, expiry rules, lot sizes, payoff, POP, charges and formatting from `@/lib/options`. Do not write another Black-Scholes. Units: volatility is a decimal (0.14), time is in years, rates are decimals, prices are rupees per unit. NSE's `iv` field is in percent; convert at the edge with `pctToDec`.

**Data.** Fetch through the hooks in `src/hooks/useMarketData.ts` or `src/lib/marketApi.ts`, never `fetch()` directly from a component. When data is missing, show an empty state or labelled sample data. Never show made-up numbers as live.

**TypeScript.** Strict mode. No new `any`: use `unknown` and narrow it. Prefix intentionally unused arguments with `_`.

**Styling.** Tailwind semantic tokens only (`bg-card`, `text-muted-foreground`, `text-bullish`, `text-bearish`, `border-border`, `bg-primary`). No hex colours or `rgba()` in class names. Nothing smaller than 10 px.

**Indian conventions.** ₹, lakh and crore (`formatINR`, `formatCompactIN`, `formatTimeIST` from `@/lib/options`), times in IST, Indian English copy. Write plainly: "Max pain moved up 100 points", not "Max pain experienced upward migration".

**Resilience.** Wrap risky widgets in `WidgetErrorBoundary` from `@/components/ErrorBoundary`. Log with `log.warn`/`log.error` from `@/lib/log` rather than bare `console.*`; the last lines are attached to bug reports.

**Proxy.** `proxy-server.mjs` stays dependency-free apart from `ws`. Native `http` and `fetch` only.

## Tests

| Kind | Where | Run |
|------|-------|-----|
| Pure logic | next to the module (`src/lib/foo.test.ts`) or `src/lib/<area>/__tests__/` | `npm test` |
| Hooks and components | `src/test/` or next to the file | `npm test` |
| Pages | `e2e/smoke.spec.ts` visits every route in `ROUTES` | `npm run test:e2e` |

Tests under `src/lib/**` run in plain Node (fast, no DOM) with an in-memory `localStorage`. If a lib test needs `document`, add `// @vitest-environment jsdom` as the first line.

Coverage: `npm run test:coverage`. `src/lib/options/**` must stay at 90% or more (CI fails below that).

## Adding a page

1. Create `src/pages/MyPage.tsx` with a default export and a single visible `<h1>`.
2. Add an entry to `ROUTES` in `src/lib/routes.ts` (path, title, nav label, group, lucide icon, keywords, optional `g` shortcut and badge).
3. Wire the route in `src/App.tsx` using `lazyWithRetry(route.lazy)`.
4. Call `useDocumentTitle("My Page")`.
5. The smoke test picks it up automatically.

## Pull request process

1. Keep PRs focused: one feature or fix.
2. Fill in the PR template, including screenshots for UI changes (light and dark).
3. Link the issue (`Closes #123`).
4. Title format:

```
feat: add Zerodha broker integration
fix: option chain not loading for FINNIFTY
docs: explain the units contract
refactor: simplify WebSocket reconnection
test: add charges reference cases
```

## License

Option Hub is licensed for personal use under the [Option Hub Personal Use Licence 1.0](LICENSE), and commercial licences are offered separately by the copyright holder (see [COMMERCIAL-LICENSE.md](COMMERCIAL-LICENSE.md)).

By submitting a contribution (a pull request, patch, issue attachment or suggested code), you confirm that you wrote it or have the right to submit it, and you agree that:

1. it is shared with other users under the same Option Hub Personal Use Licence 1.0 as the project; and
2. you grant Rohit Singh (Mr. Chartist) a perpetual, worldwide, royalty-free, irrevocable licence to use, change, sublicense and distribute your contribution under any licence, including commercial licences.

You keep the copyright in your contribution. If you cannot agree to this, please open an issue to discuss before sending code.

---

Questions? [Open an issue](https://github.com/MrChartist/india-s-best-option-hub/issues/new/choose).
