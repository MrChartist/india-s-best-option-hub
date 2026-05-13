/**
 * Broker Adapter Contract — shared types for all broker integrations.
 *
 * Every broker adapter exports an object matching `BrokerAdapter` (see JSDoc below).
 * The proxy router calls these methods generically; brokers normalize their
 * native responses into the unified shapes here so frontend code stays
 * vendor-neutral.
 */

/**
 * @typedef {Object} UnifiedOptionLeg
 * @property {number} ltp
 * @property {number} oi
 * @property {number} oiChange
 * @property {number} volume
 * @property {number} iv
 * @property {number} delta
 * @property {number} gamma
 * @property {number} theta
 * @property {number} vega
 * @property {number} bidPrice
 * @property {number} askPrice
 */

/**
 * @typedef {Object} UnifiedChainStrike
 * @property {number} strikePrice
 * @property {UnifiedOptionLeg} ce
 * @property {UnifiedOptionLeg} pe
 */

/**
 * @typedef {Object} UnifiedChainResponse
 * @property {string} source            broker id
 * @property {string} symbol            e.g. "NIFTY"
 * @property {string} [expiry]          ISO date string of the resolved expiry
 * @property {number} spotPrice         underlying spot
 * @property {UnifiedChainStrike[]} chain
 * @property {number} totalCEOI
 * @property {number} totalPEOI
 * @property {boolean} afterHours       true if served from last-good cache
 * @property {number|null} cachedAt     epoch ms when last-good was captured
 */

/**
 * @typedef {Object} UnifiedExpiry
 * @property {string} label             human-readable (e.g. "28 Nov 2025")
 * @property {string} value             ISO date (e.g. "2025-11-28")
 * @property {number} daysToExpiry
 */

/**
 * @typedef {Object} UnifiedCandleSeries
 * @property {string} status            "success" | "error"
 * @property {Object} data
 * @property {number[]} data.timestamp  unix seconds
 * @property {number[]} data.open
 * @property {number[]} data.high
 * @property {number[]} data.low
 * @property {number[]} data.close
 * @property {number[]} data.volume
 * @property {number[]} [data.oi]
 */

/**
 * @typedef {Object} UnifiedInstrument
 * @property {string} securityId        broker-native primary id (string)
 * @property {string} symbol            base symbol (e.g. "NIFTY", "RELIANCE")
 * @property {string} tradingSymbol     full broker trading symbol
 * @property {string} exchangeSegment   normalized: NSE_EQ | NSE_FNO | IDX_I | BSE_EQ | etc
 * @property {string} instrumentType    EQUITY | INDEX | OPTIDX | OPTSTK | FUTIDX | FUTSTK
 * @property {number} lotSize
 * @property {string} [expiryDate]      ISO date for derivatives
 * @property {number} [strikePrice]     for options
 * @property {string} [optionType]      "CE" | "PE"
 */

/**
 * @typedef {Object} UnifiedTick
 * @property {string} brokerId
 * @property {string} type              "ltp" | "quote" | "full" | "oi" | "prevClose" | "status"
 * @property {string|number} instrumentId
 * @property {string} [symbol]
 * @property {string} [exchangeSegment]
 * @property {number} [ltp]
 * @property {number} [open]
 * @property {number} [high]
 * @property {number} [low]
 * @property {number} [close]
 * @property {number} [prevClose]
 * @property {number} [change]
 * @property {number} [changePercent]
 * @property {number} [volume]
 * @property {number} [oi]
 * @property {number} [bidPrice]
 * @property {number} [askPrice]
 * @property {number} [timestamp]
 * @property {boolean} [connected]
 * @property {number} [instrumentCount]
 */

/**
 * @typedef {Object} BrokerCredentials
 * Free-form key/value bag. Each broker consumes the keys it knows about.
 * For Dhan: { clientId, accessToken }
 * For Kite: { apiKey, apiSecret, accessToken }
 */

/**
 * @typedef {Object} BrokerCapabilities
 * @property {boolean} hasOptionChain         exposes a chain endpoint or composer
 * @property {boolean} hasNativeGreeks        broker returns Greeks (Δ Γ Θ V)
 * @property {boolean} hasNativeIV            broker returns implied volatility
 * @property {boolean} hasNativeOIChange      broker returns intraday OI delta
 * @property {boolean} hasHistoricalDaily
 * @property {boolean} hasHistoricalIntraday
 * @property {boolean} hasWebSocket
 * @property {boolean} hasInstrumentMaster
 * @property {string[]} supportedSymbols      symbols verified working (best-effort)
 */

/**
 * @typedef {Object} BrokerRestContext
 * @property {Object} cache                   shared cache helpers (get/set/getLastGood/setLastGood)
 * @property {Function} cache.getCached
 * @property {Function} cache.setCache
 * @property {Function} cache.getLastGood
 * @property {Function} cache.setLastGood
 */

/**
 * @typedef {Object} BrokerAdapter
 * @property {string} id                      stable broker identifier (e.g. "dhan", "kite")
 * @property {string} name                    human-readable
 * @property {BrokerCapabilities} capabilities
 * @property {(endpoint: string, params: URLSearchParams, credentials: Object, ctx: BrokerRestContext) => Promise<any>} handleRequest
 *           Dispatches REST endpoints: option-chain | expiry-list | ltp | historical | instruments | test-connection
 *           Returns the unified response shape for the endpoint.
 * @property {(credentials: Object, callbacks: WSCallbacks) => WSConnection} [openWebSocket]
 *           Opens a broker WS upstream and emits unified ticks. Optional if hasWebSocket=false.
 * @property {(symbol: string) => string|number|null} [resolveSecurityId]
 *           Maps app-level symbol (e.g. "NIFTY") to broker-native id.
 */

/**
 * @typedef {Object} WSCallbacks
 * @property {(tick: UnifiedTick) => void} onTick
 * @property {(connected: boolean, info?: Object) => void} onStatus
 * @property {(err: Error) => void} onError
 */

/**
 * @typedef {Object} WSConnection
 * @property {() => void} close
 * @property {(instruments: Array<{exchangeSegment: string, securityId: string|number}>) => void} subscribe
 * @property {() => boolean} isConnected
 */

export const REST_ENDPOINTS = Object.freeze([
  "option-chain",
  "expiry-list",
  "ltp",
  "historical",
  "instruments",
  "test-connection",
]);

/** App-level normalized exchange segments. */
export const EXCHANGE_SEGMENTS = Object.freeze({
  IDX_I: "IDX_I",
  NSE_EQ: "NSE_EQ",
  NSE_FNO: "NSE_FNO",
  NSE_CUR: "NSE_CUR",
  BSE_EQ: "BSE_EQ",
  BSE_FNO: "BSE_FNO",
  BSE_IDX: "BSE_IDX",
  MCX_COMM: "MCX_COMM",
});
