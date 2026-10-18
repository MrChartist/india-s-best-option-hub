/**
 * Broker catalogue, part 1 of 4 (split to respect the 300-line file limit). Pure data, no behaviour.
 * See brokerCatalog.ts for the merged BROKERS export.
 *
 * `fields` are only the values a user may SAVE, and must equal the server adapter's credentialFields
 * (src/lib/brokerCatalog.test.ts checks this). Passwords, PINs and TOTP codes are never listed here:
 * session-login brokers get their Log in prompts from the adapter (brokerCapabilities.generated.ts).
 * What each broker can do (chain, quotes, feed, portfolio, orders) also comes from the adapter;
 * `features` are short hand-written highlights only.
 */

import type { BrokerInfo } from "./brokerCatalogTypes";

export const BROKERS_PART1: BrokerInfo[] = [
  {
    id: "dhan",
    name: "Dhan",
    logo: "🟢",
    color: "hsl(142 71% 45%)",
    description: "Real-time option chain with broker Greeks and OI, quotes, depth, candles and live feed via Dhan API v2.",
    docsUrl: "https://dhanhq.co/docs/v2/",
    features: ["Option Chain", "Live LTP", "Greeks", "OI Data", "Expiry List", "Market Depth", "Historical Data", "Live Feed", "Portfolio"],
    fields: [
      { key: "clientId", label: "Client ID", placeholder: "Enter your Dhan Client ID", type: "text", required: true, helpText: "Dhan Web → My Profile → Access DhanHQ APIs" },
      { key: "accessToken", label: "Access Token", placeholder: "Enter your Dhan Access Token", type: "password", required: true, helpText: "Generate from Dhan Web → Access DhanHQ APIs. Valid for 24 hours. Market data needs an active Data API plan." },
    ],
  },
  {
    id: "zerodha",
    name: "Zerodha (Kite)",
    logo: "🔴",
    color: "hsl(0 84% 60%)",
    description: "Kite Connect API: option chain built from the instrument dump and live quotes, depth, candles, WebSocket feed and portfolio.",
    docsUrl: "https://kite.trade/docs/connect/v3/",
    features: ["Option Chain", "Live Quotes", "Market Depth", "Historical Data", "Live Feed", "Portfolio"],
    fields: [
      { key: "apiKey", label: "API Key", placeholder: "Enter Kite Connect API Key", type: "text", required: true, helpText: "From Kite Developer Console → My Apps" },
      { key: "apiSecret", label: "API Secret", placeholder: "Enter Kite Connect API Secret", type: "password", required: true, helpText: "From Kite Developer Console → My Apps. Used only to exchange the login request token, never sent with data calls." },
      { key: "accessToken", label: "Access Token", placeholder: "Enter session Access Token", type: "password", required: true, helpText: "Generated after the Kite login via /session/token. Expires at 6 AM IST every day." },
    ],
  },
  {
    id: "angelone",
    name: "Angel One (SmartAPI)",
    logo: "🟠",
    color: "hsl(25 95% 53%)",
    description:
      "Option chain for NIFTY, BANKNIFTY, FINNIFTY, MIDCPNIFTY, SENSEX, BANKEX and stock underlyings with broker Greeks, plus quotes, depth, candles, positions, holdings, funds and order and trade books. Live API orders need a registered static IP and are limit orders only (Angel One rule from 1 April 2026).",
    docsUrl: "https://smartapi.angelone.in/docs",
    features: ["Option Chain", "Broker Greeks", "Quotes", "Depth", "Historical", "Portfolio", "Order & Trade Book"],
    fields: [
      { key: "apiKey", label: "API Key", placeholder: "Enter SmartAPI Key", type: "text", required: true, helpText: "From SmartAPI Portal → My Apps" },
      { key: "clientId", label: "Client ID", placeholder: "Enter Angel One Client ID", type: "text", required: true, helpText: "Log in each session with your PIN / MPIN and the current authenticator code; neither is saved." },
    ],
  },
  {
    id: "upstox",
    name: "Upstox",
    logo: "🟣",
    color: "hsl(271 76% 53%)",
    description: "Upstox API v2/v3: native option chain with broker Greeks, quotes, depth, candles, live feed and portfolio.",
    docsUrl: "https://upstox.com/developer/api-documentation/",
    features: ["Option Chain", "Greeks", "Market Data", "Market Depth", "Historical Data", "Live Feed", "Portfolio"],
    fields: [
      { key: "apiKey", label: "API Key", placeholder: "Enter Upstox API Key", type: "text", required: true, helpText: "From Upstox Developer Console" },
      { key: "apiSecret", label: "API Secret", placeholder: "Enter Upstox API Secret", type: "password", required: true, helpText: "Used only to exchange the OAuth code for a token." },
      { key: "accessToken", label: "Access Token", placeholder: "Enter OAuth Access Token", type: "password", required: true, helpText: "Generated via the OAuth2 login. Expires at 3:30 AM IST every day." },
    ],
  },
  {
    id: "fivepaisa",
    name: "5paisa",
    logo: "🔵",
    color: "hsl(217 91% 60%)",
    description: "5paisa Xstream API: option chain built from the daily scrip master and MarketSnapshot quotes, depth, candles and portfolio. Log in each day with your PIN and authenticator code.",
    docsUrl: "https://xstream.5paisa.com/dev-docs/",
    features: ["Option Chain", "Live Quotes", "Market Depth", "Historical Data", "Positions & Holdings", "Orders (gated)", "IV/Greeks (Black-Scholes)"],
    fields: [
      { key: "appName", label: "App Name", placeholder: "Enter 5paisa App Name", type: "text", required: true, helpText: "From 5paisa Developer Portal → My Apps" },
      { key: "appSource", label: "App Source", placeholder: "Enter App Source ID", type: "text", required: true },
      { key: "userKey", label: "User Key (App Key)", placeholder: "Enter your app's User Key", type: "password", required: true, helpText: "Sent as head.Key on every API call. From Developer Portal → My Apps." },
      { key: "encryptionKey", label: "Encryption Key", placeholder: "Enter Encryption Key", type: "password", required: true, helpText: "Client-specific, from your 5paisa account API settings" },
      { key: "userId", label: "User ID", placeholder: "Enter User ID", type: "text", required: true },
      { key: "clientCode", label: "Client Code / Email", placeholder: "Enter Client Code or login Email", type: "text", required: true, helpText: "Your own 5paisa login identifier (not the app's)" },
    ],
  },
  {
    id: "fyers",
    name: "Fyers",
    logo: "🟡",
    color: "hsl(48 96% 53%)",
    description: "Fyers API v3: native option chain for NIFTY, BANKNIFTY, FINNIFTY, MIDCPNIFTY, SENSEX, BANKEX and stock underlyings across all listed expiries with broker Greeks, plus quotes, depth, candles, positions, holdings, funds and order and trade books.",
    docsUrl: "https://fyers.in/api-docs/v3/",
    features: ["Option Chain", "Broker Greeks", "Quotes", "Depth", "Historical", "Positions", "Holdings", "Funds", "Order & Trade Book"],
    fields: [
      { key: "appId", label: "App ID", placeholder: "Enter Fyers App ID", type: "text", required: true, helpText: "Format: XXXX-100 from Fyers API Dashboard" },
      { key: "secretKey", label: "Secret Key", placeholder: "Enter Fyers Secret Key", type: "password", required: true },
      { key: "accessToken", label: "Access Token", placeholder: "Enter Fyers Access Token", type: "password", required: true, helpText: "Expires daily at 6:30 AM IST. Generate it via Fyers login (generate-authcode → validate-authcode) and paste it here." },
    ],
  },
  {
    id: "aliceblue",
    name: "Alice Blue",
    logo: "💎",
    color: "hsl(199 89% 48%)",
    description: "Alice Blue ANT V2 API: native option chain with locally computed Greeks, quotes, 1-minute and daily candles, positions, holdings, funds and order and trade books.",
    docsUrl: "https://ant.aliceblueonline.com/productdocumentation/",
    features: ["Option Chain (native)", "Quotes", "Historical (1m/1D)", "Positions", "Holdings", "Funds", "Order & Trade Book"],
    fields: [
      { key: "userId", label: "User ID", placeholder: "Alice Blue User ID", type: "text", required: true },
      { key: "appCode", label: "App Code", placeholder: "App Code", type: "text", required: true, helpText: "App Code from the Alice Blue developer portal (a3.aliceblueonline.com → My Apps)" },
      { key: "apiSecret", label: "API Secret", placeholder: "API Secret", type: "password", required: true, helpText: "API Secret shown with the App Code" },
      { key: "authCode", label: "Auth Code", placeholder: "Paste the authCode from the redirect URL", type: "password", required: true, helpText: "Open https://ant.aliceblueonline.com/?appcode=<App Code>, log in, then copy authCode from the redirect URL. Single-use: paste a fresh one whenever the session expires." },
    ],
  },
  {
    id: "arrow",
    name: "Arrow",
    logo: "🏹",
    color: "hsl(280 70% 55%)",
    description: "Live option chain for NIFTY, BANKNIFTY, FINNIFTY, MIDCPNIFTY, SENSEX, BANKEX and stock options via Arrow's option-chain contract list and batched full quotes (OI, OI change, bid/ask), with Black-Scholes IV/Greeks; also positions, holdings, funds, order and trade book.",
    docsUrl: "https://docs.arrow.trade/",
    features: ["Option Chain", "Live Quotes", "OI / OI Change", "Market Depth", "Historical Candles", "Positions & Holdings", "Funds", "Order & Trade Book", "Black-Scholes Greeks"],
    fields: [
      { key: "appId", label: "App ID", placeholder: "e.g. AR12345", type: "text", required: true, helpText: "From Arrow's Developer Apps section (profile icon → Trading APIs → +Create New)." },
      { key: "appSecret", label: "App Secret", placeholder: "App secret", type: "password", required: true, helpText: "Issued alongside App ID when you create the API app. Keep private." },
      { key: "requestToken", label: "Request Token", placeholder: "Paste the request-token from the redirect URL", type: "password", required: true, helpText: "Visit https://app.arrow.trade/app/login?appID=<App ID>, log in, then copy the 'request-token' from the redirect URL. Single use: it is exchanged once for a 24-hour session that cannot be refreshed, so paste a fresh one when it expires." },
    ],
  },
  {
    id: "compositedge",
    name: "Composite Edge (XTS)",
    logo: "🧩",
    color: "hsl(190 80% 45%)",
    description: "Option chains for NIFTY, BANKNIFTY, FINNIFTY, MIDCPNIFTY, SENSEX, BANKEX and stock options via Composite Edge's XTS APIs: instrument master plus batched quotes with Black-Scholes IV/Greeks, depth, candles and (with the Interactive keys) positions and books.",
    docsUrl: "https://symphonyfintech.com/xts-trading-front-end-api/",
    features: ["Option Chain", "Live Quotes", "OI Data", "Expiry List", "Market Depth", "Historical Candles", "Positions & Orders (read-only until trading is enabled)"],
    fields: [
      { key: "apiKey", label: "Market Data App Key", placeholder: "e.g. 3f8a9c2b1e...", type: "text", required: true, helpText: "The App Key for the Market Data (XTS) app on your Composite Edge developer account." },
      { key: "apiSecret", label: "Market Data Secret Key", placeholder: "Secret key for the Market Data app", type: "password", required: true, helpText: "The Secret Key paired with the Market Data App Key above." },
      { key: "interactiveApiKey", label: "Interactive (Trading) App Key", placeholder: "Optional", type: "text", required: false, helpText: "Needed only for positions, holdings, funds and order books." },
      { key: "interactiveApiSecret", label: "Interactive (Trading) Secret Key", placeholder: "Optional", type: "password", required: false },
      { key: "requestToken", label: "Login token (daily)", placeholder: "Optional", type: "password", required: false, helpText: "Open https://xts.compositedge.com/interactive/thirdparty?appKey=<Interactive App Key>&returnURL=<your registered URL>, log in, and paste the accessToken from the session the broker returns. Single use; log in again when the app asks." },
      { key: "clientId", label: "Client ID", placeholder: "Dealer accounts only", type: "text", required: false, helpText: "Dealer accounts only." },
    ],
  },
  {
    id: "definedge",
    name: "Definedge Securities (INTEGRATE)",
    logo: "📊",
    color: "hsl(160 70% 40%)",
    description: "Option chains for NIFTY, BANKNIFTY, FINNIFTY, MIDCPNIFTY, SENSEX, BANKEX and stock options from Definedge's INTEGRATE API (instrument master plus per-strike quotes with OI backfill and Black-Scholes Greeks), plus positions, holdings, funds, order and trade books and 1-minute/daily history. Log in each session with your External TOTP code.",
    docsUrl: "https://www.definedgesecurities.com/api-documentation/",
    features: ["Option Chain", "Live Quotes", "OI Backfill", "Market Depth", "History (1m/1D)", "Positions & Holdings", "Funds", "Order & Trade Book", "Black-Scholes Greeks"],
    fields: [
      { key: "apiToken", label: "API Token", placeholder: "e.g. AB123456", type: "text", required: true, helpText: "From MyAccount → Account → API Config at myaccount.definedgesecurities.com. Enable External TOTP at myaccount.definedgesecurities.com/security; you type the current 6-digit code each time you log in, and nothing is saved." },
      { key: "apiSecret", label: "API Secret", placeholder: "your api_secret", type: "password", required: true, helpText: "From the same API Config page. Used once per login by the local proxy; never shown or logged." },
    ],
  },
  {
    id: "firstock",
    name: "Firstock",
    logo: "🥇",
    color: "hsl(45 90% 50%)",
    description: "Session login with password and the current TOTP code. Live NIFTY/BANKNIFTY/FINNIFTY/MIDCPNIFTY/SENSEX/BANKEX and stock option chains from Firstock's option-chain-with-Greeks API (broker IV, Greeks and OI) plus best bid/ask.",
    docsUrl: "https://firstock.in/api/docs/",
    features: ["Option Chain", "Greeks (broker)", "Open Interest", "TOTP Login", "Historical", "Orders (gated)"],
    fields: [
      { key: "userId", label: "User ID", placeholder: "Enter Firstock login/client ID", type: "text", required: true, helpText: "Your Firstock trading login ID. Log in each session with your password and the current 6-digit authenticator code; neither is saved." },
      { key: "vendorCode", label: "Vendor Code", placeholder: "Enter Firstock Vendor Code", type: "text", required: true, helpText: "Issued when Firstock API access is enabled on your account" },
      { key: "apiKey", label: "API Key", placeholder: "Enter Firstock API Key", type: "password", required: true, helpText: "Issued alongside your Vendor Code for API access" },
    ],
  },
];
