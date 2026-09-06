// Broker configuration and localStorage-based key management

export interface BrokerInfo {
  id: string;
  name: string;
  logo: string; // emoji for now
  color: string; // tailwind hsl token reference
  fields: BrokerField[];
  docsUrl: string;
  description: string;
  features: string[];
}

export interface BrokerField {
  key: string;
  label: string;
  placeholder: string;
  type: "text" | "password";
  required: boolean;
  helpText?: string;
}

export interface BrokerCredentials {
  brokerId: string;
  values: Record<string, string>;
  addedAt: string;
  isActive: boolean;
}

const STORAGE_KEY = "optionsdesk_broker_keys";

export const BROKERS: BrokerInfo[] = [
  {
    id: "dhan",
    name: "Dhan",
    logo: "🟢",
    color: "hsl(142 71% 45%)",
    description: "Lightning-fast trading with real-time option chain, Greeks, and OI data via Dhan API v2.",
    docsUrl: "https://dhanhq.co/docs/v2/",
    features: ["Option Chain", "Live LTP", "Greeks", "OI Data", "Expiry List"],
    fields: [
      { key: "clientId", label: "Client ID", placeholder: "Enter your Dhan Client ID", type: "text", required: true, helpText: "Found in Dhan Developer Console → API Management" },
      { key: "accessToken", label: "Access Token", placeholder: "Enter your Dhan Access Token", type: "password", required: true, helpText: "Generate from Dhan Developer Console → Create Token" },
    ],
  },
  {
    id: "zerodha",
    name: "Zerodha (Kite)",
    logo: "🔴",
    color: "hsl(0 84% 60%)",
    description: "India's largest broker. Access live data via Kite Connect API (REST polling).",
    docsUrl: "https://kite.trade/docs/connect/v3/",
    features: ["Option Chain", "Live Quotes", "Historical Data"],
    fields: [
      { key: "apiKey", label: "API Key", placeholder: "Enter Kite Connect API Key", type: "text", required: true, helpText: "From Kite Developer Console → My Apps" },
      { key: "apiSecret", label: "API Secret", placeholder: "Enter Kite Connect API Secret", type: "password", required: true, helpText: "From Kite Developer Console → My Apps" },
      { key: "accessToken", label: "Access Token", placeholder: "Enter session Access Token", type: "password", required: true, helpText: "Generated after login flow via /session/token" },
    ],
  },
  {
    id: "angelone",
    name: "Angel One (SmartAPI)",
    logo: "🟠",
    color: "hsl(25 95% 53%)",
    description: "Full-featured SmartAPI with option chain, order placement, and portfolio tracking.",
    docsUrl: "https://smartapi.angelone.in/docs",
    features: ["Option Chain", "Live Quotes", "Order Placement", "Portfolio"],
    fields: [
      { key: "apiKey", label: "API Key", placeholder: "Enter SmartAPI Key", type: "text", required: true, helpText: "From SmartAPI Portal → My Apps" },
      { key: "clientId", label: "Client ID", placeholder: "Enter Angel One Client ID", type: "text", required: true },
      { key: "password", label: "Password / MPIN", placeholder: "Enter login password or MPIN", type: "password", required: true },
      { key: "totpSecret", label: "TOTP Secret", placeholder: "Enter TOTP secret for 2FA", type: "password", required: true, helpText: "Base32 secret from Angel One's TOTP setup — required for automated daily login (sessions expire at midnight IST)" },
    ],
  },
  {
    id: "upstox",
    name: "Upstox",
    logo: "🟣",
    color: "hsl(271 76% 53%)",
    description: "Upstox API v2 with market data, option chain, and advanced order types.",
    docsUrl: "https://upstox.com/developer/api-documentation/",
    features: ["Option Chain", "Market Data", "Orders", "Portfolio"],
    fields: [
      { key: "apiKey", label: "API Key", placeholder: "Enter Upstox API Key", type: "text", required: true, helpText: "From Upstox Developer Console" },
      { key: "apiSecret", label: "API Secret", placeholder: "Enter Upstox API Secret", type: "password", required: true },
      { key: "accessToken", label: "Access Token", placeholder: "Enter OAuth Access Token", type: "password", required: true, helpText: "Generated via OAuth2 redirect flow" },
    ],
  },
  {
    id: "fivepaisa",
    name: "5paisa",
    logo: "🔵",
    color: "hsl(217 91% 60%)",
    description: "5paisa Connect API for live market data, option chain, and trading.",
    docsUrl: "https://www.5paisa.com/developerapi/overview",
    features: ["Option Chain", "Market Data", "Orders"],
    fields: [
      { key: "appName", label: "App Name", placeholder: "Enter 5paisa App Name", type: "text", required: true, helpText: "From 5paisa Developer Portal → My Apps" },
      { key: "appSource", label: "App Source", placeholder: "Enter App Source ID", type: "text", required: true },
      { key: "userKey", label: "User Key (App Key)", placeholder: "Enter your app's User Key", type: "password", required: true, helpText: "Sent as head.Key on every API call — from Developer Portal → My Apps" },
      { key: "encryptionKey", label: "Encryption Key", placeholder: "Enter Encryption Key", type: "password", required: true, helpText: "Client-specific — from your 5paisa account API settings" },
      { key: "userId", label: "User ID", placeholder: "Enter User ID", type: "text", required: true },
      { key: "clientCode", label: "Client Code / Email", placeholder: "Enter Client Code or login Email", type: "text", required: true, helpText: "Your own 5paisa login identifier (not the app's)" },
      { key: "pin", label: "PIN", placeholder: "Enter 4-digit login PIN", type: "password", required: true },
      { key: "totpSecret", label: "TOTP Secret", placeholder: "Enter TOTP secret for daily login", type: "password", required: true, helpText: "Base32 secret from 5paisa's TOTP setup — used to auto-login each trading day (token expires 11:59 PM IST daily)" },
    ],
  },
  {
    id: "fyers",
    name: "Fyers",
    logo: "🟡",
    color: "hsl(48 96% 53%)",
    description: "Fyers API v3 with TradingView charting, market data, and algo trading support.",
    docsUrl: "https://myapi.fyers.in/docs/",
    features: ["Option Chain", "Historical Data", "TradingView Charts", "Orders"],
    fields: [
      { key: "appId", label: "App ID", placeholder: "Enter Fyers App ID", type: "text", required: true, helpText: "Format: XXXX-100 from Fyers API Dashboard" },
      { key: "secretKey", label: "Secret Key", placeholder: "Enter Fyers Secret Key", type: "password", required: true },
      { key: "accessToken", label: "Access Token", placeholder: "Enter Fyers Access Token", type: "password", required: true },
    ],
  },
  {
    id: "aliceblue",
    name: "Alice Blue",
    logo: "💎",
    color: "hsl(199 89% 48%)",
    description: "Alice Blue ANT API for low-cost trading with real-time market feeds.",
    docsUrl: "https://v2api.aliceblueonline.com/",
    features: ["Market Data", "Orders", "Portfolio", "Funds"],
    fields: [
      { key: "userId", label: "User ID", placeholder: "Enter Alice Blue User ID", type: "text", required: true },
      { key: "apiKey", label: "API Key", placeholder: "Enter API Key", type: "password", required: true, helpText: "From Alice Blue ANT Developer Portal" },
    ],
  },
  {
    id: "arrow",
    name: "Arrow",
    logo: "🏹",
    color: "hsl(280 70% 55%)",
    description: "Live NIFTY/BANKNIFTY/FINNIFTY/MIDCPNIFTY/SENSEX option chain via Arrow's instrument master + batched quote API, with Black-Scholes IV/Greeks fill-in.",
    docsUrl: "https://docs.arrow.trade/rest-api/authentication",
    features: ["Option Chain", "Live Quotes", "Batched Multi-Quote", "Black-Scholes Greeks"],
    fields: [
      { key: "appId", label: "App ID", placeholder: "e.g. AR12345", type: "text", required: true, helpText: "From Arrow's Developer Apps section (profile icon -> Trading APIs -> +Create New)." },
      { key: "appSecret", label: "App Secret", placeholder: "App secret", type: "password", required: true, helpText: "Issued alongside App ID when you create the API app. Keep private." },
      { key: "requestToken", label: "Request Token", placeholder: "Paste the request-token from the redirect URL", type: "password", required: true, helpText: "Visit https://app.arrow.trade/app/login?appID=<App ID>, log in (password+TOTP), then copy the 'request-token' query param from the URL you're redirected to. Single-use and short-lived — the server exchanges it once for a 24h session token; when that expires, repeat this step and paste a fresh one." },
    ],
  },
  {
    id: "compositedge",
    name: "Composite Edge (XTS)",
    logo: "🧩",
    color: "hsl(190 80% 45%)",
    description: "Instrument-master + batched-quote option chain for NIFTY, BANKNIFTY, FINNIFTY, MIDCPNIFTY and SENSEX via Composite Edge's XTS market-data API, with Black-Scholes-derived IV/Greeks.",
    docsUrl: "https://xtsapi.compositedge.com/",
    features: ["Option Chain", "Live Quotes", "OI Data", "Expiry List"],
    fields: [
      { key: "apiKey", label: "Market Data App Key", placeholder: "e.g. 3f8a9c2b1e...", type: "text", required: true, helpText: "The App Key issued for the Market Data (XTS) app on your CompositEdge developer account — request API access from Symphony Fintech/CompositEdge support if you don't have one yet." },
      { key: "apiSecret", label: "Market Data Secret Key", placeholder: "Secret key for the Market Data app", type: "password", required: true, helpText: "The Secret Key paired with the Market Data App Key above. Used only for read-only quotes/option-chain data, never stored beyond your session." },
    ],
  },
  {
    id: "definedge",
    name: "Definedge Securities (INTEGRATE)",
    logo: "📊",
    color: "hsl(160 70% 40%)",
    description: "Live NIFTY/BANKNIFTY/FINNIFTY/MIDCPNIFTY/SENSEX option chains from Definedge's INTEGRATE API via daily instrument-master + per-strike quotes, with history-based OI backfill and Black-Scholes IV/Greeks.",
    docsUrl: "https://www.definedgesecurities.com/api-documentation/",
    features: ["Option Chain", "Live Quotes", "OI Backfill", "Multi-Expiry", "Black-Scholes Greeks"],
    fields: [
      { key: "apiToken", label: "API Token", placeholder: "e.g. AB123456", type: "text", required: true, helpText: "From MyAccount → Account → API Config at myaccount.definedgesecurities.com." },
      { key: "apiSecret", label: "API Secret", placeholder: "your api_secret", type: "password", required: true, helpText: "From the same API Config page. Only used by you to complete the 2-step OTP login externally — never sent by this app." },
      { key: "apiSessionKey", label: "API Session Key", placeholder: "paste api_session_key here", type: "password", required: true, helpText: "Definedge login needs a real OTP sent to your phone/email each time, so this app can't log in for you. Complete the 2-step login yourself (Step 1: GET .../login/{api_token} with header api_secret; Step 2: POST .../token with the OTP) and paste the resulting api_session_key here. Lifetime isn't publicly documented — re-paste a fresh one if requests start failing with 401." },
    ],
  },
  {
    id: "firstock",
    name: "Firstock",
    logo: "🥇",
    color: "hsl(45 90% 50%)",
    description: "TOTP-authenticated Firstock integration building live NIFTY/BANKNIFTY/FINNIFTY/MIDCPNIFTY/SENSEX option chains from the daily NFO/BFO symbol master plus batched quote calls, with Black-Scholes-derived IV/Greeks.",
    docsUrl: "https://firstock.in/",
    features: ["Option Chain", "Live Quotes", "TOTP Login", "Open Interest"],
    fields: [
      { key: "userId", label: "User ID", placeholder: "Enter Firstock login/client ID", type: "text", required: true, helpText: "Your Firstock trading login ID" },
      { key: "password", label: "Password", placeholder: "Enter Firstock account password", type: "password", required: true },
      { key: "totpSecret", label: "TOTP Secret", placeholder: "Enter TOTP secret for 2FA", type: "password", required: true, helpText: "Base32 2FA secret from your authenticator app setup — used to auto-generate login codes" },
      { key: "vendorCode", label: "Vendor Code", placeholder: "Enter Firstock Vendor Code", type: "text", required: true, helpText: "Issued when Firstock API access is enabled on your account" },
      { key: "apiKey", label: "API Key", placeholder: "Enter Firstock API Key", type: "password", required: true, helpText: "Issued alongside your Vendor Code for API access" },
    ],
  },
  {
    id: "flattrade",
    name: "Flattrade (Pi)",
    logo: "📉",
    color: "hsl(340 75% 55%)",
    description: "Live NSE/BSE index option-chain data via Flattrade's PiConnect API, using a daily instrument master and rate-limited per-contract quotes with Black-Scholes-derived Greeks.",
    docsUrl: "https://piconnect.flattrade.in/docs",
    features: ["Option Chain", "Live Quotes", "Index Spot LTP", "Expiry List"],
    fields: [
      { key: "clientId", label: "Client ID (UCC)", placeholder: "FZ00000", type: "text", required: true, helpText: "Your Flattrade trading account Client ID / UCC." },
      { key: "apiKey", label: "API Key", placeholder: "App API Key from wall.flattrade.in", type: "text", required: true, helpText: "From Flattrade Pi app registration at wall.flattrade.in → Pi → Create New API Key." },
      { key: "apiSecret", label: "API Secret", placeholder: "App API Secret", type: "password", required: true, helpText: "The secret paired with your API Key, revealed via the eye icon on wall.flattrade.in." },
      { key: "requestCode", label: "Request Code", placeholder: "One-time code from the login redirect", type: "password", required: true, helpText: "Visit https://auth.flattrade.in/?app_key=<your API Key>, log in, then copy the request_code from the redirect URL. Valid only a few minutes — paste and save immediately. Needed again whenever the daily session expires (Flattrade clears sessions 5-6 AM IST)." },
    ],
  },
  {
    id: "groww",
    name: "Groww",
    logo: "🌱",
    color: "hsl(150 60% 45%)",
    description: "Live NIFTY/BANKNIFTY/FINNIFTY/MIDCPNIFTY/SENSEX option chains via Groww's checksum-authenticated Trading API, with Black-Scholes-derived IV and Greeks.",
    docsUrl: "https://groww.in/trade-api/docs/curl",
    features: ["Option Chain", "Live Quotes", "Checksum Auth"],
    fields: [
      { key: "apiKey", label: "API Key", placeholder: "Enter Groww API Key", type: "text", required: true, helpText: "From Groww app → Profile → Trading APIs → Generate API keys" },
      { key: "apiSecret", label: "API Secret", placeholder: "Enter Groww API Secret", type: "password", required: true, helpText: "Shown once when the API key is generated; requires daily approval in the Groww app" },
    ],
  },
  {
    id: "hdfcsecurities",
    name: "HDFC Securities (InvestRight)",
    logo: "🏦",
    color: "hsl(0 70% 45%)",
    description: "Live NIFTY/BANKNIFTY/FINNIFTY/MIDCPNIFTY/SENSEX option-chain data via HDFC Securities' InvestRight API — REST LTP plus a persistent WebSocket feed for OI, volume and depth.",
    docsUrl: "https://developer.hdfcsec.com",
    features: ["Option Chain", "Live Quotes", "Open Interest", "Market Depth"],
    fields: [
      { key: "apiKey", label: "API Key", placeholder: "Your InvestRight app API key", type: "text", required: true, helpText: "From your InvestRight developer app registration. Sent as an api_key query param on every request." },
      { key: "accessToken", label: "Access Token", placeholder: "Paste the accessToken from InvestRight login", type: "password", required: true, helpText: "InvestRight's login is a browser-redirect OAuth flow. Complete it once (GET /oapi/v1/login, then exchange the returned request_token for an accessToken using your apiSecret), then paste the resulting accessToken here. Valid for the rest of the trading day — re-paste if calls start failing with a session-expired error." },
    ],
  },
  {
    id: "hdfcsky",
    name: "HDFC Sky (HDFC Securities)",
    logo: "☁️",
    color: "hsl(205 75% 50%)",
    description: "Live NIFTY/BANKNIFTY/FINNIFTY/MIDCPNIFTY/SENSEX option chain via HDFC Sky's Open API, with IV/Greeks computed via Black-Scholes from real traded LTP.",
    docsUrl: "https://developer.hdfcsky.com/sky-docs/docs/intro",
    features: ["Option Chain", "Live LTP", "Expiry List", "Black-Scholes Greeks"],
    fields: [
      { key: "apiKey", label: "API Key", placeholder: "e.g. f700ed935c074eab83f177d8...", type: "text", required: true, helpText: "From HDFC Sky's developer portal (developer.hdfcsky.com). Sent as the api_key query param on every call." },
      { key: "accessToken", label: "Access Token", placeholder: "Paste the accessToken JWT from the login flow", type: "password", required: true, helpText: "Complete HDFC Sky's login flow (browser redirect: GET /oapi/v1/login -> HDFC login/OTP/PIN -> POST /oapi/v1/access-token) once externally and paste the resulting accessToken here. Sent as a raw Authorization header (no 'Bearer ' prefix). Re-paste when it expires." },
    ],
  },
  {
    id: "ibulls",
    name: "IndiaBulls Securities (XTS Market Data)",
    logo: "🐂",
    color: "hsl(15 80% 50%)",
    description: "Live NIFTY/BANKNIFTY/FINNIFTY/MIDCPNIFTY/SENSEX option chains from IndiaBulls Securities' XTS market-data API, with instrument-master-driven strike/expiry resolution and Black-Scholes-filled Greeks.",
    docsUrl: "https://symphonyfintech.com/xts-trading-front-end-api/",
    features: ["Option Chain", "Live Quotes", "Open Interest", "Expiry List"],
    fields: [
      { key: "marketApiKey", label: "Market Data API Key", placeholder: "appKey from IndiaBulls XTS developer portal", type: "password", required: true, helpText: "The 'Market Data API' appKey — distinct from the 'Interactive API' key used for order placement, which this integration never needs." },
      { key: "marketApiSecret", label: "Market Data API Secret", placeholder: "secretKey from IndiaBulls XTS developer portal", type: "password", required: true, helpText: "The 'Market Data API' secretKey, paired with the appKey above." },
    ],
  },
  {
    id: "iifl",
    name: "IIFL Securities",
    logo: "🔷",
    color: "hsl(230 65% 50%)",
    description: "Live NIFTY/BANKNIFTY/FINNIFTY/MIDCPNIFTY/SENSEX option chains via IIFL's XTS Market Data API — daily instrument master + batched quotes, Black-Scholes IV/Greeks fill-in.",
    docsUrl: "https://ttblaze.iifl.com",
    features: ["Option Chain", "Live Quotes", "Open Interest", "IV & Greeks"],
    fields: [
      { key: "apiKey", label: "Market Data App Key", placeholder: "App key from IIFL's Market Data API app", type: "text", required: true, helpText: "From your IIFL Securities developer account — the App Key for the Market Data API app (a separate app registration from the Interactive/trading API; this integration is read-only and never uses the Interactive app's credentials)." },
      { key: "apiSecret", label: "Market Data Secret Key", placeholder: "Secret key from IIFL's Market Data API app", type: "password", required: true, helpText: "The matching Secret Key for the Market Data App Key above." },
    ],
  },
  {
    id: "iiflcapital",
    name: "IIFL Capital",
    logo: "🔶",
    color: "hsl(25 85% 50%)",
    description: "Live NIFTY/BANKNIFTY/FINNIFTY/MIDCPNIFTY/SENSEX option chains via IIFL Capital's REST API, built from its daily contract-master CSVs plus batched market-quote and per-leg open-interest calls.",
    docsUrl: "https://api.iiflcapital.com/",
    features: ["Option Chain", "Live Quotes", "Open Interest", "Black-Scholes Greeks"],
    fields: [
      { key: "clientId", label: "Client ID", placeholder: "e.g. AB1234", type: "text", required: true, helpText: "Your IIFL Capital client ID — also returned as the `clientId` query param when IIFL redirects you back after logging in." },
      { key: "appSecret", label: "App Secret", placeholder: "App secret from your Relationship Manager", type: "password", required: true, helpText: "App Secret for your registered API application — obtained from your IIFL Relationship Manager / Point of Contact, not from the login page." },
      { key: "authCode", label: "Auth Code (daily)", placeholder: "Paste today's authCode", type: "password", required: true, helpText: "Single-use code from today's login: visit https://markets.iiflcapital.com/?v=1&appkey=YOUR_APP_KEY&redirecturl=YOUR_URL, log in with your trading credentials + OTP/TOTP, and copy the `authCode` IIFL redirects you back with. Must be regenerated once per trading day." },
    ],
  },
  {
    id: "indmoney",
    name: "IndMoney (INDstocks)",
    logo: "💰",
    color: "hsl(140 65% 42%)",
    description: "Live NIFTY/BANKNIFTY/FINNIFTY/MIDCPNIFTY/SENSEX option-chain data via INDstocks' instrument master + batched quotes, with Black-Scholes-derived IV and Greeks.",
    docsUrl: "https://api-docs.indstocks.com/",
    features: ["Option Chain", "Live Quotes", "Multi-Index", "TOTP Login"],
    fields: [
      { key: "accessToken", label: "Access Token (optional if using MPIN + TOTP)", placeholder: "Paste your 24-hour INDstocks access token", type: "password", required: false, helpText: "Generate at indstocks.com -> API Trading -> Generate Token. Valid 24 hours. Leave blank to use MPIN + TOTP login instead." },
      { key: "clientId", label: "Client ID", placeholder: "e.g. IND1234567", type: "text", required: false, helpText: "Shown on the INDstocks access-tokens page after TOTP setup. Required only for MPIN + TOTP login (sent as the x-api-key header)." },
      { key: "mpin", label: "MPIN", placeholder: "Your INDstocks account MPIN", type: "password", required: false, helpText: "Required only for MPIN + TOTP login." },
      { key: "totpSecret", label: "TOTP Secret", placeholder: "Base32 secret from your authenticator app setup", type: "password", required: false, helpText: "Required only for MPIN + TOTP login. The base32 secret key (not a 6-digit code) — used to generate a fresh code each session." },
    ],
  },
  {
    id: "jainamxts",
    name: "Jainam (XTS)",
    logo: "⚡",
    color: "hsl(50 90% 50%)",
    description: "Live NIFTY/BANKNIFTY/FINNIFTY/MIDCPNIFTY/SENSEX option chain data via Jainam's Symphony Fintech XTS market-data API, with Black-Scholes IV/Greeks fill-in.",
    docsUrl: "https://developers.symphonyfintech.in/doc/marketdata/",
    features: ["Option Chain", "Live LTP", "Open Interest", "Expiry List", "Black-Scholes Greeks"],
    fields: [
      { key: "apiKey", label: "Market Data API Key", placeholder: "Enter your Jainam XTS Market Data API Key", type: "text", required: true, helpText: "Raise a Symphony API activation ticket with Jainam support (client name, mobile, email, client code, branch code) to get this — it is the Market Data appKey, separate from the Interactive/order-placement key." },
      { key: "apiSecret", label: "Market Data API Secret", placeholder: "Enter your Jainam XTS Market Data API Secret", type: "password", required: true, helpText: "Issued alongside the Market Data API Key by Jainam support." },
    ],
  },
  {
    id: "kotak",
    name: "Kotak Securities (Neo)",
    logo: "🔴",
    color: "hsl(355 75% 48%)",
    description: "Live NIFTY/BANKNIFTY/FINNIFTY/MIDCPNIFTY/SENSEX option chains via Kotak Neo's TOTP+MPIN session, daily scrip-master CSV, and batched neosymbol quotes.",
    docsUrl: "https://github.com/marketcalls/broker-api-docs/tree/main/kotak-api-docs",
    features: ["Option Chain", "Live Quotes", "TOTP Login", "Daily Scrip Master", "IV/Greeks (Black-Scholes)"],
    fields: [
      { key: "accessToken", label: "Neo API Access Token", placeholder: "eyJhbGciOi...", type: "password", required: true, helpText: "Neo app > More > Trade API > Your Applications. Identifies your registered API app; also used directly (not the session token) for all read-only market-data calls." },
      { key: "mobileNumber", label: "Registered Mobile Number", placeholder: "+919876543210", type: "text", required: true, helpText: "The mobile number registered with your Kotak trading account." },
      { key: "ucc", label: "UCC (Client Code)", placeholder: "ABC123", type: "text", required: true, helpText: "Your Unique Client Code / Client ID." },
      { key: "totpSecret", label: "TOTP Secret", placeholder: "JBSWY3DPEHPK3PXP", type: "password", required: true, helpText: "The base32 secret from the QR code shown during Kotak Neo's one-time 'TOTP Registration' step in the API dashboard (not a live 6-digit code)." },
      { key: "mpin", label: "Trading MPIN", placeholder: "123456", type: "password", required: true, helpText: "Your 6-digit Kotak Neo trading MPIN." },
    ],
  },
  {
    id: "motilal",
    name: "Motilal Oswal",
    logo: "🔵",
    color: "hsl(220 70% 50%)",
    description: "Active-login (SHA-256 + TOTP) integration building the option chain from Motilal's public CSV instrument masters plus per-strike LTP calls, with Black-Scholes IV/Greeks fill-in.",
    docsUrl: "https://openapi.motilaloswal.com",
    features: ["Option Chain", "Live LTP", "Bid/Ask", "Greeks (computed)"],
    fields: [
      { key: "apiKey", label: "App API Key", placeholder: "Enter your Motilal Oswal App API Key", type: "text", required: true, helpText: "From Motilal Oswal's developer/API portal — also hashed into the login password" },
      { key: "apiSecret", label: "App API Secret", placeholder: "Enter your Motilal Oswal App API Secret (optional)", type: "password", required: false, helpText: "Optional — enables the extra getaccesstoken step; login still works without it" },
      { key: "clientId", label: "Client User ID", placeholder: "Enter your Motilal Oswal Client / User ID", type: "text", required: true, helpText: "Your trading login ID" },
      { key: "password", label: "Trading Password", placeholder: "Enter your trading password", type: "password", required: true, helpText: "Hashed with your API Key before being sent — never stored in plaintext by the broker" },
      { key: "dob", label: "Date of Birth (2FA)", placeholder: "DD/MM/YYYY", type: "text", required: true, helpText: "Used as the account's 2FA value during login, e.g. 18/10/1988" },
      { key: "totpSecret", label: "TOTP Secret", placeholder: "Enter TOTP secret (base32) from your authenticator app setup", type: "password", required: true, helpText: "Base32 secret used to auto-generate a fresh 6-digit TOTP code on every login — Motilal's own SMS/Email OTP flow is not supported" },
    ],
  },
  {
    id: "mstock",
    name: "mStock (Mirae Asset)",
    logo: "🟢",
    color: "hsl(130 55% 40%)",
    description: "Angel One-style TOTP session login with instrument-master + batched-quote option chain, Black-Scholes IV/Greeks via X API.",
    docsUrl: "https://tradingapi.mstock.com/docs/v1/typeB/",
    features: ["Option Chain", "Live Quotes", "TOTP Login", "Orders"],
    fields: [
      { key: "clientId", label: "Client ID / UCC", placeholder: "Enter mStock Client ID", type: "text", required: true, helpText: "Your mStock trading account Client ID (UCC)" },
      { key: "apiKey", label: "API Key", placeholder: "Enter mStock API Key", type: "text", required: true, helpText: "Generated at mstock.com/trading-api — valid ~1 year, sent as the X-PrivateKey header" },
      { key: "password", label: "Password", placeholder: "Enter mStock login password", type: "password", required: true },
      { key: "totpSecret", label: "TOTP Secret", placeholder: "Enter TOTP secret for 2FA", type: "password", required: true, helpText: "Base32 secret from your authenticator app setup — used to auto-generate the 6-digit TOTP code each session (session valid ~12 hours or until midnight IST, whichever is first)" },
    ],
  },
  {
    id: "nubra",
    name: "Nuvama Nubra",
    logo: "🟣",
    color: "hsl(265 60% 55%)",
    description: "TOTP-authenticated live NIFTY/BANKNIFTY/FINNIFTY/MIDCPNIFTY/SENSEX option chain via Nubra's native REST V3 option-chain endpoint, with Black-Scholes IV fill-in where the broker returns null.",
    docsUrl: "https://github.com/marketcalls/broker-api-docs/tree/main/nubra-api-docs",
    features: ["Option Chain", "Live Quotes", "Greeks (native + BS fallback)", "Expiry List"],
    fields: [
      { key: "phone", label: "Registered Mobile Number", placeholder: "9876543210", type: "text", required: true, helpText: "The 10-digit mobile number registered with your Nubra account." },
      { key: "mpin", label: "MPIN", placeholder: "1234", type: "password", required: true, helpText: "Your Nubra login MPIN — used at the /verifypin step of every login." },
      { key: "totpSecret", label: "TOTP Secret", placeholder: "Base32 secret from Nubra's Authenticator setup", type: "password", required: true, helpText: "Enable TOTP once in the Nubra app/web (Settings -> TOTP) and paste the base32 secret it gives you here -- not a 6-digit code, the secret itself." },
    ],
  },
  {
    id: "paytm",
    name: "Paytm Money",
    logo: "💙",
    color: "hsl(205 90% 50%)",
    description: "Live NIFTY/BANKNIFTY/FINNIFTY/MIDCPNIFTY option chain via Paytm Money's native /fno/v1/option-chain endpoint, with a SENSEX-specific instrument-master + batched-quotes fallback.",
    docsUrl: "https://developer.paytmmoney.com/",
    features: ["Option Chain", "Live Quotes", "OI/OI-Change", "Black-Scholes Greeks"],
    fields: [
      { key: "apiKey", label: "API Key", placeholder: "Enter Paytm Money API Key", type: "text", required: true, helpText: "From developer.paytmmoney.com → My Apps" },
      { key: "apiSecret", label: "API Secret", placeholder: "Enter Paytm Money API Secret", type: "password", required: true, helpText: "Paytm calls this api_secret_key — from developer.paytmmoney.com → My Apps" },
      { key: "accessToken", label: "Access Token", placeholder: "Enter access_token from the login flow", type: "password", required: true, helpText: "Complete the login redirect at login.paytmmoney.com, then exchange the request_token for an access_token at POST /accounts/v2/gettoken. Paste the plain access_token here (NOT public_access_token or read_access_token)." },
    ],
  },
  {
    id: "pocketful",
    name: "Pocketful",
    logo: "👛",
    color: "hsl(30 80% 50%)",
    description: "Live NIFTY/BANKNIFTY/FINNIFTY/MIDCPNIFTY/SENSEX option chain via Pocketful's authenticated WebSocket feed, with strikes resolved from its daily contract-master download.",
    docsUrl: "https://api.pocketful.in/docs/",
    features: ["Option Chain", "Live Quotes", "OI", "Greeks (computed)"],
    fields: [
      { key: "accessToken", label: "Access Token", placeholder: "Paste your Pocketful OAuth2 access_token", type: "password", required: true, helpText: "Pocketful uses a full OAuth2 authorization-code flow (browser consent + client_secret exchange). Complete that flow once outside this app (Pocketful's developer console / Postman) and paste the resulting access_token here — same pattern as this app's Upstox/Fyers integrations." },
    ],
  },
  {
    id: "rmoney",
    name: "RMoney (XTS Market Data API)",
    logo: "💵",
    color: "hsl(45 85% 48%)",
    description: "Real-time NIFTY/BANKNIFTY/FINNIFTY/MIDCPNIFTY/SENSEX option chain data via RMoney's Symphony Fintech XTS Market Data API, built from the daily instrument master and batched quote calls with Black-Scholes IV/Greeks.",
    docsUrl: "https://github.com/marketcalls/openalgo/tree/main/broker/rmoney",
    features: ["Option Chain", "Live Quotes", "Open Interest", "Black-Scholes Greeks"],
    fields: [
      { key: "apiKey", label: "Market Data API Key", placeholder: "RMoney Market Data App Key", type: "text", required: true, helpText: "The App Key issued for RMoney's XTS Market Data API (a separate key from the Interactive/trading API)." },
      { key: "apiSecret", label: "Market Data Secret Key", placeholder: "RMoney Market Data Secret Key", type: "password", required: true, helpText: "The Secret Key paired with the Market Data App Key above." },
    ],
  },
  {
    id: "samco",
    name: "SAMCO Securities (StockNote)",
    logo: "🟠",
    color: "hsl(20 85% 52%)",
    description: "Live NIFTY/BANKNIFTY/FINNIFTY/MIDCPNIFTY/SENSEX option chains via SAMCO's StockNote Trade API v3.2, built from its public scrip master and batched multi-quote calls.",
    docsUrl: "https://tradeapi.samco.in/app/login",
    features: ["Option Chain", "Live Quotes", "Index Spot", "Multi-Expiry"],
    fields: [
      { key: "apiKey", label: "API Key", placeholder: "OAuth app API key", type: "text", required: true, helpText: "From the OAuth app you create in the Samco StockNote developer dashboard at tradeapi.samco.in/app/login." },
      { key: "apiSecret", label: "API Secret", placeholder: "OAuth app API secret", type: "password", required: true, helpText: "Shown once when the OAuth app is created — regenerate it from the dashboard if you've lost it. The server exchanges this + the API key for a session token itself; you never need to paste a token." },
    ],
  },
  {
    id: "shoonya",
    name: "Shoonya (Finvasia)",
    logo: "🆓",
    color: "hsl(170 65% 42%)",
    description: "OAuth-authenticated NSE/BSE option chain data via Shoonya's Noren-OMS API, built from a daily instrument master and batched per-contract quotes with Black-Scholes IV/Greeks fill-in.",
    docsUrl: "https://shoonya.com/api-documentation",
    features: ["Option Chain", "Live Quotes", "OI", "5 Indices (incl. SENSEX)"],
    fields: [
      { key: "userId", label: "Trading User ID (UID)", placeholder: "FA12345", type: "text", required: true, helpText: "Your Shoonya trading login ID — sent as `uid` on every API call." },
      { key: "apiKey", label: "API Client ID", placeholder: "e.g. your app's OAuth client_id", type: "text", required: true, helpText: "The client_id issued when you registered an app on Shoonya's developer console." },
      { key: "apiSecret", label: "API Secret Key", placeholder: "App secret key", type: "password", required: true, helpText: "The app secret paired with your API Client ID — used only to compute the login checksum, never sent as-is." },
      { key: "requestCode", label: "Authorization Code", placeholder: "One-time code from the OAuth redirect", type: "password", required: true, helpText: "Visit https://api.shoonya.com/OAuthlogin/authorize/oauth?client_id=<API Client ID>, log in, and paste the `code` param from the redirect URL here. Expires within minutes — regenerate if login fails." },
    ],
  },
  {
    id: "tradejini",
    name: "Tradejini (CubePlus)",
    logo: "🧞",
    color: "hsl(255 65% 55%)",
    description: "Live NIFTY/BANKNIFTY/FINNIFTY/MIDCPNIFTY/SENSEX option-chain data via Tradejini's persistent NxtradStream feed, including broker-computed IV and Greeks.",
    docsUrl: "https://developer.tradejini.com/",
    features: ["Option Chain", "Live Quotes", "Server-side Greeks/IV", "Auto TOTP Login"],
    fields: [
      { key: "apiKey", label: "API Key", placeholder: "Enter Tradejini App API Key", type: "text", required: true, helpText: "From the Tradejini developer portal (app registration) — the app's static IP must be whitelisted there for login to succeed" },
      { key: "password", label: "CubePlus PIN", placeholder: "Enter your CubePlus login PIN", type: "password", required: true, helpText: "Your CubePlus trading-app login PIN, not your account password" },
      { key: "totpSecret", label: "TOTP Secret", placeholder: "Enter TOTP secret for 2FA", type: "password", required: true, helpText: "Base32 secret from Tradejini's TOTP/2FA setup — used to auto-generate a fresh login code every session" },
    ],
  },
  {
    id: "tradesmart",
    name: "TradeSmart (Noren v2)",
    logo: "📈",
    color: "hsl(195 70% 45%)",
    description: "Live NIFTY/BANKNIFTY/FINNIFTY/SENSEX option chain data via TradeSmart's Noren v2 API, built from its daily instrument master and rate-limited quote calls.",
    docsUrl: "https://apidocs.tradesmartonline.in/v2/",
    features: ["Option Chain", "Live Quotes", "OI & Volume", "Multi-Expiry"],
    fields: [
      { key: "clientId", label: "Client ID", placeholder: "AB1234", type: "text", required: true, helpText: "Your TradeSmart trading Client ID / UCC." },
      { key: "apiKey", label: "App Key", placeholder: "App key from your TradeSmart API app", type: "text", required: true, helpText: "From your registered TradeSmart API application." },
      { key: "apiSecret", label: "Secret Key", placeholder: "Secret key from your TradeSmart API app", type: "password", required: true },
      { key: "requestCode", label: "Authorization Code", placeholder: "One-time code from the OAuth redirect", type: "password", required: true, helpText: "Open https://v2api.tradesmartonline.in/OAuthlogin/authorize/oauth?client_id=<App Key>, log in, and paste the 'code' param from the redirect URL here. It is single-use and expires within minutes — generate a fresh one each session." },
    ],
  },
  {
    id: "wisdom",
    name: "Wisdom Capital (XTS)",
    logo: "🦉",
    color: "hsl(275 55% 50%)",
    description: "Live NIFTY/BANKNIFTY/FINNIFTY/MIDCPNIFTY/SENSEX option chains via Wisdom Capital's XTS market-data API, with Black-Scholes IV/Greeks fill-in.",
    docsUrl: "https://developers.symphonyfintech.in/doc/marketdata/",
    features: ["Option Chain", "Live Quotes", "Open Interest", "Expiry List"],
    fields: [
      { key: "apiKey", label: "Market Data App Key", placeholder: "Your Wisdom Capital market-data appKey", type: "text", required: true, helpText: "From Wisdom Capital's XTS developer portal — the market-data (not interactive/trading) app key." },
      { key: "apiSecret", label: "Market Data Secret Key", placeholder: "Your Wisdom Capital market-data secretKey", type: "password", required: true, helpText: "Paired secret for the market-data app key above. Never logged; used only to log in and fetch a session token server-side." },
    ],
  },
  {
    id: "zebu",
    name: "Zebu (Mynt)",
    logo: "🦓",
    color: "hsl(0 0% 40%)",
    description: "Live NIFTY/BANKNIFTY/FINNIFTY/MIDCPNIFTY/SENSEX option chains via Zebu's Noren-based Mynt API, with Black-Scholes-filled Greeks.",
    docsUrl: "https://docs.openalgo.in/connect-brokers/brokers/zebu",
    features: ["Option Chain", "Live Quotes", "OAuth Login", "OI Data"],
    fields: [
      { key: "userId", label: "Trading User ID", placeholder: "e.g. Z56004", type: "text", required: true, helpText: "Your Zebu MYNT login / trading user ID. Sent as uid/actid on every API call." },
      { key: "clientId", label: "OAuth Client ID", placeholder: "e.g. Z56004_U", type: "text", required: true, helpText: "From mynt.zebuetrade.com: Profile > Settings > OAuth Key screen." },
      { key: "apiSecret", label: "OAuth Secret Code", placeholder: "Paste your Secret Code", type: "password", required: true, helpText: "Generated alongside the Client ID on the same OAuth Key screen. Never shared." },
      { key: "authCode", label: "Authorization Code", placeholder: "Paste the one-time code from the redirect URL", type: "text", required: true, helpText: "Visit go.mynt.in/OAuthlogin/authorize/oauth?client_id=<clientId>, log in, and copy the ?code= from the redirect. Single-use, expires within minutes — you'll need a fresh one whenever the session expires." },
    ],
  },
];

// ── localStorage CRUD ──

export function getSavedBrokers(): BrokerCredentials[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveBrokerCredentials(creds: BrokerCredentials): void {
  const existing = getSavedBrokers();
  const idx = existing.findIndex((b) => b.brokerId === creds.brokerId);
  if (idx >= 0) {
    existing[idx] = creds;
  } else {
    existing.push(creds);
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(existing));
}

export function removeBrokerCredentials(brokerId: string): void {
  const existing = getSavedBrokers().filter((b) => b.brokerId !== brokerId);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(existing));
}

export function getActiveBroker(): BrokerCredentials | null {
  const all = getSavedBrokers();
  return all.find((b) => b.isActive) || all[0] || null;
}

export function setActiveBroker(brokerId: string): void {
  const all = getSavedBrokers().map((b) => ({
    ...b,
    isActive: b.brokerId === brokerId,
  }));
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
}

export function getBrokerInfo(brokerId: string): BrokerInfo | undefined {
  return BROKERS.find((b) => b.id === brokerId);
}
