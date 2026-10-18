/**
 * TradeSmart symbol masters: https://v2api.tradesmartonline.in/<SEG>_symbols.txt.zip, the standard Noren
 * layout (same columns as Shoonya's files; see shoonyaInstruments.mjs). Needs live verification: the
 * official docs page was unreachable (Cloudflare), the URLs come from the previous module and OpenAlgo.
 */

import { loadZippedSegment } from "./shoonyaInstruments.mjs";

export const MASTER_ROOT = "https://v2api.tradesmartonline.in";

export const loadSegment = (segment) => loadZippedSegment(MASTER_ROOT, segment, "TradeSmart");
