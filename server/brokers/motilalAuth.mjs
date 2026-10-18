/**
 * Motilal Oswal (MOFSL) Open API: session login and the signed-in request helper.
 *
 * Source: the official single-page moAPI documentation,
 * https://invest.motilaloswal.com/moAPI/APIDocumentation/Introduction (sections "Header Parameters",
 * "Login through API", "Generate Access Token" and "Error Codes And Description"; checked 2026-10).
 *
 * What the page specifies:
 *  - Login: POST /rest/login/v7/authdirectapi with JSON { userid, password, "2FA", totp }. `password` is the hex
 *    SHA-256 of the account password followed by the API key; "2FA" is the account's second factor (the sample is a
 *    DD/MM/YYYY date of birth); `totp` is the authenticator code (leaving it out starts the SMS/e-mail OTP flow, which
 *    this app does not offer). The reply carries status, message, errorcode, AuthToken and isAuthTokenVerified.
 *  - Generate Access Token: POST /rest/login/v1/getaccesstoken, no body, the common headers plus apisecretkey.
 *    Reply { status, message, errorcode, accesstoken }.
 *  - Every request sends the "Header Parameters" table. Authorization (the AuthToken) goes on every call except login.
 *    browsername/browserversion are required when SourceId is WEB.
 *  - The AuthToken lapses every morning at 6 a.m. Session-death codes: MO8001 Invalid Token, MO8002 Token Expired,
 *    MO8003 Token missing, MO8052 Invalid Dashboard Session, MO1011 Client Not Login.
 *
 * Contract auth.kind "sessionLogin": the password, the 2FA value and the current TOTP code are typed in the Broker
 * Settings "Log in" dialog, used for this one login call and dropped. Only { sessionToken, sessionAccessToken? } come
 * back. None of the typed values is stored, cached, logged or echoed in an error.
 */

import { createHash } from "node:crypto";
import os from "node:os";
import { BrokerError, brokerFetch, SessionRequiredError } from "./contract.mjs";
import { readTotpCode, requireFields, sessionFromCreds } from "./sessionLogin.mjs";

const NAME = "Motilal Oswal";

export const BASE_URL = "https://openapi.motilaloswal.com";

export const ENDPOINTS = {
  authdirectapi: "/rest/login/v7/authdirectapi",
  getaccesstoken: "/rest/login/v1/getaccesstoken",
  getprofile: "/rest/login/v5/getprofile",
  getltpdata: "/rest/report/v3/getltpdata",
  getindexltpdata: "/rest/report/v3/getindexltpdata",
  placeorder: "/rest/trans/v2/placeorder",
  modifyorder: "/rest/trans/v5/modifyorder",
  cancelorder: "/rest/trans/v2/cancelorder",
  getorderbook: "/rest/book/v5/getorderbook",
  gettradebook: "/rest/book/v4/gettradebook",
  getdpholding: "/rest/report/v3/getdpholding",
  getposition: "/rest/book/v4/getposition",
  getreportmarginsummary: "/rest/report/v3/getreportmarginsummary",
};

/** Error codes the "Error Codes And Description" table lists for a dead or missing session. */
export const SESSION_DEAD_CODES = new Set(["MO8001", "MO8002", "MO8003", "MO8052", "MO1011"]);

/** Typed per login, never saved. "dob" holds the account's 2FA value (date of birth on most accounts). */
export const LOGIN_FIELDS = [
  { key: "password", label: "Motilal Oswal password", kind: "secret" },
  { key: "dob", label: "2FA value: date of birth (DD/MM/YYYY) or PAN, as set on your account", kind: "secret" },
  { key: "totpCode", label: "6-digit TOTP code", kind: "totp" },
];
export const SESSION_FIELDS = ["sessionToken", "sessionAccessToken"];

const APP_NAME = "OptionsDesk";
const APP_VERSION = "1.0.0";

/**
 * Device description sent in the header table. The proxy is a local Node process, not a browser, so these describe
 * the machine it runs on. MacAddress uses the all-zero form the docs' own sample shows, and the IPs are loopback
 * because the proxy only listens on this machine. browsername/browserversion are mandatory for SourceId WEB.
 */
const DEVICE = Object.freeze({
  ClientLocalIp: "127.0.0.1",
  ClientPublicIp: "127.0.0.1",
  MacAddress: "00:00:00:00:00:00",
  osname: os.type() || "unknown",
  osversion: os.release() || "unknown",
  devicemodel: (typeof os.machine === "function" && os.machine()) || os.arch(),
  manufacturer: "unknown",
  browsername: "Node.js",
  browserversion: process.versions.node,
});

/** When the AuthToken dies: the first 06:00 IST after `now`. */
function authTokenExpiry(now = Date.now()) {
  const istOffset = 330 * 60_000;
  const dayMs = 86_400_000;
  const istNow = now + istOffset;
  const sixAmIst = istNow - (istNow % dayMs) + 6 * 3_600_000;
  return (sixAmIst > istNow ? sixAmIst : sixAmIst + dayMs) - istOffset;
}

/**
 * Header set for one request: who is calling, from what device, then the tokens. `session` is omitted only for the
 * login call itself. Header values are secrets in places; never log the returned object.
 */
function motilalHeaders({ apiKey, apiSecret, clientId }, session) {
  return {
    Accept: "application/json",
    "Content-Type": "application/json",
    "User-Agent": "MOSL/V.1.1.0",
    ApiKey: apiKey,
    vendorinfo: clientId,
    SourceId: "WEB",
    productname: APP_NAME,
    productversion: APP_VERSION,
    ...DEVICE,
    ...(apiSecret ? { apisecretkey: apiSecret } : {}),
    ...(session?.authToken ? { Authorization: session.authToken } : {}),
    ...(session?.accessToken ? { accesstoken: session.accessToken } : {}),
  };
}

/** A refusal envelope turned into a BrokerError whose message names Motilal's code (normaliseError keys off it). */
function refusal(prefix, json, { status, code } = {}) {
  const why = json?.message || "no reason given";
  const tag = json?.errorcode ? ` [${json.errorcode}]` : "";
  const http = status ? ` (HTTP ${status})` : "";
  return new BrokerError(`${NAME} ${prefix}: ${why}${tag}${http}`, code ? { code } : undefined);
}

function parseJson(text) {
  try { return JSON.parse(text); } catch { return null; }
}

/**
 * One login with the values typed in the dialog. Returns only the session tokens and their expiry.
 * When the user saved an API secret, the documented access-token step runs too; if that step fails the AuthToken
 * alone is kept, because the order/report calls accept it on its own for accounts without a secret.
 */
export async function login(creds) {
  requireFields(creds, ["apiKey", "clientId", "password", "dob"], NAME);
  const totp = readTotpCode(creds);
  const app = { apiKey: creds.apiKey, apiSecret: creds.apiSecret, clientId: creds.clientId };

  const res = await brokerFetch(BASE_URL + ENDPOINTS.authdirectapi, {
    method: "POST",
    headers: motilalHeaders(app),
    body: JSON.stringify({
      userid: creds.clientId,
      password: createHash("sha256").update(String(creds.password) + String(creds.apiKey)).digest("hex"),
      "2FA": creds.dob,
      totp,
    }),
  });
  const reply = parseJson(await res.text());
  if (!reply) throw new BrokerError(`${NAME} login: the reply was not JSON (HTTP ${res.status})`, { code: "UPSTREAM_AUTH" });
  if (!res.ok || reply.status !== "SUCCESS" || !reply.AuthToken) {
    throw refusal("login failed", reply, { status: res.ok ? undefined : res.status, code: "UPSTREAM_AUTH" });
  }

  // The docs show "TRUE" here after a TOTP login and do not define other values. Since this app always sends a TOTP,
  // anything else is treated as "the broker still wants an OTP step", which this app cannot complete.
  if (reply.isAuthTokenVerified !== undefined && String(reply.isAuthTokenVerified).toUpperCase() !== "TRUE") {
    throw new BrokerError(
      `${NAME} did not accept the authenticator code as the second step and wants an SMS/e-mail OTP, which this app ` +
        "cannot complete. Turn on authenticator (TOTP) login for your Motilal Oswal account and try again.",
      { code: "UPSTREAM_AUTH" },
    );
  }

  const session = { sessionToken: String(reply.AuthToken) };
  if (creds.apiSecret) {
    try {
      const tokRes = await brokerFetch(BASE_URL + ENDPOINTS.getaccesstoken, {
        method: "POST",
        headers: motilalHeaders(app, { authToken: session.sessionToken }),
      });
      const tok = parseJson(await tokRes.text());
      if (tokRes.ok && tok?.status === "SUCCESS" && tok.accesstoken) session.sessionAccessToken = String(tok.accesstoken);
      else console.warn(`[motilal] access-token step skipped: HTTP ${tokRes.status}${tok?.errorcode ? ` ${tok.errorcode}` : ""}`);
    } catch (e) {
      console.warn(`[motilal] access-token step skipped: ${e?.name || "network error"}`);
    }
  }
  return { session, expiresAt: authTokenExpiry() };
}

/** The saved session, or SessionRequiredError when there is none or it has lapsed. */
export function ensureSession(creds) {
  requireFields(creds, ["apiKey", "clientId"], NAME);
  const s = sessionFromCreds(creds, SESSION_FIELDS, NAME);
  return {
    authToken: s.sessionToken,
    accessToken: s.sessionAccessToken || null,
    apiKey: creds.apiKey,
    apiSecret: creds.apiSecret || null,
    clientId: creds.clientId,
  };
}

/**
 * Signed-in POST to an ENDPOINTS key. HTTP 401/403 or a session-death code throws SessionRequiredError (there is no
 * stored password to log in again with). Returns the parsed reply even when its status is FAILURE/ERROR; callers decide
 * what a refusal means for them.
 */
export async function authPost(creds, endpointKey, payload) {
  const s = ensureSession(creds);
  const res = await brokerFetch(BASE_URL + ENDPOINTS[endpointKey], {
    method: "POST",
    headers: motilalHeaders(s, s),
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  const text = await res.text();
  const json = parseJson(text);
  const code = String(json?.errorcode || "").toUpperCase();
  if (res.status === 401 || res.status === 403 || SESSION_DEAD_CODES.has(code)) {
    throw new SessionRequiredError(`${NAME} rejected the session. Log in again from Broker Settings.`);
  }
  if (res.status === 429) throw new BrokerError(`${NAME} ${endpointKey}: too many requests (HTTP 429)`, { code: "UPSTREAM_RATE_LIMIT" });
  if (!res.ok) throw new BrokerError(`${NAME} API error on ${endpointKey} [HTTP ${res.status}]: ${json?.message || text.slice(0, 160)}`);
  if (!json) throw new BrokerError(`${NAME} API [${endpointKey}] returned a non-JSON response`);
  return json;
}

/** authPost that also insists on status SUCCESS; a refusal becomes a 502 BrokerError carrying Motilal's code. */
export async function authPostOk(creds, endpointKey, payload) {
  const json = await authPost(creds, endpointKey, payload);
  if (String(json?.status).toUpperCase() !== "SUCCESS") throw refusal(endpointKey, json);
  return json;
}
