/**
 * PNG export for the payoff chart: clone the Recharts SVG, resolve CSS variables (hsl(var(--x)))
 * to concrete colours, serialise it, draw it onto a canvas with a title band and save the PNG.
 */

function rootVar(name: string): string {
  try {
    return getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim();
  } catch {
    return "";
  }
}

/** Replace every var(--token) with its computed value so the SVG renders outside the page. */
export function resolveCssVars(value: string): string {
  return value.replace(/var\(--([\w-]+)\)/g, (_m, name: string) => rootVar(name) || "0 0% 50%");
}

const COLOUR_ATTRS = ["fill", "stroke", "stop-color", "color", "style", "flood-color"];

function inlineSvg(svg: SVGSVGElement): string {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const walk = (el: Element) => {
    for (const attr of COLOUR_ATTRS) {
      const v = el.getAttribute(attr);
      if (v && v.includes("var(--")) el.setAttribute(attr, resolveCssVars(v));
    }
    for (const child of Array.from(el.children)) walk(child);
  };
  walk(clone);
  const { width, height } = svg.getBoundingClientRect();
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", String(Math.round(width)));
  clone.setAttribute("height", String(Math.round(height)));
  clone.setAttribute("font-family", "Inter, system-ui, sans-serif");
  return new XMLSerializer().serializeToString(clone);
}

export interface ChartImageOptions {
  title: string;
  subtitle: string;
  /** Optional tag drawn top-right, e.g. "SAMPLE DATA" (never omitted when the data is sample). */
  tag?: string;
}

/** Render the chart in `container` with a title band and footer to a PNG blob. Null when the browser blocks it. */
export async function renderChartPng(container: HTMLElement | null, opts: ChartImageOptions): Promise<Blob | null> {
  if (!container || typeof document === "undefined") return null;
  const svg = container.querySelector("svg.recharts-surface") as SVGSVGElement | null;
  if (!svg) return null;
  const markup = inlineSvg(svg);
  const { width, height } = svg.getBoundingClientRect();
  const scale = Math.min(3, Math.max(2, window.devicePixelRatio || 2));
  const pad = 24;
  const header = 64;
  const footer = 32;
  const W = Math.round(width + pad * 2);
  const H = Math.round(height + header + footer);
  const canvas = document.createElement("canvas");
  canvas.width = W * scale;
  canvas.height = H * scale;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.scale(scale, scale);
  const hsl = (name: string, alpha?: number) => {
    const raw = rootVar(name) || "0 0% 50%";
    return alpha === undefined ? `hsl(${raw})` : `hsl(${raw} / ${alpha})`;
  };
  ctx.fillStyle = hsl("card");
  ctx.fillRect(0, 0, W, H);
  let tagW = 0;
  if (opts.tag) {
    ctx.font = "700 11px Inter, system-ui, sans-serif";
    tagW = ctx.measureText(opts.tag).width + 16;
    ctx.fillStyle = hsl("warning", 0.15);
    ctx.fillRect(W - pad - tagW, 14, tagW, 20);
    ctx.fillStyle = hsl("warning");
    ctx.fillText(opts.tag, W - pad - tagW + 8, 28);
  }
  ctx.fillStyle = hsl("foreground");
  ctx.font = "700 16px 'Plus Jakarta Sans', Inter, system-ui, sans-serif";
  let title = opts.title;
  const titleMax = W - pad * 2 - (tagW ? tagW + 12 : 0);
  while (title.length > 1 && ctx.measureText(title).width > titleMax) title = title.slice(0, -2) + "…";
  ctx.fillText(title, pad, 28);
  ctx.fillStyle = hsl("muted-foreground");
  ctx.font = "500 12px Inter, system-ui, sans-serif";
  let sub = opts.subtitle;
  const maxW = W - pad * 2;
  if (ctx.measureText(sub).width > maxW) {
    while (sub.length > 1 && ctx.measureText(`${sub}…`).width > maxW) sub = sub.slice(0, -1);
    sub = `${sub.trimEnd()}…`;
  }
  ctx.fillText(sub, pad, 48);
  ctx.fillText("Mr. Chartist Options Terminal · mrchartist.com · For education, not investment advice", pad, H - 12);

  const img = new Image();
  const url = URL.createObjectURL(new Blob([markup], { type: "image/svg+xml;charset=utf-8" }));
  try {
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("svg load failed"));
      img.src = url;
    });
    ctx.drawImage(img, pad, header, width, height);
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
}

function downloadBlob(blob: Blob, fileName: string): void {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** Render and download the chart as a PNG. */
export async function exportChartPng(container: HTMLElement | null, opts: ChartImageOptions & { fileName: string }): Promise<boolean> {
  const blob = await renderChartPng(container, opts);
  if (!blob) return false;
  downloadBlob(blob, opts.fileName);
  return true;
}

export type CopyImageResult = "copied" | "shared" | "downloaded" | "failed";

/**
 * Copy the chart image to the clipboard (paste straight into X or WhatsApp Web). Where image
 * clipboard is unsupported (older Safari, Firefox), fall back to the share sheet, then a download.
 */
export async function copyChartPng(container: HTMLElement | null, opts: ChartImageOptions & { fileName: string }): Promise<CopyImageResult> {
  // Safari only allows clipboard writes started inside the click, so hand ClipboardItem a promise.
  const pending = renderChartPng(container, opts).then((b) => {
    if (!b) throw new Error("render failed");
    return b;
  });
  try {
    const Item = (window as unknown as { ClipboardItem?: typeof ClipboardItem }).ClipboardItem;
    if (Item && navigator.clipboard?.write) {
      await navigator.clipboard.write([new Item({ "image/png": pending })]);
      return "copied";
    }
  } catch {
    /* permission denied or unsupported: try the share sheet */
  }
  const blob = await pending.catch(() => null);
  if (!blob) return "failed";
  try {
    const file = new File([blob], opts.fileName, { type: "image/png" });
    if (typeof navigator.canShare === "function" && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: opts.title });
      return "shared";
    }
  } catch {
    /* share cancelled or blocked: download instead */
  }
  downloadBlob(blob, opts.fileName);
  return "downloaded";
}

/** Download a text file (CSV) in the browser. */
export function downloadText(text: string, fileName: string, mime = "text/csv;charset=utf-8"): void {
  try {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: mime }));
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  } catch {
    /* download blocked: nothing else to do */
  }
}
