/**
 * Kite instrument-token resolution + dump caching.
 * Kite uses a numeric `instrument_token` per scrip. The full dump is a CSV
 * fetched from https://api.kite.trade/instruments — refreshed daily.
 */

const KITE_INSTRUMENTS_URL = "https://api.kite.trade/instruments";

// Static map for indices (Kite never lists these in /instruments with predictable keys —
// these are well-known and stable).
const INDEX_TOKENS = {
  NIFTY: { instrumentToken: 256265, exchange: "NSE", tradingSymbol: "NIFTY 50" },
  BANKNIFTY: { instrumentToken: 260105, exchange: "NSE", tradingSymbol: "NIFTY BANK" },
  FINNIFTY: { instrumentToken: 257801, exchange: "NSE", tradingSymbol: "NIFTY FIN SERVICE" },
  MIDCPNIFTY: { instrumentToken: 288009, exchange: "NSE", tradingSymbol: "NIFTY MID SELECT" },
  INDIAVIX: { instrumentToken: 264969, exchange: "NSE", tradingSymbol: "INDIA VIX" },
  SENSEX: { instrumentToken: 265, exchange: "BSE", tradingSymbol: "SENSEX" },
};

// Map app-level option symbol → Kite "name" filter (exchange.tradingsymbol uses different conventions)
const OPTION_NAME_MAP = {
  NIFTY: "NIFTY",
  BANKNIFTY: "BANKNIFTY",
  FINNIFTY: "FINNIFTY",
  MIDCPNIFTY: "MIDCPNIFTY",
  SENSEX: "SENSEX",
};

let cachedDump = null;
let cachedDumpAt = 0;
const DUMP_TTL = 8 * 60 * 60 * 1000; // 8 hours — Kite rebuilds it once per day

export function resolveInstrumentToken(symbol) {
  if (!symbol) return null;
  const info = INDEX_TOKENS[symbol.toUpperCase()];
  return info?.instrumentToken ?? null;
}

export function resolveIndex(symbol) {
  return INDEX_TOKENS[symbol?.toUpperCase()] || null;
}

export function resolveOptionName(symbol) {
  return OPTION_NAME_MAP[symbol?.toUpperCase()] || symbol?.toUpperCase() || null;
}

/** Fetch full Kite instruments dump (CSV), parse, and cache. */
export async function fetchInstrumentsDump(apiKey, accessToken) {
  if (cachedDump && Date.now() - cachedDumpAt < DUMP_TTL) return cachedDump;

  if (!apiKey || !accessToken) {
    throw new Error(
      "Kite access_token missing — open /broker-settings and click 'Login with Kite' to generate one. " +
      "(api_key alone is not enough; the access_token expires every day at ~06:00 IST.)"
    );
  }

  console.log("  📥 Downloading Kite instruments CSV...");
  const res = await fetch(KITE_INSTRUMENTS_URL, {
    headers: {
      "X-Kite-Version": "3",
      "Authorization": `token ${apiKey}:${accessToken}`,
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    if (res.status === 403 || res.status === 401 || /token/i.test(body)) {
      throw new Error(
        "Kite rejected the access_token (likely expired). Open /broker-settings → 'Refresh Token' on the Zerodha card."
      );
    }
    throw new Error(`Failed to download Kite instruments: ${res.status} ${body.slice(0, 200)}`);
  }
  const csvText = await res.text();

  const lines = csvText.split("\n");
  const header = lines[0].split(",").map((h) => h.trim());
  const idx = (k) => header.indexOf(k);

  const instruments = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    if (cols.length < 8) continue;

    const exchange = cols[idx("exchange")]?.trim();
    const segment = cols[idx("segment")]?.trim();
    const instrumentType = cols[idx("instrument_type")]?.trim();

    // Map Kite's exchange/segment to our normalized scheme
    let exchangeSegment;
    if (exchange === "NSE" && segment === "NSE") exchangeSegment = "NSE_EQ";
    else if (exchange === "NFO") exchangeSegment = "NSE_FNO";
    else if (exchange === "BSE" && segment === "BSE") exchangeSegment = "BSE_EQ";
    else if (exchange === "BFO") exchangeSegment = "BSE_FNO";
    else if (segment === "INDICES") exchangeSegment = "IDX_I";
    else continue; // skip MCX, CDS, etc.

    const expiryRaw = cols[idx("expiry")]?.trim();
    const strikeRaw = cols[idx("strike")]?.trim();
    const lotRaw = cols[idx("lot_size")]?.trim();

    instruments.push({
      securityId: cols[idx("instrument_token")]?.trim(),
      symbol: cols[idx("name")]?.trim() || cols[idx("tradingsymbol")]?.trim(),
      tradingSymbol: cols[idx("tradingsymbol")]?.trim(),
      exchangeSegment,
      instrumentType,
      lotSize: parseInt(lotRaw) || 1,
      expiryDate: expiryRaw || undefined,
      strikePrice: parseFloat(strikeRaw) || undefined,
      optionType: instrumentType === "CE" || instrumentType === "PE" ? instrumentType : undefined,
      // Kite-specific extras kept for chain composer + WS subscribe
      _kiteExchange: exchange,
    });
  }

  if (instruments.length === 0) {
    // Don't cache an empty parse — likely an auth/format problem. Fail loud so the
    // next request can retry instead of silently serving zero contracts.
    throw new Error(
      `Kite instruments parse returned 0 rows (CSV header: ${header.slice(0, 5).join(", ")}…). ` +
      "Verify your access_token is valid (Login with Kite in /broker-settings)."
    );
  }

  cachedDump = { instruments, count: instruments.length };
  cachedDumpAt = Date.now();
  console.log(`  ✅ Parsed ${instruments.length} Kite instruments`);

  // Diagnostic: count CE/PE rows per common underlying so misalignment is obvious.
  // (e.g. if NIFTY shows 0 but a sample row has name="Nifty 50", you'll see it here.)
  const sampleNames = new Map();
  let opts = 0;
  for (const ins of instruments) {
    if (ins.optionType === "CE" || ins.optionType === "PE") {
      opts++;
      const key = ins.symbol || "(blank)";
      sampleNames.set(key, (sampleNames.get(key) || 0) + 1);
    }
  }
  const top = Array.from(sampleNames.entries()).sort((a, b) => b[1] - a[1]).slice(0, 8);
  console.log(`  📊 Kite option rows: ${opts} total. Top names: ${top.map(([k, v]) => `${k}=${v}`).join(", ")}`);

  return cachedDump;
}

/**
 * Match an instrument to an underlying. Kite's `name` column is *usually* the
 * underlying ("NIFTY", "BANKNIFTY"), but some rows have it blank, capitalized
 * differently ("Nifty"), or set to the long index name ("NIFTY 50"). We treat
 * that as advisory and primarily key off the tradingsymbol prefix with a
 * boundary guard — `^NIFTY\d` matches "NIFTY24N07…" but not "BANKNIFTY24N07…".
 */
function matchesUnderlying(ins, name) {
  if (!name) return false;
  // 1. Exact name match (case-insensitive, trimmed)
  if (ins.symbol && ins.symbol.toUpperCase() === name) return true;
  // 2. Tradingsymbol prefix with date-digit boundary
  const ts = ins.tradingSymbol || "";
  return new RegExp(`^${name}\\d`).test(ts);
}

/** Filter the dump to a specific underlying + option type, optionally to a single expiry. */
export function filterOptionLegs(dump, underlying, expiryDate) {
  const name = resolveOptionName(underlying);
  if (!name) return [];
  return dump.instruments.filter((ins) => {
    if (ins.optionType !== "CE" && ins.optionType !== "PE") return false;
    if (!matchesUnderlying(ins, name)) return false;
    if (expiryDate && ins.expiryDate !== expiryDate) return false;
    return true;
  });
}

/** Unique sorted expiry dates for an underlying. */
export function listExpiries(dump, underlying) {
  const name = resolveOptionName(underlying);
  const seen = new Set();
  for (const ins of dump.instruments) {
    if (ins.optionType !== "CE" && ins.optionType !== "PE") continue;
    if (!matchesUnderlying(ins, name)) continue;
    if (ins.expiryDate) seen.add(ins.expiryDate);
  }
  return Array.from(seen).sort();
}
