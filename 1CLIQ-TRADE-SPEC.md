# 1Cliq Trade — Build Spec for options-desk

**Date:** 2026-09-06
**Author:** synthesized from a 10-agent design brainstorm against the live repo
**Status:** design agreed, scope pending decision (see §0)

---

## 0. The decision that gates everything

The 10th agent researched the SEBI position and it changes the shape of this build.

**SEBI's retail algo-trading framework (circular SEBI/HO/MIRSD/MIRSD-PoD/P/CIR/2025/13, 4 Feb 2025) reached full applicability on 1 April 2026. It is in force today.**

The feature list splits cleanly along the regulatory line:

| Feature | Classification |
|---|---|
| Arrow-key order entry, F6 close-all, F7 cancel-all | **Manual order entry.** One keystroke = one order. Not an algo. |
| Auto trailing SL, MTM auto square-off, tranched baskets | **Automation.** Orders generated with no human at the decision moment. |
| "Ditto" multi-account replication | **Highest risk.** Third-party accounts = unregistered PMS / copy-trading territory. |

Two very different projects:

- **Running it privately on Rohit's own account** — permitted. Self-developed algos under the 10 orders/second threshold need no exchange registration. Requires static-IP whitelisting (already documented in `server/lib/dhanOrders.mjs`), OAuth auth, Indian-hosted server.
- **Distributing it to the community so they can trade with it** — makes Rohit an *algo provider*: broker tie-up plus exchange empanelment, comparable to Authorised Person registration. Worse, **black-box algos require the provider to hold an RA licence** — so his INH000015297 becomes the hook that drags execution activity under his registration rather than shielding it.

**Recommendation from the compliance agent:** build it, use it, don't distribute it. Community gets the analytics layer; execution stays personal. Cut Ditto beyond self-and-family outright.

This is not a refusal — it's the input Rohit needs to choose deliberately. Get a one-page written opinion from a SEBI-practice lawyer before any distribution.

---

## 1. What 1Cliq actually is

1Cliq (1cliqtrade.com), built by OI Pulse / Sivakumar Jayachandran. Was ₹13,999/yr; now **free for all Dhan users** via an official Dhan collaboration. Supports 11 brokers: TradeSmart, Zerodha, ProStocks, Fyers, Finvasia, Kotak Neo, 5Paisa, AliceBlue, FlatTrade, Dhan, Goodwill. No Upstox, no Angel One.

**Feature set:**
- 1-click execution; arrow keys place rapid market orders
- SL & Target placed on **spot/futures levels, in points** — not on option premium. This is the headline differentiator.
- Auto trailing SL (and manual), MTM trail
- MTM-based controls: exit all at a preset profit/loss
- Kill switch; cancel-all-orders; close-all-positions (F6/F7)
- Percentage exits: 25 / 50 / 75 / 100% of a position in one click
- Ready basket orders, executed **in tranches to reduce slippage**
- Consolidated order book across multiple broker accounts
- "Ditto" — replicate one trade across several accounts
- Asset-wise position grouping with separate SL/Target/MTM

**Documented weaknesses (from the X-Trader comparison review):**
- **All logic runs in the browser tab.** "The moment that tab closes or your connection drops, every automation stops." This is their structural flaw.
- No keyboard shortcut for stop-loss entry, none for limit entry
- No bracket or cover orders
- No follow-up / leg-dependency orders
- No paper mode at all

**Sources:** [X-Trader vs 1Cliq comparison](https://optionx.trade/blogs/x-trader-vs-1cliq-oi-pulse) · [MadeForTrade — free for Dhan users](https://madefortrade.in/t/1cliq-is-now-free-for-all-dhan-users/63771) · [1Cliq integrated with Dhan](https://madefortrade.in/t/1cliq-is-now-integrated-with-dhan/8647) · [Dhan announcement on X](https://x.com/DhanHQ/status/2045016174510129569) · [SEBI extension circular, 30 Sep 2025](https://www.sebi.gov.in/legal/circulars/sep-2025/extension-of-timeline-for-implementation-of-sebi-circular-dated-february-04-2025-on-safer-participation-of-retail-investors-in-algorithmic-trading-_96979.html) · [Zerodha explainer on the algo rules](https://zerodha.com/z-connect/business-updates/explaining-the-latest-sebi-algo-trading-regulations) · [NSE retail algo FAQ](https://nsearchives.nseindia.com/web/sites/default/files/inline-files/FAQ_Retail%20Algo_03112025_NSE.pdf)

---

## 2. Blockers found in the repo (verified, not assumed)

These must be fixed before any execution feature is trustworthy.

### B1 — Lot sizes are stale. This is a real-money bug. 🔴
`src/lib/positionStore.ts:10` — `LOT_SIZE_MAP` has `NIFTY: 25`, `BANKNIFTY: 15`, `FINNIFTY: 25`, `MIDCPNIFTY: 50`, `SENSEX: 10`.

The user's own 1Cliq screenshot corroborates the problem: it shows BANKNIFTY at **"Qty (In Lot: 1)" = 30**, i.e. one lot is 30, while this repo says 15. NSE revised index lot sizes in Nov 2024 and the map never caught up.

`server/lib/dhanOrders.mjs:52` computes `quantity = lots × lotSize` server-side — good design — but from the number the **frontend sent**, sourced from this stale map. A wrong constant here silently places roughly half (or double) the intended size at market.

**Fix:** remove `lotSize` from the wire format entirely. The server resolves it from the broker's own instrument master (all 33 adapters already download one) and rejects the order if it can't. Add a hard notional ceiling per intent.

### B2 — Zero of 33 broker adapters have order code
Verified by grep: all 33 export only `testConnection` / `fetchOptionChain` / `fetchLTP` / `fetchExpiryList`. The only order code in the repo is `server/lib/dhanOrders.mjs`. `server/brokers/registry.mjs:30-36` documents a `placeOrder` contract that nothing implements.

The "33 brokers" advantage is real for **market data** and currently zero for **execution**.

### B3 — No portfolio endpoints exist
`/api/dhan-proxy` supports exactly: `option-chain, expiry-list, ltp, instruments, futures-quotes, rollover, place-order, orders, order-status, cancel-order, historical`.

Missing and required for the terminal's tab strip: `positions`, `holdings`, `funds`, `trades`, `modify-order`. Four of the seven tabs in the reference UI have no backend at all.

### B4 — There is no option tick stream
`proxy-server.mjs:1044-1050` subscribes exactly 5 hardcoded index securityIds (NIFTY, BANKNIFTY, FINNIFTY, MIDCPNIFTY, INDIAVIX). **Zero option contracts stream.** Option LTP comes from REST polling: 3s client refetch + 5s server cache ⇒ **real end-to-end staleness ≈ 3–10s, typically ~6s**.

A scalping terminal on 6-second-old prices is not a scalping terminal. A dynamic-subscribe handler exists at `proxy-server.mjs:1310-1319` but nothing ever sends it.

### B5 — Tick pipeline defects
- **Multi-packet truncation:** `parseDhanBinaryPacket` (`proxy-server.mjs:1056-1072`) reads one packet from offset 0 and returns; the header's message-length field is never used, so multi-packet frames lose everything after the first. Harmless at 5 instruments, severe at 40+.
- **Key collision:** `latestTicks` is keyed by `securityId` alone (`:1218`). An option contract with id 13 overwrites index id 13 — the exact value a spot-referenced stop-loss reads.
- **Reconnect bug:** `credentialsSent` never resets (`src/lib/websocketClient.ts:72,127`), so after a proxy restart the browser never re-sends credentials.

### B6 — Multi-account is impossible today
`src/lib/brokerConfig.ts` keys `BrokerCredentials` by `brokerId`, and `saveBrokerCredentials` overwrites by that key. Two Dhan accounts cannot coexist. Prerequisite refactor for a consolidated book (and for Ditto, if it survives §0).

### B7 — Design-system drift
`src/index.css:17` sets `--primary: 173 49% 36%` (teal); `D:\AG\design_system.md` mandates coral `#FF6633` / `hsl(16 100% 60%)`. Decide which is canonical before this feature forks it a third time.

### Corrected claim
One agent reported `src/lib/marketApi.ts:599` had backslashes in the template literal, making `fetchOrders()` dead. **Verified false** — the URL is correct. Ignore.

---

## 3. Architecture — the one decision that defines the product

**The risk engine runs on the server, not in the browser tab.**

1Cliq's documented fatal flaw is that closing the tab kills every trailing stop. This repo already runs `proxy-server.mjs`, which owns the single Dhan WebSocket, the tick cache and the order credentials. Background browser tabs throttle timers to ≥1s or freeze outright — the existing 5s `setInterval` pattern in `src/hooks/useAlertEngine.ts` is fine for alerts and malpractice for stops.

So: **the browser is a view and an arming client. It never places an exit for a managed leg.** The UI posts an *intent* to `/api/risk/exit` and the same server state machine handles it. That single-writer rule is what prevents double-exit.

```
Dhan WS ──► parse ──► tickBus ──► riskEngine.evaluate() ──► placeOrder()
                          │
                          └──► per-client fan-out ──► browser (view only)
```

Risk engine evaluates **before** the browser fan-out, so an exit is never late because a UI client was slow.

---

## 4. Spot-referenced SL/Target — the core maths

Anchor `S0` = spot tick captured at fill time (server-side; never from `SPOT_PRICE_MAP`).

```
bias = (action === "BUY" ? +1 : -1) * (type === "CE" ? +1 : -1)
adv  = bias * (spot - S0)      // points in your favour, sign-normalised
SL trigger:     adv <= -slPts
Target trigger: adv >=  tgtPts
```

Precompute and display absolute levels: `slLevel = S0 - bias*slPts`, `tgtLevel = S0 + bias*tgtPts`.

With S0 = 58090, SL 50 pts, Target 80 pts:

| Leg | bias | SL fires | Target fires |
|---|---|---|---|
| BUY 58000 **CE** | +1 | spot ≤ **58040** | spot ≥ **58170** |
| SELL **CE** | −1 | spot ≥ **58140** | spot ≤ **58010** |
| BUY **PE** | −1 | spot ≥ **58140** | spot ≤ **58010** |
| SELL **PE** | +1 | spot ≤ **58040** | spot ≥ **58170** |

Use `<=` / `>=` so gaps fire. Require 2 consecutive ticks past the level (~300ms) to reject single bad prints. Arm-time validation rejects configs where `bias*(tgtLevel - slLevel) <= 0`.

**Trailing**, all in `adv` space so it is direction-agnostic. State: `mfe = max(adv)`, `stopAdv` (exit when `adv <= stopAdv`), initialised `-slPts`.

**Ratchet invariant — one line, and the whole safety property:**
```js
stopAdv = Math.max(stopAdv, candidate)   // never decreases, any leg direction
```

- Fixed-point: `mfe >= activation ? candidate = mfe - trailPts : skip`
- Percentage give-back: `mfe > 0 ? candidate = mfe * (1 - p) : skip`
- Step/ratchet: `steps = mfe >= A ? floor((mfe - A)/stepX) : 0; candidate = -slPts + steps*stepY`

### Managed-position state machine
```
IDLE ──arm──► ARMED ──disarm──► IDLE
                │
                ├─(predicate true, SYNCHRONOUS CAS)─► TRIGGERED
                └─(broker shows leg gone)──────────► ORPHANED (alarm, no order)

TRIGGERED ──submit ok──► EXIT_SUBMITTED ──► EXIT_CONFIRMED (terminal)
          └─throws────► EXIT_FAILED           ├─ partial ──► PARTIAL ──► ARMED' (residual)
                                              ├─ rejected ─► EXIT_FAILED
                                              └─ no terminal in 5s / reboot ──► RECONCILING

EXIT_FAILED ──retryBudget>0 AND reconcile proves no fill──► TRIGGERED
            ──else──► NEEDS_ATTENTION (manual only; engine never re-submits)
```

`ARMED → TRIGGERED` is a **synchronous compare-and-set before any `await`**. Retry budget 2. A rejection never re-fires without a positive "no fill" answer from the broker.

**Dead-man's switch:** the engine writes `lastHeartbeat` every 1s; `/api/risk/status` returns `{alive, lastTickAgeMs, armedCount, dhanConnected}`. The armed badge in the UI renders **only** from server-confirmed status, never optimistic client state. Since a dead engine cannot act, the real answer to 1Cliq's flaw is **broker-resident protection**: at arm time also place a wide SL-M at the premium equivalent, which the engine cancel-replaces as the trail tightens.

---

## 5. Panic layer

**Close All is a three-wave pipeline, never a fan-out:**
- **Wave A** — buy-to-close all SHORT options, sorted by |unrealised loss| descending
- **Wave B** — sell-to-close LONG options (hedges)
- **Wave C** — futures / equity legs

Closing a hedge before its short leg re-classifies a spread as naked, spikes SPAN margin, and gets the remaining legs rejected. Within a wave: concurrency 3, MARKET/IOC. Between waves: a hard barrier — poll until every Wave-A order is terminal.

**Rejection handling, classified from the broker's own message:**
- freeze-qty → split into slices, retry (the only auto-retry that changes the payload)
- insufficient margin → stop Wave B, resume Wave A (unwinding shorts releases margin)
- market closed / circuit → terminal, zero retries
- network/5xx → 2 retries, 400ms → 1200ms jittered

The sweep **never reports success while any leg is open.** Success requires a re-verified empty book, not HTTP 200s.

**Cancel-all vs in-flight placements:** a module-level `panicGate` with a `placementEpoch` counter, incremented **synchronously before any network call**. Entry paths check the gate and abort pre-flight; any placement returning with a stale epoch is immediately cancelled, or pushed into the close-all queue if it already shows TRADED. Cancel-all runs twice, 1.5s apart, re-fetching the book between passes. In a combined panic, **cancel-all always precedes close-all**.

**`tradingLockState`** — `unlocked | locked-by-user | locked-by-mtm-loss | locked-by-daily-loss-limit | locked-by-engine-fault`. Persists across reload (a lock you can clear with F5 is not a lock). Reads **fail closed**: parse error ⇒ `locked-by-engine-fault`. Panic controls stay live while locked — you must always be able to exit. Loss-triggered locks require a 10-minute cooling timer plus typing the realised loss figure; the friction is the product.

**Partial exits:** lots are indivisible. 25% of 3 lots = 0.75 → **disable the button** with "25% of 3 lots rounds to 0 — minimum 1 lot (33%)". Never silently round up. Label buttons with the resolved outcome (`25% → 1 of 3 lots`), not the bare percentage.

---

## 6. Keyboard layer

Route-scoped hotkeys register on `window` with `capture: true`, so they run *before* the existing bubble-phase global listener in `src/hooks/useKeyboardShortcuts.ts` and call `stopPropagation()` when handled. Existing `/`, `Ctrl+K`, `Ctrl+1..8`, `Alt+A`, `Esc` all survive untouched.

| Key | Action | Confirm |
|---|---|---|
| `↑` `↓` | BUY / SELL Call (market) | HOT only |
| `→` `←` | BUY / SELL Put | HOT only |
| `Shift+↑/↓` | CE strike ±1 | no |
| `Shift+→/←` | PE strike ±1 | no |
| `+` `-` | Qty ±1 lot | no |
| `1`–`5` | Qty presets | no |
| `X` | Exit selected position | no |
| `Alt+1/2/3/4` | Partial exit 25/50/75/100% | 100% only |
| `O` | Toggle one-click HOT ⇄ SAFE | yes to arm |
| `S` / `Shift+S` | Arm auto-SL / place SL on selection | no / yes |
| `B` `A` | Limit at bid / ask | no |
| `F6` `F7` | Close all / Cancel all | see below |
| `Esc` | Disarm (never places) | no |
| `?` | Cheat sheet | no |

`B`/`A`/`Shift+S` fill the two gaps 1Cliq admits to (no limit hotkey, no SL hotkey).

**Four AND-ed arming gates:** Live Trading on → one-click armed (never persisted; every reload is SAFE) → terminal focused or hovered → explicit `O` + confirm. 90s idle auto-disarms; blur auto-disarms.

**SAFE:** neutral panel, dashed border, "ONE-CLICK: OFF — press O to arm".
**HOT:** 3px solid bearish ring with slow pulse, persistent strip `● LIVE · ONE-CLICK ARMED · BANKNIFTY 58000 CE · 2 LOTS · ESC to disarm`, browser tab title prefixed `● HOT`.

**Repeat protection:** reject `e.repeat` outright; 250ms leading-edge throttle per action; token bucket max 3 orders/sec, 20/min. On breach: no order, red RATE LIMIT toast, 2s lockout, and the suppressed keypress is logged.

**F6 always requires a second F6 within 2s** — two keypresses, no dialog, no mouse. F7 (cancel) may fire bare.

**Typing detection must handle shadcn/Radix, not just `INPUT/TEXTAREA/SELECT`:** also `isContentEditable`, `[role="combobox"]`, `[cmdk-input]`, `[data-state="open"][role="dialog"]`, `[role="alertdialog"]`, `document.body[data-scroll-locked]`, `[data-radix-popper-content-wrapper]`.

**Mobile: no one-click, ever.** Four 56px targets requiring **swipe-up-to-confirm** (a drag, not a tap — un-pocket-dialable). Rate cap 1 per 2s.

---

## 7. Paper mode with genuine parity

1Cliq has no paper mode. This is the biggest product opening, and it only works if paper is *real*.

**One execution path; paper and live differ only at the last hop:**
```
OrderIntent → preflight() → ExecutionEngine(adapter) → adapter.place()
```
The engine owns SL, trailing, tranching and partial-fill accounting, so paper exercises them byte-identically.

**Fill model** (pure, seeded PRNG ⇒ reproducible in tests):
- BUY market fills at `ask`, SELL at `bid` — **never LTP**. A paper mode that always fills at LTP teaches bad habits and makes the feature a lie.
- Slippage in ticks (₹0.05): `base = ceil(spread/tick × 0.5)`, ×1.0 ATM / ×1.6 if |delta|<0.15 / ×2.2 if `oi < 50k || volume < 5k`, +1 tick per lot beyond depth-1 quantity
- Partial fills when `lots×lotSize > bestDepthQty` — scalpers must feel this
- Latency 80–250ms, so a keypress doesn't resolve on the same frame
- Deterministic rejections plus 1% stochastic, to build a rejection reflex

`src/lib/marketApi.ts:170-186` already normalises `bidPrice/askPrice/volume/oi/iv/greeks`, so the data exists.

**Pre-trade validation ladder** (ordered; first hard block wins): live armed → market session (IST) → instrument tradable → expiry-day cutoff (warn) → **lot size from the instrument master, never the stale map** → notional ceiling → open-position ceiling → freeze quantity → margin (warn; broker is the authority) → duplicate-intent within 2s.

**Fat-finger defaults:** 10 lots/order · ₹2,00,000 premium/order · ₹10,00,000/day · 15 orders/min · price band ±3% from LTP with a ±₹2 floor (3% of a ₹1.50 weekly is noise). User-editable **downward only**.

**Structural kill-switch — enforcement, not convention.** Today the live gate is checked in UI components (`OptionChain.tsx:359`, `:1118`, `:1135`), which is a convention a future bug can bypass. Replace with two independent gates:
- **Client:** `liveArm.ts` exports `armLive(): LiveArmToken | null` (branded type, private symbol) as the only producer. `placeOrder(order, token: LiveArmToken)` becomes *unconstructible* without it; an ESLint `no-restricted-imports` rule limits the import to `liveAdapter.ts`.
- **Server:** `orderGuard.mjs` re-runs the full ladder plus the rate limiter inside `case "place-order"` before `dhanPlaceOrder`, requiring a per-session arm header.

A client bug alone can no longer place an order.

**Audit log** — append-only NDJSON, dual-written. Server (`.cache/audit/YYYY-MM-DD.ndjson`, IST day key) is authoritative; an IndexedDB mirror powers the in-app viewer. Note `server/lib/dailySnapshotStore.mjs` is a whole-file rewrite, **not** append-only, so it needs a sibling rather than reuse. Every keypress mints an `intentId`; "what happened at 14:32" = filter by timestamp, group by `intentId`, read the chain from keypress to fill.

**Onboarding gate — coverage, not count.** A "20 paper trades" counter is defeated in 20 seconds of clicking. Gate on: ≥10 paper positions opened *and* closed, across ≥2 sessions, including ≥1 SL trigger and ≥1 simulated rejection. One-click auto-disarms at every session start and after 3 consecutive rejections.

---

## 8. Order engine

**Normalized `OrderIntent`** — carries no `quantity` and no `securityId`; both are broker-resolved server-side.

```js
OrderIntent = { intentId, broker, accountId, exchange, segment, underlying, expiry,
  strike, optionType, side, lots, product, variant, limitPrice?, triggerPrice?,
  protectionPct?, validity, slPoints?, targetPoints?, correlationId }
```

**33 adapters must not become 33 copies of HTTP glue.** They cluster into ~5 API families already visible in the tree — Noren/Shoonya (flattrade, shoonya, tradesmart, zebu, firstock, rmoney, wisdom — `tradesmart.mjs:5` already notes "same Noren OMS family"), XTS (jainamxts, compositedge, iifl, ibulls, arrow), Dhan, Kite-like, REST one-offs. So: one `oms-<family>.mjs` (~150 lines) plus a ~40-line per-broker field map and capability block.

**Capabilities descriptor** per adapter (`bracket`, `cover`, `ioc`, `mtf`, `nativeMarketProtection`, `maxLegQty`, `products`…). Rule: the UI never offers a control the capability object doesn't declare. Submit-time validation is a fallback, not the mechanism.

**Market Protection** is a market order expressed as an aggressive limit: BUY → `LTP × (1+pct)`, SELL → `LTP × (1−pct)`. Round to tick with **BUY floor, SELL ceil** so rounding never widens your worst case. Tick = ₹0.05 for NSE options. Use `validity: DAY`, not IOC — IOC plus protection means silent partial fills.

**Slicing** for NSE freeze limits: lot-aligned tranches, sequential (**never `Promise.all`** — parallel legs make a mid-failure unknowable), `correlationId = ${intentId}-${i}`. On leg 3 of 5 failing: **stop, do not auto-unwind, do not retry.** Return `{status:'PARTIAL', filledLots, failedLeg, remainingLots}` and force a blocking "You are 60% filled — Complete remaining / Square off filled / Do nothing" modal.

**Idempotency:** `intentId` minted at *dialog open*, not at click (a remount defeats the current `disabled={busy}` guard in `TradeConfirmDialog.tsx:82`). Server holds a `pendingIntents` map keyed `intentId` with a 90s in-flight lock; a duplicate returns the original result. Dhan supports `correlationId` (`dhanOrders.mjs:56`) so the broker dedups too.

**Static IP:** Dhan gates order endpoints on a whitelisted IP; the Noren-family brokers don't. That is how 1Cliq covers 11 brokers without users buying IPs — they execute from one fixed cloud IP. Same fix here: run the proxy on the VPS and whitelist that one IP.

**Broker phasing:** P0 Dhan (only one with working code). P1 Noren family — flattrade, shoonya, tradesmart, zebu (~2 days for the family, ~2h each after, no static IP needed). P2 Fyers, Zerodha, AliceBlue, 5Paisa, Kotak Neo (OAuth churn, 1–2 days each). P3 XTS family. Everything else stays read-only and honestly labelled.

---

## 9. Baskets

`BasketLeg` stores **specs, not resolved ids**:
```ts
strikeSpec: {kind:"absolute", strike} | {kind:"relative", offset} | {kind:"delta", target}
expirySpec: {kind:"absolute", date} | {kind:"nearest", weeksOut: 0|1|2|"monthly"}
```

`resolveBasket(basket, chain, spot, stepSize)` runs **at deploy time, never at save time**. Monday's `weeksOut:0` naturally becomes Friday's next contract. A leg with no `securityId` is paper-only and **blocks live deploy** — never silently degrade. A Monday `securityId` used on Friday is a valid-looking pointer at an expired contract.

**Tranches:** front-load 6/6/4/4 rather than 5/5/5/5 (early tranches get the pre-impact price). Interval 1500ms ±300ms jitter. Every leg executes its slice of tranche *n* before tranche *n+1*, so the basket stays shape-balanced — a half-filled basket is still a valid smaller version of the same structure. Abort on: underlying drift >0.4%, net cost drift >1.5%, spread widened >2×, any rejection, stale LTP >5s. **A big PAUSE button** — 1Cliq's tranche mode is fire-and-forget.

**Leg ordering:** ENTRY = risk-reducing legs first (long hedges before shorts; placing a short strangle before its hedge means the exchange charges full naked SPAN on both shorts and the hedge arrives too late). EXIT is the exact reverse. One shared `legOrderScore(leg, direction)`, so the two can never drift apart. Test: `orderLegs(l,"exit") === orderLegs(l,"entry").reverse()`.

**Partial-basket failure:** classify residual as `defined` or `undefined` risk. Defined ⇒ hold + alert (auto-unwinding crosses the spread twice to fix a bounded problem). Undefined (naked short) ⇒ **10-second armed auto-unwind countdown, cancellable, defaults to firing**. Dialog opens with plain words — *"You are short 2× 58000 CE with no hedge"* — then Dhan's verbatim rejection reason.

**Follow-up rules**, filling a gap 1Cliq lacks:
```ts
LegRule = { when: {leg, event: "FILLED"|"REJECTED"|"SL_HIT"|"TARGET_HIT"},
            then: {action: "ENTER"|"EXIT"|"CANCEL"|"HALT_BASKET", target: legId|"ALL_REMAINING"} }
```
`evaluateRules(rules, events) → Action[]` is pure. Reject cycles at save time with a DAG check — a rule that re-enters a leg on its own fill is an infinite order generator.

**StrategyBuilder seam:** `handleAddStrategyToPositions` (`StrategyBuilder.tsx:208-214`) already maps legs → `PendingTrade[]`, and `TradeConfirmDialog` already renders arrays. Extract that mapper, add "Save as Basket", and unhardcode `mode="paper"` at line 500. ~40 lines changed in a 592-line file.

**Margin:** *needs verification* — Dhan may document a margin-calculator endpoint, but nothing is wired in this repo and no margin or funds route exists in `server/`. Until verified, use `estimateBasketMargin()` with a hedge-benefit discount and label it **"Est. — not broker-verified"** everywhere.

---

## 10. UI

Route `/one-cliq` **inside** `DashboardLayout` (keep sidebar + ticker). The terminal claims `h-[calc(100dvh-…)] overflow-hidden` with a 7-row grid; only row 7 scrolls. `100dvh`, not `100vh`.

**Grid library:** `@tanstack/react-table` is **not** installed (only query-core + react-query). `src/components/ui/table.tsx` is a 72-line semantic wrapper with no sorting or visibility. Hand-rolling 18 sortable columns plus inline editable cells is ~400 lines of state logic that concentrates a 300-line violation. **Install `@tanstack/react-table@^8`** — headless, ~14kb gz, renders *through* the existing shadcn primitives.

Explicitly **do not** adopt AG Grid: "No Rows To Show" is AG Grid's verbatim default string, so that's what 1Cliq uses; it's 400kb+ with a theme that fights glassmorphism.

**Day-range meter** is a plain div, not `ui/slider.tsx` — the Radix Root is an interactive input with a 20px thumb that will swallow arrow keys from the hotkey layer. Position = `clamp(((v-low)/(high-low))*100, 0, 100)`, and **guard `high === low`** (pre-open and illiquid far-OTM strikes divide by zero).

**Set SL / Set Target cells:** the unit is part of the control, not a convention — `[ 142.50 ][ ₹ ▾ ]` with modes `₹` (absolute) / `Δ` (points from entry) / `%`, always showing the resolved absolute trigger as a sub-label. States: idle / pending (italic + spinner, optimistic) / live (shield icon) / hit (struck through + timestamp) / failed (bearish + retry + verbatim broker message). Optimistic values revert on failure, never linger looking live.

**Paper and live never share a grid.** A segmented control switches datasets; mixing is disallowed. Paper mode carries a persistent tinted rail, dashed row borders, and `≈` prefixed figures. MTM totals are computed per-source and never summed.

**Performance:** ticks live in a `useSyncExternalStore` store keyed `${segment}:${securityId}`, outside react-query. Price cells are memo'd leaves subscribing to their own key, so a quote update never re-renders the page. Coalesce through one `requestAnimationFrame` flush. Full tick rate: the 3 LTP tiles and bid/ask. Throttled 250ms: positions grid P&L. 1s: aggregates. Kill the `new Map(prev)` clone-per-tick in `useWebSocket.ts:73-79`.

**Mobile (390px):** the 16 control-row selects collapse into one tappable chip opening a `vaul` Drawer (already a dependency). Positions render as **cards, not a grid** — 18 columns cannot work at 390px, and horizontally scrolling a table is where every broker app fails. Blocker: `index.html:5` lacks `viewport-fit=cover`, so `env(safe-area-inset-bottom)` is inert and the Buy/Sell row sits under the iOS home indicator.

**Four of seven tabs have no backend** (§B3). Render them visible-but-disabled naming the missing endpoint. Fabricating a Funds figure in an execution terminal is the worst available failure mode.

---

## 11. Roadmap

**Phase 0 — Fix the foundation ✅ SHIPPED**
1. ✅ Lot sizes from the instrument master; `lotSize` removed from the wire format (B1) — `server/lib/instrumentLookup.mjs`
2. ✅ Multi-packet parser + composite tick key + `credentialsSent` reset (B5) — `server/lib/dhanPacketParser.mjs`
3. ✅ Dynamic option subscribe, refcounted with a linger window (B4) — `server/lib/feedSubscriptions.mjs`
4. ✅ `orderGuard.mjs` + `LiveArmToken` — structural enforcement on both sides
5. ✅ IST market session clock — `server/lib/marketHours.mjs`
6. ✅ `accountId` keying + migration; `brokerConfig.ts` split 562 → 169 lines
7. ⬜ Teal vs coral (B7) — left alone; a site-wide palette change was outside this scope

**Phase 1 — Terminal shell, paper only ✅ SHIPPED**
Route `/one-cliq` (Ctrl+9), full layout, CE/spot/PE strip with day-range meters, positions grid with honest partial-exit rounding, the complete keyboard layer with capture-phase scoping, the arming model, the rate limiter, and the real fill model. Live one-click deliberately refuses with a visible message rather than silently paper-filling.

**Defects found and fixed beyond the plan:**
- **Float tick rounding.** `100.05 / 0.05 = 2000.9999…`, so `floor()` moved an already-valid tick price a full tick against the user. Fixed in both the client fill model and the server's `roundToTick`.
- **`orderGuard` used truthiness** for the live gate, so a truthy non-boolean would have opened it. Now strict `=== true`.
- **`useKeyboardShortcuts` matched `Ctrl+Shift+1` as `Ctrl+1`**, which blocked chorded bindings app-wide.

**Corrected from the brainstorm:** one agent reported `marketApi.ts:599` as a dead `fetchOrders()` caused by backslashes in a template literal. Verified against the bytes — false.

**Phase 2 — Server risk engine**
`tickBus`, spot-referenced SL/target, trailing ratchet, state machine, heartbeat, `/api/risk/*`. Still paper-only end to end. This is where the vitest suite earns its keep.

**Phase 3 — Live execution, Dhan only**
`orderGuard`, arming flow, audit log, panic layer (three-wave close-all, cancel-all, `tradingLockState`), portfolio endpoints (`positions`, `holdings`, `funds`, `trades`, `modify-order`).

**Phase 4 — Baskets & tranches**
StrategyBuilder seam, `resolveBasket`, tranche engine with PAUSE, failure classifier, follow-up rules.

**Phase 5 — Broker breadth**
Noren family first (no static IP), then OAuth brokers.

**Deferred pending legal opinion:** Ditto / multi-account replication, and any distribution to third parties (§0).

---

## 12. Must-have tests before any live path ships

Pure functions only, no mocking, following the `server/lib/dhanOrders.test.mjs` precedent:

- `bias` / `slLevel` / `tgtLevel` / `shouldTriggerSL` / `shouldTriggerTarget` — all 4 leg combinations, exact-level equality, gap-through, invalid-config rejection
- `nextStopAdv` — property test: monotone non-decreasing over random tick sequences; activation not crossed early; `mfe <= 0` case
- `transition()` — every illegal edge rejected, partial-fill re-arm, double-trigger blocked
- `sliceOrder`, `buildOrderBody` (extend existing), `withinPriceBand`, `rateLimiter`
- `simulateFill`, `slippageTicks`, `splitPartialFills` — fill price always within `[bid, ask±slip]`; partials sum to the request
- `legOrderScore` — `orderLegs(l,"exit") === orderLegs(l,"entry").reverse()`
- `resolveBasket` — expiry roll, ATM+2 across a spot move, missing-securityId rejection
- `evaluateRules` + cycle rejection
- `sessionFor(date)`, `isExpiryCutoff`, `realisedPnl` (sign symmetry: BUY X→Y ≡ −(SELL X→Y))
- `aggregateMtm` — SELL sign, grouping, kill latch

---

## 13. Top money-losing failure modes, ranked

1. **Stale lot size** (B1) — silently trades 2× the intended size. *Live in the repo right now.*
2. **Double exit** — engine and UI both fire, or a retry lands after an unseen fill, flipping you into an unintended opposite position. Guards: single writer, synchronous CAS, `correlationId`, reconcile-before-retry, PID lock.
3. **Sign inversion on SELL/PE legs** — the "stop" sits on the profitable side; zero protection on the losing side. Guards: one `bias` function, exhaustive 4-combo tests, UI showing absolute levels ("SL if BANKNIFTY ≤ 58,040") so the trader eyeballs the sign before arming.
4. **Hedge closed before its short leg** — naked short, margin rejection, unbounded loss. Guard: the wave barrier.
5. **Sweep reports "done" on a partial** — user walks away short. Guard: post-sweep position re-verify; success requires an empty book, not HTTP 200s.
6. **Silent stale feed / dead engine while the user believes they're armed.** Guards: 1s heartbeat, server-only armed badge, loud degradation states, broker-resident SL-M net.
