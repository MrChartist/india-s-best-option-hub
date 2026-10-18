# Broker adapter contract (v1)

How every one of the 33 broker adapters in `server/brokers/` should look, how to prove it, and what each broker engineer fills in. The code is the source of truth: `server/brokers/contract.mjs` (with `orderGate.mjs`), `contractShapes.mjs`, `contractHarness.mjs` and `sessionLogin.mjs`. Dhan (`dhan.mjs` + `dhanContract.mjs`, fixtures in `__fixtures__/dhan/`) is the reference adapter.

## 0. Licence rule (read first)

OpenAlgo (`scratchpad/ref/openalgo`) is **AGPL-3.0**; this project is **MIT**.

- Use OpenAlgo only as a **factual** reference: endpoint URLs, HTTP methods, auth steps, request/response field names, exchange/segment codes, instrument-master URLs and formats.
- **Never** copy, paste or translate its code, comments, docstrings or structure line by line. Write your own idiomatic ESM in this repo's style. Do not add it as a dependency.
- Check every fact against the broker's **official** API docs. Where OpenAlgo and the official docs disagree, follow the official docs and say so in the file header and in your checklist.
- Fixture payloads come from official doc samples or your own sandbox account, never from OpenAlgo's test data. Replace every token, account ID and name with a dummy value.

## 1. Files

| File | What it holds |
|---|---|
| `server/brokers/contract.mjs` | `CAPABILITIES`, `AUTH_KINDS`, `CANONICAL_UNDERLYINGS`, `FORBIDDEN_SECRET_KEY`, JSDoc types for every normalised shape, error classes (`BrokerError`, `SessionRequiredError`, `OrderGateError`, `BrokerInputError`), `normaliseError`, `redactSecrets`, `validateAdapter`, `declaredCapabilities`. Re-exports the order gate. |
| `server/brokers/orderGate.mjs` | `withOrderGate`, `issueOrderGate`, `consumeOrderGate`, `isOrderGated`. |
| `server/brokers/contractShapes.mjs` | `check*` shape validators (one per capability) and `toOptionData` (a mirror of the app's `parseDhanLeg`). |
| `server/brokers/contractHarness.mjs` | `loadFixtures`, `createFetchStub`, `runContractHarness`, `runLoginContract`, `harnessFailures`. |
| `server/brokers/sessionLogin.mjs` | Helpers for session-login adapters (`readTotpCode`, `requireFields`, `sessionFromCreds`, `nextIstMidnightMs`) and the `/api/broker-session-login` handler and rate limiter. |
| `server/brokers/__fixtures__/<id>/` | `manifest.json` + one `<capability>.json` per declared capability (+ `login.json` for session login). |
| `server/brokers/contract.test.mjs` | The harness proven on Dhan, plus gate and `validateAdapter` rules. Also checks that **all 33** adapters pass the lenient contract. |
| `server/brokers/sessionLogin.test.mjs` | All 8 session-login brokers: strict contract, login fixture, no network before login, UI prompts match the adapter. |
| `src/lib/brokerConfig.ts` | `SESSION_LOGIN_BROKER_IDS`, `sessionLogin.prompts`, `getBrokerSessionState`, `withSession`. |
| `src/components/BrokerSessionLoginDialog.tsx` | The "Log in" dialog. |

The vitest `server` project already picks up `server/**/*.{test,spec}.mjs`, so a new `server/brokers/<id>.test.mjs` runs with no config change.

## 2. Adapter shape

Every adapter module exports:

```js
export const id = "mybroker";                       // matches src/lib/brokerConfig.ts and registry.mjs
export const credentialFields = ["apiKey", ...];    // stored, NON-secret fields only
export const capabilities = { auth: { kind: "..." }, testConnection: true, expiries: true, optionChain: { greeks: "broker"|"computed" }, ltp: true, ... };
export async function testConnection(creds) {}      // + one function per declared capability (table below)
```

**Strict and lenient modes.** `validateAdapter(mod)` runs in *strict* mode as soon as `capabilities.auth` exists. In strict mode every declared capability must have its method, order methods must be gated, `credentialFields` may not contain secret keys, and session-login metadata must be complete. Adapters not yet moved to the contract are checked *leniently*: only `id`, `credentialFields` and the four registry basics. The older order-feature keys (`bracket`, `cover`, `ioc`, `mtf`, `nativeMarketProtection`, `maxLegQty`, `products`) may stay in the same `capabilities` object.

### Capabilities

`creds` is always the first argument. It holds the saved non-secret fields plus any session fields. It never holds a password, PIN or TOTP value: the proxy strips those keys from `x-broker-credentials`.

| Capability | Method (aliases) | Signature after `creds` | Returns (`{ status: "success", data }` unless noted) | Required |
|---|---|---|---|---|
| `auth` | (none, metadata only) | `{ kind, loginFields?, sessionFields? }` | | yes |
| `testConnection` | `testConnection` | () | `{ status: "success"\|"error", message }`. Must make **one cheap authenticated call**; never throws. | yes |
| `instruments` | `fetchInstruments` | () | `Instrument[]`. Index derivatives use `underlying` ∈ NIFTY, BANKNIFTY, FINNIFTY, MIDCPNIFTY, SENSEX, BANKEX. ISO `expiry`, numeric `strike`, `optionType` CE/PE, `lotSize`, `tickSize`. | no |
| `expiries` | `fetchExpiryList` | (symbol) | `string[]`, ISO `YYYY-MM-DD`, ascending | yes |
| `optionChain` | `fetchOptionChain` | (symbol, expiry?) | `{ oc: { "<strike>": { ce?, pe? } }, last_price }`. Dhan-shaped legs: `last_price, oi, oi_chg\|previous_oi, volume, iv (PERCENT), delta, gamma, theta, vega, bid_price, ask_price`. `toOptionData()` must produce finite numbers. | yes |
| `ltp` | `fetchLTP` | (symbol) | `{ last_price }` (a positive number) | yes |
| `quotes` | `fetchQuotes` | (refs: `{token, exchange}[]`) | `Quote[]` with `ltp, open, high, low, close, volume, oi, bid, ask` (null when the broker lacks a field) | no |
| `depth` | `fetchDepth` | (ref) | `{ bids: [{price, qty, orders}], asks: [...] }` | no |
| `historical` | `fetchHistorical` | ({ instrument, interval, from, to }) | `Candle[]`: `time` is epoch **seconds**, strictly ascending | no |
| `feed` | `createFeed` | ({ onTick, onStatus }) | `{ subscribe(refs), unsubscribe(refs), close() }` (no fixture; test it with its own unit test) | no |
| `positions` | `fetchPositions` | () | `Position[]` | no |
| `holdings` | `fetchHoldings` | () | `Holding[]` | no |
| `funds` | `fetchFunds` | () | `{ availableCash, usedMargin, totalBalance, collateral, withdrawable }` | no |
| `orderBook` | `fetchOrderBook` (`getOrders`) | () | `Order[]`, with `status` ∈ OPEN, TRIGGER_PENDING, PARTIALLY_FILLED, COMPLETE, CANCELLED, REJECTED, EXPIRED, UNKNOWN | no |
| `tradeBook` | `fetchTradeBook` | () | `Trade[]` | no |
| `placeOrder` | `placeOrder` (**gated**) | (order, resolvedLotSize, gate) | `OrderAck { orderId, orderStatus }` (not enveloped) | no |
| `modifyOrder` | `modifyOrder` (**gated**) | (orderId, changes, gate) | `OrderAck` | no |
| `cancelOrder` | `cancelOrder` (**gated**) | (orderId, gate) | `OrderAck` | no |
| `normaliseError` | `normaliseError` | (err, { secrets }) | `{ statusCode: 422\|502, code, message }` (secrets redacted). `export { normaliseError } from "./contract.mjs"` is fine. | no |

Field lists for `Position`, `Holding`, `Order`, `Trade`, `Quote` and `Instrument` are in the JSDoc in `contract.mjs`. Products use the app-wide vocabulary: CNC, INTRADAY, MARGIN, MTF, CO, BO. Exchanges are NSE, BSE, NFO, BFO, MCX and CDS.

### Auth kinds

| `auth.kind` | Meaning | What is stored |
|---|---|---|
| `apiKeyToken` | User pastes a long-lived key or token (or a key pair the adapter swaps server-side, e.g. the XTS family). | The keys |
| `oauthRedirect` | Broker login page redirects back with a code that the adapter exchanges. | Key, secret, access token |
| `requestTokenExchange` | User pastes a one-time request or auth code that the adapter swaps for a session. | Key, secret, code or session |
| `sessionLogin` | User types the password/PIN **and the current 6-digit TOTP code** each session. | **Only** the returned session fields |

## 3. Errors: the 422/502 convention

- **422** means *we refused* (local decision): `SESSION_LOGIN_REQUIRED` (`SessionRequiredError`), `ORDER_GATE_CLOSED` (`OrderGateError`), `BROKER_INPUT_INVALID` (`BrokerInputError`).
- **502** means *the upstream failed or refused*: `UPSTREAM_ERROR` by default. Broker-specific codes such as `UPSTREAM_AUTH` and `UPSTREAM_RATE_LIMIT` are welcome (see `dhanContract.normaliseError`).
- `/api/broker-proxy` answers 422 + `code` for any `BrokerError` with status 422, and does not serve stale last-good data in that case. Every other error keeps the existing 502 / last-good behaviour.
- Error messages must never contain credentials. `normaliseError(e, { secrets })` redacts them, and the session-login route redacts again.

## 4. Order gate (real money)

- Every order method must be `withOrderGate("placeOrder"|"modifyOrder"|"cancelOrder", impl, { brokerId })`. The gate is the **last** argument.
- Without a gate, with a forged object or with a reused or stale gate (5 s), the method throws `OrderGateError` **before any network call**. The harness checks all three cases.
- Gates are minted only by `issueOrderGate({ verdict, liveArmed: true, action, brokerId })` after `validateOrder()` has passed. **No route mints gates for non-Dhan brokers today.** The browser order path stays blocked pending owner review. Do not add one.
- The existing Dhan 1Cliq routes keep calling `server/lib/dhanOrders.mjs` behind `validateOrder` and live arming. The risk engine and basket-deploy never place real orders. Panic close/cancel always re-fetch authoritative broker state.
- Resolved: every adapter's `placeOrder`/`modifyOrder`/`cancelOrder` is now wrapped with `withOrderGate()` (all 33 are strict). No route mints a gate for them and `/api/broker-proxy` answers `403 ORDER_PATH_BLOCKED` for order endpoints.

## 5. Session login (password/PIN + current TOTP)

```
Broker Settings "Log in" dialog --POST {values, secrets}--> /api/broker-session-login?broker=<id>
      (type=password, autocomplete=one-time-code, state only)     |  loopback/Origin check, JSON, 4 KB cap,
                                                                   |  5 attempts/min per IP+broker, no logging
                                                                   v
                                                         adapter.login({...values, ...secrets})
                                                                   |  returns { session, expiresAt }
browser saves values + session + sessionExpiresAt  <--  only declared auth.sessionFields go back
(same session-only/encrypted store as every key)
```

- `capabilities.auth = { kind: "sessionLogin", loginFields: [{ key, label, kind: "secret"|"totp" }], sessionFields: ["sessionToken", ...] }`. `loginFields` must include `{ key: "totpCode", kind: "totp" }`. Session field names must not match `FORBIDDEN_SECRET_KEY`.
- `login(creds)`: call `requireFields` for the stored and secret fields, then `readTotpCode(creds)` (refuses anything but 6 digits, before any network call). Make the broker call(s) and return `{ session, expiresAt }`. Never cache by, log or return a secret.
- Data calls: `sessionFromCreds(creds, SESSION_FIELDS, name)` throws `SessionRequiredError` when not logged in or expired. Call it **before** any instrument-master download. A broker-side token rejection must throw `SessionRequiredError`. There is no auto re-login.
- Frontend: add the id to `SESSION_LOGIN_BROKER_IDS` in `src/lib/brokerConfig.ts`. Prompts come from the catalogue's secret fields, and a TOTP secret becomes `totpCode`. `sessionLogin.test.mjs` fails if the UI prompts or saveable fields drift from the adapter.
- Already done for: angelone, fivepaisa, firstock, kotak, motilal, mstock, nubra, tradejini (login fixtures only; data-capability fixtures are each engineer's job). Kotak's `sessionBaseUrl` is pinned to `https://*.kotaksecurities.com` at login and on every use.

## 6. Fixtures and the harness

1. Create `server/brokers/__fixtures__/<id>/manifest.json`:
   ```json
   { "brokerId": "<id>", "creds": { "apiKey": "dummy" }, "symbol": "NIFTY", "expiry": "2026-10-20",
     "sources": ["<official doc URL for every payload>"], "notes": "..." }
   ```
2. Add one `<capability>.json` per declared capability (`login.json` for session login):
   ```json
   { "args": ["NIFTY", "2026-10-20"],
     "creds": { "sessionToken": "dummy" },
     "secrets": { "password": "...", "totpCode": "123456" },
     "responses": [ { "method": "POST", "url": "https://api.broker/...", "urlPattern": "regex (optional)",
                      "expectBody": { "partial": "request body match" },
                      "status": 200, "json": { }, "text": "for CSV/plain bodies", "headers": { } } ],
     "expect": { "minRows": 1, "minStrikes": 3, "status": "success", "underlyings": ["NIFTY", "BANKNIFTY"] } }
   ```
   `args` defaults: `expiries`/`ltp` use `[symbol]`; `optionChain` uses `[symbol, expiry]`; the rest use `[]`. Order fixtures pass `args` without the gate: the harness adds no gate, a forged gate and a real gate in turn. `secrets` applies to `login.json` only. Any request that no response matches fails the capability, so no harness run can reach the network.
3. Add `server/brokers/<id>.contract.test.mjs`:
   ```js
   import { expect, it } from "vitest";
   import * as adapter from "./<id>.mjs";
   import { validateAdapter } from "./contract.mjs";
   import { harnessFailures, loadFixtures, runContractHarness } from "./contractHarness.mjs";
   it("<id> meets the contract", async () => {
     expect(validateAdapter(adapter).errors).toEqual([]);
     expect(harnessFailures(await runContractHarness(adapter, loadFixtures("<id>")))).toEqual([]);
   });
   ```
4. Limits: the harness stubs `fetch` only. Code that uses `node:https` (mStock quotes) or WebSockets (Tradejini, Alice Blue, Pocketful) needs its own small unit test around a pure parser; keep the network call thin. Module-level instrument caches persist between capabilities in one run, so include the master download in the first fixture that needs it.

## 7. OpenAlgo capability map (facts only)

OpenAlgo's `broker/<name>/` covers: `api/auth_api.py` → `auth`/`login`; `api/data.py` → `quotes`, `depth`, `historical`; `api/order_api.py` → `orderBook`, `tradeBook`, `positions`, `holdings`, `placeOrder`, `modifyOrder`, `cancelOrder`; `api/funds.py` → `funds`; `database/master_contract_db.py` → `instruments` (master URL and columns); `mapping/` → exchange, product and order-type codes; `streaming/` → `feed`. Its GTT, margin calculator, "smart order" and close-all helpers are **out of scope** for v1. Read those files for endpoint and field facts, then confirm each one in the official docs.

## 8. Current status

All 33 adapters are on the strict contract with a full fixture harness (`validateAdapter` strict, `runContractHarness` with no failures). Only Dhan has been verified against a live account; the rest are beta. The user-facing table, with capabilities and docs links, is in [BROKERS.md](BROKERS.md); `src/lib/brokerCapabilities.generated.ts` is generated from the adapters (`node scripts/generate-broker-capabilities.mjs`).

| `auth.kind` | Brokers |
|---|---|
| apiKeyToken | dhan, groww, hdfcsecurities, hdfcsky, ibulls, jainamxts, paytm, pocketful, rmoney, samco, wisdom |
| oauthRedirect | zerodha, upstox, fyers |
| requestTokenExchange | aliceblue, arrow, compositedge, flattrade, iifl, iiflcapital, shoonya, tradesmart, zebu |
| sessionLogin | angelone, definedge, fivepaisa, firstock, indmoney, kotak, motilal, mstock, nubra, tradejini |

Known follow-ups (not blocking): OAuth/third-party callback routes (zerodha, upstox, compositedge) so users need not paste tokens; streaming feeds for the brokers that do not declare `feed`; `server/lib/batch.mjs` swallows `SessionRequiredError` (the brokers that hit this stopped using it); `server/lib/dhanPacketParser.mjs` differs from the official v2 feed layout (SENSEX id 51, BANKEX 69, float32 prices) but only its `tickKey` helper is used in production, the proxy has its own float32 decoder.

## 9. Per-broker checklist (copy into your PR description)

```
### Broker: <id>  —  engineer: <name>
Official docs: <URLs>                     OpenAlgo consulted for facts only: yes/no
Disagreements (OpenAlgo vs official, what we followed):
-

Auth
- [ ] auth.kind = ____  (sessionLogin: loginFields + sessionFields declared; id added to SESSION_LOGIN_BROKER_IDS)
- [ ] credentialFields lists only non-secret fields; catalogue fields in brokerCatalogPart*.ts match
- [ ] Session expiry: ____ (documented? source)  ·  token-rejection signal: ____ → SessionRequiredError
- [ ] testConnection makes one cheap authenticated call (endpoint: ____)

Market data
- [ ] instruments: master URL ____, format ____, refresh ____; NIFTY/BANKNIFTY/FINNIFTY/MIDCPNIFTY/SENSEX/BANKEX + stocks mapped
- [ ] expiries: ISO, ascending
- [ ] optionChain: native endpoint? __ / built from master + quotes; greeks: broker|computed; IV in percent; bid/ask; oi change source
- [ ] ltp for all six indices (index tokens: ____)
- [ ] quotes / depth / historical (intervals supported: ____) / feed (ws URL, auth, binary or JSON) — or explicitly not declared

Portfolio (read-only)
- [ ] positions  - [ ] holdings  - [ ] funds  - [ ] orderBook (status mapping table below)  - [ ] tradeBook
Broker status → contract status: ____ → OPEN, ____ → COMPLETE, ...

Orders (real money; stays behind the gate, no new route)
- [ ] placeOrder / modifyOrder / cancelOrder wrapped with withOrderGate(…, { brokerId })
- [ ] buildOrderBody pure + unit-tested; resolvedLotSize required, never from the client
- [ ] product/order-type/validity mapping verified against official docs (no guessed enums)
- [ ] legacy order-feature descriptor (bracket/cover/ioc/mtf/…) conservative, sourced

Errors and safety
- [ ] normaliseError: 422 for refusals, 502 for upstream; broker error codes mapped: ____
- [ ] No secret in logs, errors, cache keys, fixtures or the result of login()
- [ ] Rate limits documented (____ req/s) and respected (batch size/delay)
- [ ] No new hosts outside the broker's official API domains; any host returned by the broker is pinned

Tests and fixtures
- [ ] __fixtures__/<id>/manifest.json with official sources; one fixture per declared capability (+ login.json)
- [ ] <id>.contract.test.mjs: validateAdapter(strict) has no errors; runContractHarness has no failures
- [ ] npm run typecheck · npm run lint · npx vitest run --project server · node --check server/brokers/<id>*.mjs

Licence (required before merge; see section 0)
- [ ] node scripts/check-openalgo-overlap.mjs --ref <local OpenAlgo checkout> <id>
      Every shared 6-token run it lists is an endpoint path, a documented field name or a documented constant.
      Anything else (helper shape, header/filler values, log or error text, literal tables in OpenAlgo's order)
      has been rewritten from the official docs. Paste the script's summary line here: ____
- [ ] Any fact taken from OpenAlgo because the official docs omit it is named in the file header and in
      "Disagreements" above, and flagged for live verification
```
