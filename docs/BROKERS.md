# Supported brokers

The terminal can read option chains, quotes and your portfolio from **33 Indian brokers** through the local proxy (`npm run proxy`). Keys stay in your browser and go only to the proxy on your own machine, which forwards them to the broker over HTTPS. Passwords, PINs, MPINs and TOTP codes are never stored.

**Verification status.** Only **Dhan** has been verified end to end with a live account. Every other broker is **beta: not yet verified with a live account**. Each adapter was written from the broker's official API documentation and is tested against recorded sample responses (`server/brokers/__fixtures__/`), with no network calls in tests. Please check figures against your broker before relying on them, and report what you find.

**Orders.** Every adapter has order methods, and all of them are wrapped in an order gate that refuses without a valid, single-use, broker-bound gate. No route issues a gate for these brokers and the proxy answers `403 ORDER_PATH_BLOCKED` to order requests, so **no order can be sent from this app through any broker except Dhan**. Dhan orders go through 1Cliq Trade, and only after you switch on live trading and arm the session.

## Capability table

The capability columns are generated from each adapter's declared `capabilities` (see `src/lib/brokerCapabilities.generated.ts`, rebuilt with `node scripts/generate-broker-capabilities.mjs`), the same source the Broker Settings page uses.

| Broker | id | Sign-in (auth kind) | Option chain | Quotes | Live feed | Portfolio | Orders | Official docs | Status |
|---|---|---|---|---|---|---|---|---|---|
| Dhan | `dhan` | API key / token (`apiKeyToken`) | Broker Greeks | Quotes + depth | Live | Full | 1Cliq (armed) | [docs](https://dhanhq.co/docs/v2/) | Verified with a live account |
| 5paisa | `fivepaisa` | Session login (`sessionLogin`) | Computed Greeks | Quotes + depth | — | Full | Blocked | [docs](https://xstream.5paisa.com/dev-docs/) | Beta: not yet verified with a live account |
| Alice Blue | `aliceblue` | One-time code (`requestTokenExchange`) | Computed Greeks | Quotes | — | Full | Blocked | [docs](https://ant.aliceblueonline.com/productdocumentation/) | Beta: not yet verified with a live account |
| Angel One (SmartAPI) | `angelone` | Session login (`sessionLogin`) | Broker Greeks | Quotes + depth | — | Full | Blocked | [docs](https://smartapi.angelone.in/docs) | Beta: not yet verified with a live account |
| Arrow | `arrow` | One-time code (`requestTokenExchange`) | Computed Greeks | Quotes + depth | — | Full | Blocked | [docs](https://docs.arrow.trade/) | Beta: not yet verified with a live account |
| Composite Edge (XTS) | `compositedge` | One-time code (`requestTokenExchange`) | Computed Greeks | Quotes + depth | — | Full | Blocked | [docs](https://symphonyfintech.com/xts-trading-front-end-api/) | Beta: not yet verified with a live account |
| Definedge Securities (INTEGRATE) | `definedge` | Session login (`sessionLogin`) | Computed Greeks | Quotes + depth | — | Full | Blocked | [docs](https://www.definedgesecurities.com/api-documentation/) | Beta: not yet verified with a live account |
| Firstock | `firstock` | Session login (`sessionLogin`) | Broker Greeks | Quotes + depth | — | Full | Blocked | [docs](https://firstock.in/api/docs/) | Beta: not yet verified with a live account |
| Flattrade (Pi) | `flattrade` | One-time code (`requestTokenExchange`) | Computed Greeks | Quotes + depth | Live | Full | Blocked | [docs](https://pi.flattrade.in/docs) | Beta: not yet verified with a live account |
| Fyers | `fyers` | OAuth login (`oauthRedirect`) | Broker Greeks | Quotes + depth | — | Full | Blocked | [docs](https://fyers.in/api-docs/v3/) | Beta: not yet verified with a live account |
| Groww | `groww` | API key / token (`apiKeyToken`) | Broker Greeks | Quotes + depth | — | Full | Blocked | [docs](https://groww.in/trade-api/docs/curl) | Beta: not yet verified with a live account |
| HDFC Securities (InvestRight) | `hdfcsecurities` | API key / token (`apiKeyToken`) | Computed Greeks | Quotes + depth | Live | Full | Blocked | [docs](https://developer.hdfcsec.com) | Beta: not yet verified with a live account |
| HDFC Sky (HDFC Securities) | `hdfcsky` | API key / token (`apiKeyToken`) | Computed Greeks | Quotes + depth | Live | Full | Blocked | [docs](https://developer.hdfcsky.com/sky-docs/docs/intro) | Beta: not yet verified with a live account |
| IIFL Capital | `iiflcapital` | One-time code (`requestTokenExchange`) | Computed Greeks | Quotes + depth | — | Full | Blocked | [docs](https://developers.iiflcapital.com/apidocs/introduction) | Beta: not yet verified with a live account |
| IIFL Securities (XTS) | `iifl` | One-time code (`requestTokenExchange`) | Computed Greeks | Quotes + depth | — | Full | Blocked | [docs](https://ttblaze.iifl.com/doc/interactive/) | Beta: not yet verified with a live account |
| IndiaBulls Securities (XTS) | `ibulls` | API key / token (`apiKeyToken`) | Computed Greeks | Quotes + depth | — | Full | Blocked | [docs](https://symphonyfintech.com/xts-trading-front-end-api/) | Beta: not yet verified with a live account |
| IndMoney (INDstocks) | `indmoney` | Session login (`sessionLogin`) | Computed Greeks | Quotes + depth | Live | Full | Blocked | [docs](https://api-docs.indstocks.com/getting-started/) | Beta: not yet verified with a live account |
| Jainam (XTS) | `jainamxts` | API key / token (`apiKeyToken`) | Computed Greeks | Quotes + depth | — | Full | Blocked | [docs](https://symphonyfintech.com/xts-market-data-front-end-api/) | Beta: not yet verified with a live account |
| Kotak Securities (Neo) | `kotak` | Session login (`sessionLogin`) | Computed Greeks | Quotes + depth | — | Full | Blocked | [docs](https://github.com/Kotak-Neo/Kotak-neo-api-v2) | Beta: not yet verified with a live account |
| Motilal Oswal | `motilal` | Session login (`sessionLogin`) | Computed Greeks | Quotes | — | Full | Blocked | [docs](https://invest.motilaloswal.com/moAPI/APIDocumentation/Introduction) | Beta: not yet verified with a live account |
| mStock (Mirae Asset) | `mstock` | Session login (`sessionLogin`) | Computed Greeks | Quotes | — | Full | Blocked | [docs](https://tradingapi.mstock.com/docs/v1/typeB/User/) | Beta: not yet verified with a live account |
| Nuvama Nubra | `nubra` | Session login (`sessionLogin`) | Broker Greeks | Quotes + depth | — | Partial | Blocked | [docs](https://nubra.io/products/api/docs/rest-api-v3/index.html) | Beta: not yet verified with a live account |
| Paytm Money | `paytm` | API key / token (`apiKeyToken`) | Broker Greeks | Quotes + depth | — | Full | Blocked | [docs](https://developer.paytmmoney.com/) | Beta: not yet verified with a live account |
| Pocketful | `pocketful` | API key / token (`apiKeyToken`) | Computed Greeks | Quotes | Live | Full | Blocked | [docs](https://api.pocketful.in/docs/curl) | Beta: not yet verified with a live account |
| RMoney (XTS) | `rmoney` | API key / token (`apiKeyToken`) | Computed Greeks | Quotes + depth | — | Full | Blocked | [docs](https://symphonyfintech.com/xts-trading-front-end-api-v2/) | Beta: not yet verified with a live account |
| SAMCO Securities (StockNote) | `samco` | API key / token (`apiKeyToken`) | Broker Greeks | Quotes + depth | — | Full | Blocked | [docs](https://docs-tradeapi.samco.in/) | Beta: not yet verified with a live account |
| Shoonya (Finvasia) | `shoonya` | One-time code (`requestTokenExchange`) | Computed Greeks | Quotes + depth | Live | Full | Blocked | [docs](https://shoonya.com/api-documentation) | Beta: not yet verified with a live account |
| Tradejini (CubePlus) | `tradejini` | Session login (`sessionLogin`) | Broker Greeks | Quotes | Live | Full | Blocked | [docs](https://developer.tradejini.com/docs) | Beta: not yet verified with a live account |
| TradeSmart (Noren v2) | `tradesmart` | One-time code (`requestTokenExchange`) | Computed Greeks | Quotes + depth | Live | Full | Blocked | [docs](https://apidocs.tradesmartonline.in/v2/) | Beta: not yet verified with a live account |
| Upstox | `upstox` | OAuth login (`oauthRedirect`) | Broker Greeks | Quotes + depth | Live | Full | Blocked | [docs](https://upstox.com/developer/api-documentation/) | Beta: not yet verified with a live account |
| Wisdom Capital (XTS) | `wisdom` | API key / token (`apiKeyToken`) | Computed Greeks | Quotes + depth | — | Full | Blocked | [docs](https://symphonyfintech.com/xts-trading-front-end-api-v2/) | Beta: not yet verified with a live account |
| Zebu (Mynt) | `zebu` | One-time code (`requestTokenExchange`) | Computed Greeks | Quotes + depth | — | Full | Blocked | [docs](https://zebumyntapi.web.app/OAuth/Authentication/) | Beta: not yet verified with a live account |
| Zerodha (Kite) | `zerodha` | OAuth login (`oauthRedirect`) | Computed Greeks | Quotes + depth | Live | Full | Blocked | [docs](https://kite.trade/docs/connect/v3/) | Beta: not yet verified with a live account |

### Legend

- **Option chain**: *Broker Greeks* means IV and Greeks come from the broker's API; *Computed Greeks* means the chain's IV and Greeks are computed locally (Black-Scholes) from live prices.
- **Quotes**: *Quotes + depth* includes 5-level market depth; *Quotes* is quotes without depth.
- **Live feed**: *Live* means a streaming WebSocket feed is wired; *—* means data is polled over REST.
- **Portfolio**: *Full* is positions, holdings, funds, order book and trade book; *Partial* lacks at least one of them (Nubra has no trade-book endpoint in its REST V3 docs).
- **Orders**: *Blocked* means the order code is built and gated but cannot be used from this app yet; *1Cliq (armed)* means live orders after you enable live trading and arm the session.

## Sign-in methods

| Method | Auth kind | What you do |
|---|---|---|
| API key / token | `apiKeyToken` | Paste API keys or a token from the broker's developer portal. Daily tokens need pasting again when they expire. |
| OAuth login | `oauthRedirect` | Log in on the broker's site, then paste the access token it issues (expires daily). |
| One-time code | `requestTokenExchange` | Log in on the broker's site and paste the one-time code from the redirect; the local proxy exchanges it once for a session. |
| Session login | `sessionLogin` | Save the non-secret keys, then use **Log in** each session with your PIN or password and the current 6-digit authenticator code. Only the session token the broker returns is kept. |

## Proxy endpoints

`GET /api/broker-proxy?broker=<id>&endpoint=<endpoint>` with the saved keys in the `x-broker-credentials` header (base64 JSON; password, PIN and TOTP keys are dropped by the proxy):

| Endpoint | Parameters | Cached |
|---|---|---|
| `option-chain`, `expiry-list`, `ltp` | `symbol` (NIFTY, BANKNIFTY, FINNIFTY, MIDCPNIFTY, SENSEX, BANKEX or a stock), `expiry` | a few seconds, per credential |
| `quotes` | `refs` = JSON array of `{ "token", "exchange" }`, at most 50 | 2 s |
| `depth` | `token`, `exchange` | 1 s |
| `historical` | `token`, `exchange`, `interval` (1m, 3m, 5m, 15m, 30m, 60m, 1d), `from`, `to` (`YYYY-MM-DD` or `YYYY-MM-DD HH:mm` IST) | 60 s |
| `instruments` | `underlying`, optional `instrumentType`, `expiry`; at most 2,000 rows | 10 min |
| `positions`, `holdings`, `funds`, `order-book`, `trade-book` | none | never; non-browser callers only from loopback |

A capability the broker's adapter does not declare answers `422 CAPABILITY_UNSUPPORTED`; a missing or expired session answers `422 SESSION_LOGIN_REQUIRED`. `GET /api/broker-capabilities` lists what each adapter offers, without credentials. Developer details: [broker-contract.md](broker-contract.md).

## Attribution

The broker API facts behind these adapters (endpoints, field names, error codes, instrument formats) were cross-checked against the open-source [OpenAlgo](https://github.com/marketcalls/openalgo) project (AGPL-3.0, github.com/marketcalls/openalgo) and each broker's official API documentation, linked above. Where the two disagreed, the official documentation was followed. No OpenAlgo code is included in this project: OpenAlgo was used only as a factual reference, and every adapter was written independently.
