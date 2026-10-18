/**
 * Presentation logic for the broker directory in Broker Settings: the capability matrix (derived from
 * each server adapter's declared capabilities, never hand-written), auth-method copy, search/filter
 * across all 41 brokers and credential-form validation. Pure functions, unit-tested.
 */
import type { BrokerAuthKind, BrokerCapability, BrokerInfo } from "./brokerConfig";

export type MatrixKey = "chain" | "quotes" | "feed" | "portfolio" | "orders";
export type MatrixLevel = "yes" | "partial" | "gated" | "no";

export interface MatrixCell {
  level: MatrixLevel;
  /** Short text shown next to the icon (also the accessible name). */
  label: string;
  /** Longer explanation for a tooltip / screen readers. */
  detail: string;
}

export const MATRIX_COLUMNS: ReadonlyArray<{ key: MatrixKey; label: string }> = [
  { key: "chain", label: "Option chain" },
  { key: "quotes", label: "Quotes" },
  { key: "feed", label: "Live feed" },
  { key: "portfolio", label: "Portfolio" },
  { key: "orders", label: "Orders" },
];

export const AUTH_COPY: Record<BrokerAuthKind, { label: string; help: string }> = {
  apiKeyToken: {
    label: "API key / token",
    help: "Paste your API keys or a token from the broker's developer portal. Daily tokens need pasting again when they expire.",
  },
  oauthRedirect: {
    label: "OAuth login",
    help: "Log in on the broker's site, then paste the access token it issues. It expires daily.",
  },
  requestTokenExchange: {
    label: "One-time code",
    help: "Log in on the broker's site and paste the one-time code from the redirect; the local proxy exchanges it for a session.",
  },
  sessionLogin: {
    label: "Session login",
    help: "Use Log in each session with your PIN or password and the current authenticator code. Neither is ever saved.",
  },
};

export const CAPABILITY_LABEL: Record<BrokerCapability, string> = {
  testConnection: "Connection test",
  instruments: "Instrument master",
  expiries: "Expiry list",
  optionChain: "Option chain",
  ltp: "LTP",
  quotes: "Quotes",
  depth: "Market depth",
  historical: "Historical candles",
  feed: "Live feed",
  positions: "Positions",
  holdings: "Holdings",
  funds: "Funds",
  orderBook: "Order book",
  tradeBook: "Trade book",
  placeOrder: "Place order",
  modifyOrder: "Modify order",
  cancelOrder: "Cancel order",
};

const PORTFOLIO: BrokerCapability[] = ["positions", "holdings", "funds", "orderBook", "tradeBook"];
const ORDERS: BrokerCapability[] = ["placeOrder", "modifyOrder", "cancelOrder"];

type CapSource = Pick<BrokerInfo, "capabilities" | "greeks" | "verified">;

/** The five-column summary of what a broker's adapter can do. */
export function capabilityMatrix(b: CapSource): Record<MatrixKey, MatrixCell> {
  const has = (c: BrokerCapability) => b.capabilities.includes(c);

  const chain: MatrixCell = has("optionChain")
    ? {
        level: "yes",
        label: b.greeks === "broker" ? "Broker Greeks" : "Computed Greeks",
        detail: b.greeks === "broker" ? "Option chain with IV and Greeks from the broker" : "Option chain; IV and Greeks computed locally (Black-Scholes)",
      }
    : { level: "no", label: "No", detail: "No option chain" };

  const quotes: MatrixCell =
    has("quotes") && has("depth")
      ? { level: "yes", label: "Quotes + depth", detail: "Quotes and market depth" }
      : has("quotes")
        ? { level: "yes", label: "Quotes", detail: "Quotes (no market depth over the API)" }
        : has("ltp")
          ? { level: "partial", label: "LTP only", detail: "Last traded price only" }
          : { level: "no", label: "No", detail: "No quotes" };

  const feed: MatrixCell = has("feed")
    ? { level: "yes", label: "Live", detail: "Streaming WebSocket feed" }
    : { level: "no", label: "Polling", detail: "No streaming feed wired yet; data is polled" };

  const present = PORTFOLIO.filter(has);
  const missing = PORTFOLIO.filter((c) => !has(c));
  const portfolio: MatrixCell =
    missing.length === 0
      ? { level: "yes", label: "Full", detail: "Positions, holdings, funds, order book and trade book" }
      : present.length > 0
        ? { level: "partial", label: "Partial", detail: `No ${missing.map((c) => CAPABILITY_LABEL[c].toLowerCase()).join(", ")}` }
        : { level: "no", label: "No", detail: "No portfolio data" };

  const orders: MatrixCell = !ORDERS.every(has)
    ? { level: "no", label: "No", detail: "No order methods" }
    : b.verified
      ? { level: "yes", label: "1Cliq (armed)", detail: "Live orders through 1Cliq Trade, only after you enable live trading and arm the session" }
      : { level: "gated", label: "Blocked", detail: "Order code is built and gated, but blocked in this app pending review. No order can be sent." };

  return { chain, quotes, feed, portfolio, orders };
}

/** Human names of every capability the adapter declares, in contract order. */
export function capabilityLabels(b: Pick<BrokerInfo, "capabilities">): string[] {
  return b.capabilities.filter((c) => c !== "testConnection").map((c) => CAPABILITY_LABEL[c]);
}

export interface BrokerFilter {
  query: string;
  auth: BrokerAuthKind | "all";
  capability: MatrixKey | "all";
  savedOnly: boolean;
}

export const EMPTY_FILTER: BrokerFilter = { query: "", auth: "all", capability: "all", savedOnly: false };

function matchesQuery(b: BrokerInfo, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = [b.id, b.name, b.description, AUTH_COPY[b.authKind].label, ...b.features, ...capabilityLabels(b)].join(" ").toLowerCase();
  return q.split(/\s+/).every((word) => hay.includes(word));
}

/** Apply search text, auth-method, capability and saved-only filters. */
export function filterBrokers(list: readonly BrokerInfo[], f: BrokerFilter, savedIds: ReadonlySet<string> = new Set()): BrokerInfo[] {
  return list.filter((b) => {
    if (f.savedOnly && !savedIds.has(b.id)) return false;
    if (f.auth !== "all" && b.authKind !== f.auth) return false;
    if (f.capability !== "all") {
      const level = capabilityMatrix(b)[f.capability].level;
      if (level === "no" || (f.capability !== "orders" && level === "gated")) return false;
    }
    return matchesQuery(b, f.query);
  });
}

/** Labels of the fields still needed before a broker's keys can be saved (required fields + alternatives). */
export function missingCredentialFields(b: Pick<BrokerInfo, "fields" | "alternatives">, values: Record<string, string>): string[] {
  const filled = (k: string) => !!values[k]?.trim();
  const label = (k: string) => b.fields.find((f) => f.key === k)?.label ?? k;
  const missing = b.fields.filter((f) => f.required && !filled(f.key)).map((f) => f.label);
  const groups = b.alternatives ?? [];
  if (groups.length > 0 && !groups.some((g) => g.every(filled))) {
    missing.push(groups.map((g) => g.map(label).join(" + ")).join(" or "));
  }
  return missing;
}
