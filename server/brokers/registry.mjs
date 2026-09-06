/**
 * Broker module contract + registry.
 *
 * Every module below exports:
 *   id: string
 *   credentialFields: string[]   — informational, mirrors src/lib/brokerConfig.ts BROKERS[].fields
 *   async testConnection(creds) -> { status: "success"|"error", message: string }
 *   async fetchExpiryList(creds, symbol) -> { status: string, data: string[] }   // ISO "YYYY-MM-DD", ascending
 *   async fetchOptionChain(creds, symbol, expiry) -> {
 *     status: "success",
 *     data: {
 *       oc: { "<strike>": { ce?: Leg, pe?: Leg } },
 *       last_price: number   // underlying spot price
 *     }
 *   }
 *   // Leg = { last_price, oi, oi_chg?, volume, iv, delta, gamma, theta, vega, bid_price, ask_price }
 *   // (iv as a percentage e.g. 14.2, not 0.142 — matches Dhan's convention, the app's reference schema)
 *
 * `symbol` is one of: NIFTY | BANKNIFTY | FINNIFTY | MIDCPNIFTY | SENSEX
 * `creds` is the raw `values` object the user saved in Broker Settings for that broker
 * (field names match brokerConfig.ts, e.g. { apiKey, apiSecret, accessToken }).
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

// Keys MUST match the broker `id` values in src/lib/brokerConfig.ts — the
// frontend sends this id verbatim as the `broker` query param / dispatch key.
const MODULES = {
  dhan, zerodha, angelone, upstox, fyers, fivepaisa, aliceblue,
  arrow, compositedge, definedge, firstock, flattrade, groww,
  hdfcsecurities, hdfcsky, ibulls, iifl, iiflcapital, indmoney,
  jainamxts, kotak, motilal, mstock, nubra, paytm, pocketful,
  rmoney, samco, shoonya, tradejini, tradesmart, wisdom, zebu,
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
