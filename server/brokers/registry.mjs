/**
 * Broker module registry: all 41 adapters, keyed by the broker id the frontend sends.
 *
 * THE CONTRACT lives in server/brokers/contract.mjs (capabilities, normalised shapes, order gate,
 * validateAdapter) with fixture tests via contractHarness.mjs; docs/broker-contract.md has the
 * per-broker checklist and docs/BROKERS.md the user-facing table. Every adapter below is on the
 * strict contract: it exports `id`, `credentialFields` (never a password, PIN or TOTP value) and a
 * `capabilities` object whose keys promise the matching methods (fetchOptionChain, fetchQuotes,
 * fetchDepth, fetchHistorical, createFeed, fetchPositions, fetchHoldings, fetchFunds,
 * fetchOrderBook, fetchTradeBook, ...). capabilities.auth.kind is one of apiKeyToken,
 * oauthRedirect, requestTokenExchange or sessionLogin; session-login brokers also export
 * login(creds) and are reached through POST /api/broker-session-login.
 *
 * How the proxy reaches them (proxy-server.mjs + brokerProxyRoutes.mjs):
 *   GET /api/broker-proxy?broker=<id>&endpoint=<e>  — every declared READ capability (option-chain,
 *       expiry-list, ltp, quotes, depth, historical, instruments, positions, holdings, funds,
 *       order-book, trade-book). Undeclared capabilities answer 422 CAPABILITY_UNSUPPORTED.
 *   GET /api/broker-test-connection, GET /api/broker-capabilities.
 *
 * Orders (real money): every adapter's placeOrder/modifyOrder/cancelOrder is wrapped with
 * withOrderGate() and refuses without a valid, unused, broker- and action-bound gate. No route mints
 * a gate for any broker here, and /api/broker-proxy answers 403 ORDER_PATH_BLOCKED for order
 * endpoints, so live orders from these adapters stay blocked pending owner review. Only Dhan places
 * live orders, through 1Cliq on /api/dhan-proxy (live-trading toggle + armed session), and only Dhan
 * has been verified against a live account; the other 40 are fixture-tested (beta).
 *
 * Index underlyings: NIFTY | BANKNIFTY | FINNIFTY | MIDCPNIFTY | SENSEX | BANKEX (CANONICAL_UNDERLYINGS),
 * plus stock underlyings where the broker offers them.
 * `creds` is the raw `values` object the user saved in Broker Settings for that broker (field names
 * match brokerCatalogPart*.ts), plus the session fields a session login returned.
 */

import * as dhan from "./dhan.mjs";
import * as zerodha from "./zerodha.mjs";
import * as angelone from "./angelone.mjs";
import * as upstox from "./upstox.mjs";
import * as fyers from "./fyers.mjs";
import * as fivepaisa from "./fivepaisa.mjs";
import * as aliceblue from "./aliceblue.mjs";
import * as arrow from "./arrow.mjs";
import * as compositedge from "./compositedge.mjs";
import * as definedge from "./definedge.mjs";
import * as firstock from "./firstock.mjs";
import * as flattrade from "./flattrade.mjs";
import * as groww from "./groww.mjs";
import * as hdfcsecurities from "./hdfcsecurities.mjs";
import * as hdfcsky from "./hdfcsky.mjs";
import * as ibulls from "./ibulls.mjs";
import * as iifl from "./iifl.mjs";
import * as iiflcapital from "./iiflcapital.mjs";
import * as indmoney from "./indmoney.mjs";
import * as jainamxts from "./jainamxts.mjs";
import * as kotak from "./kotak.mjs";
import * as motilal from "./motilal.mjs";
import * as mstock from "./mstock.mjs";
import * as nubra from "./nubra.mjs";
import * as paytm from "./paytm.mjs";
import * as pocketful from "./pocketful.mjs";
import * as rmoney from "./rmoney.mjs";
import * as samco from "./samco.mjs";
import * as shoonya from "./shoonya.mjs";
import * as tradejini from "./tradejini.mjs";
import * as tradesmart from "./tradesmart.mjs";
import * as wisdom from "./wisdom.mjs";
import * as zebu from "./zebu.mjs";
import * as anandrathi from "./anandrathi.mjs";
import * as axisdirect from "./axisdirect.mjs";
import * as bigul from "./bigul.mjs";
import * as fivepaisaxts from "./fivepaisaxts.mjs";
import * as goodwill from "./goodwill.mjs";
import * as icicidirect from "./icicidirect.mjs";
import * as profitmart from "./profitmart.mjs";
import * as rupeezy from "./rupeezy.mjs";

// Keys MUST match the broker `id` values in src/lib/brokerConfig.ts — the
// frontend sends this id verbatim as the `broker` query param / dispatch key.
const MODULES = {
  dhan, zerodha, angelone, upstox, fyers, fivepaisa, aliceblue,
  arrow, compositedge, definedge, firstock, flattrade, groww,
  hdfcsecurities, hdfcsky, ibulls, iifl, iiflcapital, indmoney,
  jainamxts, kotak, motilal, mstock, nubra, paytm, pocketful,
  rmoney, samco, shoonya, tradejini, tradesmart, wisdom, zebu,
  anandrathi, axisdirect, bigul, fivepaisaxts, goodwill, icicidirect,
  profitmart, rupeezy,
};

export function createBrokerRegistry() {
  return {
    has(brokerId) {
      return Object.prototype.hasOwnProperty.call(MODULES, brokerId);
    },
    get(brokerId) {
      const mod = MODULES[brokerId];
      if (!mod) throw new Error(`Unknown broker: ${brokerId}. Supported: ${Object.keys(MODULES).join(", ")}`);
      return mod;
    },
    list() {
      return Object.keys(MODULES);
    },
  };
}
