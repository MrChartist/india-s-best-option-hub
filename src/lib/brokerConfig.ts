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
    description: "India's largest broker. Access live data via Kite Connect API with WebSocket streaming.",
    docsUrl: "https://kite.trade/docs/connect/v3/",
    features: ["Option Chain", "Live Quotes", "WebSocket Streaming", "Historical Data"],
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
      { key: "totpSecret", label: "TOTP Secret", placeholder: "Enter TOTP secret for 2FA", type: "password", required: false, helpText: "For automated TOTP generation (optional)" },
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
      { key: "appName", label: "App Name", placeholder: "Enter 5paisa App Name", type: "text", required: true },
      { key: "appSource", label: "App Source", placeholder: "Enter App Source ID", type: "text", required: true },
      { key: "userId", label: "User ID", placeholder: "Enter User ID / Client Code", type: "text", required: true },
      { key: "encryptionKey", label: "Encryption Key", placeholder: "Enter Encryption Key", type: "password", required: true },
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
