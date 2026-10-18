/** Minimal RFC 4180 CSV reader (quoted fields, escaped quotes, CRLF, BOM) plus header helpers. */

/** Parse CSV text into rows of cells. Blank lines are dropped; line numbers are kept for messages. */
export function parseCsv(text: string): Array<{ line: number; cells: string[] }> {
  const src = (text ?? "").replace(/^\uFEFF/, "");
  const rows: Array<{ line: number; cells: string[] }> = [];
  let cells: string[] = [];
  let cell = "";
  let inQuotes = false;
  let line = 1;
  let rowLine = 1;
  const delim = sniffDelimiter(src);
  const endRow = () => {
    cells.push(cell);
    if (cells.some((c) => c.trim() !== "")) rows.push({ line: rowLine, cells: cells.map((c) => c.trim()) });
    cells = [];
    cell = "";
  };
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else inQuotes = false;
      } else {
        if (ch === "\n") line++;
        cell += ch;
      }
      continue;
    }
    if (ch === '"' && cell.trim() === "") {
      cell = "";
      inQuotes = true;
    } else if (ch === delim) {
      cells.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      endRow();
      line++;
      rowLine = line;
    } else cell += ch;
  }
  if (cell !== "" || cells.length) endRow();
  return rows;
}

/** Comma unless the first line has more semicolons or tabs. */
function sniffDelimiter(src: string): string {
  const first = src.slice(0, Math.max(0, src.indexOf("\n")) || src.length);
  const count = (c: string) => first.split(c).length - 1;
  const best = [",", ";", "\t"].map((c) => [c, count(c)] as const).sort((a, b) => b[1] - a[1])[0];
  return best && best[1] > 0 ? best[0] : ",";
}

/** Normalise a header cell for matching: lower case, letters and digits only. */
export function normHeader(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Index of the first header matching any alias (normalised), or -1. */
export function findColumn(headers: string[], aliases: string[]): number {
  const norm = headers.map(normHeader);
  for (const a of aliases) {
    const i = norm.indexOf(normHeader(a));
    if (i >= 0) return i;
  }
  return -1;
}

/** Parse a number that may carry commas, ₹, spaces or a trailing Cr/Dr. NaN when empty. */
export function parseNum(s: string | undefined): number {
  if (s === undefined) return NaN;
  const t = s.replace(/[₹,\s]/g, "").replace(/(cr|dr)$/i, "");
  if (!t) return NaN;
  const v = Number(t);
  return Number.isFinite(v) ? v : NaN;
}
