/**
 * Endpoint table and input validation for the generic multi-broker proxy (/api/broker-proxy).
 *
 * proxy-server.mjs owns transport (Host/Origin allowlists, rate limits, credential decoding, caching);
 * this module owns WHICH adapter capability an endpoint reaches and what arguments it may carry, so the
 * rules can be unit-tested without spawning the proxy.
 *
 *   market    — read-only market data. Cacheable for a few seconds under a credential-tagged key.
 *   portfolio — the user's own positions/holdings/funds/books. Read-only GETs, but never cached, never
 *               served stale, and (like the 1Cliq trading endpoints) Origin-less callers only from loopback.
 *   order     — real-money calls. ALWAYS refused here: the browser order path for these adapters is
 *               intentionally blocked pending owner review, and no route mints an order gate for them.
 *               Even if one did, every adapter's placeOrder/modifyOrder/cancelOrder is wrapped with
 *               withOrderGate() and refuses without a valid, unused gate.
 *
 * The streaming `feed` capability is a WebSocket, not an HTTP endpoint, and is not proxied here.
 */
import { BrokerInputError, CAPABILITIES } from "./contract.mjs";

export const MARKET_ENDPOINTS = Object.freeze({
  "option-chain": "optionChain",
  "expiry-list": "expiries",
  ltp: "ltp",
  quotes: "quotes",
  depth: "depth",
  historical: "historical",
  instruments: "instruments",
});

export const PORTFOLIO_ENDPOINTS = Object.freeze({
  positions: "positions",
  holdings: "holdings",
  funds: "funds",
  "order-book": "orderBook",
  "trade-book": "tradeBook",
});

export const ORDER_ENDPOINTS = Object.freeze({
  "place-order": "placeOrder",
  "modify-order": "modifyOrder",
  "cancel-order": "cancelOrder",
});

export const BROKER_PROXY_ENDPOINTS = Object.freeze([
  ...Object.keys(MARKET_ENDPOINTS),
  ...Object.keys(PORTFOLIO_ENDPOINTS),
]);

/** Cache lifetime per market endpoint (ms). Portfolio endpoints are never cached. */
export const MARKET_TTL_MS = Object.freeze({
  "option-chain": 3000,
  "expiry-list": 300_000,
  ltp: 3000,
  quotes: 2000,
  depth: 1000,
  historical: 60_000,
  instruments: 600_000,
});

const EXCHANGES = new Set(["NSE", "BSE", "NFO", "BFO", "MCX", "CDS"]);
const INTERVALS = new Set(["1m", "3m", "5m", "15m", "30m", "60m", "1d"]);
const INSTRUMENT_TYPES = new Set(["INDEX", "EQ", "FUTIDX", "FUTSTK", "OPTIDX", "OPTSTK"]);
// Broker tokens differ wildly ("49081", "IDX_I:13", "NSE:NIFTY 50", "2885_NSE", "IDX-13", "NSE_FO|51440",
// "NSE:M&M-EQ"), so this allows only the characters they actually use. No "/", "?", "#", "%", "," or "..": an
// adapter that puts a token in a URL path or query can never be steered to another endpoint. ("&" stays because
// real symbols such as M&M carry it; adapters must still encodeURIComponent any token they put in a URL.)
const TOKEN_RE = /^(?!.*\.\.)[A-Za-z0-9:_|.& -]{1,64}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}( \d{2}:\d{2})?$/;
const UNDERLYING_RE = /^[A-Z0-9&-]{1,20}$/;
/**
 * Upper bounds on a historical request, checked before any adapter runs. Several adapters split long
 * ranges into many sequential upstream calls, so an unbounded span would let one inbound request burn
 * hundreds of calls on the user's token (and risk the broker throttling the key). Adapters keep their
 * own per-broker limits as a second layer.
 */
export const HISTORICAL_MIN_YEAR = 2000;
export const HISTORICAL_MAX_SPAN_DAYS = Object.freeze({ intraday: 60, daily: 2000 });
const DAY_MS = 86_400_000;
const dayNumber = (d) => {
  const [y, m, day] = d.slice(0, 10).split("-").map(Number);
  const t = Date.UTC(y, m - 1, day);
  const back = new Date(t);
  // Reject impossible calendar dates (2026-02-31) rather than letting Date roll them over.
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== m - 1 || back.getUTCDate() !== day) return NaN;
  return Math.floor(t / DAY_MS);
};
export const MAX_QUOTE_REFS = 50;
export const MAX_INSTRUMENT_ROWS = 2000;

/**
 * Classify an endpoint name.
 * @returns {{ kind: "market"|"portfolio"|"order", capability: string } | null}
 */
export function resolveBrokerEndpoint(endpoint) {
  const e = String(endpoint ?? "");
  if (Object.hasOwn(MARKET_ENDPOINTS, e)) return { kind: "market", capability: MARKET_ENDPOINTS[e] };
  if (Object.hasOwn(PORTFOLIO_ENDPOINTS, e)) return { kind: "portfolio", capability: PORTFOLIO_ENDPOINTS[e] };
  if (Object.hasOwn(ORDER_ENDPOINTS, e)) return { kind: "order", capability: ORDER_ENDPOINTS[e] };
  return null;
}

/** The adapter method that implements `capability`, or null when the adapter does not offer it. */
export function capabilityMethod(adapter, capability) {
  const spec = CAPABILITIES[capability];
  if (!spec || !adapter) return null;
  const caps = adapter.capabilities && typeof adapter.capabilities === "object" ? adapter.capabilities : null;
  // A strict adapter must also DECLARE the capability; a lenient one is judged by its methods alone.
  if (caps?.auth !== undefined && (caps[capability] === undefined || caps[capability] === false)) return null;
  return spec.methods.find((m) => typeof adapter[m] === "function") ?? null;
}

function readRef(token, exchange, label = "instrument") {
  const t = String(token ?? "");
  const x = String(exchange ?? "").toUpperCase();
  if (!TOKEN_RE.test(t)) throw new BrokerInputError(`Invalid ${label} token`);
  if (!EXCHANGES.has(x)) throw new BrokerInputError(`Invalid ${label} exchange. Use one of: ${[...EXCHANGES].join(", ")}`);
  return { token: t, exchange: x };
}

/**
 * Validate the query parameters of a quotes/depth/historical/instruments request and return the
 * adapter arguments that follow `creds`. Throws BrokerInputError (422) on anything unexpected.
 * @param {string} capability
 * @param {URLSearchParams} params
 */
export function parseBrokerArgs(capability, params) {
  switch (capability) {
    case "quotes": {
      let refs;
      try {
        refs = JSON.parse(params.get("refs") ?? "");
      } catch {
        throw new BrokerInputError('quotes needs refs=[{"token":"...","exchange":"NFO"}] (JSON)');
      }
      if (!Array.isArray(refs) || refs.length === 0 || refs.length > MAX_QUOTE_REFS) {
        throw new BrokerInputError(`quotes needs between 1 and ${MAX_QUOTE_REFS} refs`);
      }
      return [refs.map((r) => readRef(r?.token, r?.exchange))];
    }
    case "depth":
      return [readRef(params.get("token"), params.get("exchange"))];
    case "historical": {
      const instrument = readRef(params.get("token"), params.get("exchange"));
      const interval = String(params.get("interval") ?? "");
      if (!INTERVALS.has(interval)) throw new BrokerInputError(`Invalid interval. Use one of: ${[...INTERVALS].join(", ")}`);
      const from = String(params.get("from") ?? "");
      const to = String(params.get("to") ?? "");
      if (!DATE_RE.test(from) || !DATE_RE.test(to)) throw new BrokerInputError("from and to must be YYYY-MM-DD or YYYY-MM-DD HH:mm (IST)");
      if (from.slice(0, 10) > to.slice(0, 10)) throw new BrokerInputError("from must not be after to");
      const maxYear = new Date().getUTCFullYear() + 1;
      for (const d of [from, to]) {
        const y = Number(d.slice(0, 4));
        if (y < HISTORICAL_MIN_YEAR || y > maxYear) throw new BrokerInputError(`from and to must fall between ${HISTORICAL_MIN_YEAR} and ${maxYear}`);
      }
      const fromDay = dayNumber(from);
      const toDay = dayNumber(to);
      if (!Number.isFinite(fromDay) || !Number.isFinite(toDay)) throw new BrokerInputError("from and to must be real calendar dates");
      const cap = interval === "1d" ? HISTORICAL_MAX_SPAN_DAYS.daily : HISTORICAL_MAX_SPAN_DAYS.intraday;
      if (toDay - fromDay > cap) throw new BrokerInputError(`The range is too long for ${interval} candles: ask for at most ${cap} days at a time`);
      return [{ instrument, interval, from, to }];
    }
    default:
      return [];
  }
}

/** Filters accepted by the instruments endpoint (the full master is far too large to send). */
export function parseInstrumentFilter(params) {
  const underlying = String(params.get("underlying") ?? "").trim().toUpperCase();
  if (!UNDERLYING_RE.test(underlying)) throw new BrokerInputError("instruments needs underlying=<NIFTY|BANKNIFTY|...|stock symbol>");
  const type = params.get("instrumentType");
  if (type !== null && !INSTRUMENT_TYPES.has(type)) throw new BrokerInputError(`Invalid instrumentType. Use one of: ${[...INSTRUMENT_TYPES].join(", ")}`);
  const expiry = params.get("expiry");
  if (expiry !== null && !/^\d{4}-\d{2}-\d{2}$/.test(expiry)) throw new BrokerInputError("expiry must be YYYY-MM-DD");
  return { underlying, instrumentType: type, expiry };
}

/** Apply the instrument filter to an adapter result, capped at MAX_INSTRUMENT_ROWS. */
export function filterInstruments(result, filter) {
  const rows = Array.isArray(result?.data) ? result.data : [];
  const matched = rows.filter(
    (r) =>
      r?.underlying === filter.underlying &&
      (!filter.instrumentType || r.instrumentType === filter.instrumentType) &&
      (!filter.expiry || r.expiry === filter.expiry),
  );
  return { status: "success", data: matched.slice(0, MAX_INSTRUMENT_ROWS), truncated: matched.length > MAX_INSTRUMENT_ROWS, total: matched.length };
}

/** A stable cache-key fragment for the validated request (never includes credentials). */
export function argsKey(capability, params) {
  switch (capability) {
    case "quotes":
      return parseBrokerArgs(capability, params)[0].map((r) => `${r.exchange}|${r.token}`).join(",");
    case "depth": {
      const [r] = parseBrokerArgs(capability, params);
      return `${r.exchange}|${r.token}`;
    }
    case "historical": {
      const [h] = parseBrokerArgs(capability, params);
      return `${h.instrument.exchange}|${h.instrument.token}|${h.interval}|${h.from}|${h.to}`;
    }
    case "instruments": {
      const f = parseInstrumentFilter(params);
      return `${f.underlying}|${f.instrumentType ?? ""}|${f.expiry ?? ""}`;
    }
    default:
      return "";
  }
}

/** Whether a market/portfolio result carries data worth caching (a zero LTP is "no data", not a price). */
export function hasBrokerData(capability, result) {
  if (!result || typeof result !== "object") return false;
  switch (capability) {
    case "optionChain":
      return !!(result.data?.oc && Object.keys(result.data.oc).length > 0);
    case "ltp":
      return Number(result.data?.last_price) > 0;
    case "expiries":
    case "quotes":
    case "historical":
    case "instruments":
      return Array.isArray(result.data) && result.data.length > 0;
    case "depth":
      return !!result.data && (Array.isArray(result.data.bids) || Array.isArray(result.data.asks));
    default:
      return result.data !== undefined;
  }
}

/** Per-broker capability summary for GET /api/broker-capabilities (no credentials, nothing secret). */
export function describeAdapter(adapter) {
  const caps = adapter?.capabilities && typeof adapter.capabilities === "object" ? adapter.capabilities : {};
  const declared = Object.keys(CAPABILITIES).filter((k) => k !== "auth" && capabilityMethod(adapter, k));
  return {
    id: adapter.id,
    authKind: caps.auth?.kind ?? null,
    capabilities: declared,
    endpoints: BROKER_PROXY_ENDPOINTS.filter((e) => {
      const r = resolveBrokerEndpoint(e);
      return r && declared.includes(r.capability);
    }),
    ordersEnabled: false,
  };
}
