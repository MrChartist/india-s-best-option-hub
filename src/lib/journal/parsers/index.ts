/** Tradebook importers for Zerodha, Dhan, Upstox and Angel One, with header-based auto-detection. */
import type { JournalSource, ParseResult } from "../types";
import { normHeader, parseCsv } from "./csv";
import { ANGEL_SPEC, parseAngel } from "./angel";
import { DHAN_SPEC, parseDhan } from "./dhan";
import type { BrokerSpec } from "./engine";
import { UPSTOX_SPEC, parseUpstox } from "./upstox";
import { ZERODHA_SPEC, parseZerodha } from "./zerodha";

export { parseAngel, parseDhan, parseUpstox, parseZerodha };
export { parseCsv } from "./csv";
export { parseInstrument, parseDateTime, monthlyExpiryOf, contractFromColumns } from "./contract";

export type BrokerId = "zerodha" | "dhan" | "upstox" | "angel";
export const BROKERS: Array<{ id: BrokerId; name: string; howTo: string }> = [
  { id: "zerodha", name: "Zerodha", howTo: "Console → Reports → Tradebook → segment F&O → download CSV." },
  { id: "dhan", name: "Dhan", howTo: "web.dhan.co → Statements → Trade History → F&O → export CSV." },
  { id: "upstox", name: "Upstox", howTo: "Upstox Pro → Reports → Trade → F&O → download CSV." },
  { id: "angel", name: "Angel One", howTo: "Angel One web → Reports → Trade Book → F&O → download CSV." },
];

const SPECS: Record<BrokerId, BrokerSpec> = { zerodha: ZERODHA_SPEC, dhan: DHAN_SPEC, upstox: UPSTOX_SPEC, angel: ANGEL_SPEC };
const PARSERS: Record<BrokerId, (t: string) => ParseResult> = { zerodha: parseZerodha, dhan: parseDhan, upstox: parseUpstox, angel: parseAngel };

/** Guess the broker from the header row(s): the spec with the most signature headers wins. */
export function detectBroker(text: string): BrokerId | null {
  const rows = parseCsv(text).slice(0, 15);
  let best: { id: BrokerId; score: number } | null = null;
  for (const r of rows) {
    const set = new Set(r.cells.map(normHeader));
    for (const id of Object.keys(SPECS) as BrokerId[]) {
      const score = SPECS[id].signature.filter((h) => set.has(normHeader(h))).length;
      if (score > 0 && (!best || score > best.score)) best = { id, score };
    }
  }
  return best?.id ?? null;
}

/** Parse a tradebook with a named broker, or auto-detect (falls back to trying every parser). */
export function parseTradebook(text: string, broker: BrokerId | "auto" = "auto"): ParseResult & { broker: BrokerId | null } {
  if (broker !== "auto") return { ...PARSERS[broker](text), broker };
  const guess = detectBroker(text);
  if (guess) return { ...PARSERS[guess](text), broker: guess };
  let best: (ParseResult & { broker: BrokerId | null }) | null = null;
  for (const id of Object.keys(PARSERS) as BrokerId[]) {
    const r = PARSERS[id](text);
    if (!best || r.fills.length > best.fills.length) best = { ...r, broker: id };
  }
  return best ?? { source: "zerodha" as JournalSource, fills: [], issues: [{ line: 1, message: "Empty file." }], rows: 0, broker: null };
}
