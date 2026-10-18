/**
 * Transport for ICICI Direct Breeze GET calls that carry a JSON body.
 *
 * Breeze's documented read endpoints (customerdetails, funds, quotes, OptionChain, order, trades, ...) are GET
 * requests whose parameters travel as a JSON body, and the checksum is computed over that body. A query string is
 * not read (the server answers "Request Object is Null"). WHATWG fetch refuses a body on GET, so brokerFetch()
 * cannot send these. This module sends them with node:https under the same rules brokerFetch enforces:
 *  - a time limit (the brokerFetch limits), refused redirects (custom secret headers are never forwarded),
 *  - HTTPS to api.icicidirect.com only, and a response size cap.
 * When global fetch has been replaced (the contract harness and the unit tests stub it), the call goes through
 * brokerFetch -> the stub instead, so tests can never reach the network through this path.
 * Non-GET calls (POST / PUT / DELETE with a body) use brokerFetch directly; fetch allows a body there.
 */

import https from "node:https";
import { BrokerError, UPSTREAM_TIMEOUT_MS, brokerFetch } from "./contract.mjs";

const NATIVE_FETCH = globalThis.fetch;
const ALLOWED_HOSTS = new Set(["api.icicidirect.com"]);
export const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;
const LABEL = "ICICI Direct";

/** GET `url` with a JSON string body. Resolves to a fetch Response. */
export function getWithBody(url, { headers = {}, body = "{}", kind = "read" } = {}) {
  if (globalThis.fetch !== NATIVE_FETCH) return brokerFetch(url, { method: "GET", headers, body }, { kind, label: LABEL });
  const u = new URL(url);
  if (u.protocol !== "https:" || !ALLOWED_HOSTS.has(u.hostname)) {
    return Promise.reject(new BrokerError(`${LABEL}: refused to send a request to ${u.host}.`, { code: "UPSTREAM_HOST_REFUSED" }));
  }
  const limit = UPSTREAM_TIMEOUT_MS[kind] ?? UPSTREAM_TIMEOUT_MS.read;
  const payload = Buffer.from(String(body), "utf8");
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (fn, v) => { if (!settled) { settled = true; fn(v); } };
    const req = https.request(u, { method: "GET", headers: { ...headers, "Content-Length": payload.length }, timeout: limit }, (res) => {
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400) {
        res.resume();
        done(reject, new BrokerError(`${LABEL} tried to redirect the request to another address, so it was stopped.`, { code: "UPSTREAM_REDIRECT_REFUSED" }));
        return;
      }
      const chunks = [];
      let size = 0;
      res.on("data", (c) => {
        size += c.length;
        if (size > MAX_RESPONSE_BYTES) {
          req.destroy();
          done(reject, new BrokerError(`${LABEL} sent a response larger than ${MAX_RESPONSE_BYTES} bytes, so it was dropped.`));
        } else chunks.push(c);
      });
      res.on("end", () => {
        const noBody = status === 204 || status === 205 || status === 304 || status < 200 || status > 599;
        done(resolve, new Response(noBody ? null : Buffer.concat(chunks), { status: status >= 200 && status <= 599 ? status : 502 }));
      });
      res.on("error", (e) => done(reject, new BrokerError(`${LABEL}: network error (${e?.message || e})`)));
    });
    req.on("timeout", () => {
      req.destroy();
      done(reject, new BrokerError(`${LABEL} did not respond within ${Math.round(limit / 1000)} s. Please try again.`, { code: "UPSTREAM_TIMEOUT" }));
    });
    req.on("error", (e) => done(reject, e instanceof BrokerError ? e : new BrokerError(`${LABEL}: network error (${e?.message || e})`)));
    req.end(payload);
  });
}
