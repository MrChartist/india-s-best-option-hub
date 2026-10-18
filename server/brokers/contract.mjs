/**
 * The canonical broker adapter contract (version 1).
 *
 * One file per broker under server/brokers/<id>.mjs, registered in registry.mjs.
 * Every adapter exports `id`, `credentialFields` and the four registry basics
 * (testConnection, fetchExpiryList, fetchOptionChain, fetchLTP). An adapter that
 * has been moved onto this contract ALSO exports `capabilities`, an object whose
 * keys come from CAPABILITIES below; declaring a key is a promise that the named
 * method exists and returns the normalised shape checked by contractShapes.mjs.
 * contractHarness.mjs proves that promise against recorded fixtures.
 *
 * Human-readable version, with the per-broker checklist: docs/broker-contract.md.
 *
 * Several adapters already export a `capabilities` object describing ORDER
 * features (bracket, cover, ioc, mtf, nativeMarketProtection, maxLegQty,
 * products). Those keys are listed in LEGACY_ORDER_FEATURE_KEYS and are allowed
 * to sit alongside the contract keys, so nothing that reads them breaks.
 */

export const CONTRACT_VERSION = 1;

/** Index underlyings every adapter maps its own names onto. */
export const CANONICAL_UNDERLYINGS = Object.freeze(["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "SENSEX", "BANKEX"]);

/**
 * How the user gets a usable session.
 *  - apiKeyToken:          user pastes a long-lived key/token (Dhan, Pocketful).
 *  - oauthRedirect:        broker login page redirects back with a code the app exchanges (Zerodha, Upstox, Fyers).
 *  - requestTokenExchange: user pastes a one-time request code that the adapter swaps for a session (Noren family).
 *  - sessionLogin:         user types password/PIN and the CURRENT 6-digit TOTP code at login time; the proxy calls
 *                          adapter.login() once and only the returned session token is kept. The password, PIN and
 *                          code are never stored, cached, logged or used as a cache key.
 */
export const AUTH_KINDS = Object.freeze(["apiKeyToken", "oauthRedirect", "requestTokenExchange", "sessionLogin"]);

/**
 * Whether a credential key names a secret that must never be stored, cached, logged or used in a cache key:
 * passwords, PINs/MPINs, TOTP/OTP values and other second factors (2FA answers, date of birth, PAN). The check is
 * token-aware so camelCase and snake_case keys are caught too ("loginPin", "trading_pin", "userDob", "panNumber").
 * Mirrors isForbiddenFieldKey in src/lib/brokerConfig.ts; keep the two identical.
 */
export function isForbiddenSecretKey(key) {
  const raw = String(key ?? "");
  const lower = raw.toLowerCase();
  if (/pass|totp|otp|mpin|2fa|twofa|factor2|answer/.test(lower)) return true;
  const tokens = raw.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase().split(/[^a-z0-9]+/);
  if (tokens.some((t) => SECRET_TOKENS.has(t))) return true;
  return /^pin|pin$|pincode$|dob$|pan$/.test(lower);
}
const SECRET_TOKENS = new Set(["pin", "tpin", "pincode", "dob", "pan"]);

/** RegExp-like wrapper so existing `FORBIDDEN_SECRET_KEY.test(key)` call sites keep working. */
export const FORBIDDEN_SECRET_KEY = Object.freeze({ test: isForbiddenSecretKey });

/**
 * Capability name -> the adapter method(s) that implement it. The first method name is canonical;
 * later names are accepted aliases kept for adapters written before this contract.
 * `order: true` marks real-money calls: the method must be wrapped with withOrderGate().
 */
export const CAPABILITIES = Object.freeze({
  auth: { methods: [], required: true },
  testConnection: { methods: ["testConnection"], required: true },
  instruments: { methods: ["fetchInstruments"] },
  expiries: { methods: ["fetchExpiryList"], required: true },
  optionChain: { methods: ["fetchOptionChain"], required: true },
  ltp: { methods: ["fetchLTP"], required: true },
  quotes: { methods: ["fetchQuotes"] },
  depth: { methods: ["fetchDepth"] },
  historical: { methods: ["fetchHistorical"] },
  feed: { methods: ["createFeed"] },
  positions: { methods: ["fetchPositions"] },
  holdings: { methods: ["fetchHoldings"] },
  funds: { methods: ["fetchFunds"] },
  orderBook: { methods: ["fetchOrderBook", "getOrders"] },
  tradeBook: { methods: ["fetchTradeBook"] },
  placeOrder: { methods: ["placeOrder"], order: true },
  modifyOrder: { methods: ["modifyOrder"], order: true },
  cancelOrder: { methods: ["cancelOrder"], order: true },
  normaliseError: { methods: ["normaliseError"] },
});

/** Keys of the older order-feature descriptor that may share the `capabilities` object. */
export const LEGACY_ORDER_FEATURE_KEYS = Object.freeze(["bracket", "cover", "ioc", "mtf", "nativeMarketProtection", "maxLegQty", "products"]);

/** Registry basics every adapter has had since before this contract (proxy-server.mjs calls them). */
const REGISTRY_BASICS = ["testConnection", "fetchExpiryList", "fetchOptionChain", "fetchLTP"];

// ── JSDoc types (the normalised shapes; contractShapes.mjs checks them) ──

/**
 * @typedef {Record<string, string>} Creds  Saved Broker Settings values, plus session fields after a session login.
 *
 * @typedef {{ status: "success"|"error", message: string }} ConnectionResult
 * @typedef {{ status: "success", data: string[] }} ExpiryListResult  ISO "YYYY-MM-DD", ascending.
 * @typedef {{ last_price?: number, ltp?: number, oi?: number, oi_chg?: number, previous_oi?: number, volume?: number,
 *   iv?: number, implied_volatility?: number, delta?: number, gamma?: number, theta?: number, vega?: number,
 *   greeks?: { delta?: number, gamma?: number, theta?: number, vega?: number },
 *   bid_price?: number, ask_price?: number, top_bid_price?: number, top_ask_price?: number, security_id?: string|number }} ChainLeg
 *   Dhan-shaped leg; iv in percent (14.2, not 0.142). The app's parser (src/lib/marketApi.ts parseDhanLeg,
 *   mirrored by contractShapes.toOptionData) turns it into OptionData.
 * @typedef {{ status: "success", data: { oc: Record<string, { ce?: ChainLeg, pe?: ChainLeg }>, last_price: number } }} OptionChainResult
 * @typedef {{ status: "success", data: { last_price: number } }} LtpResult
 *
 * @typedef {"NSE"|"BSE"|"NFO"|"BFO"|"MCX"|"CDS"} Exchange
 * @typedef {{ token: string, exchange: Exchange, tradingSymbol: string, underlying: string,
 *   instrumentType: "INDEX"|"EQ"|"FUTIDX"|"FUTSTK"|"OPTIDX"|"OPTSTK", expiry: string|null, strike: number|null,
 *   optionType: "CE"|"PE"|null, lotSize: number, tickSize: number }} Instrument
 *   `underlying` uses CANONICAL_UNDERLYINGS for index derivatives, the NSE/BSE symbol for stocks.
 * @typedef {{ token: string, exchange: Exchange }} InstrumentRef
 * @typedef {{ token: string, exchange: Exchange, ltp: number, open: number|null, high: number|null, low: number|null,
 *   close: number|null, volume: number|null, oi: number|null, bid: number|null, ask: number|null }} Quote
 * @typedef {{ price: number, qty: number, orders: number|null }} DepthLevel
 * @typedef {{ bids: DepthLevel[], asks: DepthLevel[] }} Depth
 * @typedef {{ instrument: InstrumentRef, interval: "1m"|"3m"|"5m"|"15m"|"30m"|"60m"|"1d", from: string, to: string }} HistoricalRequest
 * @typedef {{ time: number, open: number, high: number, low: number, close: number, volume: number, oi?: number }} Candle  time = epoch seconds.
 * @typedef {{ subscribe(refs: InstrumentRef[]): void, unsubscribe(refs: InstrumentRef[]): void, close(): void }} Feed
 *   createFeed(creds, { onTick(quote: Quote), onStatus({ connected: boolean, reason?: string }) }) -> Feed
 *
 * @typedef {"CNC"|"INTRADAY"|"MARGIN"|"MTF"|"CO"|"BO"} Product
 * @typedef {"OPEN"|"TRIGGER_PENDING"|"PARTIALLY_FILLED"|"COMPLETE"|"CANCELLED"|"REJECTED"|"EXPIRED"|"UNKNOWN"} OrderStatus
 * @typedef {{ tradingSymbol: string, exchange: Exchange, token: string, product: Product, netQty: number, avgPrice: number,
 *   ltp: number|null, pnl: number, realisedPnl: number|null, unrealisedPnl: number|null }} Position
 * @typedef {{ tradingSymbol: string, exchange: Exchange, token: string, isin: string|null, qty: number, avgPrice: number,
 *   ltp: number|null, pnl: number|null }} Holding
 * @typedef {{ availableCash: number, usedMargin: number, totalBalance: number|null, collateral: number|null,
 *   withdrawable: number|null }} Funds
 * @typedef {{ orderId: string, tradingSymbol: string, exchange: Exchange, token: string, side: "BUY"|"SELL", qty: number,
 *   filledQty: number, pendingQty: number, price: number, triggerPrice: number, avgPrice: number, orderType: string,
 *   product: Product, status: OrderStatus, statusMessage: string|null, placedAt: string|null }} Order
 * @typedef {{ tradeId: string, orderId: string, tradingSymbol: string, exchange: Exchange, token: string,
 *   side: "BUY"|"SELL", qty: number, price: number, tradedAt: string|null }} Trade
 * @typedef {{ orderId: string, orderStatus: OrderStatus }} OrderAck
 * @typedef {{ session: Record<string, string>, expiresAt: number }} LoginResult  expiresAt = epoch ms.
 * @typedef {{ statusCode: 422|502, code: string, message: string }} NormalisedError
 *
 * Read capabilities return `{ status: "success", data }` with `data` of the type above
 * (Position[], Holding[], Funds, Order[], Trade[], Quote[], Depth, Candle[], Instrument[]).
 *
 * Order signatures (the gate is ALWAYS the last argument, see withOrderGate):
 *   placeOrder(creds, order, resolvedLotSize, gate) -> OrderAck
 *   modifyOrder(creds, orderId, changes, gate)     -> OrderAck
 *   cancelOrder(creds, orderId, gate)              -> OrderAck
 */

// ── Errors ──

/** Base class. `statusCode` follows the proxy convention: 422 = we refused, 502 = upstream failed. */
export class BrokerError extends Error {
  constructor(message, { code = "UPSTREAM_ERROR", statusCode = 502 } = {}) {
    super(message);
    this.name = "BrokerError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

/** No session token, or it expired / was rejected. The user must log in again (session-login brokers). */
export class SessionRequiredError extends BrokerError {
  constructor(message = "Your broker session has expired. Log in again from Broker Settings.") {
    super(message, { code: "SESSION_LOGIN_REQUIRED", statusCode: 422 });
    this.name = "SessionRequiredError";
  }
}

/** A real-money call was attempted without a valid, unused order gate. */
export class OrderGateError extends BrokerError {
  constructor(message = "Order refused: live trading is not armed for this request. No order was sent.") {
    super(message, { code: "ORDER_GATE_CLOSED", statusCode: 422 });
    this.name = "OrderGateError";
  }
}

/** Bad or missing input caught before any broker call (e.g. a malformed TOTP code). */
export class BrokerInputError extends BrokerError {
  constructor(message) {
    super(message, { code: "BROKER_INPUT_INVALID", statusCode: 422 });
    this.name = "BrokerInputError";
  }
}

// ── Upstream fetch (every adapter goes through this, never through a bare fetch) ──

/** Upstream time limits in ms. Reads fail fast; logins and order calls get a little longer; instrument masters are big files. */
export const UPSTREAM_TIMEOUT_MS = Object.freeze({ read: 10_000, write: 15_000, login: 15_000, master: 120_000 });

/**
 * fetch() for broker adapters. It adds two things a bare fetch does not have:
 *  - a time limit (AbortSignal.timeout), so a broker host that hangs cannot hold a coalesced request, a login that
 *    carries a password, or a panic re-fetch open for ever. A timeout becomes BrokerError 502 UPSTREAM_TIMEOUT.
 *  - redirect: "error" by default, so custom secret headers (api_secret, x-api-key, apikey ...) are never forwarded to
 *    wherever a broker endpoint redirects. A refused redirect becomes BrokerError 502 UPSTREAM_REDIRECT_REFUSED.
 *    Only anonymous public file downloads (instrument masters) should pass `redirect: "follow"`.
 *
 * @param {string|URL} url
 * @param {RequestInit} [init]  Normal fetch options. A caller `signal` is combined with the time limit.
 * @param {{ kind?: "read"|"write"|"login"|"master", timeoutMs?: number, label?: string }} [opts]
 *   kind defaults to "read" for GET/HEAD and "write" otherwise; label names the broker in the timeout message.
 */
export async function brokerFetch(url, init = {}, { kind, timeoutMs, label = "The broker" } = {}) {
  const method = String(init.method ?? "GET").toUpperCase();
  const limit = timeoutMs ?? UPSTREAM_TIMEOUT_MS[kind ?? (method === "GET" || method === "HEAD" ? "read" : "write")] ?? UPSTREAM_TIMEOUT_MS.read;
  const timer = AbortSignal.timeout(limit);
  const signal = init.signal ? AbortSignal.any([init.signal, timer]) : timer;
  try {
    return await globalThis.fetch(url, { ...init, redirect: init.redirect ?? "error", signal });
  } catch (err) {
    if (timer.aborted || err?.name === "TimeoutError") {
      throw new BrokerError(`${label} did not respond within ${Math.round(limit / 1000)} s. Please try again.`, { code: "UPSTREAM_TIMEOUT", statusCode: 502 });
    }
    if (/redirect/i.test(String(err?.cause?.message ?? err?.message ?? ""))) {
      throw new BrokerError(`${label} tried to redirect the request to another address, so it was stopped.`, { code: "UPSTREAM_REDIRECT_REFUSED", statusCode: 502 });
    }
    throw err;
  }
}

/** Shared wording for an order call whose outcome is unknown (no order ID came back, or the call failed mid-way). */
export const ORDER_BOOK_HINT = "Open the order book to confirm whether the order went through before you place it again.";

/** Replace every secret value (length >= 4) that appears in `text` with "***". */
export function redactSecrets(text, secrets = []) {
  let out = String(text ?? "");
  for (const s of secrets) {
    if (typeof s === "string" && s.length >= 4) out = out.split(s).join("***");
  }
  return out;
}

/**
 * Default error normaliser. Adapters may export their own `normaliseError` that adds broker-specific
 * codes (e.g. a token-rejected code) and falls back to this one.
 * @returns {NormalisedError}
 */
export function normaliseError(err, { secrets = [] } = {}) {
  const known = err instanceof BrokerError;
  const statusCode = known && (err.statusCode === 422 || err.statusCode === 502) ? err.statusCode : 502;
  const code = known && typeof err.code === "string" ? err.code : "UPSTREAM_ERROR";
  const raw = err instanceof Error ? err.message : String(err ?? "Broker request failed");
  const message = redactSecrets(raw || "Broker request failed", secrets).slice(0, 240);
  return { statusCode, code, message };
}

// ── Order gate (orderGate.mjs). issueOrderGate is not re-exported: adapters must not mint gates (see orderGate.mjs). ──
export { ORDER_GATE_TTL_MS, ORDER_GATED, consumeOrderGate, withOrderGate, isOrderGated } from "./orderGate.mjs";
import { isOrderGated } from "./orderGate.mjs";

// ── validateAdapter ──

function methodFor(adapter, capability) {
  const spec = CAPABILITIES[capability];
  return spec?.methods.find((m) => typeof adapter[m] === "function") ?? null;
}

function validateAuth(adapter, auth, errors) {
  if (!auth || typeof auth !== "object") return errors.push("capabilities.auth must be an object { kind, ... }");
  if (!AUTH_KINDS.includes(auth.kind)) return errors.push(`capabilities.auth.kind must be one of ${AUTH_KINDS.join(", ")}`);
  if (auth.kind !== "sessionLogin") return;
  if (typeof adapter.login !== "function") errors.push("sessionLogin adapters must export login(creds)");
  const lf = auth.loginFields;
  if (!Array.isArray(lf) || lf.length === 0) errors.push("sessionLogin needs auth.loginFields [{ key, label, kind: 'secret'|'totp' }]");
  else {
    if (!lf.some((f) => f?.kind === "totp" && f.key === "totpCode")) errors.push("sessionLogin loginFields must include { key: 'totpCode', kind: 'totp' }");
    for (const f of lf) {
      if (!f || typeof f.key !== "string" || typeof f.label !== "string") errors.push("each loginField needs a string key and label");
      else if (f.kind !== "secret" && f.kind !== "totp") errors.push(`loginField ${f.key}: kind must be 'secret' or 'totp'`);
    }
  }
  const sf = auth.sessionFields;
  if (!Array.isArray(sf) || sf.length === 0) errors.push("sessionLogin needs auth.sessionFields (the keys login() returns)");
  else for (const k of sf) {
    if (typeof k !== "string" || !/^[A-Za-z0-9_]{1,40}$/.test(k)) errors.push(`sessionField ${String(k)} is not a valid key`);
    else if (FORBIDDEN_SECRET_KEY.test(k)) errors.push(`sessionField ${k} looks like a secret and would be stripped from storage`);
  }
}

/**
 * Check an adapter module against the contract.
 * Lenient mode (adapter has no capabilities.auth): only id, credentialFields and the registry basics.
 * Strict mode (capabilities.auth declared, or { strict: true }): every declared capability is checked.
 * @returns {{ ok: boolean, mode: "lenient"|"strict", errors: string[], warnings: string[] }}
 */
export function validateAdapter(adapter, { strict } = {}) {
  const errors = [];
  const warnings = [];
  if (!adapter || typeof adapter !== "object") return { ok: false, mode: "lenient", errors: ["adapter is not a module object"], warnings };
  if (typeof adapter.id !== "string" || !/^[a-z0-9]{2,20}$/.test(adapter.id)) errors.push("id must be 2-20 lowercase letters/digits");
  if (!Array.isArray(adapter.credentialFields) || adapter.credentialFields.some((f) => typeof f !== "string")) {
    errors.push("credentialFields must be an array of strings");
  }
  for (const m of REGISTRY_BASICS) if (typeof adapter[m] !== "function") errors.push(`missing registry basic ${m}()`);

  const caps = adapter.capabilities && typeof adapter.capabilities === "object" ? adapter.capabilities : {};
  const isStrict = strict === true || (strict !== false && caps.auth !== undefined);

  for (const name of ["placeOrder", "modifyOrder", "cancelOrder"]) {
    if (typeof adapter[name] === "function" && !isOrderGated(adapter[name])) {
      (isStrict ? errors : warnings).push(`${name}() is not wrapped with withOrderGate()`);
    }
  }
  if (!isStrict) return { ok: errors.length === 0, mode: "lenient", errors, warnings };

  if (Array.isArray(adapter.credentialFields)) {
    for (const f of adapter.credentialFields) if (FORBIDDEN_SECRET_KEY.test(f)) errors.push(`credentialFields must not list secret ${f}; use a session login`);
  }
  validateAuth(adapter, caps.auth, errors);
  for (const [name, spec] of Object.entries(CAPABILITIES)) {
    const declared = caps[name] !== undefined && caps[name] !== false;
    if (spec.required && !declared) errors.push(`capability ${name} is required`);
    if (name === "auth") continue;
    const method = methodFor(adapter, name);
    if (declared && !method) errors.push(`capability ${name} declared but ${spec.methods.join("/")}() is missing`);
    if (!declared && method && !spec.order) warnings.push(`${method}() exists but capability ${name} is not declared`);
    if (spec.order && declared && method && !isOrderGated(adapter[method])) errors.push(`${name}() must be wrapped with withOrderGate()`);
  }
  for (const key of Object.keys(caps)) {
    if (!CAPABILITIES[key] && !LEGACY_ORDER_FEATURE_KEYS.includes(key)) warnings.push(`unknown capability key ${key}`);
  }
  return { ok: errors.length === 0, mode: "strict", errors, warnings };
}

/** The capability names an adapter declares (strict adapters) — for the harness and health output. */
export function declaredCapabilities(adapter) {
  const caps = adapter?.capabilities && typeof adapter.capabilities === "object" ? adapter.capabilities : {};
  return Object.keys(CAPABILITIES).filter((k) => caps[k] !== undefined && caps[k] !== false);
}
