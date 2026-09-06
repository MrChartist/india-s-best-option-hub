/**
 * Fyers `/data/options-chain-v3` response parsing.
 *
 * Pulled out of fyers.mjs (which just does auth + fetch orchestration) to
 * keep both files well under the 300-line cap.
 */

/** "24-03-2026" -> "2026-03-24". Fyers documents expiryData.date as DD-MM-YYYY. */
export function parseExpiryDate(ddmmyyyy) {
  if (!ddmmyyyy || typeof ddmmyyyy !== "string") return null;
  const [dd, mm, yyyy] = ddmmyyyy.split("-");
  if (!dd || !mm || !yyyy) return null;
  return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
}

/**
 * Fyers embeds the underlying itself as one row in `optionsChain` with
 * option_type: "" and strike_price: -1 — that row's `ltp` is the spot price.
 */
function findSpot(optionsChain) {
  const underlyingRow = optionsChain.find((item) => !item.option_type || item.strike_price === -1);
  return Number(underlyingRow?.ltp) || 0;
}

/**
 * Use Fyers' own greeks (present when the request was made with greeks=1) when they look real.
 * UNVERIFIED: research did not confirm whether Fyers' greeks.iv is already a percentage
 * (e.g. 14.2, matching this app's Leg.iv convention) or a decimal (0.142). Assuming
 * percentage here to match Fyers' documented UI display convention; if live data shows
 * IV values consistently < 1 for normal index options, this needs a *100 fix.
 */
function greeksFromFyers(item) {
  const g = item.greeks;
  if (!g) return null;
  const iv = Number(g.iv);
  if (!(iv > 0)) return null; // 0/missing — treat as absent, fall back to Black-Scholes
  return {
    iv,
    delta: Number(g.delta) || 0,
    gamma: Number(g.gamma) || 0,
    theta: Number(g.theta) || 0,
    vega: Number(g.vega) || 0,
  };
}

/**
 * Build the app's reference { oc, last_price } shape from a raw Fyers
 * optionsChain array. `computeIVAndGreeks` is injected (from blackScholes.mjs)
 * so this file stays a pure transform with no cross-imports of its own.
 */
export function buildOptionsChain(optionsChain, { daysToExpiry, computeIVAndGreeks }) {
  const spot = findSpot(optionsChain);
  const oc = {};

  for (const item of optionsChain) {
    const type = item.option_type;
    if (type !== "CE" && type !== "PE") continue; // skip the embedded underlying row
    const strike = Number(item.strike_price);
    if (!(strike > 0)) continue;

    const strikeKey = String(strike);
    if (!oc[strikeKey]) oc[strikeKey] = {};

    const ltp = Number(item.ltp) || 0;
    const oi = Number(item.oi) || 0;
    const prevOi = item.prev_oi != null ? Number(item.prev_oi) : null;
    const oiChg = item.oich != null ? Number(item.oich) : prevOi != null ? oi - prevOi : undefined;

    const greeks =
      greeksFromFyers(item) || computeIVAndGreeks({ ltp, spot, strike, daysToExpiry, type });

    const leg = {
      last_price: ltp,
      oi,
      volume: Number(item.volume) || 0,
      iv: greeks.iv,
      delta: greeks.delta,
      gamma: greeks.gamma,
      theta: greeks.theta,
      vega: greeks.vega,
      bid_price: Number(item.bid) || 0,
      ask_price: Number(item.ask) || 0,
    };
    if (oiChg !== undefined) leg.oi_chg = oiChg;

    oc[strikeKey][type.toLowerCase()] = leg;
  }

  return { oc, last_price: spot };
}
