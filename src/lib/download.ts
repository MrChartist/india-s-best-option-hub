/**
 * One browser-download helper for the whole app (CSV, JSON, PNG ...).
 *
 * CSV text gets a UTF-8 byte-order mark so Excel opens it as UTF-8 and the ₹ sign, Δ and other
 * non-ASCII characters survive. Errors (blocked downloads, no DOM) are swallowed and reported
 * through the return value so callers can show a toast if they want to.
 */
import { nowIST } from "@/lib/options";

const BOM = "﻿";

/** Normalise a MIME type: text types always carry an explicit UTF-8 charset. */
export function withCharset(mime: string): string {
  if (!/^text\/|^application\/(json|xml)/i.test(mime) || /charset=/i.test(mime)) return mime;
  return `${mime};charset=utf-8`;
}

/** Payload for a text download: CSV gets a BOM (once). */
export function textPayload(text: string, mime: string): string {
  return /^text\/csv/i.test(mime) && !text.startsWith(BOM) ? BOM + text : text;
}

/** Save a Blob under `name`. Returns false when the browser blocked it. */
export function downloadBlob(name: string, blob: Blob): boolean {
  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  } catch {
    return false;
  }
}

/** Save text under `name` (default MIME text/csv). */
export function downloadText(name: string, text: string, mime = "text/csv"): boolean {
  const type = withCharset(mime);
  try {
    return downloadBlob(name, new Blob([textPayload(text, type)], { type }));
  } catch {
    return false;
  }
}

/** Filename-safe IST timestamp, e.g. "2026-10-17-1432". */
export function istFileStamp(now: Date = new Date()): string {
  const t = nowIST(now);
  if (!t.date) return "unknown";
  return `${t.date}-${String(t.hh).padStart(2, "0")}${String(t.mm).padStart(2, "0")}`;
}
