# Data endpoints

Everything the browser fetches goes through the local proxy (`proxy-server.mjs`, default
`http://127.0.0.1:4002`). The browser talks to it through `src/lib/api/proxyClient.ts`.

> Data for education and research. Not investment advice. NSE file formats and URLs change without
> notice; anything marked *verify* below should be checked against the live source before release.

## Running the proxy

| Env var | Default | Meaning |
| --- | --- | --- |
| `PROXY_PORT` | `4002` | HTTP and WebSocket port |
| `PROXY_HOST` | `127.0.0.1` | Bind address. Use `0.0.0.0` only inside a container. |
| `PROXY_ALLOWED_ORIGINS` | – | Extra comma-separated origins for CORS and the WebSocket. `http://localhost` and `http://127.0.0.1` on ports 8080, 5173 and 4001 are always allowed. |
| `DHAN_CLIENT_ID`, `DHAN_ACCESS_TOKEN` | – | Optional server-side Dhan keys. Browser keys sent as headers take priority. |
| `PROXY_TRUSTED_NETS` | – | Comma-separated IPv4 addresses, IPv4 CIDRs or IPv6 addresses (besides loopback) that may use the `.env` Dhan keys and the `/ws` live feed. Decided by the socket address, never by the `Origin` header. The Docker image sets `172.16.0.0/12` (the bridge gateway). |

Security behaviour:

- Requests with an `Origin` header outside the allowlist get `403`. Requests without `Origin` (curl, same machine) are allowed.
- Per-IP token bucket: 80 requests burst, refilled at 25 per second. Over the limit → `429` with `Retry-After: 1`.
- Only `GET` and `OPTIONS` are accepted.
- Inputs are whitelisted: `symbol` `^[A-Z0-9&-]{1,20}$`, dates `yyyy-mm-dd`, expiries `yyyy-mm-dd` or `dd-Mon-yyyy`, intervals `1|5|15|25|60|D`, known exchange segments and instrument types only.
- Every upstream call has a timeout (`AbortSignal.timeout`), and error bodies are stripped of HTML and cut to 160 characters.
- Browser Dhan keys arrive as `x-dhan-client-id` / `x-dhan-access-token` headers and are never logged or cached on disk.

Reliability behaviour:

- Identical concurrent requests are coalesced into one upstream call.
- Rate queues per upstream: Dhan option chain 1 per 3 s, other Dhan calls 1 per 250 ms, NSE API 1 per 350 ms, NSE archives 1 per 300 ms.
- In-memory LRU cache (600 entries) with per-route TTLs.
- `429` responses honour `Retry-After`; while blocked the proxy serves the last good copy with `stale: true`.
- If `www.nseindia.com` answers `403` (Akamai bot block), NSE API calls back off for 60 s. NSE archive files (`nsearchives.nseindia.com`) keep working.
- Last-good copies are written atomically to `.cache/` (18 h for live data, 14 days for dated archive files) and reloaded on start using the key stored inside each file.

## The envelope

All `/api/x/*` routes answer with:

```json
{ "data": <payload or null>, "meta": { "source": "nse", "asOf": 1792208092817, "stale": false, "reason": "optional text" } }
```

| Field | Meaning |
| --- | --- |
| `source` | `dhan` · `nse` · `bse` · `yahoo` · `tv` · `cache` (a last-good copy) · `sample` (never sent by the proxy; used by the client for generated data) |
| `asOf` | Epoch ms of the data itself (for end-of-day files: 18:30 IST on the file date) |
| `stale` | `true` when the payload is a cached copy or `data` is `null` |
| `reason` | Why the data is stale, derived or missing |

HTTP status: `200` with data (fresh or stale), `400` for bad input (`data: null`), `502` when the upstream failed and no last-good copy exists (`data: null`).
`proxyGet()` in the browser never throws; on a network error it returns `data: null` with `meta.reason` `"offline"` (or `"timeout"`).

## Envelope routes

Dates are ISO `yyyy-mm-dd` in IST. "Latest" means today after 19:00 IST, otherwise the previous weekday, walking back up to six weekdays until a file exists.

### `GET /api/x/lot-sizes`
Source: `nsearchives.nseindia.com/content/fo/fo_mktlots.csv`. Cache 6 h.
```ts
Array<{ symbol: string; underlying: string; lotSize: number; byMonth: Array<{ month: string /* "OCT-26" */; lotSize: number }> }>
```
`lotSize` is the first listed month. Feed it to `registerContractSpecs()` to override built-in lot sizes.

### `GET /api/x/holidays?segment=FO|CM|CD|COM`
Source: NSE `/api/holiday-master?type=trading`. Default segment `FO`. Cache 12 h.
```ts
Array<{ date: string; weekday: string; description: string; segment: string }>
```

### `GET /api/x/participant-oi?date=`
Source: `content/nsccl/fao_participant_oi_DDMMYYYY.csv`. Contracts. Omit `date` for the latest file.
```ts
Array<{
  date: string;
  participant: "Client" | "DII" | "FII" | "Pro";
  futIdxLong: number; futIdxShort: number;
  optIdxCallLong: number; optIdxCallShort: number;
  optIdxPutLong: number; optIdxPutShort: number;
  futStkLong: number; futStkShort: number;
}>
```
The `TOTAL` row is dropped. Columns are matched by header name, not position.

### `GET /api/x/participant-oi/history?days=`
Same row shape, for the last `days` available trading days (1–60, default 20), sorted by date then participant. Each dated file is cached for 14 days.

### `GET /api/x/participant-vol?date=`
Source: `fao_participant_vol_DDMMYYYY.csv`. Same row shape as participant OI, values are traded contracts (Long = bought, Short = sold).

### `GET /api/x/fii-stats?date=`
**Derived** from the FII rows of participant OI and participant volume (NSE's `fii_stats_*.xls` is a binary Excel file the proxy does not parse). `meta.reason` says so.
```ts
Array<{
  date: string;
  segment: "Index Futures" | "Index Calls" | "Index Puts" | "Stock Futures";
  longOi: number; shortOi: number; netOi: number; longPct: number;   // longPct = long / (long + short) × 100
  buyVol: number | null; sellVol: number | null; netVol: number | null; // null when the volume file is missing
}>
```

### `GET /api/x/ban-list`
Source: `content/fo/fo_secban.csv`. Cache 30 min.
```ts
{ date: string /* trade date the ban applies to */; symbols: string[] }
```

### `GET /api/x/mwpl`
Source: `archives/nsccl/mwpl/combineoi_DDMMYYYY.zip` (CSV inside). Latest available file. Sorted by `mwplPct` descending.
```ts
Array<{ symbol: string; mwplPct: number; mwpl?: number; oi?: number; limitNextDay?: number }>
```
`mwplPct = oi / mwpl × 100`. A stock enters the ban at 95 %.

### `GET /api/x/vix-history?days=`
Source: NSE `/api/historical/vixhistory` (chunks of 365 days); falls back to Yahoo `^INDIAVIX` (then `meta.source = "yahoo"`). `days` 5–730, default 365.
```ts
Array<{ date: string; close: number; open?: number; high?: number; low?: number }>
```

### `GET /api/x/oi-spurts?type=underlyings|contracts`
Source: NSE `/api/live-analysis-oi-spurts-{type}`. Cache 3 min.
```ts
Array<{
  symbol: string;
  instrument?: string; expiry?: string; strike?: number; optionType?: "CE" | "PE" | "FUT";
  category?: "Long build-up" | "Short build-up" | "Short covering" | "Long unwinding";  // contracts only
  ltp?: number; pChange?: number;
  latestOi: number; prevOi: number; chgOi: number; chgOiPct: number;
  volume: number; underlyingValue?: number;
}>
```

### `GET /api/x/most-active?type=contracts|futures&sort=volume|value`
Source: NSE `/api/snapshot-derivatives-equity?index={type}`. Top 20. Cache 2 min.
```ts
Array<{
  symbol: string; instrument: string; expiry: string; strike: number | null; optionType: "CE" | "PE" | "FUT" | null;
  ltp: number; pChange: number; contracts: number;
  turnoverLakh: number; premiumTurnoverLakh: number | null;   // ₹ lakh, as published by NSE (verify)
  oi: number; underlyingValue: number;
}>
```

### `GET /api/x/bhavcopy-fo?date=&symbol=&expiry=`
Source: UDiFF F&O bhavcopy `content/fo/BhavCopy_NSE_FO_0_0_0_YYYYMMDD_F_0000.csv.zip`. Omit `date` for the latest file. Filter with `symbol` (recommended: the full file is about 50,000 rows) and `expiry`.
```ts
Array<{
  symbol: string; expiry: string; strike: number /* 0 for futures */; type: "CE" | "PE" | "FUT";
  close: number; settle: number; oi: number; chgOi: number;
  volume: number;            // TtlTradgVol as published (verify units: contracts vs quantity)
  underlyingClose: number;
}>
```

### `GET /api/x/event-calendar`
Source: NSE `/api/event-calendar` (board meetings, results). Cache 6 h.
```ts
Array<{ symbol: string; company: string; purpose: string; description: string; date: string }>
```

### `GET /api/x/bulk-deals` and `GET /api/x/block-deals`
Source: NSE `/api/snapshot-capital-market-largedeal`. Cache 15 min.
```ts
Array<{ date: string; symbol: string; name: string; client: string; side: "BUY" | "SELL"; qty: number; price: number; remarks?: string }>
```

### `GET /api/x/chain-multi?symbol=&expiries=next3|all|<iso,iso,…>`
Dhan when keys are present (one option-chain call per expiry, paced at 1 per 3 s), otherwise NSE option-chain-v3. `all` is capped at 8 expiries. SENSEX and BANKEX need Dhan keys.
```ts
{
  symbol: string;
  spot: number;
  expiries: Array<{
    expiry: string;
    chain: Array<{ strikePrice: number; ce: Leg; pe: Leg }>;
  }>;
}
// Leg = OptionLegDataExt from src/lib/types/market.ts:
// { ltp, oi, oiChange, volume, iv /* % */, delta, gamma, theta, vega, bidPrice, askPrice,
//   change?, pChange?, prevClose?, bidQty?, askQty?, securityId? }
// NSE legs carry zero Greeks; enrich them client-side with enrichChain() from @/lib/options.
```
Client hook: `useChainMulti(symbol, expiries)` in `src/hooks/useMarketData.ts` (falls back to a labelled sample chain).

## Legacy routes (not enveloped)

| Route | Notes |
| --- | --- |
| `GET /api/dhan-proxy?endpoint=option-chain&symbol=&expiry=` | Dhan chain. Empty chains are errors, not "success". On failure: last-good copy with `stale: true, afterHours: true, cachedAt`, else `502 { status: "error", reason }` so the client falls back to NSE. |
| `GET /api/dhan-proxy?endpoint=expiry-list&symbol=` | `UnderlyingSeg: IDX_I`. ISO dates. |
| `GET /api/dhan-proxy?endpoint=ltp&symbol=` | Index LTP. |
| `GET /api/dhan-proxy?endpoint=instruments` | Dhan scrip master, parsed (NSE_EQ, NSE_FNO, IDX_I, BSE_FNO). Cache 1 h. |
| `GET /api/dhan-proxy?endpoint=historical&securityId=&exchangeSegment=&instrument=&interval=&fromDate=&toDate=` | Intraday ranges clamped to 90 days. |
| `GET /api/nse-proxy?endpoint=option-chain&symbol=&expiry=` | option-chain-v3 for one expiry, normalised to the legacy `{ records: { expiryDates, data, underlyingValue }, filtered }` shape; legacy endpoint as fallback. Stale copies carry `stale: true, cachedAt`. |
| `GET /api/nse-proxy?endpoint=indices\|market-status\|equity-derivatives\|market-data-pre-open\|fii-dii` | Raw NSE JSON. |
| `GET /api/yahoo-chart?symbol=&interval=&fromDate=&toDate=` | Yahoo candles; dates are IST calendar days. |
| `GET /api/test-connection` | Checks the Dhan keys (expiry list for NIFTY). |
| `GET /health` | See below. |

### `/health`
```ts
{
  status: "ok"; version: string; uptime: number;
  websocket: { dhanConnected: boolean; browserClients: number; instrumentsSubscribed: number; cachedTicks: number; lastDisconnectCode: number | null };
  upstreams: Record<"dhan" | "nse" | "bse" | "yahoo", { lastSuccess: number | null; lastFailure: number | null; lastError: string | null; blockedUntil: number | null }>;
  sources: { dhan: boolean /* keys in .env */; nse: true; yahoo: true };
  cache: { entries: number; lastGood: number; inflight: number };
  security: { host: string; allowedOrigins: string[] };
}
```

## Live feed WebSocket (`/ws`)

Browser → proxy messages:

```json
{ "type": "configure", "clientId": "1000000001", "accessToken": "eyJ…" }
{ "type": "subscribe", "instruments": [{ "ExchangeSegment": "NSE_FNO", "SecurityId": "43210" }] }
```
`subscribe` takes 1–100 instruments per message (known segments, numeric ids); the proxy keeps up to 4,000 and resubscribes after reconnects. More than 30 messages in 10 s are ignored.

Proxy → browser messages:

- Status: `{ type: "status", connected, dhanConnected, disconnectCode, message, instrumentCount }`
- Ticks keyed by `key = "<segment>:<securityId>"`, for example `IDX_I:13`:
  `{ key, type: "ticker"|"quote"|"oi"|"prevClose"|"full", exchangeSegment, securityId, symbol, ltp, ltq, ltt, avgPrice, volume, totalBuyQty, totalSellQty, open, high, low, close, prevClose, prevOI, oi, oiDayHigh, oiDayLow, depth?: [{ bidQty, askQty, bidOrders, askOrders, bid, ask } ×5], change, changePercent, timestamp }`

Dhan binary parsing (v2, little-endian): 8-byte header (code u8, length u16, segment u8, security id u32); prices are float32. Ticker 16 B, Quote 50 B, OI 12 B, Prev close 16 B (`prevClose` f32 at 8, `prevOI` at 12), Full 162 B (OI at 34–45, OHLC at 46–61, five 20-byte depth levels from 62). Frames may hold several packets back to back.
Disconnect codes: 805 too many connections (back off 2 min), 806 data APIs not subscribed, 807 token expired, 808 auth failed, 809/810 invalid token or client id. 806–810 stop reconnecting until the browser sends different keys.

Index security ids (Dhan `IDX_I`, *verify* against the scrip master): NIFTY 13, BANKNIFTY 25, FINNIFTY 27, MIDCPNIFTY 442, INDIA VIX 21, SENSEX 51, BANKEX 69.

## Browser-side storage

| Store | Where | Contents |
| --- | --- | --- |
| Broker keys | `sessionStorage` (session-only mode) or `localStorage` AES-GCM vault (PBKDF2-SHA256, 310k rounds) | Dhan client id and access token. Never passwords, MPIN or TOTP. |
| `mrchartist_market_db` v3 | IndexedDB | `instruments`, `prices`, `candles`, `metadata`, plus `chainSnapshots` (`{ id, symbol, expiry, ts, spot, rows: StrikeSnap[] }`, index `[symbol, expiry, ts]`) and `dailyStats` (`{ symbol, date, atmIv, pcrOi, pcrVol, maxPain, straddle, spot, futBasis?, rr25? }`, key `[symbol, date]`). |

Snapshot API: `src/lib/snapshotStore.ts` (`recordSnapshot`, `getSnapshots`, `getLatestSnapshots`, `putDailyStat`, `getDailyStats`, `pruneSnapshots`, `getSnapshotStats`). Recorder hook: `useSnapshotRecorder(symbols, intervalMs)` records only fresh live chains during the open session (at most every 15 s) and writes one `DailyStat` per symbol after 15:30 IST.
