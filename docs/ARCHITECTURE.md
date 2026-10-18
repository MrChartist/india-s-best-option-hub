# Architecture

How the Mr. Chartist Options Terminal is put together, and the conventions that keep a codebase with many contributors coherent.

> Data for education and research. Not investment advice.

## The big picture

```
 Upstreams                Local proxy (Node)              Browser (React 18 + Vite)
 ─────────                ──────────────────              ─────────────────────────
 Dhan API v2  ─┐                                          src/lib/api/proxyClient.ts   one door to the proxy
 NSE India    ─┼──►  proxy-server.mjs  :4002   ──HTTP──►  src/lib/marketApi.ts         typed fetchers + fallbacks
 Yahoo        ─┘     cache · coalesce · rate   ──WS────►  src/hooks/useMarketData.ts   React Query hooks
                     queues · last-good copies            src/lib/options/**           pure maths (no I/O)
                                                          src/pages/*                  one file per route
                                                          src/lib/routes.ts            route registry
```

### 1. Proxy: `proxy-server.mjs`

A dependency-free Node server (only `ws`). It exists because NSE and Dhan cannot be called from a browser (CORS, cookies, secrets).

- Binds `127.0.0.1:4002` by default (`PROXY_HOST`, `PROXY_PORT`), with a CORS and WebSocket Origin allowlist.
- Legacy pass-through routes (`/api/dhan-proxy`, `/api/nse-proxy`, `/api/yahoo-chart`) and envelope routes under `/api/x/*`.
- Envelope: `{ data, meta: { source, asOf, stale, reason? } }`. `stale: true` means a last-good copy or no data.
- Coalesces identical requests, rate-limits per upstream, honours `Retry-After`, keeps last-good copies in `.cache/`.
- Relays the Dhan binary market feed as JSON ticks on `ws://127.0.0.1:4002/ws`.
- `GET /health` reports uptime, feed state and configured sources. CI and Docker use it.

Endpoint details: [DATA_ENDPOINTS.md](DATA_ENDPOINTS.md).

### 2. Client data layer: `src/lib/api/proxyClient.ts` → `src/lib/marketApi.ts`

- `proxyClient.ts` is the **only** module that knows the proxy URL (`VITE_PROXY_URL`). `proxyGet()` never throws; network errors come back as `{ data: null, meta: { reason: "offline" } }`.
- `marketApi.ts` turns envelopes into typed domain objects (`src/lib/types/market.ts`) and falls back Dhan → NSE for option chains. F&O stock quotes come from NSE, then the proxy's last saved NSE copy, then the local database, then labelled sample data.
- `snapshotStore.ts` records chain snapshots to IndexedDB. It feeds flow, OI replay, IV history and PCR history.

### 3. Hooks: `src/hooks/useMarketData.ts`

React Query hooks (`useLiveIndices`, `useLiveOptionChain`, `useExpiryList`, `useChainMulti`, `useProxyHealth`, ...) own polling intervals, market-hours awareness and the WebSocket → polling → IndexedDB fallback. Components never call `fetch()` directly.

### 4. Pages: `src/pages/*`

Each page is lazy-loaded. A page:

- renders exactly one visible `<h1>` (the smoke test checks this),
- sets its title with `useDocumentTitle()`,
- labels anything sample or derived with a visible badge,
- shows the education disclaimer.

### 5. Route registry: `src/lib/routes.ts`

`ROUTES: RouteDef[]` is the single list of pages: path, title, nav label, sidebar group, lucide icon name, optional `g` shortcut, keywords, badge and a `lazy()` import. Everything navigational reads from it:

| Consumer | Uses |
|----------|------|
| `App.tsx` | `lazyWithRetry(route.lazy)` per route |
| Sidebar, command palette | `routesByGroup()`, `navLabel`, `icon`, `keywords`, `badge` |
| `useKeyboardShortcuts` | `routeForShortcut()` for `g` sequences; `SHORTCUT_HELP` for the `?` overlay |
| `useDocumentTitle`, headers | `routeTitle(pathname)` |
| `NotFound` | `suggestRoutes(pathname)` and `LEGACY_REDIRECTS` |
| `e2e/smoke.spec.ts` | `staticPaths()` |

## The options maths contract: `src/lib/options/**`

Every calculation goes through `@/lib/options`. There is no second Black-Scholes anywhere. The modules are pure: no DOM, no network, they never throw (bad input returns `NaN` or an empty result), and they run in Node.

| Quantity | Unit inside the library |
|----------|-------------------------|
| Volatility `sigma` | decimal (`0.14` = 14%) |
| Time `T` | years (to 15:30 IST, minute precision) |
| Rates `r`, dividend yield `q` | decimal (`0.065`) |
| Prices | rupees **per unit**, not per lot |
| Theta | rupees per calendar day (`thetaTrading` per trading day) |
| Vega, rho | per 1 vol point, per 1% rate |
| NSE `iv` field | **percent**: convert at the edge with `pctToDec` / `decToPct` |

Modules: `normal`, `blackScholes`, `greeks`, `iv`, `marketParams`, `time` (IST clock, NSE calendar and holidays), `instruments` (lot sizes, strike steps, expiry rules), `chain`, `payoff`, `probability`, `expectedMove`, `volatility`, `charges` (dated STT and fee tables), `margin`, `sizing`, `format` (₹, lakh/crore, IST) and `sampleChain` (BS-consistent labelled demo data).

Coverage gate: 90% lines, branches, functions and statements on `src/lib/options/**`.

## Resilience

- **Chunk loading.** `lazyWithRetry()` retries a failed dynamic import once, then reloads the page once (guarded in `sessionStorage` with a 60 s cooldown) so a tab opened before a deploy picks up the new build.
- **Error boundaries.** `ErrorBoundary` wraps each route with `resetKeys={[pathname]}`, so navigating away clears a crash. It offers Try again, Reload, Copy error and Report on GitHub (a prefilled issue with the stack and the recent log, never storage contents). `WidgetErrorBoundary` contains failures to one card.
- **Logging.** `src/lib/log.ts` keeps the last 200 entries in memory (`getRecentErrors()`, `formatLogs()`); nothing is sent anywhere.

## Quality gates

| Gate | Command | CI job |
|------|---------|--------|
| Content guards | grep for leaked prompt text, stray `'''` and mojibake | `guards` |
| Types | `npm run typecheck` (strict; app, configs, e2e) | `typecheck` (Node 20, 22) |
| Lint | `npm run lint` (errors block; `lint:strict` reports warnings) | `lint` |
| Unit tests | `npm run test:coverage` (lcov uploaded) | `test` (Node 20, 22) |
| Build | `npm run build` | `build` (Node 20, 22) |
| Smoke | `npm run test:e2e` (every route, desktop and 375 px, proxy offline) | `e2e` |
| Proxy | start `proxy-server.mjs`, `GET /health` | `proxy-smoke` |
| Audit | `npm audit --audit-level=high` (non-blocking) | `audit` |

## File ownership conventions

The codebase is organised so that several people (or agents) can work in parallel without stepping on each other:

- **Feature code lives in its own folder or file**: `src/lib/<feature>/*` for logic, `src/pages/<Feature>.tsx` for the page, `src/components/<feature>/*` for its widgets.
- **Shared modules have one owner** and change through small, reviewed PRs: `src/lib/options/**` (maths), `src/lib/api/**` and `marketApi.ts` (data), `src/index.css` / `tailwind.config.ts` / `src/components/ui/**` (theme), `src/lib/routes.ts` (navigation).
- **Integration points** (`src/App.tsx`, `AppSidebar.tsx`, `CommandPalette.tsx`) are edited last, by whoever merges the feature, and only to wire registry entries.
- **Missing shared helpers**: write a small local helper in your feature folder, then propose moving it into the shared module in a follow-up PR. Do not copy-paste maths.
