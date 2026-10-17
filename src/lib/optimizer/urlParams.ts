/** URL parameters for the Strategy Optimizer: /optimizer?symbol=BANKNIFTY&target=56500. */
import { normalizeSymbol } from "@/lib/options";

/** ?symbol= (letters, digits, &, - only) and ?target= (a positive number) from the URL. */
export function parseOptimizerParams(params: URLSearchParams): { symbol: string | null; target: number | null } {
  const rawSym = params.get("symbol");
  const sym = rawSym ? normalizeSymbol(rawSym) : "";
  const symbol = sym && /^[A-Z0-9&-]{1,20}$/.test(sym) ? sym : null;
  const rawTarget = params.get("target");
  const t = rawTarget !== null && rawTarget.trim() !== "" ? Number(rawTarget.replace(/,/g, "")) : NaN;
  return { symbol, target: Number.isFinite(t) && t > 0 && t < 1e7 ? Math.round(t * 100) / 100 : null };
}
