/**
 * Fixture-driven contract harness. Given an adapter and its recorded fixtures it stubs global fetch,
 * calls every declared capability and checks the normalised shape (contractShapes.mjs). Order
 * capabilities are also called WITHOUT a gate and with a forged gate, and must refuse before any
 * network call. Unmatched requests fail the capability, so a harness run can never reach the network.
 *
 * Fixtures live in server/brokers/__fixtures__/<brokerId>/:
 *   manifest.json        { "brokerId", "creds": {...dummy values...}, "symbol": "NIFTY", "expiry": "YYYY-MM-DD", "sources": [urls] }
 *   <capability>.json    one per declared capability (names from CAPABILITIES, plus "login"):
 *     {
 *       "args":      [...]        optional; arguments after creds (defaults per capability, see defaultArgs)
 *       "creds":     {...}        optional; merged over manifest.creds
 *       "secrets":   {...}        login only: { password|pin|mpin, totpCode } typed by the user
 *       "responses": [ { "method": "POST", "url": "https://..." | "urlPattern": "regex",
 *                        "status": 200, "json": {...} | "text": "...", "headers": {...},
 *                        "expectBody": { partial JSON the request body must contain } } ],
 *       "expect":    { "minRows", "minStrikes", "status", "underlyings", "errorCode" }
 *     }
 * Recorded responses must be REAL broker payloads (from the official docs' samples or a sandbox
 * account), trimmed and with every token/account id replaced by a dummy value.
 */

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { CAPABILITIES, OrderGateError, declaredCapabilities, normaliseError as defaultNormalise, SessionRequiredError } from "./contract.mjs";
import { issueOrderGate } from "./orderGate.mjs";
import * as shapes from "./contractShapes.mjs";

export const FIXTURES_ROOT = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__");

/** Load manifest.json and every <capability>.json for a broker. */
export function loadFixtures(brokerId, { root = FIXTURES_ROOT } = {}) {
  const dir = join(root, brokerId);
  if (!existsSync(dir)) throw new Error(`No fixtures for ${brokerId} (expected ${dir})`);
  const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf-8"));
  const byCapability = {};
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".json") || file === "manifest.json") continue;
    byCapability[file.replace(/\.json$/, "")] = JSON.parse(readFileSync(join(dir, file), "utf-8"));
  }
  return { manifest, byCapability };
}

function partialMatch(actual, expected) {
  if (expected === null || typeof expected !== "object") return actual === expected;
  if (!actual || typeof actual !== "object") return false;
  return Object.entries(expected).every(([k, v]) => partialMatch(actual[k], v));
}

/** A fetch replacement that answers only from `responses` and records every call. */
export function createFetchStub(responses = []) {
  const calls = [];
  const fetchStub = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input?.url ?? String(input);
    const method = String(init.method || "GET").toUpperCase();
    const body = typeof init.body === "string" ? init.body : init.body instanceof URLSearchParams ? init.body.toString() : init.body;
    calls.push({ url, method, body, headers: init.headers || {} });
    const hit = responses.find((r) => {
      if ((r.method || "GET").toUpperCase() !== method) return false;
      if (r.url && r.url !== url) return false;
      if (r.urlPattern && !new RegExp(r.urlPattern).test(url)) return false;
      if (r.expectBody) {
        let parsed = body;
        try { parsed = JSON.parse(body); } catch { parsed = Object.fromEntries(new URLSearchParams(String(body ?? ""))); }
        if (!partialMatch(parsed, r.expectBody)) return false;
      }
      return true;
    });
    if (!hit) throw new Error(`Contract harness: unexpected network call ${method} ${url}`);
    const text = hit.text !== undefined ? hit.text : JSON.stringify(hit.json ?? {});
    return new Response(text, { status: hit.status ?? 200, headers: { "content-type": "application/json", ...(hit.headers || {}) } });
  };
  return { fetch: fetchStub, calls };
}

/** Run `fn` with fetch stubbed and console captured; always restores both. */
async function withStubs(responses, fn) {
  const stub = createFetchStub(responses);
  const realFetch = globalThis.fetch;
  const logs = [];
  const saved = { log: console.log, warn: console.warn, error: console.error, info: console.info };
  globalThis.fetch = stub.fetch;
  for (const k of Object.keys(saved)) console[k] = (...a) => logs.push(a.map(String).join(" "));
  try {
    const value = await fn();
    return { value, calls: stub.calls, logs };
  } catch (error) {
    return { error, calls: stub.calls, logs };
  } finally {
    globalThis.fetch = realFetch;
    Object.assign(console, saved);
  }
}

function defaultArgs(cap, fx, manifest) {
  if (Array.isArray(fx.args)) return fx.args;
  switch (cap) {
    case "expiries": case "ltp": return [manifest.symbol];
    case "optionChain": return [manifest.symbol, manifest.expiry];
    default: return [];
  }
}

const CHECKS = {
  testConnection: shapes.checkConnection, instruments: shapes.checkInstruments, expiries: shapes.checkExpiries,
  optionChain: shapes.checkOptionChain, ltp: shapes.checkLtp, quotes: shapes.checkQuotes, depth: shapes.checkDepth,
  historical: shapes.checkCandles, positions: shapes.checkPositions, holdings: shapes.checkHoldings, funds: shapes.checkFunds,
  orderBook: shapes.checkOrderBook, tradeBook: shapes.checkTradeBook,
  placeOrder: shapes.checkOrderAck, modifyOrder: shapes.checkOrderAck, cancelOrder: shapes.checkOrderAck,
};
const NO_FIXTURE_NEEDED = new Set(["auth", "feed", "normaliseError"]);

function methodOf(adapter, cap) {
  return CAPABILITIES[cap].methods.find((m) => typeof adapter[m] === "function");
}

async function runOrderCapability(adapter, cap, fx, creds, args) {
  const fn = adapter[methodOf(adapter, cap)];
  const problems = [];
  for (const [label, gate] of [["no gate", undefined], ["forged gate", { action: cap, brokerId: adapter.id }]]) {
    const callArgs = gate === undefined ? [creds, ...args] : [creds, ...args, gate];
    const r = await withStubs(fx.responses, () => fn(...callArgs));
    if (!(r.error instanceof OrderGateError)) problems.push(`${cap} with ${label} must throw OrderGateError`);
    if (r.calls.length) problems.push(`${cap} with ${label} made ${r.calls.length} network call(s) before refusing`);
  }
  const gate = issueOrderGate({ verdict: { ok: true }, liveArmed: true, action: cap, brokerId: adapter.id });
  const r = await withStubs(fx.responses, () => fn(creds, ...args, gate));
  if (r.error) problems.push(`${cap} with a valid gate threw: ${r.error.message}`);
  else problems.push(...shapes.checkOrderAck(r.value));
  return { problems, calls: r.calls };
}

/** Check a session-login adapter's login() against its login.json fixture. */
export async function runLoginContract(adapter, fx, manifestCreds = {}) {
  const auth = adapter.capabilities.auth;
  const secrets = fx.secrets || {};
  const secretValues = Object.values(secrets);
  const r = await withStubs(fx.responses, () => adapter.login({ ...manifestCreds, ...(fx.creds || {}), ...secrets }));
  if (r.error) return { problems: [`login threw: ${r.error.message}`], calls: r.calls };
  const problems = shapes.checkLoginResult(r.value, { sessionFields: auth.sessionFields, secrets: secretValues });
  for (const line of r.logs) if (secretValues.some((s) => s.length >= 4 && line.includes(s))) problems.push("a secret value was logged");
  if (secrets.totpCode && !r.calls.some((c) => String(c.body ?? "").includes(secrets.totpCode))) problems.push("the typed TOTP code was never sent to the broker");
  // A missing/malformed code must be refused before any network call.
  const bad = await withStubs(fx.responses, () => adapter.login({ ...manifestCreds, ...(fx.creds || {}), ...secrets, totpCode: "12ab" }));
  if (!bad.error) problems.push("login accepted a malformed TOTP code");
  if (bad.calls.length) problems.push("login made a network call with a malformed TOTP code");
  return { problems, calls: r.calls };
}

function checkNormaliseError(adapter) {
  const fn = typeof adapter.normaliseError === "function" ? adapter.normaliseError : defaultNormalise;
  const problems = [];
  const secret = "S3cr3tValue";
  const upstream = fn(new Error(`broker said no for ${secret}`), { secrets: [secret] });
  problems.push(...shapes.checkNormalisedError(upstream));
  if (upstream?.statusCode !== 502) problems.push("a plain upstream error must map to 502");
  if (String(upstream?.message).includes(secret)) problems.push("normaliseError leaked a secret");
  const refused = fn(new SessionRequiredError());
  if (refused?.statusCode !== 422 || refused?.code !== "SESSION_LOGIN_REQUIRED") problems.push("SessionRequiredError must map to 422 SESSION_LOGIN_REQUIRED");
  return problems;
}

/**
 * Run every declared capability against its fixture.
 * @returns {Promise<{ brokerId: string, ok: boolean, results: Array<{ capability: string, ok: boolean, problems: string[], calls: number }> }>}
 */
export async function runContractHarness(adapter, { manifest, byCapability }) {
  const results = [];
  const creds = { ...(manifest.creds || {}) };
  const caps = declaredCapabilities(adapter);
  const push = (capability, problems, calls = []) => results.push({ capability, ok: problems.length === 0, problems, calls: calls.length });

  if (adapter.capabilities?.auth?.kind === "sessionLogin") {
    const fx = byCapability.login;
    if (!fx) push("login", ["no login.json fixture"]);
    else { const r = await runLoginContract(adapter, fx, creds); push("login", r.problems, r.calls); }
  }
  for (const cap of caps) {
    if (cap === "normaliseError") { push(cap, checkNormaliseError(adapter)); continue; }
    if (NO_FIXTURE_NEEDED.has(cap)) continue;
    const fx = byCapability[cap];
    if (!fx) { push(cap, [`no ${cap}.json fixture`]); continue; }
    const capCreds = { ...creds, ...(fx.creds || {}) };
    const args = defaultArgs(cap, fx, manifest);
    if (CAPABILITIES[cap].order) {
      const r = await runOrderCapability(adapter, cap, fx, capCreds, args);
      push(cap, r.problems, r.calls);
      continue;
    }
    const r = await withStubs(fx.responses, () => adapter[methodOf(adapter, cap)](capCreds, ...args));
    if (r.error) push(cap, [`threw: ${r.error.message}`], r.calls);
    else push(cap, CHECKS[cap](r.value, fx.expect || {}), r.calls);
  }
  return { brokerId: adapter.id, ok: results.every((r) => r.ok), results };
}

/** Flatten a harness report into readable failure lines (for expect(...).toEqual([])). */
export function harnessFailures(report) {
  return report.results.flatMap((r) => r.problems.map((p) => `${report.brokerId}.${r.capability}: ${p}`));
}
